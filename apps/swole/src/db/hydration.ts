import 'server-only'

import type { SessionState, SetLog } from 'src/core/session-machine'
import { type RoutineWithIds, toRoutine, toSetLog } from 'src/db/mappers'
import { getProgressionsForSession } from 'src/db/progressions'
import { getRoutineWithExercises } from 'src/db/routines'
import { getActiveSession } from 'src/db/sessions'
import { getSetLogsForSession } from 'src/db/setLogs'
import type { ProgressionRow, SessionRow } from 'src/db/types'
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

  const failedSetLogIds: number[] = []
  const setLogs: SetLog[] = []
  for (const row of setLogRows) {
    try {
      setLogs.push(toSetLog(row, routine))
    } catch (err) {
      failedSetLogIds.push(row.id)
      logger.error({
        msg: 'swole hydration: set_log skipped',
        setLogId: row.id,
        sessionId: row.sessionId,
        exerciseId: row.exerciseId,
        err,
      })
    }
  }

  // `cursorOverride` is UI-transient — JumpTo never persists, so hydration
  // never reproduces it. The runner's next interaction will set it as
  // needed.
  const sessionState: SessionState = { setLogs }

  return { session, routine, sessionState, progressions, failedSetLogIds }
}
