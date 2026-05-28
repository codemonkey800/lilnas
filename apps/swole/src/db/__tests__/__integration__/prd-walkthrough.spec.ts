// PRD F2/F3 walkthrough at the data layer. Single test exercises the
// complete F2 happy path: routine → exercises → session → 9 set_logs →
// post-session Case A "Roll up" prompt → commit → complete. Asserts the
// canonical-write invariant cross-layer.
//
// If this test fails, the FSM↔DB contract drifted somewhere upstream —
// look at the mappers, hydration, or commitProgressionDecision before
// blaming this file.

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

import { desc, eq } from 'drizzle-orm'

import {
  applyAction,
  classifyPostSession,
  type Routine,
  type SessionState,
} from 'src/core/session-machine'
import { createExercise } from 'src/db/exercises'
import { buildSessionState } from 'src/db/hydration'
import { toSetLogArgs } from 'src/db/mappers'
import {
  commitProgressionDecision,
  getProgressionsForExercise,
} from 'src/db/progressions'
import { createRoutine } from 'src/db/routines'
import {
  exercises as exercisesTable,
  progressions,
  setLogs,
} from 'src/db/schema'
import {
  completeSession,
  listSessionsForRoutine,
  startSession,
} from 'src/db/sessions'
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

describe('PRD F2/F3 walkthrough', () => {
  it('routine → 9 logs → Case A Roll up → complete session, with canonical-write invariant holding', async () => {
    // (1) Create routine
    const routine = await createRoutine({
      name: 'Push Day',
      days: ['mon', 'wed', 'fri'],
    })

    // (2) Create exercises
    const bench = await createExercise({
      routineId: routine.id,
      type: 'weighted',
      name: 'Bench Press',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
    // Assert: initial progression row for Bench at 100.
    const benchInitial = await getProgressionsForExercise({
      exerciseId: bench.id,
    })
    expect(benchInitial).toHaveLength(1)
    expect(benchInitial[0]?.reason).toBe('initial')
    expect(benchInitial[0]?.startingWeight).toBe(100)

    const pushups = await createExercise({
      routineId: routine.id,
      type: 'bodyweight',
      name: 'Pushups',
      orderInRoutine: 1,
      sets: 3,
      targetReps: 15,
    })
    expect(
      await getProgressionsForExercise({ exerciseId: pushups.id }),
    ).toEqual([])

    const plank = await createExercise({
      routineId: routine.id,
      type: 'time-based',
      name: 'Plank',
      orderInRoutine: 2,
      sets: 3,
      durationSeconds: 30,
    })
    expect(await getProgressionsForExercise({ exerciseId: plank.id })).toEqual(
      [],
    )

    // (3) Start the session.
    const session = await startSession({ routineId: routine.id })

    // (4) Build the FSM-shape routine for applyAction and the augmented
    //     id-carrying shape for toSetLogArgs.
    const fsmRoutine: Routine = {
      exercises: [
        {
          name: 'Bench Press',
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
    const augmented = {
      exercises: [
        { ...fsmRoutine.exercises[0]!, id: bench.id },
        { ...fsmRoutine.exercises[1]!, id: pushups.id },
        { ...fsmRoutine.exercises[2]!, id: plank.id },
      ],
    }

    // (5) Run the F2 action sequence through the FSM. The pattern is chosen
    //     to land Case A (lowest >= originalStartingWeight) for bench so the
    //     post-session prompt is "Roll up".
    let state: SessionState = { setLogs: [] }
    // Bench: Increment, Stay, Complete → weights [100, 105, 105]
    state = applyAction(state, { type: 'Increment' }, fsmRoutine)
    state = applyAction(state, { type: 'Stay' }, fsmRoutine)
    state = applyAction(state, { type: 'Complete' }, fsmRoutine)
    // Pushups: Complete x3
    state = applyAction(state, { type: 'Complete' }, fsmRoutine)
    state = applyAction(state, { type: 'Complete' }, fsmRoutine)
    state = applyAction(state, { type: 'Complete' }, fsmRoutine)
    // Plank: Hold x3
    state = applyAction(state, { type: 'Hold' }, fsmRoutine)
    state = applyAction(state, { type: 'Hold' }, fsmRoutine)
    state = applyAction(state, { type: 'Hold' }, fsmRoutine)
    expect(state.setLogs).toHaveLength(9)

    // (6) Persist each set log.
    for (const log of state.setLogs) {
      await appendSetLog(toSetLogArgs(log, session.id, augmented))
    }

    // (6a) Row-level assertion on the persisted action column — pins #28.
    // If mappers silently swap `Stay` ↔ `Increment` (or any other symmetric
    // bug) the round-trip test in step 7 would still pass; this direct read
    // of `set_logs.action` would surface the lie.
    const rawActions = testDb.db
      .select({
        action: setLogs.action,
        exerciseId: setLogs.exerciseId,
        setNumber: setLogs.setNumber,
      })
      .from(setLogs)
      .where(eq(setLogs.sessionId, session.id))
      .orderBy(setLogs.loggedAt, setLogs.id)
      .all()
    expect(rawActions).toEqual([
      // Bench: Increment, Stay, Complete
      { action: 'Increment', exerciseId: bench.id, setNumber: 1 },
      { action: 'Stay', exerciseId: bench.id, setNumber: 2 },
      { action: 'Complete', exerciseId: bench.id, setNumber: 3 },
      // Pushups: Complete x3
      { action: 'Complete', exerciseId: pushups.id, setNumber: 1 },
      { action: 'Complete', exerciseId: pushups.id, setNumber: 2 },
      { action: 'Complete', exerciseId: pushups.id, setNumber: 3 },
      // Plank: Hold x3
      { action: 'Hold', exerciseId: plank.id, setNumber: 1 },
      { action: 'Hold', exerciseId: plank.id, setNumber: 2 },
      { action: 'Hold', exerciseId: plank.id, setNumber: 3 },
    ])

    // (7) Hydrate and assert deep-equal with the FSM's computed state.
    const hydrated = await buildSessionState({ sessionId: session.id })
    expect(hydrated).not.toBeNull()
    expect(hydrated!.sessionState.setLogs).toEqual(state.setLogs)

    // (8) Compute the post-session prompt set.
    const prompts = classifyPostSession(state, fsmRoutine)
    expect(prompts).toHaveLength(1)
    const benchPrompt = prompts[0]
    expect(benchPrompt?.case).toBe('A')
    expect(benchPrompt?.exerciseIdx).toBe(0)
    if (benchPrompt?.case !== 'A') throw new Error('expected Case A')
    expect(benchPrompt.lowest).toBe(100)
    expect(benchPrompt.highest).toBe(105)
    expect(benchPrompt.ending).toBe(105)
    expect(benchPrompt.stayOption).toBe(100)
    expect(benchPrompt.rollUpOption).toBe(105)

    // (9) User taps "Roll up" — commit chosenStartingWeight = rollUpOption.
    await commitProgressionDecision({
      sessionId: session.id,
      exerciseId: bench.id,
      chosenStartingWeight: benchPrompt.rollUpOption,
    })

    // (10) Bench's canonical starting_weight is now 105; two progression
    //      rows (initial: 100, session_progression: 105).
    const benchAfter = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.id, bench.id))
      .get()
    expect(benchAfter?.startingWeight).toBe(105)
    const benchProgs = await getProgressionsForExercise({
      exerciseId: bench.id,
    })
    expect(benchProgs).toHaveLength(2)
    expect(benchProgs.map(p => p.reason)).toEqual([
      'initial',
      'session_progression',
    ])
    expect(benchProgs[1]?.startingWeight).toBe(105)
    expect(benchProgs[1]?.sessionId).toBe(session.id)

    // (10a) Pushups and Plank starting_weights unchanged (they're non-weighted).
    const pushupsAfter = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.id, pushups.id))
      .get()
    expect(pushupsAfter?.startingWeight).toBeNull()
    const plankAfter = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.id, plank.id))
      .get()
    expect(plankAfter?.startingWeight).toBeNull()

    // (11) Complete the session.
    await completeSession({ sessionId: session.id })

    // (12) Session appears in completed-only listing; not in getActiveSession.
    const completed = await listSessionsForRoutine({
      routineId: routine.id,
      completedOnly: true,
    })
    expect(completed.map(s => s.id)).toEqual([session.id])
    expect(await buildSessionState({ sessionId: session.id })).toBeNull()

    // (13) Canonical-write invariant: for every weighted exercise, the
    //      latest progressions row's starting_weight equals the exercise's
    //      current starting_weight. R19 cross-layer.
    const weightedExercises = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.type, 'weighted'))
      .all()
    for (const ex of weightedExercises) {
      const latest = testDb.db
        .select()
        .from(progressions)
        .where(eq(progressions.exerciseId, ex.id))
        .orderBy(desc(progressions.effectiveFrom), desc(progressions.id))
        .limit(1)
        .get()
      expect(latest?.startingWeight).toBe(ex.startingWeight)
    }
  })

  it('Case B path: user drops below originalStartingWeight → new SW = lowest', async () => {
    const routine = await createRoutine({
      name: 'Strength',
      days: ['tue', 'thu'],
    })
    const bench = await createExercise({
      routineId: routine.id,
      type: 'weighted',
      name: 'Bench Press',
      orderInRoutine: 0,
      sets: 3,
      targetReps: 5,
      startingWeight: 100,
      increment: 5,
    })
    const session = await startSession({ routineId: routine.id })

    const fsmRoutine: Routine = {
      exercises: [
        {
          name: 'Bench Press',
          type: 'weighted',
          sets: 3,
          targetReps: 5,
          startingWeight: 100,
          increment: 5,
        },
      ],
    }
    const augmented = {
      exercises: [{ ...fsmRoutine.exercises[0]!, id: bench.id }],
    }

    // Decrement on set 1 (weight 100 → next is 95), then Decrement on set 2
    // (weight 95 → next is 90), then Decrement on last set (weight 90 → ending 90).
    let state: SessionState = { setLogs: [] }
    state = applyAction(state, { type: 'Decrement' }, fsmRoutine)
    state = applyAction(state, { type: 'Decrement' }, fsmRoutine)
    state = applyAction(state, { type: 'Decrement' }, fsmRoutine)
    for (const log of state.setLogs) {
      await appendSetLog(toSetLogArgs(log, session.id, augmented))
    }

    const prompts = classifyPostSession(state, fsmRoutine)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.case).toBe('B')
    if (prompts[0]?.case !== 'B') throw new Error('expected Case B')
    expect(prompts[0].newStartingWeight).toBe(90)

    await commitProgressionDecision({
      sessionId: session.id,
      exerciseId: bench.id,
      chosenStartingWeight: prompts[0].newStartingWeight,
    })
    const benchAfter = testDb.db
      .select()
      .from(exercisesTable)
      .where(eq(exercisesTable.id, bench.id))
      .get()
    expect(benchAfter?.startingWeight).toBe(90)

    await completeSession({ sessionId: session.id })
  })
})
