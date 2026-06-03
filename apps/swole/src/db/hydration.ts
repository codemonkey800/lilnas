import 'server-only'

import type { SessionState, SetLog } from 'src/core/session-machine'
import { type RoutineWithIds, toRoutine, toSetLog } from 'src/db/mappers'
import { getProgressionsForSession } from 'src/db/progressions'
import { getRoutineWithExercises } from 'src/db/routines'
import { getActiveSession, getSession } from 'src/db/sessions'
import { getSetLogsForSession } from 'src/db/setLogs'
import {
  type CompletedSessionRow,
  type ExerciseRow,
  isCompletedSession,
  type ProgressionRow,
  type RoutineRow,
  type SessionRow,
  type SetLogRow,
} from 'src/db/types'
import { logger } from 'src/lib/logger'

export type HydratedSession = {
  session: SessionRow
  routine: RoutineWithIds
  sessionState: SessionState
  progressions: ProgressionRow[]
  // IDs of set_log rows that couldn't be hydrated. Empty in the happy path;
  // populated when a row references an unknown exercise or has a malformed
  // type-specific column. The UI can render a warning when this is non-empty
  // and the rest of the session is still usable.
  failedSetLogIds: number[]
}

export type CompletedHydratedSession = {
  session: CompletedSessionRow
  routine: RoutineRow
  exercises: ExerciseRow[]
  setLogs: SetLogRow[]
  progressions: ProgressionRow[]
  failedSetLogIds: number[]
}

// Shared per-row validation used by both hydration paths. Attempts toSetLog
// for each row; rows that fail (unknown exercise, malformed type-specific
// fields) are excluded and their ids recorded in failedSetLogIds.
// Both setLogs (FSM) and validRawRows are returned so each caller can take
// what it needs without a second pass.
function resolveSetLogs(
  rows: SetLogRow[],
  routine: RoutineWithIds,
  sessionId: number,
): { setLogs: SetLog[]; validRawRows: SetLogRow[]; failedSetLogIds: number[] } {
  const failedSetLogIds: number[] = []
  const setLogs: SetLog[] = []
  const validRawRows: SetLogRow[] = []

  for (const row of rows) {
    try {
      setLogs.push(toSetLog(row, routine))
      validRawRows.push(row)
    } catch (err) {
      failedSetLogIds.push(row.id)
      logger.error({
        msg: 'swole hydration: set_log skipped',
        setLogId: row.id,
        sessionId,
        exerciseId: row.exerciseId,
        err,
      })
    }
  }

  return { setLogs, validRawRows, failedSetLogIds }
}

// Reconstruct a SessionState from persisted rows. Composes the four queries
// the runner page (Survivor 4) needs and returns them as a typed bundle.
//
// `includeArchived: true` on getRoutineWithExercises is load-bearing — if an
// exercise referenced by this session's set_logs got archived (e.g. a race
// with archiveExercise that slipped past the guard), the hydration path
// still finds the exercise and translates exerciseIdx correctly. The runner
// UI can choose to render archived exercises with a visual cue, but the
// data layer never silently loses logs.
//
// A single bad set_log row no longer aborts the whole session (#13): the
// mapper failure is logged at error level and the row is filtered out. The
// rest of the session remains hydratable so the user doesn't lose access to
// other logs.
export type BuildSessionStateArgs = { sessionId: number }

export async function buildSessionState(
  args: BuildSessionStateArgs,
): Promise<HydratedSession | null> {
  const session = await getActiveSession({ id: args.sessionId })
  if (!session) return null

  const routineResult = await getRoutineWithExercises({
    id: session.routineId,
    includeArchived: true,
  })
  if (!routineResult) return null

  const routine = toRoutine(routineResult.routine, routineResult.exercises)
  const setLogRows = await getSetLogsForSession({ sessionId: args.sessionId })
  const progressions = await getProgressionsForSession({
    sessionId: args.sessionId,
  })

  const { setLogs, failedSetLogIds } = resolveSetLogs(
    setLogRows,
    routine,
    args.sessionId,
  )

  // `cursorOverride` is UI-transient — JumpTo never persists, so hydration
  // never reproduces it. The runner's next interaction will set it as
  // needed.
  const sessionState: SessionState = { setLogs }

  return { session, routine, sessionState, progressions, failedSetLogIds }
}

export type BuildCompletedSessionStateArgs = { sessionId: number }

// Hydrates a completed session for the read-only detail page. Returns raw
// rows (not FSM objects) since the detail page renders via formatSetRow.
// Uses the same per-row validation as buildSessionState so failedSetLogIds
// is identical across both hydration paths (Key Decision 5).
// Returns null for unknown ids and active sessions — caller should guard.
export async function buildCompletedSessionState(
  args: BuildCompletedSessionStateArgs,
): Promise<CompletedHydratedSession | null> {
  const session = await getSession({ id: args.sessionId })
  if (!session || !isCompletedSession(session)) return null

  const routineResult = await getRoutineWithExercises({
    id: session.routineId,
    includeArchived: true,
  })
  if (!routineResult) return null

  const routine = toRoutine(routineResult.routine, routineResult.exercises)
  const setLogRows = await getSetLogsForSession({ sessionId: args.sessionId })
  const progressions = await getProgressionsForSession({
    sessionId: args.sessionId,
  })

  const { validRawRows, failedSetLogIds } = resolveSetLogs(
    setLogRows,
    routine,
    args.sessionId,
  )

  return {
    session,
    routine: routineResult.routine,
    exercises: routineResult.exercises,
    setLogs: validRawRows,
    progressions,
    failedSetLogIds,
  }
}
