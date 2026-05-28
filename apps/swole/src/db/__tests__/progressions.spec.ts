let currentDb: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<
  typeof import('src/db/schema')
>

jest.mock('src/db/client', () => ({
  get db() {
    return currentDb
  },
}))

import { eq } from 'drizzle-orm'

import { createExercise } from 'src/db/exercises'
import {
  commitProgressionDecision,
  getProgressionsForExercise,
  getProgressionsForSession,
} from 'src/db/progressions'
import {
  exercises as exercisesTable,
  progressions,
  routines,
  sessions,
} from 'src/db/schema'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb
let routineId: number
let sessionId: number
let exerciseId: number

beforeEach(async () => {
  testDb = createTestDb()
  currentDb = testDb.db
  routineId = testDb.db
    .insert(routines)
    .values({ name: 'Push', days: ['mon'] })
    .returning()
    .get().id
  sessionId = testDb.db
    .insert(sessions)
    .values({ routineId })
    .returning()
    .get().id
  exerciseId = (
    await createExercise({
      routineId,
      type: 'weighted',
      name: 'Bench',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
  ).id
})

afterEach(() => {
  testDb.close()
})

const exerciseStartingWeight = (): number | null =>
  testDb.db
    .select()
    .from(exercisesTable)
    .where(eq(exercisesTable.id, exerciseId))
    .get()?.startingWeight ?? null

const seedProgression = (
  args: Partial<typeof progressions.$inferInsert> &
    Pick<typeof progressions.$inferInsert, 'startingWeight' | 'reason'>,
) =>
  testDb.db
    .insert(progressions)
    .values({ exerciseId, ...args })
    .run()

// ─── Reads ──────────────────────────────────────────────────────────────────

describe('getProgressionsForExercise', () => {
  it('returns rows ordered by effective_from asc', async () => {
    // The beforeEach createExercise already wrote an `initial` row at "now".
    // Use far-future timestamps so the seed rows sort AFTER the initial row.
    const t1 = new Date('2099-01-01T11:00:00Z')
    const t2 = new Date('2099-01-01T12:00:00Z')
    seedProgression({
      startingWeight: 105,
      reason: 'session_progression',
      sessionId,
      effectiveFrom: t1,
    })
    seedProgression({
      startingWeight: 110,
      reason: 'manual_edit',
      effectiveFrom: t2,
    })
    const rows = await getProgressionsForExercise({ exerciseId })
    expect(rows.map(r => r.startingWeight)).toEqual([100, 105, 110])
    expect(rows.map(r => r.reason)).toEqual([
      'initial',
      'session_progression',
      'manual_edit',
    ])
  })

  it('returns empty array when no rows', async () => {
    // Build a fresh exercise without an initial row by inserting bodyweight.
    const bw = await createExercise({
      routineId,
      type: 'bodyweight',
      name: 'Pushups',
      orderInRoutine: 1,
      sets: 3,
      targetReps: 15,
    })
    expect(await getProgressionsForExercise({ exerciseId: bw.id })).toEqual([])
  })
})

describe('getProgressionsForSession', () => {
  it('returns only rows that share the session_id', async () => {
    // The createExercise initial row has sessionId = null, so it's excluded.
    seedProgression({
      startingWeight: 105,
      reason: 'session_progression',
      sessionId,
    })
    const rows = await getProgressionsForSession({ sessionId })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.startingWeight).toBe(105)
  })
})

// ─── Writes ─────────────────────────────────────────────────────────────────

describe('commitProgressionDecision', () => {
  it('Case A roll up: writes session_progression row and updates canonical SW', async () => {
    await commitProgressionDecision({
      sessionId,
      exerciseId,
      chosenStartingWeight: 105,
    })
    expect(exerciseStartingWeight()).toBe(105)
    const progRows = await getProgressionsForExercise({ exerciseId })
    expect(progRows).toHaveLength(2)
    expect(progRows[1]?.reason).toBe('session_progression')
    expect(progRows[1]?.startingWeight).toBe(105)
    expect(progRows[1]?.sessionId).toBe(sessionId)
  })

  it('Case A stay: writes a session_progression row even when chosenStartingWeight equals current', async () => {
    await commitProgressionDecision({
      sessionId,
      exerciseId,
      chosenStartingWeight: 100,
    })
    expect(exerciseStartingWeight()).toBe(100)
    const progRows = await getProgressionsForExercise({ exerciseId })
    expect(progRows).toHaveLength(2)
    expect(progRows[1]?.reason).toBe('session_progression')
    expect(progRows[1]?.startingWeight).toBe(100)
  })

  it('Case B: lowers canonical SW and writes session_progression row', async () => {
    await commitProgressionDecision({
      sessionId,
      exerciseId,
      chosenStartingWeight: 95,
    })
    expect(exerciseStartingWeight()).toBe(95)
    const progRows = await getProgressionsForExercise({ exerciseId })
    expect(progRows[1]?.startingWeight).toBe(95)
  })

  it('canonical-write invariant: after commit, latest progressions.starting_weight === exercises.starting_weight', async () => {
    await commitProgressionDecision({
      sessionId,
      exerciseId,
      chosenStartingWeight: 110,
    })
    const progRows = await getProgressionsForExercise({ exerciseId })
    const latest = progRows[progRows.length - 1]
    expect(latest?.startingWeight).toBe(exerciseStartingWeight())
  })

  it('pre-write throw: NotFoundError on missing exercise (existing-check fails before any writes)', async () => {
    const swBefore = exerciseStartingWeight()
    await expect(
      commitProgressionDecision({
        sessionId,
        exerciseId: 99999,
        chosenStartingWeight: 200,
      }),
    ).rejects.toThrow(/Exercise not found/)
    expect(exerciseStartingWeight()).toBe(swBefore)
    const progRows = await getProgressionsForExercise({ exerciseId })
    expect(progRows).toHaveLength(1)
    expect(progRows[0]?.reason).toBe('initial')
  })

  it('NotFoundError when the session does not exist', async () => {
    await expect(
      commitProgressionDecision({
        sessionId: 99999,
        exerciseId,
        chosenStartingWeight: 105,
      }),
    ).rejects.toThrow(/Session not found/)
  })

  it('SessionAlreadyCompleted when the session is sealed', async () => {
    testDb.db
      .update(sessions)
      .set({ completedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .run()
    await expect(
      commitProgressionDecision({
        sessionId,
        exerciseId,
        chosenStartingWeight: 105,
      }),
    ).rejects.toThrow(/Session \d+ is already completed/)
  })

  it('ValidationError when the session belongs to a different routine (#3)', async () => {
    const otherRoutineId = testDb.db
      .insert(routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get().id
    const otherSessionId = testDb.db
      .insert(sessions)
      .values({ routineId: otherRoutineId })
      .returning()
      .get().id
    await expect(
      commitProgressionDecision({
        sessionId: otherSessionId,
        exerciseId,
        chosenStartingWeight: 105,
      }),
    ).rejects.toThrow(/belongs to routine .+, not exercise/)
    const progRows = await getProgressionsForExercise({ exerciseId })
    expect(progRows).toHaveLength(1)
  })

  it('mid-tx rollback: when the inner exercise update violates a CHECK after the progression insert, the insert is rolled back (#4)', async () => {
    // Build a bodyweight exercise in the same routine. All four pre-checks
    // pass — the progression INSERT then runs and succeeds. The subsequent
    // UPDATE setting `exercises.starting_weight` to a non-null value fires
    // the `exercise_type_fields_match` CHECK constraint (bodyweight rows
    // require starting_weight IS NULL). The atomicity contract says the
    // INSERT must roll back when the UPDATE fails.
    const pushups = await createExercise({
      routineId,
      type: 'bodyweight',
      name: 'Pushups',
      orderInRoutine: 1,
      sets: 3,
      targetReps: 15,
    })
    const progBefore = (
      await getProgressionsForExercise({ exerciseId: pushups.id })
    ).length
    await expect(
      commitProgressionDecision({
        sessionId,
        exerciseId: pushups.id,
        chosenStartingWeight: 200,
      }),
    ).rejects.toThrow(/CHECK/)
    const pushupsAfter = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.id, pushups.id))
      .get()
    expect(pushupsAfter?.startingWeight).toBeNull()
    expect(
      (await getProgressionsForExercise({ exerciseId: pushups.id })).length,
    ).toBe(progBefore)
  })
})
