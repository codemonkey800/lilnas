export type ExerciseType = 'weighted' | 'bodyweight' | 'time-based' | 'cardio'

export type Action =
  | { type: 'Increment' }
  | { type: 'Stay' }
  | { type: 'Decrement' }
  | { type: 'Complete' }
  | { type: 'Hold' }
  | { type: 'Done' }
  | { type: 'Skipped' }
  // Failed is split by exercise kind so the field name matches the units.
  // Weighted / bodyweight: actualReps. Time-based: actualDuration (seconds).
  // Both variants share `type: 'Failed'` for the schema enum; consumers use
  // `'actualDuration' in action` to discriminate when needed.
  | { type: 'Failed'; actualReps: number }
  | { type: 'Failed'; actualDuration: number }
  | { type: 'JumpTo'; exerciseIdx: number }

export type SetLog = {
  exerciseIdx: number
  setIdx: number
  weight?: number
  reps?: number
  actualReps?: number
  duration?: number
  actualDuration?: number
  action: Action
}

export type SessionState = {
  setLogs: SetLog[]
  cursorOverride?: number
}

export type WeightedExercise = {
  name: string
  type: 'weighted'
  sets: number
  targetReps: number
  startingWeight: number
  increment: number
}

export type BodyweightExercise = {
  name: string
  type: 'bodyweight'
  sets: number
  targetReps: number
}

export type TimeBasedExercise = {
  name: string
  type: 'time-based'
  sets: number
  durationSeconds: number
}

export type CardioExercise = {
  name: string
  type: 'cardio'
  sets: 1
  durationSeconds: number
}

export type Exercise =
  | WeightedExercise
  | BodyweightExercise
  | TimeBasedExercise
  | CardioExercise

export type Routine = {
  exercises: Exercise[]
}

export type NextTarget = {
  weight?: number
  reps?: number
  duration?: number
  exerciseIdx: number
  setIdx: number
}

export type PostSessionPrompt = {
  case: 'B'
  exerciseIdx: number
  originalStartingWeight: number
  lowest: number
  highest: number
  ending: number
  newStartingWeight: number
}

export function initialState(): SessionState {
  return { setLogs: [] }
}

function countLogsForExercise(
  state: SessionState,
  exerciseIdx: number,
): number {
  let count = 0

  for (const log of state.setLogs) {
    if (log.exerciseIdx === exerciseIdx) count++
  }

  return count
}

function findActivePosition(
  state: SessionState,
  routine: Routine,
): { exerciseIdx: number; setIdx: number; exercise: Exercise } | null {
  if (state.cursorOverride != null) {
    const idx = state.cursorOverride
    const exercise = routine.exercises[idx]
    if (!exercise) return null

    const setIdx = countLogsForExercise(state, idx)

    return {
      exerciseIdx: idx,
      setIdx,
      exercise,
    }
  }

  for (let i = 0; i < routine.exercises.length; i++) {
    const exercise = routine.exercises[i]
    if (!exercise) continue

    const count = countLogsForExercise(state, i)
    if (count < exercise.sets) {
      return { exerciseIdx: i, setIdx: count, exercise }
    }
  }

  return null
}

function deriveNextWeight(
  state: SessionState,
  exerciseIdx: number,
  exercise: WeightedExercise,
): number {
  let priorLog: SetLog | undefined
  for (const log of state.setLogs) {
    if (log.exerciseIdx === exerciseIdx) priorLog = log
  }

  if (!priorLog) return exercise.startingWeight

  const priorWeight = priorLog.weight ?? exercise.startingWeight

  switch (priorLog.action.type) {
    case 'Increment':
      return priorWeight + exercise.increment

    case 'Decrement':
      return priorWeight - exercise.increment

    default:
      return priorWeight
  }
}

function isValidActionForCell(
  exerciseType: ExerciseType,
  isLastSet: boolean,
  actionType: Action['type'],
): boolean {
  switch (exerciseType) {
    case 'weighted':
      if (isLastSet) {
        return (
          actionType === 'Complete' ||
          actionType === 'Stay' ||
          actionType === 'Decrement' ||
          actionType === 'Failed'
        )
      }

      return (
        actionType === 'Increment' ||
        actionType === 'Stay' ||
        actionType === 'Decrement' ||
        actionType === 'Failed'
      )

    case 'bodyweight':
      return actionType === 'Complete' || actionType === 'Failed'

    case 'time-based':
      return actionType === 'Hold' || actionType === 'Failed'

    case 'cardio':
      return actionType === 'Done' || actionType === 'Skipped'
  }
}

function describePosition(setIdx: number, exercise: Exercise): string {
  if (exercise.sets === 1) return 'single set'
  if (setIdx === exercise.sets - 1) return 'last set'

  return 'non-last set'
}

export function applyAction(
  state: SessionState,
  action: Action,
  routine: Routine,
): SessionState {
  if (action.type === 'JumpTo') {
    if (
      action.exerciseIdx < 0 ||
      action.exerciseIdx >= routine.exercises.length
    ) {
      throw new Error(
        `JumpTo target exerciseIdx out of range: ${action.exerciseIdx} (routine has ${routine.exercises.length} exercises)`,
      )
    }

    return { setLogs: state.setLogs, cursorOverride: action.exerciseIdx }
  }

  const position = findActivePosition(state, routine)
  if (!position) {
    throw new Error('Cannot apply action: session is complete')
  }

  const { exerciseIdx, setIdx, exercise } = position

  if (setIdx >= exercise.sets) {
    throw new Error(
      `exercise ${exerciseIdx} has ${exercise.sets} sets; cannot write setIdx ${setIdx}`,
    )
  }

  const isLastSet = setIdx === exercise.sets - 1

  if (!isValidActionForCell(exercise.type, isLastSet, action.type)) {
    throw new Error(
      `Invalid action '${action.type}' on ${describePosition(setIdx, exercise)} of ${exercise.type} exercise at exerciseIdx=${exerciseIdx}`,
    )
  }

  let newLog: SetLog

  switch (exercise.type) {
    case 'weighted': {
      const weight = deriveNextWeight(state, exerciseIdx, exercise)
      const reps = exercise.targetReps
      const actualReps =
        action.type === 'Failed' && 'actualReps' in action
          ? action.actualReps
          : reps
      newLog = {
        exerciseIdx,
        setIdx,
        weight,
        reps,
        actualReps,
        action,
      }
      break
    }

    case 'bodyweight': {
      const reps = exercise.targetReps
      const actualReps =
        action.type === 'Failed' && 'actualReps' in action
          ? action.actualReps
          : reps
      newLog = {
        exerciseIdx,
        setIdx,
        reps,
        actualReps,
        action,
      }
      break
    }

    case 'time-based': {
      const duration = exercise.durationSeconds
      newLog = {
        exerciseIdx,
        setIdx,
        duration,
        action,
      }
      if (action.type === 'Failed' && 'actualDuration' in action) {
        newLog.actualDuration = action.actualDuration
      }
      break
    }

    case 'cardio': {
      const duration = exercise.durationSeconds
      newLog = {
        exerciseIdx,
        setIdx,
        duration,
        action,
      }
      break
    }
  }

  return { setLogs: [...state.setLogs, newLog] }
}

export function undo(state: SessionState): SessionState {
  if (state.setLogs.length === 0) {
    if (state.cursorOverride == null) return state
    return { setLogs: [] }
  }

  return { setLogs: state.setLogs.slice(0, -1) }
}

export function nextTarget(
  state: SessionState,
  routine: Routine,
): NextTarget | null {
  const position = findActivePosition(state, routine)
  if (!position) return null

  const { exerciseIdx, setIdx, exercise } = position

  switch (exercise.type) {
    case 'weighted':
      return {
        weight: deriveNextWeight(state, exerciseIdx, exercise),
        reps: exercise.targetReps,
        exerciseIdx,
        setIdx,
      }

    case 'bodyweight':
      return {
        reps: exercise.targetReps,
        exerciseIdx,
        setIdx,
      }

    case 'time-based':
      return {
        duration: exercise.durationSeconds,
        exerciseIdx,
        setIdx,
      }

    case 'cardio':
      return {
        duration: exercise.durationSeconds,
        exerciseIdx,
        setIdx,
      }
  }
}

export function classifyPostSession(
  state: SessionState,
  routine: Routine,
): PostSessionPrompt[] {
  const prompts: PostSessionPrompt[] = []

  for (
    let exerciseIdx = 0;
    exerciseIdx < routine.exercises.length;
    exerciseIdx++
  ) {
    const exercise = routine.exercises[exerciseIdx]
    if (!exercise || exercise.type !== 'weighted') continue

    const logs = state.setLogs.filter(l => l.exerciseIdx === exerciseIdx)
    if (logs.length === 0) continue

    const weights: number[] = []
    for (const log of logs) {
      if (log.weight != null) weights.push(log.weight)
    }
    if (weights.length === 0) continue

    let lowest = weights[0] as number
    let highest = weights[0] as number
    for (const w of weights) {
      if (w < lowest) lowest = w
      if (w > highest) highest = w
    }
    const ending = weights[weights.length - 1] as number

    const originalStartingWeight = exercise.startingWeight
    const lastLog = logs[logs.length - 1]
    const lastActionFailed = lastLog?.action.type === 'Failed'

    prompts.push({
      case: 'B',
      exerciseIdx,
      originalStartingWeight,
      lowest,
      highest,
      ending,
      newStartingWeight: lastActionFailed ? originalStartingWeight : ending,
    })
  }

  return prompts
}
