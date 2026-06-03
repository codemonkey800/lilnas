import type { SetLog } from 'src/core/session-machine'
import {
  type ExerciseWithId,
  HydrationError,
  type RoutineWithIds,
  toExercise,
  toRoutine,
  toSetLog,
  toSetLogArgs,
} from 'src/db/mappers'
import type * as schema from 'src/db/schema'

type SetLogRow = typeof schema.setLogs.$inferSelect
type ExerciseRow = typeof schema.exercises.$inferSelect
type RoutineRow = typeof schema.routines.$inferSelect

const baseTimestamps = () => ({
  archivedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
})

const weightedRow = (id: number): ExerciseRow => ({
  id,
  routineId: 1,
  name: 'Bench',
  type: 'weighted',
  orderInRoutine: 0,
  sets: 3,
  targetReps: 10,
  startingWeight: 100,
  increment: 5,
  durationSeconds: null,
  ...baseTimestamps(),
})

const bodyweightRow = (id: number): ExerciseRow => ({
  id,
  routineId: 1,
  name: 'Pushups',
  type: 'bodyweight',
  orderInRoutine: 1,
  sets: 3,
  targetReps: 15,
  startingWeight: null,
  increment: null,
  durationSeconds: null,
  ...baseTimestamps(),
})

const timeBasedRow = (id: number): ExerciseRow => ({
  id,
  routineId: 1,
  name: 'Plank',
  type: 'time-based',
  orderInRoutine: 2,
  sets: 3,
  targetReps: null,
  startingWeight: null,
  increment: null,
  durationSeconds: 30,
  ...baseTimestamps(),
})

const cardioRow = (id: number): ExerciseRow => ({
  id,
  routineId: 1,
  name: 'Treadmill',
  type: 'cardio',
  orderInRoutine: 3,
  sets: 1,
  targetReps: null,
  startingWeight: null,
  increment: null,
  durationSeconds: 600,
  ...baseTimestamps(),
})

const routineRow: RoutineRow = {
  id: 1,
  name: 'Push',
  days: ['mon'],
  ...baseTimestamps(),
}

const setLogRow = (overrides: Partial<SetLogRow>): SetLogRow => ({
  id: 1,
  sessionId: 1,
  exerciseId: 1,
  setNumber: 1,
  weight: null,
  targetReps: null,
  actualReps: null,
  durationSeconds: null,
  actualDurationSeconds: null,
  action: 'Stay',
  loggedAt: new Date('2026-05-27T10:00:00Z'),
  ...overrides,
})

describe('toExercise', () => {
  it('translates a weighted row to an FSM-shaped weighted exercise', () => {
    const ex = toExercise(weightedRow(1))
    expect(ex).toMatchObject({
      id: 1,
      name: 'Bench',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
  })

  it('translates a bodyweight row', () => {
    const ex = toExercise(bodyweightRow(2))
    expect(ex).toMatchObject({
      id: 2,
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    })
  })

  it('translates a time-based row', () => {
    const ex = toExercise(timeBasedRow(3))
    expect(ex).toMatchObject({
      id: 3,
      type: 'time-based',
      sets: 3,
      durationSeconds: 30,
    })
  })

  it('translates a cardio row, pinning sets: 1', () => {
    const ex = toExercise(cardioRow(4))
    expect(ex).toMatchObject({
      id: 4,
      type: 'cardio',
      sets: 1,
      durationSeconds: 600,
    })
  })

  it('throws when a weighted row is missing required columns', () => {
    expect(() =>
      toExercise({ ...weightedRow(1), startingWeight: null }),
    ).toThrow(HydrationError)
  })
})

describe('toRoutine', () => {
  it('composes the routine + exercises into the augmented shape', () => {
    const routine = toRoutine(routineRow, [
      weightedRow(1),
      bodyweightRow(2),
      timeBasedRow(3),
      cardioRow(4),
    ])
    expect(routine.exercises.map(e => e.id)).toEqual([1, 2, 3, 4])
    expect(routine.exercises.map(e => e.type)).toEqual([
      'weighted',
      'bodyweight',
      'time-based',
      'cardio',
    ])
  })
})

const fullRoutine: RoutineWithIds = {
  exercises: [
    toExercise(weightedRow(101)),
    toExercise(bodyweightRow(102)),
    toExercise(timeBasedRow(103)),
    toExercise(cardioRow(104)),
  ],
}

describe('toSetLog', () => {
  it('weighted Stay maps row → FSM SetLog', () => {
    const row = setLogRow({
      exerciseId: 101,
      setNumber: 1,
      weight: 100,
      targetReps: 10,
      actualReps: 10,
      action: 'Stay',
    })
    const log = toSetLog(row, fullRoutine)
    expect(log).toEqual({
      exerciseIdx: 0,
      setIdx: 0,
      weight: 100,
      reps: 10,
      actualReps: 10,
      action: { type: 'Stay' },
    })
  })

  it('weighted Failed carries actualReps onto the Action discriminator', () => {
    const row = setLogRow({
      exerciseId: 101,
      setNumber: 2,
      weight: 100,
      targetReps: 10,
      actualReps: 6,
      action: 'Failed',
    })
    const log = toSetLog(row, fullRoutine)
    expect(log.action).toEqual({ type: 'Failed', actualReps: 6 })
    expect(log.actualReps).toBe(6)
  })

  it('time-based Failed carries actualDuration onto Action (matches column units, #10)', () => {
    const row = setLogRow({
      exerciseId: 103,
      setNumber: 1,
      durationSeconds: 30,
      actualDurationSeconds: 18,
      action: 'Failed',
    })
    const log = toSetLog(row, fullRoutine)
    expect(log.action).toEqual({ type: 'Failed', actualDuration: 18 })
    expect(log.actualDuration).toBe(18)
    expect(log.duration).toBe(30)
  })

  it('cardio Done maps to action without payload', () => {
    const row = setLogRow({
      exerciseId: 104,
      setNumber: 1,
      durationSeconds: 600,
      action: 'Done',
    })
    const log = toSetLog(row, fullRoutine)
    expect(log.action).toEqual({ type: 'Done' })
    expect(log.duration).toBe(600)
  })

  it('translates setIdx via row.setNumber - 1', () => {
    const row = setLogRow({
      exerciseId: 101,
      setNumber: 3,
      weight: 100,
      targetReps: 10,
      actualReps: 10,
      action: 'Increment',
    })
    expect(toSetLog(row, fullRoutine).setIdx).toBe(2)
  })

  it('throws when the row references an exercise not in the routine', () => {
    const row = setLogRow({ exerciseId: 99999, action: 'Stay' })
    expect(() => toSetLog(row, fullRoutine)).toThrow(HydrationError)
  })
})

describe('toSetLogArgs', () => {
  it('translates an FSM SetLog to primitive args, including sessionId', () => {
    const setLog: SetLog = {
      exerciseIdx: 0,
      setIdx: 1,
      weight: 105,
      reps: 10,
      actualReps: 10,
      action: { type: 'Increment' },
    }
    const args = toSetLogArgs(setLog, 7, fullRoutine)
    expect(args).toEqual({
      sessionId: 7,
      exerciseId: 101,
      setNumber: 2,
      weight: 105,
      targetReps: 10,
      actualReps: 10,
      action: 'Increment',
    })
  })

  it('weighted Failed: passes actualReps through to args.actualReps', () => {
    const setLog: SetLog = {
      exerciseIdx: 0,
      setIdx: 0,
      weight: 100,
      reps: 10,
      actualReps: 6,
      action: { type: 'Failed', actualReps: 6 },
    }
    const args = toSetLogArgs(setLog, 7, fullRoutine)
    expect(args.action).toBe('Failed')
    expect(args.actualReps).toBe(6)
  })

  it('time-based Failed: actualDuration round-trips via actualDurationSeconds', () => {
    const setLog: SetLog = {
      exerciseIdx: 2,
      setIdx: 0,
      duration: 30,
      actualDuration: 18,
      action: { type: 'Failed', actualDuration: 18 },
    }
    const args = toSetLogArgs(setLog, 7, fullRoutine)
    expect(args.actualDurationSeconds).toBe(18)
    expect(args.durationSeconds).toBe(30)
  })

  it('throws when SetLog has JumpTo action', () => {
    const setLog: SetLog = {
      exerciseIdx: 0,
      setIdx: 0,
      action: { type: 'JumpTo', exerciseIdx: 1 },
    }
    expect(() => toSetLogArgs(setLog, 7, fullRoutine)).toThrow(HydrationError)
  })

  it('throws when exerciseIdx is out of range', () => {
    const setLog: SetLog = {
      exerciseIdx: 99,
      setIdx: 0,
      action: { type: 'Stay' },
    }
    expect(() => toSetLogArgs(setLog, 7, fullRoutine)).toThrow(HydrationError)
  })
})

describe('symmetric round-trip', () => {
  // The load-bearing assertion: persisting a SetLog and reading it back
  // reproduces the original FSM-shaped log.
  const cases: { name: string; exerciseIdx: number; setLog: SetLog }[] = [
    {
      name: 'weighted Stay',
      exerciseIdx: 0,
      setLog: {
        exerciseIdx: 0,
        setIdx: 0,
        weight: 100,
        reps: 10,
        actualReps: 10,
        action: { type: 'Stay' },
      },
    },
    {
      name: 'weighted Increment',
      exerciseIdx: 0,
      setLog: {
        exerciseIdx: 0,
        setIdx: 1,
        weight: 105,
        reps: 10,
        actualReps: 10,
        action: { type: 'Increment' },
      },
    },
    {
      name: 'weighted Failed',
      exerciseIdx: 0,
      setLog: {
        exerciseIdx: 0,
        setIdx: 2,
        weight: 100,
        reps: 10,
        actualReps: 7,
        action: { type: 'Failed', actualReps: 7 },
      },
    },
    {
      name: 'bodyweight Complete',
      exerciseIdx: 1,
      setLog: {
        exerciseIdx: 1,
        setIdx: 0,
        reps: 15,
        actualReps: 15,
        action: { type: 'Complete' },
      },
    },
    {
      name: 'time-based Hold',
      exerciseIdx: 2,
      setLog: {
        exerciseIdx: 2,
        setIdx: 0,
        duration: 30,
        action: { type: 'Hold' },
      },
    },
    {
      name: 'time-based Failed',
      exerciseIdx: 2,
      setLog: {
        exerciseIdx: 2,
        setIdx: 1,
        duration: 30,
        actualDuration: 22,
        action: { type: 'Failed', actualDuration: 22 },
      },
    },
    {
      name: 'cardio Done',
      exerciseIdx: 3,
      setLog: {
        exerciseIdx: 3,
        setIdx: 0,
        duration: 600,
        action: { type: 'Done' },
      },
    },
    {
      name: 'cardio Skipped',
      exerciseIdx: 3,
      setLog: {
        exerciseIdx: 3,
        setIdx: 0,
        duration: 600,
        action: { type: 'Skipped' },
      },
    },
  ]

  it.each(cases)('round-trips $name', ({ setLog }) => {
    const args = toSetLogArgs(setLog, 1, fullRoutine)
    // Reconstruct a synthetic row from args (DB would assign id + loggedAt).
    const ex: ExerciseWithId | undefined =
      fullRoutine.exercises[setLog.exerciseIdx]
    const reconstructed = toSetLog(
      {
        id: 999,
        sessionId: args.sessionId,
        exerciseId: ex!.id,
        setNumber: args.setNumber,
        weight: args.weight ?? null,
        targetReps: args.targetReps ?? null,
        actualReps: args.actualReps ?? null,
        durationSeconds: args.durationSeconds ?? null,
        actualDurationSeconds: args.actualDurationSeconds ?? null,
        action: args.action,
        loggedAt: new Date(),
      },
      fullRoutine,
    )
    expect(reconstructed).toEqual(setLog)
  })
})
