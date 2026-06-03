// Integration spec for the session-detail data contract.
// Verifies that buildCompletedSessionState + groupSetLogsByExercise +
// weightedVolume produce the expected counts and grouped rows for a known
// seeded session, including a Failed set rendered as a shortfall (R2, R6, R7).

let currentDb: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<
  typeof import('src/db/schema')
>

jest.mock('src/db/client', () => ({
  get db() {
    return currentDb
  },
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
}))

import { createExercise } from 'src/db/exercises'
import { buildCompletedSessionState } from 'src/db/hydration'
import { createRoutine } from 'src/db/routines'
import { setLogs } from 'src/db/schema'
import { completeSession, startSession } from 'src/db/sessions'
import { createTestDb, type TestDb } from 'src/db/test-db'
import { formatSetRow } from 'src/lib/format'
import { groupSetLogsByExercise, weightedVolume } from 'src/lib/stats'

let testDb: TestDb

beforeEach(() => {
  testDb = createTestDb()
  currentDb = testDb.db
})

afterEach(() => {
  testDb.close()
})

describe('session detail data contract', () => {
  it('groupSetLogsByExercise + weightedVolume produce correct counts and volume (R2, R6, R7)', async () => {
    const routine = await createRoutine({ name: 'Push', days: ['mon'] })
    const bench = await createExercise({
      routineId: routine.id,
      type: 'weighted',
      name: 'Bench',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
    const pushups = await createExercise({
      routineId: routine.id,
      type: 'bodyweight',
      name: 'Pushups',
      orderInRoutine: 1,
      sets: 3,
      targetReps: 15,
    })
    const session = await startSession({ routineId: routine.id })

    // 2 weighted sets + 1 bodyweight + 1 weighted Failed (shortfall) set
    testDb.db
      .insert(setLogs)
      .values([
        {
          sessionId: session.id,
          exerciseId: bench.id,
          setNumber: 1,
          weight: 100,
          targetReps: 10,
          actualReps: 10,
          action: 'Stay',
        },
        {
          sessionId: session.id,
          exerciseId: bench.id,
          setNumber: 2,
          weight: 100,
          targetReps: 10,
          actualReps: 8,
          action: 'Failed',
        },
        {
          sessionId: session.id,
          exerciseId: pushups.id,
          setNumber: 1,
          targetReps: 15,
          actualReps: 15,
          action: 'Complete',
        },
      ])
      .run()

    await completeSession({ sessionId: session.id })

    const bundle = await buildCompletedSessionState({ sessionId: session.id })
    expect(bundle).not.toBeNull()
    expect(bundle!.setLogs).toHaveLength(3)

    const groups = groupSetLogsByExercise(bundle!.setLogs, bundle!.exercises)
    // 2 exercises touched
    expect(groups).toHaveLength(2)
    expect(groups[0]!.exercise.id).toBe(bench.id)
    expect(groups[0]!.logs).toHaveLength(2)
    expect(groups[1]!.exercise.id).toBe(pushups.id)
    expect(groups[1]!.logs).toHaveLength(1)

    // weighted volume: 100×10 + 100×8 = 1800 (bodyweight row has null weight)
    expect(weightedVolume(bundle!.setLogs)).toBe(1800)

    // Failed weighted set renders as shortfall
    const failedLog = groups[0]!.logs[1]!
    const parts = formatSetRow(failedLog, groups[0]!.exercise)
    expect(parts.kind).toBe('shortfall')
    if (parts.kind === 'shortfall') {
      expect(parts.fraction).toBe('8/10')
    }
  })

  it('completed session referencing an archived exercise includes it in groups (R7)', async () => {
    const routine = await createRoutine({ name: 'Push', days: ['mon'] })
    const bench = await createExercise({
      routineId: routine.id,
      type: 'weighted',
      name: 'Bench',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
    const session = await startSession({ routineId: routine.id })
    testDb.db
      .insert(setLogs)
      .values({
        sessionId: session.id,
        exerciseId: bench.id,
        setNumber: 1,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      })
      .run()
    // Archive the exercise after the session
    const { exercises } = await import('src/db/schema')
    const { eq } = await import('drizzle-orm')
    testDb.db
      .update(exercises)
      .set({ archivedAt: new Date() })
      .where(eq(exercises.id, bench.id))
      .run()
    await completeSession({ sessionId: session.id })

    const bundle = await buildCompletedSessionState({ sessionId: session.id })
    expect(bundle).not.toBeNull()
    const groups = groupSetLogsByExercise(bundle!.setLogs, bundle!.exercises)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.exercise.id).toBe(bench.id)
    expect(groups[0]!.exercise.archivedAt).not.toBeNull()
  })
})
