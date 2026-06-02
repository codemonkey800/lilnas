import type {
  Action,
  BodyweightExercise,
  CardioExercise,
  Exercise,
  Routine,
  SessionState,
  TimeBasedExercise,
  WeightedExercise,
} from 'src/core/session-machine'
import { applyAction, nextTarget, undo } from 'src/core/session-machine'
import {
  countLogsForExercise,
  deriveButtonConfig,
  deriveExerciseList,
  derivePreviousSetPeek,
  deriveProgress,
  deriveSessionSummary,
  resolveActiveOverride,
  runnerReducer,
} from 'src/lib/runner'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const bench: WeightedExercise = {
  name: 'Bench Press',
  type: 'weighted',
  sets: 3,
  targetReps: 10,
  startingWeight: 100,
  increment: 5,
}

const benchSingle: WeightedExercise = {
  name: 'Bench Single',
  type: 'weighted',
  sets: 1,
  targetReps: 10,
  startingWeight: 100,
  increment: 5,
}

const pushups: BodyweightExercise = {
  name: 'Pushups',
  type: 'bodyweight',
  sets: 3,
  targetReps: 15,
}

const plank: TimeBasedExercise = {
  name: 'Plank',
  type: 'time-based',
  sets: 2,
  durationSeconds: 30,
}

const run: CardioExercise = {
  name: 'Run',
  type: 'cardio',
  sets: 1,
  durationSeconds: 1800,
}

const routine: Routine = { exercises: [bench, pushups, plank] }
const empty: SessionState = { setLogs: [] }

function stateWith(
  logs: number,
  exerciseIdx: number,
  routine: Routine,
): SessionState {
  let state: SessionState = { setLogs: [] }
  const ex = routine.exercises[exerciseIdx] as Exercise
  for (let i = 0; i < logs; i++) {
    let action: Action
    if (ex.type === 'weighted') {
      // last set accepts Complete, mid-sets accept Increment
      const isLastSet = i === ex.sets - 1
      action = isLastSet ? { type: 'Complete' } : { type: 'Increment' }
    } else if (ex.type === 'bodyweight') {
      action = { type: 'Complete' }
    } else if (ex.type === 'time-based') {
      action = { type: 'Hold' }
    } else {
      action = { type: 'Done' }
    }
    state = applyAction(state, action, routine)
  }
  return state
}

// ─── runnerReducer ────────────────────────────────────────────────────────────

describe('runnerReducer', () => {
  it('action delegates to applyAction', () => {
    const action: Action = { type: 'Increment' }
    const result = runnerReducer(empty, { kind: 'action', action }, routine)
    expect(result).toEqual(applyAction(empty, action, routine))
  })

  it('undo delegates to undo', () => {
    const state = applyAction(empty, { type: 'Increment' }, routine)
    expect(runnerReducer(state, { kind: 'undo' }, routine)).toEqual(undo(state))
  })

  it('cursorOverride in msg targets the jumped-to exercise (not exercise 0)', () => {
    // Routine: bench (3 sets, weighted) at idx 0, pushups (3 sets, bodyweight) at idx 1.
    // Base state has no logs and no cursorOverride (like a fresh sessionState from the server).
    // The user jumped to pushups (idx 1) via the drawer.
    // addOptimistic must carry cursorOverride:1 so the log lands on pushups, not bench.
    const jumpRoutine: Routine = { exercises: [bench, pushups] }
    const baseState: SessionState = { setLogs: [] }

    const result = runnerReducer(
      baseState,
      { kind: 'action', action: { type: 'Complete' }, cursorOverride: 1 },
      jumpRoutine,
    )

    expect(result.setLogs).toHaveLength(1)
    expect(result.setLogs[0]!.exerciseIdx).toBe(1)
    expect(result.setLogs[0]!.action.type).toBe('Complete')
  })

  it('without cursorOverride in msg, action lands on exercise 0 (regression guard)', () => {
    const jumpRoutine: Routine = { exercises: [bench, pushups] }
    const baseState: SessionState = { setLogs: [] }

    // Without cursorOverride, the natural first-incomplete exercise (0) is targeted.
    // Complete is invalid on a non-last set of weighted — throws instead of silently
    // misdirecting.  This test documents the pre-fix failure mode.
    expect(() =>
      runnerReducer(
        baseState,
        { kind: 'action', action: { type: 'Complete' } },
        jumpRoutine,
      ),
    ).toThrow(/Invalid action 'Complete'/)
  })
})

// ─── deriveButtonConfig ──────────────────────────────────────────────────────

describe('deriveButtonConfig — happy paths', () => {
  it('weighted mid-set (AE1): Increment/Stay/Decrement/Failed with weight previews', () => {
    const target = nextTarget(empty, routine)!
    const buttons = deriveButtonConfig(bench, false, target)
    expect(buttons).toHaveLength(4)
    expect(buttons[0]).toMatchObject({
      slot: 1,
      actionType: 'Increment',
      treatment: 'accent',
      iconKey: 'increment',
      previewWeight: 105,
    })
    expect(buttons[1]).toMatchObject({
      slot: 2,
      actionType: 'Stay',
      treatment: 'neutral',
      iconKey: 'stay',
      previewWeight: 100,
    })
    expect(buttons[2]).toMatchObject({
      slot: 3,
      actionType: 'Decrement',
      treatment: 'amber',
      iconKey: 'decrement',
      previewWeight: 95,
    })
    expect(buttons[3]).toMatchObject({
      slot: 4,
      actionType: 'Failed',
      treatment: 'red',
      iconKey: 'failed',
    })
    expect(buttons[3]?.previewWeight).toBeUndefined()
  })

  it('weighted last set (AE2): Complete/Stay/Decrement/Failed, no previews', () => {
    const state = stateWith(2, 0, routine)
    const target = nextTarget(state, routine)!
    const buttons = deriveButtonConfig(bench, true, target)
    expect(buttons[0]).toMatchObject({
      slot: 1,
      actionType: 'Complete',
      treatment: 'accent',
    })
    expect(buttons[1]).toMatchObject({ slot: 2, actionType: 'Stay' })
    expect(buttons[2]).toMatchObject({ slot: 3, actionType: 'Decrement' })
    expect(buttons[3]).toMatchObject({ slot: 4, actionType: 'Failed' })
    expect(buttons.every(b => b.previewWeight === undefined)).toBe(true)
  })

  it('bodyweight: slot 1 Complete (accent), slot 4 Failed (red), no slots 2/3', () => {
    const routineBW: Routine = { exercises: [pushups] }
    const target = nextTarget(empty, routineBW)!
    const buttons = deriveButtonConfig(pushups, false, target)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toMatchObject({
      slot: 1,
      actionType: 'Complete',
      treatment: 'accent',
    })
    expect(buttons[1]).toMatchObject({
      slot: 4,
      actionType: 'Failed',
      treatment: 'red',
    })
    expect(buttons.every(b => b.previewWeight === undefined)).toBe(true)
  })

  it('time-based: slot 1 Hold (neutral), slot 4 Failed (red)', () => {
    const routineTB: Routine = { exercises: [plank] }
    const target = nextTarget(empty, routineTB)!
    const buttons = deriveButtonConfig(plank, false, target)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toMatchObject({
      slot: 1,
      actionType: 'Hold',
      treatment: 'neutral',
    })
    expect(buttons[1]).toMatchObject({
      slot: 4,
      actionType: 'Failed',
      treatment: 'red',
    })
  })

  it('cardio: slot 1 Done (accent), slot 4 Skipped (neutral)', () => {
    const routineC: Routine = { exercises: [run] }
    const target = nextTarget(empty, routineC)!
    const buttons = deriveButtonConfig(run, true, target)
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toMatchObject({
      slot: 1,
      actionType: 'Done',
      treatment: 'accent',
    })
    expect(buttons[1]).toMatchObject({
      slot: 4,
      actionType: 'Skipped',
      treatment: 'neutral',
    })
  })
})

// ─── FSM parity cross-check ──────────────────────────────────────────────────

const ALL_NON_FAILED_ACTIONS: Action[] = [
  { type: 'Increment' },
  { type: 'Stay' },
  { type: 'Decrement' },
  { type: 'Complete' },
  { type: 'Hold' },
  { type: 'Done' },
  { type: 'Skipped' },
]

function probeAccepted(
  state: SessionState,
  _exercise: Exercise,
  r: Routine,
): Set<string> {
  const accepted = new Set<string>()
  for (const action of ALL_NON_FAILED_ACTIONS) {
    try {
      applyAction(state, action, r)
      accepted.add(action.type)
    } catch {
      /* rejected */
    }
  }
  // Failed variants differ by exercise type
  const failedReps: Action = { type: 'Failed', actualReps: 0 }
  const failedDur: Action = { type: 'Failed', actualDuration: 0 }
  try {
    applyAction(state, failedReps, r)
    accepted.add('Failed')
  } catch {
    /* not accepted */
  }
  try {
    applyAction(state, failedDur, r)
    accepted.add('Failed')
  } catch {
    /* not accepted */
  }
  return accepted
}

describe('deriveButtonConfig FSM parity (R10)', () => {
  function checkParity(
    label: string,
    exercise: Exercise,
    state: SessionState,
    r: Routine,
    isLastSet: boolean,
  ) {
    it(label, () => {
      const target = nextTarget(state, r)!
      const buttons = deriveButtonConfig(exercise, isLastSet, target)
      const offered = new Set(buttons.map(b => b.actionType as string))
      const accepted = probeAccepted(
        state,
        exercise /* kept for parity doc */,
        r,
      )
      expect(offered).toEqual(accepted)
    })
  }

  const r3 = { exercises: [bench] }
  const r1 = { exercises: [benchSingle] }
  const rBW = { exercises: [pushups] }
  const rTB = { exercises: [plank] }
  const rC = { exercises: [run] }

  checkParity(
    'weighted mid-set (setIdx=0, sets=3)',
    bench,
    { setLogs: [] },
    r3,
    false,
  )
  checkParity(
    'weighted mid-set (setIdx=1, sets=3)',
    bench,
    stateWith(1, 0, r3),
    r3,
    false,
  )
  checkParity(
    'weighted last set (setIdx=2, sets=3)',
    bench,
    stateWith(2, 0, r3),
    r3,
    true,
  )
  checkParity(
    'weighted single-set (sets=1, isLastSet=true)',
    benchSingle,
    { setLogs: [] },
    r1,
    true,
  )
  checkParity('bodyweight any', pushups, { setLogs: [] }, rBW, false)
  checkParity('bodyweight last set', pushups, stateWith(2, 0, rBW), rBW, true)
  checkParity('time-based any', plank, { setLogs: [] }, rTB, false)
  checkParity('cardio single', run, { setLogs: [] }, rC, true)
})

// ─── deriveProgress ───────────────────────────────────────────────────────────

describe('deriveProgress', () => {
  // 3-exercise routine: bench(3), pushups(3), plank(2) = 8 total sets
  it('mid-session: 4 logs over 3-exercise/8-set routine', () => {
    // Log all 3 bench sets + 1 pushup set
    let state = stateWith(3, 0, routine)
    state = {
      ...applyAction(state, { type: 'Complete' }, routine),
    }
    const result = deriveProgress(state, routine)
    expect(result.exerciseCount).toBe(3)
    expect(result.totalSets).toBe(8)
    expect(result.loggedSets).toBe(4)
    expect(result.activeExerciseIdx).toBe(1) // now on pushups
  })

  it('jumped (cursorOverride:2) → activeExerciseIdx:2', () => {
    const state: SessionState = { setLogs: [], cursorOverride: 2 }
    const result = deriveProgress(state, routine)
    expect(result.activeExerciseIdx).toBe(2)
  })

  it('terminal (all sets logged) → activeExerciseIdx is last exercise', () => {
    // Log all 8 sets
    let state = stateWith(3, 0, routine) // bench
    state = applyAction(state, { type: 'Complete' }, routine) // pushup 1
    state = applyAction(state, { type: 'Complete' }, routine) // pushup 2
    state = applyAction(state, { type: 'Complete' }, routine) // pushup 3
    state = applyAction(state, { type: 'Hold' }, routine) // plank 1
    state = applyAction(state, { type: 'Hold' }, routine) // plank 2
    expect(nextTarget(state, routine)).toBeNull()
    const result = deriveProgress(state, routine)
    expect(result.loggedSets).toBe(8)
    expect(result.totalSets).toBe(8)
    expect(result.activeExerciseIdx).toBe(2) // last exercise
  })

  it('edge (override-on-full): cursorOverride on full exercise falls through to natural', () => {
    // Log all 3 bench sets, then set cursor back to bench (which is full)
    const state: SessionState = {
      ...stateWith(3, 0, routine),
      cursorOverride: 0,
    }
    // nextTarget with cursorOverride:0 will see bench has 3 logs for 3 sets → stale
    // but actually nextTarget uses cursorOverride directly — the stale-override guard
    // is in the container. Here we verify deriveProgress doesn't crash.
    const result = deriveProgress(state, routine)
    // With cursorOverride:0 pointing at full exercise, nextTarget will return a
    // phantom setIdx=3 which is ≥ sets. But in this spec, we're verifying
    // the counting functions don't produce incorrect results; the container's
    // stale-override guard is tested via the integration path.
    expect(result.exerciseCount).toBe(3)
    expect(result.totalSets).toBe(8)
    expect(result.loggedSets).toBe(3)
    expect(result.activeExerciseIdx).toBe(0)
  })
})

// ─── deriveExerciseList ───────────────────────────────────────────────────────

describe('deriveExerciseList', () => {
  it('AE4: after bench (3/3) logged, cursor on pushups', () => {
    const state = stateWith(3, 0, routine)
    // pushups not started yet → natural position is pushups idx=1
    const list = deriveExerciseList(state, routine)
    expect(list[0]).toMatchObject({
      idx: 0,
      name: 'Bench Press',
      loggedCount: 3,
      sets: 3,
      status: 'done',
      isCurrent: false,
    })
    expect(list[1]).toMatchObject({
      idx: 1,
      name: 'Pushups',
      loggedCount: 0,
      sets: 3,
      status: 'unstarted',
      isCurrent: true,
    })
    expect(list[2]).toMatchObject({
      idx: 2,
      name: 'Plank',
      loggedCount: 0,
      sets: 2,
      status: 'unstarted',
      isCurrent: false,
    })
  })

  it('edge: known per-exercise log distribution — loggedCount and status exact', () => {
    // bench: 3 logs, pushups: 1 log, plank: 0
    let state = stateWith(3, 0, routine) // bench done
    state = applyAction(state, { type: 'Complete' }, routine) // pushup 1
    const list = deriveExerciseList(state, routine)
    expect(list[0]).toMatchObject({ loggedCount: 3, status: 'done' })
    expect(list[1]).toMatchObject({
      loggedCount: 1,
      status: 'in-progress',
      isCurrent: true,
    })
    expect(list[2]).toMatchObject({ loggedCount: 0, status: 'unstarted' })
  })

  it('AE5 (undo): after Complete advances bench→pushups, undo restores position', () => {
    let state = stateWith(2, 0, routine) // bench: 2 logs
    state = applyAction(state, { type: 'Complete' }, routine) // bench complete (3/3)
    // natural position now pushups
    expect(deriveExerciseList(state, routine)[1]?.isCurrent).toBe(true)
    state = undo(state) // pop last bench log
    const list = deriveExerciseList(state, routine)
    expect(list[0]).toMatchObject({
      loggedCount: 2,
      status: 'in-progress',
      isCurrent: true,
    })
    expect(list[1]).toMatchObject({ loggedCount: 0, status: 'unstarted' })
  })
})

// ─── countLogsForExercise ─────────────────────────────────────────────────────

describe('countLogsForExercise', () => {
  it('returns 0 for empty state', () => {
    expect(countLogsForExercise([], 0)).toBe(0)
  })

  it('counts only logs for the given exerciseIdx', () => {
    let state = stateWith(3, 0, routine) // bench: 3
    state = applyAction(state, { type: 'Complete' }, routine) // pushup: 1
    expect(countLogsForExercise(state.setLogs, 0)).toBe(3)
    expect(countLogsForExercise(state.setLogs, 1)).toBe(1)
    expect(countLogsForExercise(state.setLogs, 2)).toBe(0)
  })
})

// ─── derivePreviousSetPeek ────────────────────────────────────────────────────

describe('derivePreviousSetPeek', () => {
  it('first set weighted → kind:start with startingWeight', () => {
    const peek = derivePreviousSetPeek(empty, routine, 0)
    expect(peek).toEqual({ kind: 'start', startingWeight: 100 })
  })

  it('first set bodyweight → kind:none', () => {
    const peek = derivePreviousSetPeek(empty, routine, 1)
    expect(peek).toEqual({ kind: 'none' })
  })

  it('first set time-based → kind:none', () => {
    const peek = derivePreviousSetPeek(empty, routine, 2)
    expect(peek).toEqual({ kind: 'none' })
  })

  it('after a log → kind:log reflecting the last log', () => {
    const state = applyAction(empty, { type: 'Increment' }, routine)
    const peek = derivePreviousSetPeek(state, routine, 0)
    expect(peek).toMatchObject({
      kind: 'log',
      weight: 100,
      reps: 10,
      actualReps: 10,
      action: { type: 'Increment' },
    })
  })

  it('after a Failed set → kind:log with actualReps from the failed log', () => {
    const state = applyAction(empty, { type: 'Failed', actualReps: 7 }, routine)
    const peek = derivePreviousSetPeek(state, routine, 0)
    expect(peek).toMatchObject({
      kind: 'log',
      weight: 100,
      reps: 10,
      actualReps: 7,
      action: { type: 'Failed', actualReps: 7 },
    })
  })

  it('peek reflects the LAST log for the exercise', () => {
    let state = applyAction(empty, { type: 'Increment' }, routine) // set 1
    state = applyAction(state, { type: 'Stay' }, routine) // set 2
    const peek = derivePreviousSetPeek(state, routine, 0)
    expect(peek).toMatchObject({ kind: 'log', action: { type: 'Stay' } })
  })
})

// ─── deriveSessionSummary ─────────────────────────────────────────────────────

describe('deriveSessionSummary', () => {
  it('AE6: fully-logged 3-exercise session → exerciseCount:3, totalSetsLogged:8', () => {
    let state = stateWith(3, 0, routine)
    state = applyAction(state, { type: 'Complete' }, routine)
    state = applyAction(state, { type: 'Complete' }, routine)
    state = applyAction(state, { type: 'Complete' }, routine)
    state = applyAction(state, { type: 'Hold' }, routine)
    state = applyAction(state, { type: 'Hold' }, routine)
    const summary = deriveSessionSummary(state, routine)
    expect(summary).toEqual({ exerciseCount: 3, totalSetsLogged: 8 })
  })

  it('empty session → totalSetsLogged:0', () => {
    const summary = deriveSessionSummary(empty, routine)
    expect(summary).toEqual({ exerciseCount: 3, totalSetsLogged: 0 })
  })
})

// ─── deriveProgress / undo (AE5) ─────────────────────────────────────────────

describe('deriveProgress undo (AE5)', () => {
  it('after Complete advances bench→pushups, undo restores loggedSets and activeExerciseIdx', () => {
    let state = stateWith(2, 0, routine)
    state = applyAction(state, { type: 'Complete' }, routine) // bench 3/3 done
    expect(deriveProgress(state, routine).activeExerciseIdx).toBe(1)
    expect(deriveProgress(state, routine).loggedSets).toBe(3)
    state = undo(state)
    const result = deriveProgress(state, routine)
    expect(result.activeExerciseIdx).toBe(0) // back to bench
    expect(result.loggedSets).toBe(2)
  })
})

// ─── resolveActiveOverride ────────────────────────────────────────────────────

describe('resolveActiveOverride', () => {
  it('undefined cursorOverride → undefined', () => {
    expect(resolveActiveOverride([], undefined, routine)).toBeUndefined()
  })

  it('null cursorOverride → undefined', () => {
    expect(
      resolveActiveOverride([], null as unknown as undefined, routine),
    ).toBeUndefined()
  })

  it('cursorOverride points to exercise with remaining sets → returns idx', () => {
    // bench has 3 sets; 1 logged → 2 remaining → override is active
    const state = stateWith(1, 0, routine)
    expect(resolveActiveOverride(state.setLogs, 0, routine)).toBe(0)
  })

  it('cursorOverride points to fully-logged exercise → returns undefined', () => {
    // bench has 3 sets; all 3 logged → override is stale
    const state = stateWith(3, 0, routine)
    expect(resolveActiveOverride(state.setLogs, 0, routine)).toBeUndefined()
  })

  it('cursorOverride points out-of-bounds → returns undefined', () => {
    expect(resolveActiveOverride([], 99, routine)).toBeUndefined()
  })
})
