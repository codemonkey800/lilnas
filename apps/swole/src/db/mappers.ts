// Symmetric FSM ↔ DB translation. The schema module never imports FSM types;
// this file is the one-way bridge. Both `toSetLog` (DB → FSM) and
// `toSetLogArgs` (FSM → DB args) live here so the seam is auditable.

import type {
  Action,
  Exercise,
  Routine,
  SetLog,
} from 'src/core/session-machine'
import { HydrationError } from 'src/db/errors'
import type * as schema from 'src/db/schema'
import { setLogActionEnum } from 'src/db/schema'
import type { AppendSetLogArgs } from 'src/db/setLogs'

// Re-export HydrationError so existing consumers that imported it from
// `src/db/mappers` continue to compile. The canonical home is `src/db/errors`.
export { HydrationError }

type SetLogRow = typeof schema.setLogs.$inferSelect
type ExerciseRow = typeof schema.exercises.$inferSelect
type RoutineRow = typeof schema.routines.$inferSelect

// Exercises carry their DB id so toSetLog can resolve exerciseIdx by id.
// RoutineWithIds is structurally compatible with the FSM's Routine because
// ExerciseWithId extends Exercise.
export type ExerciseWithId = Exercise & { id: number }
export type RoutineWithIds = { exercises: ExerciseWithId[] }

// Compile-time guards. Non-exported and prefixed with `_` so they don't leak
// into the public API of this module. Removing one only weakens the type-level
// invariance check at that seam — it is not a runtime contract.

// Ensure RoutineWithIds is assignable to the FSM Routine type — the callers
// (e.g. classifyPostSession) only see `routine: Routine`.
const _routineCompatGuard: RoutineWithIds extends Routine ? true : never = true
void _routineCompatGuard

// The DB enum must be a superset of the FSM actions that can persist. If a
// future FSM addition (e.g. a hypothetical `Pause`) is not reflected in the
// schema's enum, this assertion fails to type-check. The JumpTo action is
// intentionally excluded — it never persists.
type SchemaActionEnum = (typeof setLogActionEnum)[number]
type PersistableActions = Exclude<Action['type'], 'JumpTo'>
const _actionEnumDriftGuard: PersistableActions extends SchemaActionEnum
  ? true
  : never = true
void _actionEnumDriftGuard

// Reverse guard: the schema enum must also be a subset of FSM PersistableActions.
// If a future schema-only addition lands without an FSM variant, `parseAction`'s
// exhaustive `never` check stops compiling AND this assertion fails. Together
// the two guards lock schema ↔ FSM at type-check time (#20).
const _reverseActionGuard: SchemaActionEnum extends PersistableActions
  ? true
  : never = true
void _reverseActionGuard

export function toExercise(row: ExerciseRow): ExerciseWithId {
  switch (row.type) {
    case 'weighted':
      if (
        row.targetReps == null ||
        row.startingWeight == null ||
        row.increment == null
      ) {
        throw new HydrationError(
          `weighted exercise ${row.id} missing required fields`,
        )
      }
      return {
        id: row.id,
        name: row.name,
        type: 'weighted',
        sets: row.sets,
        targetReps: row.targetReps,
        startingWeight: row.startingWeight,
        increment: row.increment,
      }
    case 'bodyweight':
      if (row.targetReps == null) {
        throw new HydrationError(
          `bodyweight exercise ${row.id} missing targetReps`,
        )
      }
      return {
        id: row.id,
        name: row.name,
        type: 'bodyweight',
        sets: row.sets,
        targetReps: row.targetReps,
      }
    case 'time-based':
      if (row.durationSeconds == null) {
        throw new HydrationError(
          `time-based exercise ${row.id} missing durationSeconds`,
        )
      }
      return {
        id: row.id,
        name: row.name,
        type: 'time-based',
        sets: row.sets,
        durationSeconds: row.durationSeconds,
      }
    case 'cardio':
      if (row.durationSeconds == null) {
        throw new HydrationError(
          `cardio exercise ${row.id} missing durationSeconds`,
        )
      }
      return {
        id: row.id,
        name: row.name,
        type: 'cardio',
        sets: 1,
        durationSeconds: row.durationSeconds,
      }
  }
}

export function toRoutine(
  _routineRow: RoutineRow,
  exerciseRows: ExerciseRow[],
): RoutineWithIds {
  return {
    exercises: exerciseRows.map(toExercise),
  }
}

// DB row → FSM SetLog. The routine arg's exercises must include id so the
// row's exerciseId can be resolved to an FSM exerciseIdx. Throws when the
// row references an exercise that isn't in the routine.
export function toSetLog(row: SetLogRow, routine: RoutineWithIds): SetLog {
  const exerciseIdx = routine.exercises.findIndex(e => e.id === row.exerciseId)
  if (exerciseIdx === -1) {
    throw new HydrationError(
      `set_log ${row.id} references exerciseId ${row.exerciseId} not in routine`,
    )
  }
  const exercise = routine.exercises[exerciseIdx] as ExerciseWithId
  const setIdx = row.setNumber - 1
  const action = parseAction(row, exercise.type)

  const base: SetLog = { exerciseIdx, setIdx, action }
  if (row.weight != null) base.weight = row.weight
  if (row.targetReps != null) base.reps = row.targetReps
  if (row.actualReps != null) base.actualReps = row.actualReps
  if (row.durationSeconds != null) base.duration = row.durationSeconds
  if (row.actualDurationSeconds != null) {
    base.actualDuration = row.actualDurationSeconds
  }
  return base
}

function parseAction(row: SetLogRow, exerciseType: Exercise['type']): Action {
  switch (row.action) {
    case 'Failed': {
      // Failed for time-based exercises carries `actualDuration` (seconds);
      // for weighted/bodyweight it carries `actualReps`. The field name
      // matches the exercise's units (#10).
      if (exerciseType === 'time-based') {
        if (row.actualDurationSeconds == null) {
          throw new HydrationError(
            `set_log ${row.id} has action='Failed' on time-based exercise without actual_duration_seconds`,
          )
        }
        return { type: 'Failed', actualDuration: row.actualDurationSeconds }
      }
      if (row.actualReps == null) {
        throw new HydrationError(
          `set_log ${row.id} has action='Failed' without actual_reps`,
        )
      }
      return { type: 'Failed', actualReps: row.actualReps }
    }
    case 'Increment':
    case 'Stay':
    case 'Decrement':
    case 'Complete':
    case 'Hold':
    case 'Done':
    case 'Skipped':
      return { type: row.action }
    default: {
      // Exhaustiveness check tied to the reverse drift guard at the top of
      // this module. If a future schema enum addition lands without an FSM
      // Action variant, `row.action` is no longer `never` here and TS errors.
      const _exhaustive: never = row.action
      throw new HydrationError(
        `set_log ${row.id} has unknown action '${String(_exhaustive)}'`,
      )
    }
  }
}

// FSM SetLog → primitive args for appendSetLog. Caller supplies sessionId
// (since the FSM SetLog doesn't know about persistence sessions).
export function toSetLogArgs(
  setLog: SetLog,
  sessionId: number,
  routine: RoutineWithIds,
): AppendSetLogArgs {
  if (setLog.action.type === 'JumpTo') {
    throw new HydrationError(
      'JumpTo action is UI-only and must not be persisted',
    )
  }
  const exercise: ExerciseWithId | undefined =
    routine.exercises[setLog.exerciseIdx]
  if (!exercise) {
    throw new HydrationError(
      `setLog references exerciseIdx ${setLog.exerciseIdx} out of range`,
    )
  }
  const args: AppendSetLogArgs = {
    sessionId,
    exerciseId: exercise.id,
    setNumber: setLog.setIdx + 1,
    action: setLog.action.type,
  }
  if (setLog.weight !== undefined) args.weight = setLog.weight
  if (setLog.reps !== undefined) args.targetReps = setLog.reps
  if (setLog.actualReps !== undefined) args.actualReps = setLog.actualReps
  if (setLog.duration !== undefined) args.durationSeconds = setLog.duration
  if (setLog.actualDuration !== undefined) {
    args.actualDurationSeconds = setLog.actualDuration
  }
  // Mirror the time-based Failed action's `actualDuration` to the column so
  // the row's actual_duration_seconds matches `setLog.actualDuration` even if
  // the caller built the SetLog without setting actualDuration explicitly.
  if (
    setLog.action.type === 'Failed' &&
    'actualDuration' in setLog.action &&
    args.actualDurationSeconds === undefined
  ) {
    args.actualDurationSeconds = setLog.action.actualDuration
  }
  return args
}
