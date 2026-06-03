import 'server-only'

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm'

import { db } from 'src/db/client'
import {
  exercises,
  progressions,
  routines,
  sessions,
  setLogs,
} from 'src/db/schema'
import type {
  ExerciseRow,
  ProgressionRow,
  RoutineRow,
  SessionRow,
  SetLogRow,
} from 'src/db/types'
import { resolveStatsScope, type StatsScope } from 'src/lib/stats'

export type StatsIndexData = {
  scope: StatsScope
  /** Active routines selected by the current scope. */
  routines: RoutineRow[]
  /** All active routines — used by the scope selector. */
  activeRoutines: RoutineRow[]
  exercises: ExerciseRow[]
  /** Completed sessions for the scoped routines. */
  sessions: SessionRow[]
  /** Most recent completedAt per exercise across all set types. */
  lastPerformedByExercise: Map<number, Date>
  /** Set logs with their sessions for weighted exercises only (for PRs). */
  weightedSetLogs: Array<{ setLog: SetLogRow; session: SessionRow }>
  /** Progressions per weighted exercise, oldest-first (for trend + current weight). */
  progressionsByExercise: Map<number, ProgressionRow[]>
  /** Archived routines that have at least one completed session (for selector). */
  archivedWithHistory: RoutineRow[]
  /** MAX(completedAt) per archived-with-history routine — recency order (R9) + row labels (R7). */
  archivedLastTrained: Map<number, Date>
}

/** Batched, no-N+1, scope-aware read for the stats index page. */
export async function getStatsIndexData(
  rawRoutineParam?: string,
): Promise<StatsIndexData> {
  // 1. All routines (active + archived), alphabetical.
  const allRoutines = db
    .select()
    .from(routines)
    .orderBy(asc(routines.name))
    .all()

  const activeRoutineList = allRoutines.filter(r => r.archivedAt === null)
  const archivedRoutineList = allRoutines.filter(r => r.archivedAt !== null)

  // 2. Find which archived routines have at least one completed session and
  //    compute MAX(completedAt) per routine for recency order + row labels.
  // inArray([]) guard: skip the query entirely when there are no archived rows.
  const archivedWithHistorySet = new Set<number>()
  const archivedLastTrained = new Map<number, Date>()
  if (archivedRoutineList.length > 0) {
    const archivedIds = archivedRoutineList.map(r => r.id)
    const historyRows = db
      .select({
        routineId: sessions.routineId,
        lastTrainedMs: sql<number | null>`max(${sessions.completedAt})`,
      })
      .from(sessions)
      .where(
        and(
          inArray(sessions.routineId, archivedIds),
          isNotNull(sessions.completedAt),
        ),
      )
      .groupBy(sessions.routineId)
      .all()
    for (const row of historyRows) {
      archivedWithHistorySet.add(row.routineId)
      if (row.lastTrainedMs !== null) {
        archivedLastTrained.set(row.routineId, new Date(row.lastTrainedMs))
      }
    }
  }

  const archivedWithHistory = archivedRoutineList.filter(r =>
    archivedWithHistorySet.has(r.id),
  )

  // 3. Resolve scope using the pure helper.
  const routinesWithMeta = allRoutines.map(r => ({
    id: r.id,
    archivedAt: r.archivedAt,
    hasHistory: archivedWithHistorySet.has(r.id),
  }))
  const scope = resolveStatsScope(rawRoutineParam, routinesWithMeta)

  // 4. Determine which routines are in scope.
  let scopedRoutines: RoutineRow[]
  if (scope.kind === 'all') {
    scopedRoutines = activeRoutineList
  } else {
    const found = allRoutines.find(r => r.id === scope.id)
    scopedRoutines = found ? [found] : []
  }

  const routineIds = scopedRoutines.map(r => r.id)

  // inArray([]) guard: return early when scope is empty.
  if (routineIds.length === 0) {
    return {
      scope,
      routines: [],
      activeRoutines: activeRoutineList,
      exercises: [],
      sessions: [],
      lastPerformedByExercise: new Map(),
      weightedSetLogs: [],
      progressionsByExercise: new Map(),
      archivedWithHistory,
      archivedLastTrained,
    }
  }

  // 5. Exercises for the scoped routines.
  // Archived scope reads archived exercises too (frozen history, model C).
  const exerciseWhere =
    scope.kind === 'archived'
      ? inArray(exercises.routineId, routineIds)
      : and(
          inArray(exercises.routineId, routineIds),
          isNull(exercises.archivedAt),
        )

  const exerciseList = db
    .select()
    .from(exercises)
    .where(exerciseWhere)
    .orderBy(asc(exercises.routineId), asc(exercises.orderInRoutine))
    .all()

  if (exerciseList.length === 0) {
    return {
      scope,
      routines: scopedRoutines,
      activeRoutines: activeRoutineList,
      exercises: [],
      sessions: [],
      lastPerformedByExercise: new Map(),
      weightedSetLogs: [],
      progressionsByExercise: new Map(),
      archivedWithHistory,
      archivedLastTrained,
    }
  }

  const exerciseIds = exerciseList.map(e => e.id)
  const weightedIds = exerciseList
    .filter(e => e.type === 'weighted')
    .map(e => e.id)

  // 6. Completed sessions for the scoped routines.
  const sessionList = db
    .select()
    .from(sessions)
    .where(
      and(
        inArray(sessions.routineId, routineIds),
        isNotNull(sessions.completedAt),
      ),
    )
    .orderBy(desc(sessions.completedAt), desc(sessions.id))
    .all()

  // 7. Last-performed: MAX(completedAt) per exercise (all exercise types).
  // Uses raw sql<number> to retrieve the stored timestamp integer, then converts
  // to Date — avoids Drizzle mode-translation uncertainty in the aggregate path.
  const lastPerformedRows = db
    .select({
      exerciseId: setLogs.exerciseId,
      lastPerformedMs: sql<number | null>`max(${sessions.completedAt})`,
    })
    .from(setLogs)
    .innerJoin(sessions, eq(setLogs.sessionId, sessions.id))
    .where(
      and(
        inArray(setLogs.exerciseId, exerciseIds),
        isNotNull(sessions.completedAt),
      ),
    )
    .groupBy(setLogs.exerciseId)
    .all()

  const lastPerformedByExercise = new Map<number, Date>()
  for (const row of lastPerformedRows) {
    if (row.lastPerformedMs !== null) {
      lastPerformedByExercise.set(row.exerciseId, new Date(row.lastPerformedMs))
    }
  }

  // 8. Weighted set logs and progressions (inArray guard on weightedIds).
  let weightedSetLogs: Array<{ setLog: SetLogRow; session: SessionRow }> = []
  const progressionsByExercise = new Map<number, ProgressionRow[]>()

  if (weightedIds.length > 0) {
    weightedSetLogs = db
      .select({ setLog: setLogs, session: sessions })
      .from(setLogs)
      .innerJoin(sessions, eq(setLogs.sessionId, sessions.id))
      .where(
        and(
          inArray(setLogs.exerciseId, weightedIds),
          isNotNull(sessions.completedAt),
        ),
      )
      .orderBy(
        desc(sessions.completedAt),
        desc(sessions.id),
        asc(setLogs.setNumber),
      )
      .all()

    const allProgressions = db
      .select()
      .from(progressions)
      .where(inArray(progressions.exerciseId, weightedIds))
      .orderBy(asc(progressions.effectiveFrom), asc(progressions.id))
      .all()

    for (const p of allProgressions) {
      const group = progressionsByExercise.get(p.exerciseId) ?? []
      group.push(p)
      progressionsByExercise.set(p.exerciseId, group)
    }
  }

  return {
    scope,
    routines: scopedRoutines,
    activeRoutines: activeRoutineList,
    exercises: exerciseList,
    sessions: sessionList,
    lastPerformedByExercise,
    weightedSetLogs,
    progressionsByExercise,
    archivedWithHistory,
    archivedLastTrained,
  }
}
