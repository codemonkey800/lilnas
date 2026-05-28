import 'server-only'

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db } from 'src/db/client'
import {
  ArchiveBlockedByActiveSession,
  NotFoundError,
  ValidationError,
} from 'src/db/errors'
import { type DayCode, exercises, routines, sessions } from 'src/db/schema'
import type { ExerciseRow, RoutineRow } from 'src/db/types'
import { logger } from 'src/lib/logger'

// ─── Reads ──────────────────────────────────────────────────────────────────

export type ListRoutinesArgs = { includeArchived?: boolean }

export async function listRoutines(
  args: ListRoutinesArgs = {},
): Promise<RoutineRow[]> {
  const base = db.select().from(routines)
  if (args.includeArchived) {
    return base.orderBy(asc(routines.name)).all()
  }
  return base
    .where(isNull(routines.archivedAt))
    .orderBy(asc(routines.name))
    .all()
}

export type GetRoutineArgs = { id: number }

export async function getRoutine(
  args: GetRoutineArgs,
): Promise<RoutineRow | null> {
  const row = db.select().from(routines).where(eq(routines.id, args.id)).get()
  return row ?? null
}

export type RoutineWithExercises = {
  routine: RoutineRow
  exercises: ExerciseRow[]
}

export type GetRoutineWithExercisesArgs = {
  id: number
  includeArchived?: boolean
}

export async function getRoutineWithExercises(
  args: GetRoutineWithExercisesArgs,
): Promise<RoutineWithExercises | null> {
  const routine = await getRoutine({ id: args.id })
  if (!routine) return null
  const whereClause = args.includeArchived
    ? eq(exercises.routineId, args.id)
    : and(eq(exercises.routineId, args.id), isNull(exercises.archivedAt))
  const list = db
    .select()
    .from(exercises)
    .where(whereClause)
    .orderBy(asc(exercises.orderInRoutine))
    .all()
  return { routine, exercises: list }
}

export type RoutineForHome = {
  routine: RoutineRow
  exerciseCount: number
  firstExercise: ExerciseRow | null
}

// Routines list for the home page — joins each non-archived routine with its
// exercise count and first non-archived exercise (by orderInRoutine) so the
// page never N+1s. Returns alphabetical by routine name to match R9 and the
// default `listRoutines` ordering.
//
// Implementation: two index-friendly queries — one for routines, one for
// exercises filtered by `inArray(routineId)` — grouped in-process. A single
// grouped SQL with window functions would work in SQLite but trades Drizzle
// composition clarity for marginal performance at home's expected scale
// (≤ ~20 routines).
export async function listRoutinesForHome(): Promise<RoutineForHome[]> {
  const routineList = db
    .select()
    .from(routines)
    .where(isNull(routines.archivedAt))
    .orderBy(asc(routines.name))
    .all()

  // Guard the empty case explicitly. `inArray(col, [])` emits `IN ()` on some
  // better-sqlite3 paths, which is invalid SQL; the first-deploy empty-state
  // flow hits this on every fresh install and must not throw.
  if (routineList.length === 0) return []

  const routineIds = routineList.map(r => r.id)
  const exerciseList = db
    .select()
    .from(exercises)
    .where(
      and(
        inArray(exercises.routineId, routineIds),
        isNull(exercises.archivedAt),
      ),
    )
    .orderBy(asc(exercises.routineId), asc(exercises.orderInRoutine))
    .all()

  const exercisesByRoutine = new Map<number, ExerciseRow[]>()
  for (const ex of exerciseList) {
    const group = exercisesByRoutine.get(ex.routineId)
    if (group) {
      group.push(ex)
    } else {
      exercisesByRoutine.set(ex.routineId, [ex])
    }
  }

  return routineList.map(routine => {
    const group = exercisesByRoutine.get(routine.id) ?? []
    return {
      routine,
      exerciseCount: group.length,
      firstExercise: group[0] ?? null,
    }
  })
}

// ─── Writes ─────────────────────────────────────────────────────────────────
//
// Mutations across the data layer are intentionally `async`-returning even
// though the underlying better-sqlite3 `db.transaction` is synchronous. The
// signature pins the API at `Promise<T>` so a future libSQL/Turso swap (or
// any other genuinely-async driver) is a non-breaking change for consumers
// (#34). The same convention applies to db/{exercises,sessions,setLogs,
// progressions}.ts.

export type CreateRoutineArgs = {
  name: string
  days: DayCode[]
}

export async function createRoutine(
  args: CreateRoutineArgs,
): Promise<RoutineRow> {
  if (args.name.trim() === '') {
    throw new ValidationError('routine name must be non-empty')
  }
  return db
    .insert(routines)
    .values({ name: args.name, days: args.days })
    .returning()
    .get()
}

export type UpdateRoutineArgs = {
  id: number
  name?: string
  days?: DayCode[]
}

// Reads-and-writes inside BEGIN IMMEDIATE so the existing-check and update
// are atomic vs concurrent archiveRoutine/deleteRoutine on the same id (#39).
// Bumps updated_at unconditionally (including for empty patches) so behavior
// matches `updateExercise` (#40).
export async function updateRoutine(
  args: UpdateRoutineArgs,
): Promise<RoutineRow> {
  if (args.name !== undefined && args.name.trim() === '') {
    throw new ValidationError('routine name must be non-empty')
  }
  try {
    return db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(routines)
          .where(eq(routines.id, args.id))
          .get()
        if (!existing) throw new NotFoundError('Routine', args.id)
        const patch: { name?: string; days?: DayCode[] } = {}
        if (args.name !== undefined) patch.name = args.name
        if (args.days !== undefined) patch.days = args.days
        return tx
          .update(routines)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(routines.id, args.id))
          .returning()
          .get()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('updateRoutine', args, err)
    throw err
  }
}

export type ArchiveRoutineArgs = { id: number }

// Archive the routine. Refuses while any active session references it —
// otherwise hydration could lose data when the routine's exercises become
// unreachable from default queries.
export async function archiveRoutine(
  args: ArchiveRoutineArgs,
): Promise<RoutineRow> {
  try {
    return db.transaction(
      tx => {
        const existing = tx
          .select()
          .from(routines)
          .where(eq(routines.id, args.id))
          .get()
        if (!existing) throw new NotFoundError('Routine', args.id)

        const activeCount = tx
          .select({ n: sql<number>`count(*)`.as('n') })
          .from(sessions)
          .where(
            and(eq(sessions.routineId, args.id), isNull(sessions.completedAt)),
          )
          .get()
        if ((activeCount?.n ?? 0) > 0) {
          throw new ArchiveBlockedByActiveSession('Routine', args.id)
        }

        return tx
          .update(routines)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(routines.id, args.id))
          .returning()
          .get()
      },
      { behavior: 'immediate' },
    )
  } catch (err) {
    logMutationError('archiveRoutine', args, err)
    throw err
  }
}

function logMutationError(
  op: string,
  args: Record<string, unknown>,
  err: unknown,
): void {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code
    logger.error({ msg: 'swole mutation failed', op, args, err, code })
  } else {
    logger.error({ msg: 'swole mutation failed', op, args, err })
  }
}
