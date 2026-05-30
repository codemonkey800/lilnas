// Pure view-model module — no directive. All decision logic that components
// consume lives here so the .tsx tree stays dumb and testable.

import type {
  Action,
  Exercise,
  NextTarget,
  Routine,
  SessionState,
  SetLog,
} from 'src/core/session-machine'
import { applyAction, nextTarget, undo } from 'src/core/session-machine'

// ─── Optimistic reducer ───────────────────────────────────────────────────────

export type RunnerMsg =
  | { kind: 'action'; action: Action; cursorOverride?: number }
  | { kind: 'undo' }

export function runnerReducer(
  state: SessionState,
  msg: RunnerMsg,
  routine: Routine,
): SessionState {
  if (msg.kind === 'undo') return undo(state)
  const s: SessionState =
    msg.cursorOverride !== undefined
      ? { ...state, cursorOverride: msg.cursorOverride }
      : state
  return applyAction(s, msg.action, routine)
}

// ─── Button config ─────────────────────────────────────────────────────────

export type ButtonIconKey =
  | 'increment'
  | 'decrement'
  | 'stay'
  | 'complete'
  | 'hold'
  | 'done'
  | 'failed'
  | 'skipped'

export type ButtonTreatment = 'accent' | 'neutral' | 'amber' | 'red'

export type ButtonSlotConfig = {
  slot: 1 | 2 | 3 | 4
  actionType: Exclude<Action['type'], 'JumpTo'>
  label: string
  iconKey: ButtonIconKey
  treatment: ButtonTreatment
  // Present only for weighted mid-set buttons (R9). Number emitted here;
  // formatted to "→105" by formatWeightPreview in the component.
  previewWeight?: number
}

// R7/R8 button table. isLastSet = setIdx === sets - 1 (single-set weighted
// exercise is "last" and gets Complete/Stay/Decrement/Failed).
export function deriveButtonConfig(
  exercise: Exercise,
  isLastSet: boolean,
  target: NextTarget,
): ButtonSlotConfig[] {
  switch (exercise.type) {
    case 'weighted': {
      const w = target.weight as number
      const inc = exercise.increment
      if (isLastSet) {
        return [
          {
            slot: 1,
            actionType: 'Complete',
            label: 'Complete',
            iconKey: 'complete',
            treatment: 'accent',
          },
          {
            slot: 2,
            actionType: 'Stay',
            label: 'Stay',
            iconKey: 'stay',
            treatment: 'neutral',
          },
          {
            slot: 3,
            actionType: 'Decrement',
            label: 'Decrement',
            iconKey: 'decrement',
            treatment: 'amber',
          },
          {
            slot: 4,
            actionType: 'Failed',
            label: 'Failed',
            iconKey: 'failed',
            treatment: 'red',
          },
        ]
      }
      return [
        {
          slot: 1,
          actionType: 'Increment',
          label: 'Increment',
          iconKey: 'increment',
          treatment: 'accent',
          previewWeight: w + inc,
        },
        {
          slot: 2,
          actionType: 'Stay',
          label: 'Stay',
          iconKey: 'stay',
          treatment: 'neutral',
          previewWeight: w,
        },
        {
          slot: 3,
          actionType: 'Decrement',
          label: 'Decrement',
          iconKey: 'decrement',
          treatment: 'amber',
          previewWeight: w - inc,
        },
        {
          slot: 4,
          actionType: 'Failed',
          label: 'Failed',
          iconKey: 'failed',
          treatment: 'red',
        },
      ]
    }

    case 'bodyweight':
      return [
        {
          slot: 1,
          actionType: 'Complete',
          label: 'Complete',
          iconKey: 'complete',
          treatment: 'accent',
        },
        {
          slot: 4,
          actionType: 'Failed',
          label: 'Failed',
          iconKey: 'failed',
          treatment: 'red',
        },
      ]

    case 'time-based':
      return [
        {
          slot: 1,
          actionType: 'Hold',
          label: 'Hold',
          iconKey: 'hold',
          treatment: 'neutral',
        },
        {
          slot: 4,
          actionType: 'Failed',
          label: 'Failed',
          iconKey: 'failed',
          treatment: 'red',
        },
      ]

    case 'cardio':
      return [
        {
          slot: 1,
          actionType: 'Done',
          label: 'Done',
          iconKey: 'done',
          treatment: 'accent',
        },
        {
          slot: 4,
          actionType: 'Skipped',
          label: 'Skipped',
          iconKey: 'skipped',
          treatment: 'neutral',
        },
      ]
  }
}

// ─── Stale-override guard ─────────────────────────────────────────────────

// Returns cursorOverride only if it points at an exercise that still has
// remaining sets; otherwise returns undefined (prevents phantom Set N+1).
export function resolveActiveOverride(
  setLogs: SetLog[],
  cursorOverride: number | undefined,
  routine: Routine,
): number | undefined {
  if (cursorOverride == null) return undefined
  return countLogsForExercise(setLogs, cursorOverride) <
    (routine.exercises[cursorOverride]?.sets ?? 0)
    ? cursorOverride
    : undefined
}

// ─── Log counting ─────────────────────────────────────────────────────────

// Own counting loop — the FSM's private countLogsForExercise is not exported
// (scope forbids new FSM exports), so this mirrors it deliberately and is
// pinned by explicit tests.
export function countLogsForExercise(
  setLogs: SetLog[],
  exerciseIdx: number,
): number {
  let count = 0
  for (const log of setLogs) {
    if (log.exerciseIdx === exerciseIdx) count++
  }
  return count
}

// ─── Progress ────────────────────────────────────────────────────────────

export type ProgressData = {
  activeExerciseIdx: number
  exerciseCount: number
  loggedSets: number
  totalSets: number
}

export function deriveProgress(
  effectiveState: SessionState,
  routine: Routine,
): ProgressData {
  const exerciseCount = routine.exercises.length
  let totalSets = 0
  for (const ex of routine.exercises) totalSets += ex.sets
  const loggedSets = effectiveState.setLogs.length

  const target = nextTarget(effectiveState, routine)
  const activeExerciseIdx = target
    ? target.exerciseIdx
    : exerciseCount > 0
      ? exerciseCount - 1
      : 0

  return { activeExerciseIdx, exerciseCount, loggedSets, totalSets }
}

// ─── Exercise list ────────────────────────────────────────────────────────

export type ExerciseStatus = 'done' | 'in-progress' | 'unstarted'

export type ExerciseListItem = {
  idx: number
  name: string
  type: Exercise['type']
  loggedCount: number
  sets: number
  status: ExerciseStatus
  isCurrent: boolean
}

export function deriveExerciseList(
  effectiveState: SessionState,
  routine: Routine,
): ExerciseListItem[] {
  const target = nextTarget(effectiveState, routine)
  const activeExerciseIdx = target ? target.exerciseIdx : -1

  return routine.exercises.map((exercise, idx) => {
    const loggedCount = countLogsForExercise(effectiveState.setLogs, idx)
    let status: ExerciseStatus
    if (loggedCount >= exercise.sets) {
      status = 'done'
    } else if (loggedCount > 0) {
      status = 'in-progress'
    } else {
      status = 'unstarted'
    }
    return {
      idx,
      name: exercise.name,
      type: exercise.type,
      loggedCount,
      sets: exercise.sets,
      status,
      isCurrent: idx === activeExerciseIdx,
    }
  })
}

// ─── Previous-set peek ─────────────────────────────────────────────────────

export type PreviousSetPeek =
  | { kind: 'start'; startingWeight: number }
  | {
      kind: 'log'
      weight?: number
      reps?: number
      actualReps?: number
      duration?: number
      actualDuration?: number
      action: Action
    }
  | { kind: 'none' }

export function derivePreviousSetPeek(
  effectiveState: SessionState,
  routine: Routine,
  activeExerciseIdx: number,
): PreviousSetPeek {
  const exercise = routine.exercises[activeExerciseIdx]
  if (!exercise) return { kind: 'none' }

  let lastLog: SetLog | undefined
  for (const log of effectiveState.setLogs) {
    if (log.exerciseIdx === activeExerciseIdx) lastLog = log
  }

  if (!lastLog) {
    if (exercise.type === 'weighted') {
      return { kind: 'start', startingWeight: exercise.startingWeight }
    }
    return { kind: 'none' }
  }

  const peek: Extract<PreviousSetPeek, { kind: 'log' }> = {
    kind: 'log',
    action: lastLog.action,
  }
  if (lastLog.weight !== undefined) peek.weight = lastLog.weight
  if (lastLog.reps !== undefined) peek.reps = lastLog.reps
  if (lastLog.actualReps !== undefined) peek.actualReps = lastLog.actualReps
  if (lastLog.duration !== undefined) peek.duration = lastLog.duration
  if (lastLog.actualDuration !== undefined)
    peek.actualDuration = lastLog.actualDuration
  return peek
}

// ─── Session summary ───────────────────────────────────────────────────────

export type SessionSummary = {
  exerciseCount: number
  totalSetsLogged: number
}

export function deriveSessionSummary(
  effectiveState: SessionState,
  routine: Routine,
): SessionSummary {
  return {
    exerciseCount: routine.exercises.length,
    totalSetsLogged: effectiveState.setLogs.length,
  }
}
