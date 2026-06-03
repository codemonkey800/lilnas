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

import { applyAction, type Routine } from 'src/core/session-machine'
import { createExercise } from 'src/db/exercises'
import { buildCompletedSessionState, buildSessionState } from 'src/db/hydration'
import { toSetLogArgs } from 'src/db/mappers'
import { createRoutine } from 'src/db/routines'
import { completeSession, startSession } from 'src/db/sessions'
import { appendSetLog } from 'src/db/setLogs'
import { createTestDb, type TestDb } from 'src/db/test-db'

let testDb: TestDb

beforeEach(() => {
  testDb = createTestDb()
  currentDb = testDb.db
})

afterEach(() => {
  testDb.close()
})

async function buildFixture() {
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
  const plank = await createExercise({
    routineId: routine.id,
    type: 'time-based',
    name: 'Plank',
    orderInRoutine: 2,
    sets: 3,
    durationSeconds: 30,
  })
  const session = await startSession({ routineId: routine.id })
  const fsmRoutine: Routine = {
    exercises: [
      {
        name: 'Bench',
        type: 'weighted',
        sets: 3,
        targetReps: 10,
        startingWeight: 100,
        increment: 5,
      },
      { name: 'Pushups', type: 'bodyweight', sets: 3, targetReps: 15 },
      { name: 'Plank', type: 'time-based', sets: 3, durationSeconds: 30 },
    ],
  }
  return {
    routine,
    session,
    exercises: { bench, pushups, plank },
    fsmRoutine,
  }
}

describe('buildSessionState', () => {
  it('returns null for a nonexistent session id', async () => {
    expect(await buildSessionState({ sessionId: 99999 })).toBeNull()
  })

  it('returns null for a completed session', async () => {
    const f = await buildFixture()
    await completeSession({ sessionId: f.session.id })
    expect(await buildSessionState({ sessionId: f.session.id })).toBeNull()
  })

  it('empty session hydrates with setLogs: []', async () => {
    const f = await buildFixture()
    const result = await buildSessionState({ sessionId: f.session.id })
    expect(result?.sessionState.setLogs).toEqual([])
    expect(result?.sessionState.cursorOverride).toBeUndefined()
  })

  it('round-trips a weighted session through applyAction + persist + hydrate', async () => {
    const f = await buildFixture()
    // Use the FSM to compute the canonical SessionState; then persist each
    // log via toSetLogArgs + appendSetLog; then hydrate and assert deep-equal.
    let fsmState = { setLogs: [] as ReturnType<typeof applyAction>['setLogs'] }
    fsmState = applyAction(fsmState, { type: 'Increment' }, f.fsmRoutine)
    fsmState = applyAction(fsmState, { type: 'Stay' }, f.fsmRoutine)
    fsmState = applyAction(
      fsmState,
      { type: 'Failed', actualReps: 7 },
      f.fsmRoutine,
    )

    // Snapshot the routine in the augmented (id-carrying) shape that
    // toSetLogArgs needs. We can compose this from the createExercise
    // outputs.
    const augmented = {
      exercises: [
        { ...f.fsmRoutine.exercises[0]!, id: f.exercises.bench.id },
        { ...f.fsmRoutine.exercises[1]!, id: f.exercises.pushups.id },
        { ...f.fsmRoutine.exercises[2]!, id: f.exercises.plank.id },
      ],
    }

    for (const log of fsmState.setLogs) {
      await appendSetLog(toSetLogArgs(log, f.session.id, augmented))
    }

    const hydrated = await buildSessionState({ sessionId: f.session.id })
    expect(hydrated).not.toBeNull()
    expect(hydrated!.sessionState.setLogs).toEqual(fsmState.setLogs)
  })

  it('round-trips time-based Failed with actualDuration', async () => {
    const f = await buildFixture()
    // Move cursor past bench (3 sets) and pushups (3 sets) by appending
    // logs directly through the FSM.
    let fsmState = { setLogs: [] as ReturnType<typeof applyAction>['setLogs'] }
    for (let i = 0; i < 3; i++) {
      fsmState = applyAction(
        fsmState,
        i === 2 ? { type: 'Stay' } : { type: 'Increment' },
        f.fsmRoutine,
      )
    }
    for (let i = 0; i < 3; i++) {
      fsmState = applyAction(fsmState, { type: 'Complete' }, f.fsmRoutine)
    }
    fsmState = applyAction(
      fsmState,
      { type: 'Failed', actualDuration: 22 },
      f.fsmRoutine,
    )

    const augmented = {
      exercises: [
        { ...f.fsmRoutine.exercises[0]!, id: f.exercises.bench.id },
        { ...f.fsmRoutine.exercises[1]!, id: f.exercises.pushups.id },
        { ...f.fsmRoutine.exercises[2]!, id: f.exercises.plank.id },
      ],
    }

    for (const log of fsmState.setLogs) {
      await appendSetLog(toSetLogArgs(log, f.session.id, augmented))
    }
    const hydrated = await buildSessionState({ sessionId: f.session.id })
    const lastLog = hydrated?.sessionState.setLogs.at(-1)
    expect(lastLog?.actualDuration).toBe(22)
    expect(lastLog?.action).toEqual({ type: 'Failed', actualDuration: 22 })
  })

  it('hydrates even when an exercise was archived after the session started (includeArchived: true)', async () => {
    const f = await buildFixture()
    // The archive guard normally prevents this via the public API, but the
    // hydration path needs to survive direct-DB tampering — simulate that by
    // setting archived_at via a raw DB update.
    const { eq } = await import('drizzle-orm')
    const { exercises } = await import('src/db/schema')
    testDb.db
      .update(exercises)
      .set({ archivedAt: new Date() })
      .where(eq(exercises.id, f.exercises.pushups.id))
      .run()
    const result = await buildSessionState({ sessionId: f.session.id })
    // The routine includes the archived exercise in the hydrated view.
    expect(result?.routine.exercises.map(e => e.id)).toContain(
      f.exercises.pushups.id,
    )
  })

  it('returns session-scoped progressions in the bundle (#15)', async () => {
    const f = await buildFixture()
    // Insert a progression row scoped to this session.
    const { progressions } = await import('src/db/schema')
    testDb.db
      .insert(progressions)
      .values({
        exerciseId: f.exercises.bench.id,
        sessionId: f.session.id,
        startingWeight: 105,
        reason: 'session_progression',
      })
      .run()
    // Insert another progression scoped to a DIFFERENT session — it must
    // NOT appear in the hydration result (proves the query is session-scoped).
    const otherRoutine = testDb.db
      .insert((await import('src/db/schema')).routines)
      .values({ name: 'Pull', days: ['tue'] })
      .returning()
      .get()
    const otherSession = testDb.db
      .insert((await import('src/db/schema')).sessions)
      .values({ routineId: otherRoutine.id })
      .returning()
      .get()
    testDb.db
      .insert(progressions)
      .values({
        exerciseId: f.exercises.bench.id,
        sessionId: otherSession.id,
        startingWeight: 200,
        reason: 'session_progression',
      })
      .run()
    const result = await buildSessionState({ sessionId: f.session.id })
    expect(result?.progressions).toHaveLength(1)
    expect(result?.progressions[0]?.startingWeight).toBe(105)
    expect(result?.progressions[0]?.reason).toBe('session_progression')
    expect(result?.progressions[0]?.sessionId).toBe(f.session.id)
  })

  it('skips and logs a bad set_log row instead of aborting the whole session (#13)', async () => {
    const f = await buildFixture()
    const { setLogs } = await import('src/db/schema')
    // One good log; one bad log (action='Failed' with no actualReps and a
    // weighted exerciseId — the parseAction Failed branch requires
    // actual_reps and throws HydrationError).
    testDb.db
      .insert(setLogs)
      .values({
        sessionId: f.session.id,
        exerciseId: f.exercises.bench.id,
        setNumber: 1,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      })
      .run()
    const bad = testDb.db
      .insert(setLogs)
      .values({
        sessionId: f.session.id,
        exerciseId: f.exercises.bench.id,
        setNumber: 2,
        weight: 100,
        targetReps: 10,
        // actualReps: null — Failed requires it, so parseAction throws.
        action: 'Failed',
      })
      .returning()
      .get()
    const result = await buildSessionState({ sessionId: f.session.id })
    expect(result).not.toBeNull()
    // The good log is hydrated; the bad one is skipped.
    expect(result!.sessionState.setLogs).toHaveLength(1)
    expect(result!.failedSetLogIds).toEqual([bad.id])
  })
})

describe('buildCompletedSessionState', () => {
  it('returns null for an unknown session id', async () => {
    expect(await buildCompletedSessionState({ sessionId: 99999 })).toBeNull()
  })

  it('returns null for an active (incomplete) session', async () => {
    const f = await buildFixture()
    expect(
      await buildCompletedSessionState({ sessionId: f.session.id }),
    ).toBeNull()
  })

  it('returns bundle for a completed session with no logs', async () => {
    const f = await buildFixture()
    await completeSession({ sessionId: f.session.id })
    const result = await buildCompletedSessionState({ sessionId: f.session.id })
    expect(result).not.toBeNull()
    expect(result!.session.completedAt).toBeInstanceOf(Date)
    expect(result!.setLogs).toEqual([])
    expect(result!.failedSetLogIds).toEqual([])
    expect(result!.exercises).toHaveLength(3)
  })

  it('returns raw setLogs in chronological order for a completed session', async () => {
    const f = await buildFixture()
    const augmented = {
      exercises: [
        { ...f.fsmRoutine.exercises[0]!, id: f.exercises.bench.id },
        { ...f.fsmRoutine.exercises[1]!, id: f.exercises.pushups.id },
        { ...f.fsmRoutine.exercises[2]!, id: f.exercises.plank.id },
      ],
    }
    let fsmState = { setLogs: [] as ReturnType<typeof applyAction>['setLogs'] }
    fsmState = applyAction(fsmState, { type: 'Increment' }, f.fsmRoutine)
    fsmState = applyAction(fsmState, { type: 'Stay' }, f.fsmRoutine)
    for (const log of fsmState.setLogs) {
      await appendSetLog(toSetLogArgs(log, f.session.id, augmented))
    }
    await completeSession({ sessionId: f.session.id })
    const result = await buildCompletedSessionState({ sessionId: f.session.id })
    expect(result).not.toBeNull()
    expect(result!.setLogs).toHaveLength(2)
    expect(result!.setLogs[0]!.exerciseId).toBe(f.exercises.bench.id)
  })

  it('includes archived exercise in exercises array (R7)', async () => {
    const f = await buildFixture()
    const { eq } = await import('drizzle-orm')
    const { exercises } = await import('src/db/schema')
    testDb.db
      .update(exercises)
      .set({ archivedAt: new Date() })
      .where(eq(exercises.id, f.exercises.pushups.id))
      .run()
    await completeSession({ sessionId: f.session.id })
    const result = await buildCompletedSessionState({ sessionId: f.session.id })
    expect(result).not.toBeNull()
    expect(result!.exercises.map(e => e.id)).toContain(f.exercises.pushups.id)
  })

  it('skips malformed set-log row and records its id in failedSetLogIds (R8)', async () => {
    const f = await buildFixture()
    const { setLogs } = await import('src/db/schema')
    testDb.db
      .insert(setLogs)
      .values({
        sessionId: f.session.id,
        exerciseId: f.exercises.bench.id,
        setNumber: 1,
        weight: 100,
        targetReps: 10,
        actualReps: 10,
        action: 'Stay',
      })
      .run()
    const bad = testDb.db
      .insert(setLogs)
      .values({
        sessionId: f.session.id,
        exerciseId: f.exercises.bench.id,
        setNumber: 2,
        weight: 100,
        targetReps: 10,
        action: 'Failed',
        // actualReps: null — Failed requires it, so toSetLog throws HydrationError
      })
      .returning()
      .get()
    await completeSession({ sessionId: f.session.id })
    const result = await buildCompletedSessionState({ sessionId: f.session.id })
    expect(result).not.toBeNull()
    expect(result!.setLogs).toHaveLength(1)
    expect(result!.failedSetLogIds).toEqual([bad.id])
  })

  it('buildSessionState still returns null for a completed session (invariant)', async () => {
    const f = await buildFixture()
    await completeSession({ sessionId: f.session.id })
    expect(await buildSessionState({ sessionId: f.session.id })).toBeNull()
  })

  it('FSM round-trip: append logs, complete session, hydrate via buildCompletedSessionState', async () => {
    const f = await buildFixture()
    const augmented = {
      exercises: [
        { ...f.fsmRoutine.exercises[0]!, id: f.exercises.bench.id },
        { ...f.fsmRoutine.exercises[1]!, id: f.exercises.pushups.id },
        { ...f.fsmRoutine.exercises[2]!, id: f.exercises.plank.id },
      ],
    }
    let fsmState = { setLogs: [] as ReturnType<typeof applyAction>['setLogs'] }
    fsmState = applyAction(fsmState, { type: 'Increment' }, f.fsmRoutine)
    fsmState = applyAction(fsmState, { type: 'Stay' }, f.fsmRoutine)
    fsmState = applyAction(
      fsmState,
      { type: 'Failed', actualReps: 7 },
      f.fsmRoutine,
    )
    for (const log of fsmState.setLogs) {
      await appendSetLog(toSetLogArgs(log, f.session.id, augmented))
    }
    await completeSession({ sessionId: f.session.id })
    const result = await buildCompletedSessionState({ sessionId: f.session.id })
    expect(result).not.toBeNull()
    expect(result!.setLogs).toHaveLength(3)
    expect(result!.setLogs[2]!.action).toBe('Failed')
    expect(result!.setLogs[2]!.actualReps).toBe(7)
  })
})
