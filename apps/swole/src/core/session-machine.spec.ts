import {
  Action,
  applyAction,
  classifyPostSession,
  initialState,
  nextTarget,
  Routine,
  SessionState,
  SetLog,
  undo,
} from 'src/core/session-machine'

const weightedRoutine: Routine = {
  exercises: [
    {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    },
  ],
}

const weightedSingleSetRoutine: Routine = {
  exercises: [
    {
      name: 'Heavy Single',
      type: 'weighted',
      sets: 1,
      targetReps: 5,
      startingWeight: 200,
      increment: 10,
    },
  ],
}

const bodyweightRoutine: Routine = {
  exercises: [
    {
      name: 'Pushups',
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    },
  ],
}

const timeBasedRoutine: Routine = {
  exercises: [
    {
      name: 'Plank',
      type: 'time-based',
      sets: 3,
      durationSeconds: 30,
    },
  ],
}

const cardioRoutine: Routine = {
  exercises: [
    {
      name: 'Treadmill',
      type: 'cardio',
      sets: 1,
      durationSeconds: 600,
    },
  ],
}

const twoWeightedRoutine: Routine = {
  exercises: [
    {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    },
    {
      name: 'Squat',
      type: 'weighted',
      sets: 3,
      targetReps: 5,
      startingWeight: 200,
      increment: 10,
    },
  ],
}

function dispatch(
  initial: SessionState,
  actions: Action[],
  routine: Routine,
): SessionState {
  return actions.reduce((s, a) => applyAction(s, a, routine), initial)
}

describe('applyAction', () => {
  describe('weighted exercise, first set (no prior log)', () => {
    it('Increment → records weight=SW, action=Increment, reps=target, actualReps=target', () => {
      const result = applyAction(
        initialState(),
        { type: 'Increment' },
        weightedRoutine,
      )
      expect(result.setLogs).toEqual([
        {
          exerciseIdx: 0,
          setIdx: 0,
          weight: 100,
          reps: 10,
          actualReps: 10,
          action: { type: 'Increment' },
        },
      ])
    })

    it('Stay → records weight=SW, action=Stay', () => {
      const result = applyAction(
        initialState(),
        { type: 'Stay' },
        weightedRoutine,
      )
      expect(result.setLogs).toEqual([
        {
          exerciseIdx: 0,
          setIdx: 0,
          weight: 100,
          reps: 10,
          actualReps: 10,
          action: { type: 'Stay' },
        },
      ])
    })

    it('Decrement on first set → records weight=SW (decrement lands on set 2)', () => {
      const result = applyAction(
        initialState(),
        { type: 'Decrement' },
        weightedRoutine,
      )
      expect(result.setLogs).toEqual([
        {
          exerciseIdx: 0,
          setIdx: 0,
          weight: 100,
          reps: 10,
          actualReps: 10,
          action: { type: 'Decrement' },
        },
      ])
    })

    it('Failed with actualReps=7 → records weight=SW, reps=10, actualReps=7', () => {
      const result = applyAction(
        initialState(),
        { type: 'Failed', actualReps: 7 },
        weightedRoutine,
      )
      expect(result.setLogs).toEqual([
        {
          exerciseIdx: 0,
          setIdx: 0,
          weight: 100,
          reps: 10,
          actualReps: 7,
          action: { type: 'Failed', actualReps: 7 },
        },
      ])
    })
  })

  describe('weighted exercise, middle set (prior log exists)', () => {
    it('prior Increment (100, inc 5), current Increment → weight=105', () => {
      const state = applyAction(
        initialState(),
        { type: 'Increment' },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Increment' }, weightedRoutine)
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 1,
        weight: 105,
        reps: 10,
        actualReps: 10,
        action: { type: 'Increment' },
      })
    })

    it('prior Stay (100), current Stay → weight=100', () => {
      const state = applyAction(
        initialState(),
        { type: 'Stay' },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Stay' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(100)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Stay' })
    })

    it('prior Decrement (100, inc 5), current Decrement → weight=95', () => {
      const state = applyAction(
        initialState(),
        { type: 'Decrement' },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Decrement' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(95)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Decrement' })
    })

    it('prior Failed (100), current Stay → weight=100 (Failed → Stay-equivalent)', () => {
      const state = applyAction(
        initialState(),
        { type: 'Failed', actualReps: 6 },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Stay' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(100)
    })

    it('prior Increment (100, inc 5), current Stay → weight=105 (the bumped weight)', () => {
      const state = applyAction(
        initialState(),
        { type: 'Increment' },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Stay' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(105)
    })

    it('prior Failed (100, inc 5), current Increment → weight=100, action=Increment', () => {
      const state = applyAction(
        initialState(),
        { type: 'Failed', actualReps: 5 },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Increment' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(100)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Increment' })
    })

    it('prior Failed (100, inc 5), current Decrement → weight=100, action=Decrement', () => {
      const state = applyAction(
        initialState(),
        { type: 'Failed', actualReps: 5 },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Decrement' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(100)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Decrement' })
    })

    it('prior Decrement (100, inc 5), current Increment → weight=95, action=Increment', () => {
      const state = applyAction(
        initialState(),
        { type: 'Decrement' },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Increment' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(95)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Increment' })
    })

    it('prior Decrement (100, inc 5), current Stay → weight=95, action=Stay', () => {
      const state = applyAction(
        initialState(),
        { type: 'Decrement' },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Stay' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(95)
    })

    it('prior Increment (100, inc 5), current Decrement → weight=105, action=Decrement', () => {
      const state = applyAction(
        initialState(),
        { type: 'Increment' },
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Decrement' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(105)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Decrement' })
    })

    it('Complete on middle (non-last) set → throws', () => {
      const state = applyAction(
        initialState(),
        { type: 'Stay' },
        weightedRoutine,
      )
      expect(() =>
        applyAction(state, { type: 'Complete' }, weightedRoutine),
      ).toThrow(/Invalid action 'Complete'/)
    })
  })

  describe('weighted exercise, last set', () => {
    it('prior Stay (100), current Complete on last set → weight=100, action=Complete', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Stay' }],
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Complete' }, weightedRoutine)
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 2,
        weight: 100,
        reps: 10,
        actualReps: 10,
        action: { type: 'Complete' },
      })
    })

    it('prior Increment (100, inc 5), current Complete on last set → weight=105', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Increment' }],
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Complete' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(105)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Complete' })
    })

    it('Stay still valid on last set → weight=100', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Stay' }],
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Stay' }, weightedRoutine)
      expect(result.setLogs.at(-1)?.weight).toBe(100)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Stay' })
    })

    it('Decrement valid on last set (prior Stay → weight unchanged per R7)', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Stay' }],
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Decrement' }, weightedRoutine)
      // Per R7, new log's weight derives from PRIOR action, not current.
      // Prior Stay → unchanged. The Decrement label is recorded for history;
      // its effect would land on a (nonexistent) next set.
      expect(result.setLogs.at(-1)?.weight).toBe(100)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Decrement' })
    })

    it('Decrement on last set with prior Decrement → weight=95 (prior Decrement → -inc)', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Decrement' }],
        weightedRoutine,
      )
      const result = applyAction(state, { type: 'Decrement' }, weightedRoutine)
      // Prior log (set 1) had action=Decrement, weight=100. New log: 100 - 5 = 95.
      expect(result.setLogs.at(-1)?.weight).toBe(95)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Decrement' })
    })

    it('Failed with actualReps=6 on last set → weight=prior, actualReps=6', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Stay' }],
        weightedRoutine,
      )
      const result = applyAction(
        state,
        { type: 'Failed', actualReps: 6 },
        weightedRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 2,
        weight: 100,
        reps: 10,
        actualReps: 6,
        action: { type: 'Failed', actualReps: 6 },
      })
    })

    it('Increment on last set → throws (Complete replaces Increment)', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Stay' }],
        weightedRoutine,
      )
      expect(() =>
        applyAction(state, { type: 'Increment' }, weightedRoutine),
      ).toThrow(/Invalid action 'Increment'/)
    })
  })

  describe('weighted exercise, edge cases', () => {
    it('Decrement past zero is not clamped (5 - 10 = -5)', () => {
      const routine: Routine = {
        exercises: [
          {
            name: 'Edge',
            type: 'weighted',
            sets: 3,
            targetReps: 5,
            startingWeight: 5,
            increment: 10,
          },
        ],
      }
      const state = applyAction(initialState(), { type: 'Decrement' }, routine)
      const result = applyAction(state, { type: 'Decrement' }, routine)
      expect(result.setLogs.at(-1)?.weight).toBe(-5)
    })

    it('Decrement from zero is not clamped (0 - 5 = -5)', () => {
      const routine: Routine = {
        exercises: [
          {
            name: 'Zero SW',
            type: 'weighted',
            sets: 3,
            targetReps: 5,
            startingWeight: 0,
            increment: 5,
          },
        ],
      }
      const state = applyAction(initialState(), { type: 'Decrement' }, routine)
      const result = applyAction(state, { type: 'Decrement' }, routine)
      expect(result.setLogs.at(-1)?.weight).toBe(-5)
    })
  })

  describe('weighted exercise, single-set (sets=1, first IS last)', () => {
    it('Complete on the single set → records weight=SW=200, action=Complete', () => {
      const result = applyAction(
        initialState(),
        { type: 'Complete' },
        weightedSingleSetRoutine,
      )
      expect(result.setLogs.at(-1)?.weight).toBe(200)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Complete' })
    })

    it('Stay on the single set → weight=200', () => {
      const result = applyAction(
        initialState(),
        { type: 'Stay' },
        weightedSingleSetRoutine,
      )
      expect(result.setLogs.at(-1)?.weight).toBe(200)
    })

    it('Decrement on the single set → weight=200 (first-set Decrement records SW)', () => {
      const result = applyAction(
        initialState(),
        { type: 'Decrement' },
        weightedSingleSetRoutine,
      )
      expect(result.setLogs.at(-1)?.weight).toBe(200)
      expect(result.setLogs.at(-1)?.action).toEqual({ type: 'Decrement' })
    })

    it('Failed on the single set with actualReps=3 → weight=200, actualReps=3', () => {
      const result = applyAction(
        initialState(),
        { type: 'Failed', actualReps: 3 },
        weightedSingleSetRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 0,
        weight: 200,
        reps: 5,
        actualReps: 3,
        action: { type: 'Failed', actualReps: 3 },
      })
    })

    it('Increment on the single set → throws (single set IS the last set)', () => {
      expect(() =>
        applyAction(
          initialState(),
          { type: 'Increment' },
          weightedSingleSetRoutine,
        ),
      ).toThrow(/Invalid action 'Increment'/)
    })
  })

  describe('bodyweight exercise', () => {
    it('Complete on first set → reps=15, actualReps=15, action=Complete', () => {
      const result = applyAction(
        initialState(),
        { type: 'Complete' },
        bodyweightRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 0,
        reps: 15,
        actualReps: 15,
        action: { type: 'Complete' },
      })
    })

    it('Failed with actualReps=12 → reps=15, actualReps=12', () => {
      const result = applyAction(
        initialState(),
        { type: 'Failed', actualReps: 12 },
        bodyweightRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 0,
        reps: 15,
        actualReps: 12,
        action: { type: 'Failed', actualReps: 12 },
      })
    })

    it('Complete on middle set → reps=15', () => {
      const state = applyAction(
        initialState(),
        { type: 'Complete' },
        bodyweightRoutine,
      )
      const result = applyAction(state, { type: 'Complete' }, bodyweightRoutine)
      expect(result.setLogs.at(-1)?.setIdx).toBe(1)
      expect(result.setLogs.at(-1)?.reps).toBe(15)
    })

    it('Complete on last set → reps=15', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Complete' }, { type: 'Complete' }],
        bodyweightRoutine,
      )
      const result = applyAction(state, { type: 'Complete' }, bodyweightRoutine)
      expect(result.setLogs.at(-1)?.setIdx).toBe(2)
    })

    it.each([
      ['Increment', { type: 'Increment' } as Action],
      ['Stay', { type: 'Stay' } as Action],
      ['Decrement', { type: 'Decrement' } as Action],
      ['Hold', { type: 'Hold' } as Action],
      ['Done', { type: 'Done' } as Action],
      ['Skipped', { type: 'Skipped' } as Action],
    ])('%s on bodyweight → throws', (_label, action) => {
      expect(() =>
        applyAction(initialState(), action, bodyweightRoutine),
      ).toThrow(/Invalid action/)
    })
  })

  describe('time-based exercise', () => {
    it('Hold on first set → duration=30, action=Hold (no weight, no reps, no actualReps, no actualDuration)', () => {
      const result = applyAction(
        initialState(),
        { type: 'Hold' },
        timeBasedRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 0,
        duration: 30,
        action: { type: 'Hold' },
      })
    })

    it('Failed on first set with payload=20 → duration=30, actualDuration=20, no actualReps', () => {
      const result = applyAction(
        initialState(),
        { type: 'Failed', actualDuration: 20 },
        timeBasedRoutine,
      )
      const log = result.setLogs.at(-1)!
      expect(log.exerciseIdx).toBe(0)
      expect(log.setIdx).toBe(0)
      expect(log.duration).toBe(30)
      expect(log.actualDuration).toBe(20)
      expect(log.actualReps).toBeUndefined()
      expect(log.action).toEqual({ type: 'Failed', actualDuration: 20 })
    })

    it('Hold on middle set → duration=target', () => {
      const state = applyAction(
        initialState(),
        { type: 'Hold' },
        timeBasedRoutine,
      )
      const result = applyAction(state, { type: 'Hold' }, timeBasedRoutine)
      expect(result.setLogs.at(-1)?.setIdx).toBe(1)
      expect(result.setLogs.at(-1)?.duration).toBe(30)
    })

    it('Hold on last set → duration=target', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Hold' }, { type: 'Hold' }],
        timeBasedRoutine,
      )
      const result = applyAction(state, { type: 'Hold' }, timeBasedRoutine)
      expect(result.setLogs.at(-1)?.setIdx).toBe(2)
    })

    it.each([
      ['Increment', { type: 'Increment' } as Action],
      ['Stay', { type: 'Stay' } as Action],
      ['Decrement', { type: 'Decrement' } as Action],
      ['Complete', { type: 'Complete' } as Action],
      ['Done', { type: 'Done' } as Action],
      ['Skipped', { type: 'Skipped' } as Action],
    ])('%s on time-based → throws', (_label, action) => {
      expect(() =>
        applyAction(initialState(), action, timeBasedRoutine),
      ).toThrow(/Invalid action/)
    })
  })

  describe('cardio exercise (sets=1)', () => {
    it('Done on the single set → duration=target, action=Done', () => {
      const result = applyAction(
        initialState(),
        { type: 'Done' },
        cardioRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 0,
        duration: 600,
        action: { type: 'Done' },
      })
    })

    it('Skipped on the single set → duration=target, action=Skipped', () => {
      const result = applyAction(
        initialState(),
        { type: 'Skipped' },
        cardioRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 0,
        setIdx: 0,
        duration: 600,
        action: { type: 'Skipped' },
      })
    })

    it.each([
      ['Increment', { type: 'Increment' } as Action],
      ['Stay', { type: 'Stay' } as Action],
      ['Decrement', { type: 'Decrement' } as Action],
      ['Complete', { type: 'Complete' } as Action],
      ['Hold', { type: 'Hold' } as Action],
      ['Failed', { type: 'Failed', actualReps: 10 } as Action],
    ])('%s on cardio → throws', (_label, action) => {
      expect(() => applyAction(initialState(), action, cardioRoutine)).toThrow(
        /Invalid action/,
      )
    })
  })

  describe('cross-exercise transitions', () => {
    it('after completing weighted exercise 0, exercise 1 uses its own SW (not last weight of ex0)', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Increment' }, { type: 'Stay' }, { type: 'Complete' }],
        twoWeightedRoutine,
      )
      // exercise 0 fully complete. Now dispatch Increment on exercise 1.
      const result = applyAction(
        state,
        { type: 'Increment' },
        twoWeightedRoutine,
      )
      const newLog = result.setLogs.at(-1)!
      expect(newLog.exerciseIdx).toBe(1)
      expect(newLog.setIdx).toBe(0)
      expect(newLog.weight).toBe(200) // squat SW, not bench's last (105)
      expect(newLog.action).toEqual({ type: 'Increment' })
    })

    it('applyAction on a fully-complete session → throws "session is complete"', () => {
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Stay' }, { type: 'Complete' }],
        weightedRoutine,
      )
      // weightedRoutine has one exercise with 3 sets, now all 3 logged.
      // No more positions to write.
      expect(() =>
        applyAction(state, { type: 'Stay' }, weightedRoutine),
      ).toThrow(/session is complete/)
    })

    it('applyAction with hand-constructed out-of-range cursorOverride → throws "session is complete"', () => {
      // JumpTo validates the index, but a hand-constructed state could carry an invalid override.
      // findActivePosition treats this as no-position and applyAction reports session complete.
      const state: SessionState = {
        setLogs: [],
        cursorOverride: 5,
      }
      expect(() =>
        applyAction(state, { type: 'Stay' }, weightedRoutine),
      ).toThrow(/session is complete/)
    })
  })

  describe('purity invariants', () => {
    it('applyAction does not mutate state.setLogs (length unchanged after dispatch)', () => {
      const before = initialState()
      const beforeLen = before.setLogs.length
      applyAction(before, { type: 'Stay' }, weightedRoutine)
      expect(before.setLogs.length).toBe(beforeLen)
    })

    it('returned state.setLogs is a new reference', () => {
      const before = initialState()
      const after = applyAction(before, { type: 'Stay' }, weightedRoutine)
      expect(after.setLogs).not.toBe(before.setLogs)
    })

    it('returned state is a new object', () => {
      const before = initialState()
      const after = applyAction(before, { type: 'Stay' }, weightedRoutine)
      expect(after).not.toBe(before)
    })
  })

  describe('JumpTo action and cursor override', () => {
    it('JumpTo on empty state → no log appended, cursorOverride set', () => {
      const result = applyAction(
        initialState(),
        { type: 'JumpTo', exerciseIdx: 1 },
        twoWeightedRoutine,
      )
      expect(result.setLogs).toEqual([])
      expect(result.cursorOverride).toBe(1)
    })

    it('JumpTo on state with existing logs → setLogs reference unchanged, cursorOverride set', () => {
      const state = applyAction(
        initialState(),
        { type: 'Stay' },
        twoWeightedRoutine,
      )
      const result = applyAction(
        state,
        { type: 'JumpTo', exerciseIdx: 1 },
        twoWeightedRoutine,
      )
      expect(result.setLogs).toBe(state.setLogs)
      expect(result.cursorOverride).toBe(1)
    })

    it('non-JumpTo action after JumpTo → writes to jumped-to exercise, override cleared', () => {
      // Start fresh, JumpTo exercise 1, then dispatch Increment
      const state1 = applyAction(
        initialState(),
        { type: 'JumpTo', exerciseIdx: 1 },
        twoWeightedRoutine,
      )
      const state2 = applyAction(
        state1,
        { type: 'Increment' },
        twoWeightedRoutine,
      )
      expect(state2.setLogs.at(-1)).toEqual({
        exerciseIdx: 1,
        setIdx: 0,
        weight: 200, // squat SW
        reps: 5,
        actualReps: 5,
        action: { type: 'Increment' },
      })
      expect(state2.cursorOverride).toBeUndefined()
    })

    it('JumpTo into partially-completed exercise → new log honors existing count', () => {
      // 1 log on exercise 1 already, then JumpTo exercise 1, then dispatch
      const setupState = dispatch(
        initialState(),
        [
          { type: 'JumpTo', exerciseIdx: 1 },
          { type: 'Stay' }, // log on exercise 1
        ],
        twoWeightedRoutine,
      )
      const jumped = applyAction(
        setupState,
        { type: 'JumpTo', exerciseIdx: 1 },
        twoWeightedRoutine,
      )
      const result = applyAction(
        jumped,
        { type: 'Increment' },
        twoWeightedRoutine,
      )
      expect(result.setLogs.at(-1)).toEqual({
        exerciseIdx: 1,
        setIdx: 1,
        weight: 200, // prior Stay → unchanged from SW
        reps: 5,
        actualReps: 5,
        action: { type: 'Increment' },
      })
    })

    it('JumpTo back to fully-completed exercise → next applyAction throws (no slot)', () => {
      // Complete all 3 sets of exercise 0
      const state = dispatch(
        initialState(),
        [{ type: 'Stay' }, { type: 'Stay' }, { type: 'Complete' }],
        twoWeightedRoutine,
      )
      const jumped = applyAction(
        state,
        { type: 'JumpTo', exerciseIdx: 0 },
        twoWeightedRoutine,
      )
      expect(() =>
        applyAction(jumped, { type: 'Stay' }, twoWeightedRoutine),
      ).toThrow(/exercise 0 has 3 sets; cannot write setIdx 3/)
    })

    it('two JumpTos in a row → override updates to latest target', () => {
      const state = applyAction(
        initialState(),
        { type: 'JumpTo', exerciseIdx: 1 },
        twoWeightedRoutine,
      )
      const result = applyAction(
        state,
        { type: 'JumpTo', exerciseIdx: 0 },
        twoWeightedRoutine,
      )
      expect(result.cursorOverride).toBe(0)
      expect(result.setLogs).toEqual([])
    })

    it('JumpTo into currently-active exercise → no-op effect, next action proceeds normally', () => {
      // Active exercise is exercise 0 (no logs). JumpTo 0 should match the normal walk.
      const jumped = applyAction(
        initialState(),
        { type: 'JumpTo', exerciseIdx: 0 },
        twoWeightedRoutine,
      )
      expect(jumped.cursorOverride).toBe(0)
      const result = applyAction(jumped, { type: 'Stay' }, twoWeightedRoutine)
      expect(result.setLogs.at(-1)?.exerciseIdx).toBe(0)
      expect(result.setLogs.at(-1)?.setIdx).toBe(0)
      expect(result.cursorOverride).toBeUndefined()
    })

    it('JumpTo to exerciseIdx=-1 → throws', () => {
      expect(() =>
        applyAction(
          initialState(),
          { type: 'JumpTo', exerciseIdx: -1 },
          twoWeightedRoutine,
        ),
      ).toThrow(/out of range/)
    })

    it('JumpTo to exerciseIdx=length → throws', () => {
      expect(() =>
        applyAction(
          initialState(),
          { type: 'JumpTo', exerciseIdx: 2 },
          twoWeightedRoutine,
        ),
      ).toThrow(/out of range/)
    })

    it('JumpTo to exerciseIdx=length+1 → throws', () => {
      expect(() =>
        applyAction(
          initialState(),
          { type: 'JumpTo', exerciseIdx: 3 },
          twoWeightedRoutine,
        ),
      ).toThrow(/out of range/)
    })

    it('JumpTo on empty routine → throws', () => {
      expect(() =>
        applyAction(
          initialState(),
          { type: 'JumpTo', exerciseIdx: 0 },
          { exercises: [] },
        ),
      ).toThrow(/out of range/)
    })

    it('applyAction with non-JumpTo when override points at completed exercise → throws', () => {
      // Complete exercise 0, then JumpTo back to it, then try to dispatch
      const state = dispatch(
        initialState(),
        [
          { type: 'Stay' },
          { type: 'Stay' },
          { type: 'Complete' },
          { type: 'JumpTo', exerciseIdx: 0 },
        ],
        twoWeightedRoutine,
      )
      expect(() =>
        applyAction(state, { type: 'Stay' }, twoWeightedRoutine),
      ).toThrow(/exercise 0 has 3 sets; cannot write setIdx 3/)
    })

    it('JumpTo preserves setLogs reference (same array, not a copy)', () => {
      const state = applyAction(
        initialState(),
        { type: 'Stay' },
        twoWeightedRoutine,
      )
      const after = applyAction(
        state,
        { type: 'JumpTo', exerciseIdx: 1 },
        twoWeightedRoutine,
      )
      expect(after.setLogs).toBe(state.setLogs)
    })
  })
})

describe('undo', () => {
  it('dispatch one action then undo → state equals initialState()', () => {
    const after = applyAction(initialState(), { type: 'Stay' }, weightedRoutine)
    expect(undo(after)).toEqual(initialState())
  })

  it('dispatch two actions then undo → setLogs has length 1, matches first dispatch', () => {
    const afterOne = applyAction(
      initialState(),
      { type: 'Increment' },
      weightedRoutine,
    )
    const afterTwo = applyAction(afterOne, { type: 'Stay' }, weightedRoutine)
    const result = undo(afterTwo)
    expect(result.setLogs).toHaveLength(1)
    expect(result.setLogs).toEqual(afterOne.setLogs)
  })

  it('undo on empty state → returns input unchanged', () => {
    const empty = initialState()
    expect(undo(empty)).toBe(empty)
  })

  it('undo across exercise boundary → removes only the most recent log; cursor points back to un-done set', () => {
    // Complete exercise 0 (3 sets), then write 1 set on exercise 1.
    const state = dispatch(
      initialState(),
      [
        { type: 'Stay' }, // ex0 set 0
        { type: 'Stay' }, // ex0 set 1
        { type: 'Complete' }, // ex0 set 2
        { type: 'Increment' }, // ex1 set 0 (only log on ex1)
      ],
      twoWeightedRoutine,
    )
    const undone = undo(state)
    expect(undone.setLogs).toHaveLength(3)
    // ex1 should be empty after undo
    expect(undone.setLogs.filter(l => l.exerciseIdx === 1)).toEqual([])
    // ex0 still has 3 logs
    expect(undone.setLogs.filter(l => l.exerciseIdx === 0)).toHaveLength(3)
    // A subsequent applyAction writes to exercise 1, setIdx 0 again
    const next = applyAction(undone, { type: 'Stay' }, twoWeightedRoutine)
    const lastLog = next.setLogs.at(-1)!
    expect(lastLog.exerciseIdx).toBe(1)
    expect(lastLog.setIdx).toBe(0)
  })

  it.each<[string, Action, Routine]>([
    ['weighted first set Stay', { type: 'Stay' }, weightedRoutine],
    [
      'weighted with prior log + Increment',
      { type: 'Increment' },
      weightedRoutine,
    ],
    ['bodyweight Complete', { type: 'Complete' }, bodyweightRoutine],
    ['time-based Hold', { type: 'Hold' }, timeBasedRoutine],
    ['cardio Done', { type: 'Done' }, cardioRoutine],
  ])('round-trip property: %s', (_label, action, routine) => {
    // For weighted-with-prior, dispatch one Stay first so there's a prior log.
    const initial =
      _label === 'weighted with prior log + Increment'
        ? applyAction(initialState(), { type: 'Stay' }, routine)
        : initialState()
    const after = applyAction(initial, action, routine)
    expect(undo(after)).toEqual(initial)
  })

  it('undo twice on a state with one log → second undo is no-op', () => {
    const after = applyAction(initialState(), { type: 'Stay' }, weightedRoutine)
    const once = undo(after)
    const twice = undo(once)
    expect(twice).toEqual(initialState())
  })

  it('undo on state with cursorOverride + logs → removes last log AND clears override', () => {
    const state = applyAction(
      initialState(),
      { type: 'Stay' },
      twoWeightedRoutine,
    )
    const withOverride = applyAction(
      state,
      { type: 'JumpTo', exerciseIdx: 1 },
      twoWeightedRoutine,
    )
    // withOverride.setLogs has 1 log (same as state); cursorOverride = 1.
    const undone = undo(withOverride)
    expect(undone.setLogs).toEqual([])
    expect(undone.cursorOverride).toBeUndefined()
  })

  it('undo after JumpTo with no subsequent write → setLogs unchanged, override cleared', () => {
    const state = applyAction(
      initialState(),
      { type: 'Stay' },
      twoWeightedRoutine,
    )
    const withOverride = applyAction(
      state,
      { type: 'JumpTo', exerciseIdx: 1 },
      twoWeightedRoutine,
    )
    // Override is set; the JumpTo did not add a log. Now undo.
    const undone = undo(withOverride)
    // Undo pops the last log. state has 1 log; withOverride has 1 log (same).
    // After undo: setLogs has 0 logs (1 - 1).
    expect(undone.setLogs).toHaveLength(0)
    expect(undone.cursorOverride).toBeUndefined()
  })

  it('round-trip for JumpTo from initialState: undo(applyAction(initial, JumpTo)) → initialState (empty branch is no-op)', () => {
    const s = initialState()
    const after = applyAction(
      s,
      { type: 'JumpTo', exerciseIdx: 1 },
      twoWeightedRoutine,
    )
    // JumpTo did NOT add a log; setLogs is still empty. undo's empty branch is a no-op.
    // Result: setLogs unchanged (empty), no cursorOverride.
    const undone = undo(after)
    expect(undone.setLogs).toEqual(s.setLogs)
    expect(undone.cursorOverride).toBeUndefined()
  })
})

describe('nextTarget', () => {
  it('initial state on weighted routine → first set of exercise 0 with SW', () => {
    expect(nextTarget(initialState(), weightedRoutine)).toEqual({
      weight: 100,
      reps: 10,
      exerciseIdx: 0,
      setIdx: 0,
    })
  })

  it('after one Increment log on ex 0 → weight = SW + inc, setIdx = 1', () => {
    const state = applyAction(
      initialState(),
      { type: 'Increment' },
      weightedRoutine,
    )
    expect(nextTarget(state, weightedRoutine)).toEqual({
      weight: 105,
      reps: 10,
      exerciseIdx: 0,
      setIdx: 1,
    })
  })

  it('after one Stay log → weight = SW, setIdx = 1', () => {
    const state = applyAction(initialState(), { type: 'Stay' }, weightedRoutine)
    expect(nextTarget(state, weightedRoutine)?.weight).toBe(100)
    expect(nextTarget(state, weightedRoutine)?.setIdx).toBe(1)
  })

  it('after one Decrement log → weight = SW − inc, setIdx = 1', () => {
    const state = applyAction(
      initialState(),
      { type: 'Decrement' },
      weightedRoutine,
    )
    expect(nextTarget(state, weightedRoutine)?.weight).toBe(95)
  })

  it('after one Failed log → weight = SW (R8: Failed → Stay-equivalent)', () => {
    const state = applyAction(
      initialState(),
      { type: 'Failed', actualReps: 5 },
      weightedRoutine,
    )
    expect(nextTarget(state, weightedRoutine)?.weight).toBe(100)
  })

  it('after exercise.sets logs on ex 0 → advance to ex 1, setIdx = 0', () => {
    const state = dispatch(
      initialState(),
      [{ type: 'Stay' }, { type: 'Stay' }, { type: 'Complete' }],
      twoWeightedRoutine,
    )
    expect(nextTarget(state, twoWeightedRoutine)).toEqual({
      weight: 200, // squat SW
      reps: 5,
      exerciseIdx: 1,
      setIdx: 0,
    })
  })

  it('after full ex 0 + one log on ex 1 → ex 1, setIdx = 1', () => {
    const state = dispatch(
      initialState(),
      [
        { type: 'Stay' }, // ex0 set 0
        { type: 'Stay' }, // ex0 set 1
        { type: 'Complete' }, // ex0 set 2
        { type: 'Stay' }, // ex1 set 0
      ],
      twoWeightedRoutine,
    )
    expect(nextTarget(state, twoWeightedRoutine)?.exerciseIdx).toBe(1)
    expect(nextTarget(state, twoWeightedRoutine)?.setIdx).toBe(1)
  })

  it('bodyweight routine → next target has reps but no weight', () => {
    const target = nextTarget(initialState(), bodyweightRoutine)
    expect(target).toEqual({
      reps: 15,
      exerciseIdx: 0,
      setIdx: 0,
    })
    expect(target?.weight).toBeUndefined()
  })

  it('time-based routine → next target has duration, no weight, no reps', () => {
    const target = nextTarget(initialState(), timeBasedRoutine)
    expect(target).toEqual({
      duration: 30,
      exerciseIdx: 0,
      setIdx: 0,
    })
    expect(target?.weight).toBeUndefined()
    expect(target?.reps).toBeUndefined()
  })

  it('cardio (sets=1), one Done log → advances to next exercise (or null)', () => {
    const cardioThenWeighted: Routine = {
      exercises: [
        {
          name: 'Treadmill',
          type: 'cardio',
          sets: 1,
          durationSeconds: 600,
        },
        {
          name: 'Bench',
          type: 'weighted',
          sets: 3,
          targetReps: 10,
          startingWeight: 100,
          increment: 5,
        },
      ],
    }
    const state = applyAction(
      initialState(),
      { type: 'Done' },
      cardioThenWeighted,
    )
    expect(nextTarget(state, cardioThenWeighted)).toEqual({
      weight: 100,
      reps: 10,
      exerciseIdx: 1,
      setIdx: 0,
    })
  })

  it('cardio as the only exercise → null after Done', () => {
    const state = applyAction(initialState(), { type: 'Done' }, cardioRoutine)
    expect(nextTarget(state, cardioRoutine)).toBeNull()
  })

  it('cardio sandwiched between weighted exercises → walks through correctly', () => {
    const routine: Routine = {
      exercises: [
        {
          name: 'Bench',
          type: 'weighted',
          sets: 3,
          targetReps: 10,
          startingWeight: 100,
          increment: 5,
        },
        {
          name: 'Treadmill',
          type: 'cardio',
          sets: 1,
          durationSeconds: 600,
        },
        {
          name: 'Squat',
          type: 'weighted',
          sets: 3,
          targetReps: 5,
          startingWeight: 200,
          increment: 10,
        },
      ],
    }
    // Complete bench's 3 sets
    let state = dispatch(
      initialState(),
      [{ type: 'Stay' }, { type: 'Stay' }, { type: 'Complete' }],
      routine,
    )
    // Next is cardio
    expect(nextTarget(state, routine)?.exerciseIdx).toBe(1)
    // Done cardio
    state = applyAction(state, { type: 'Done' }, routine)
    // Next is squat, setIdx 0 with squat SW (not bench's last 100)
    expect(nextTarget(state, routine)).toEqual({
      weight: 200,
      reps: 5,
      exerciseIdx: 2,
      setIdx: 0,
    })
    // Walk squat
    state = dispatch(
      state,
      [{ type: 'Stay' }, { type: 'Stay' }, { type: 'Complete' }],
      routine,
    )
    expect(nextTarget(state, routine)).toBeNull()
  })

  it('full routine completed → returns null', () => {
    const state = dispatch(
      initialState(),
      [{ type: 'Stay' }, { type: 'Stay' }, { type: 'Complete' }],
      weightedRoutine,
    )
    expect(nextTarget(state, weightedRoutine)).toBeNull()
  })

  it('empty routine → returns null', () => {
    expect(nextTarget(initialState(), { exercises: [] })).toBeNull()
  })

  it('cross-exercise: ex 0 just completed → ex 1 uses its own SW, not last weight of ex 0', () => {
    // Bench Press SW=100, increment, increment, complete → log weights 100, 105, 110
    // Then nextTarget on ex 1 (squat SW=200) should return 200, not 110.
    const state = dispatch(
      initialState(),
      [{ type: 'Increment' }, { type: 'Increment' }, { type: 'Complete' }],
      twoWeightedRoutine,
    )
    // ex0 last weight is 110 (Increment → +5 each step from SW=100)
    expect(state.setLogs.at(-1)?.weight).toBe(110)
    expect(nextTarget(state, twoWeightedRoutine)?.weight).toBe(200)
    expect(nextTarget(state, twoWeightedRoutine)?.exerciseIdx).toBe(1)
  })

  it('agreement: nextTarget(s, r).weight === applyAction(s, Stay, r).setLogs.at(-1).weight', () => {
    // Pin that deriveNextWeight is the shared source of weight derivation.
    const states: SessionState[] = [
      initialState(),
      applyAction(initialState(), { type: 'Increment' }, weightedRoutine),
      applyAction(initialState(), { type: 'Stay' }, weightedRoutine),
      applyAction(initialState(), { type: 'Decrement' }, weightedRoutine),
      dispatch(
        initialState(),
        [{ type: 'Increment' }, { type: 'Stay' }],
        weightedRoutine,
      ),
    ]
    for (const s of states) {
      const preview = nextTarget(s, weightedRoutine)
      const applied = applyAction(s, { type: 'Stay' }, weightedRoutine)
      expect(preview?.weight).toBe(applied.setLogs.at(-1)?.weight)
    }
  })

  it('after JumpTo to exercise 2 on empty state → returns exercise 2 first-set target', () => {
    const threeExerciseRoutine: Routine = {
      exercises: [
        {
          name: 'Bench',
          type: 'weighted',
          sets: 3,
          targetReps: 10,
          startingWeight: 100,
          increment: 5,
        },
        {
          name: 'Squat',
          type: 'weighted',
          sets: 3,
          targetReps: 5,
          startingWeight: 200,
          increment: 10,
        },
        {
          name: 'Deadlift',
          type: 'weighted',
          sets: 3,
          targetReps: 3,
          startingWeight: 300,
          increment: 5,
        },
      ],
    }
    const state = applyAction(
      initialState(),
      { type: 'JumpTo', exerciseIdx: 2 },
      threeExerciseRoutine,
    )
    expect(nextTarget(state, threeExerciseRoutine)).toEqual({
      weight: 300,
      reps: 3,
      exerciseIdx: 2,
      setIdx: 0,
    })
  })

  it('after JumpTo to fully-completed exercise → returns that exercise with setIdx >= sets', () => {
    const state = dispatch(
      initialState(),
      [
        { type: 'Stay' }, // ex0 set 0
        { type: 'Stay' }, // ex0 set 1
        { type: 'Complete' }, // ex0 set 2
        { type: 'JumpTo', exerciseIdx: 0 }, // jump back to completed ex0
      ],
      twoWeightedRoutine,
    )
    const target = nextTarget(state, twoWeightedRoutine)
    expect(target?.exerciseIdx).toBe(0)
    expect(target?.setIdx).toBe(3) // count of logs on ex0, which is >= sets
  })
})

describe('classifyPostSession', () => {
  // Hand-construct logs for classification tests. classifyPostSession only reads
  // log.weight and log.exerciseIdx; action values are placeholders.
  function weightedLog(
    exerciseIdx: number,
    setIdx: number,
    weight: number,
  ): SetLog {
    return {
      exerciseIdx,
      setIdx,
      weight,
      reps: 10,
      actualReps: 10,
      action: { type: 'Stay' },
    }
  }

  it('AE F3-A: Bench Press SW=100 inc=5, logs 100/105/110 → Case A', () => {
    const state: SessionState = {
      setLogs: [
        weightedLog(0, 0, 100),
        weightedLog(0, 1, 105),
        weightedLog(0, 2, 110),
      ],
    }
    expect(classifyPostSession(state, weightedRoutine)).toEqual([
      {
        case: 'A',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 100,
        highest: 110,
        ending: 110,
        stayOption: 100,
        rollUpOption: 105,
      },
    ])
  })

  it('All sets at SW → Case A with lowest=100, ending=100', () => {
    const state: SessionState = {
      setLogs: [
        weightedLog(0, 0, 100),
        weightedLog(0, 1, 100),
        weightedLog(0, 2, 100),
      ],
    }
    expect(classifyPostSession(state, weightedRoutine)).toEqual([
      {
        case: 'A',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 100,
        highest: 100,
        ending: 100,
        stayOption: 100,
        rollUpOption: 105,
      },
    ])
  })

  it('AE F3-B: Bench Press SW=100, logs 100/95 (dropped at set 2) → Case B', () => {
    const state: SessionState = {
      setLogs: [weightedLog(0, 0, 100), weightedLog(0, 1, 95)],
    }
    expect(classifyPostSession(state, weightedRoutine)).toEqual([
      {
        case: 'B',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 95,
        highest: 100,
        ending: 95,
        newStartingWeight: 95,
      },
    ])
  })

  it('Bench Press SW=100, logs 100/95/95/95 → Case B with newStartingWeight=95', () => {
    const state: SessionState = {
      setLogs: [
        weightedLog(0, 0, 100),
        weightedLog(0, 1, 95),
        weightedLog(0, 2, 95),
        weightedLog(0, 3, 95),
      ],
    }
    expect(classifyPostSession(state, weightedRoutine)).toEqual([
      {
        case: 'B',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 95,
        highest: 100,
        ending: 95,
        newStartingWeight: 95,
      },
    ])
  })

  it('Bench Press SW=100, logs 100/105/100/95 → Case B with lowest=95 highest=105 ending=95', () => {
    const state: SessionState = {
      setLogs: [
        weightedLog(0, 0, 100),
        weightedLog(0, 1, 105),
        weightedLog(0, 2, 100),
        weightedLog(0, 3, 95),
      ],
    }
    expect(classifyPostSession(state, weightedRoutine)).toEqual([
      {
        case: 'B',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 95,
        highest: 105,
        ending: 95,
        newStartingWeight: 95,
      },
    ])
  })

  it('Routine = Bench + Pushups + Plank, logs for all → only Bench Press emits', () => {
    const routine: Routine = {
      exercises: [
        {
          name: 'Bench',
          type: 'weighted',
          sets: 3,
          targetReps: 10,
          startingWeight: 100,
          increment: 5,
        },
        {
          name: 'Pushups',
          type: 'bodyweight',
          sets: 3,
          targetReps: 15,
        },
        {
          name: 'Plank',
          type: 'time-based',
          sets: 3,
          durationSeconds: 30,
        },
      ],
    }
    const state: SessionState = {
      setLogs: [
        weightedLog(0, 0, 100),
        weightedLog(0, 1, 100),
        weightedLog(0, 2, 100),
        {
          exerciseIdx: 1,
          setIdx: 0,
          reps: 15,
          actualReps: 15,
          action: { type: 'Complete' },
        },
        {
          exerciseIdx: 2,
          setIdx: 0,
          duration: 30,
          action: { type: 'Hold' },
        },
      ],
    }
    const result = classifyPostSession(state, routine)
    expect(result).toHaveLength(1)
    expect(result[0]?.exerciseIdx).toBe(0)
    expect(result[0]?.case).toBe('A')
  })

  it('Two weighted exercises with logs → two prompts in routine order', () => {
    const state: SessionState = {
      setLogs: [
        weightedLog(0, 0, 100),
        weightedLog(0, 1, 100),
        weightedLog(0, 2, 100),
        weightedLog(1, 0, 200),
        weightedLog(1, 1, 200),
        weightedLog(1, 2, 200),
      ],
    }
    const result = classifyPostSession(state, twoWeightedRoutine)
    expect(result).toHaveLength(2)
    expect(result[0]?.exerciseIdx).toBe(0)
    expect(result[1]?.exerciseIdx).toBe(1)
    expect(result[0]?.case).toBe('A')
    expect(result[1]?.case).toBe('A')
  })

  it('weighted exercise with no logs (session abandoned before) → no prompt', () => {
    const state: SessionState = {
      setLogs: [weightedLog(0, 0, 100)],
    }
    // twoWeightedRoutine has Bench (idx 0) and Squat (idx 1). Only Bench has logs.
    const result = classifyPostSession(state, twoWeightedRoutine)
    expect(result).toHaveLength(1)
    expect(result[0]?.exerciseIdx).toBe(0)
  })

  it('empty state → empty array', () => {
    expect(classifyPostSession(initialState(), weightedRoutine)).toEqual([])
  })

  it('all-cardio routine → empty array', () => {
    const routine: Routine = {
      exercises: [
        {
          name: 'Treadmill',
          type: 'cardio',
          sets: 1,
          durationSeconds: 600,
        },
      ],
    }
    const state: SessionState = {
      setLogs: [
        {
          exerciseIdx: 0,
          setIdx: 0,
          duration: 600,
          action: { type: 'Done' },
        },
      ],
    }
    expect(classifyPostSession(state, routine)).toEqual([])
  })

  it('Single set at 95 (below SW) → Case B with newStartingWeight=95', () => {
    const state: SessionState = {
      setLogs: [weightedLog(0, 0, 95)],
    }
    expect(classifyPostSession(state, weightedRoutine)).toEqual([
      {
        case: 'B',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 95,
        highest: 95,
        ending: 95,
        newStartingWeight: 95,
      },
    ])
  })

  it('Boundary: lowest exactly equals SW (100/100/100) → Case A', () => {
    const state: SessionState = {
      setLogs: [
        weightedLog(0, 0, 100),
        weightedLog(0, 1, 100),
        weightedLog(0, 2, 100),
      ],
    }
    const result = classifyPostSession(state, weightedRoutine)
    expect(result[0]?.case).toBe('A')
  })
})

describe('PRD fixtures', () => {
  const pushDay: Routine = {
    exercises: [
      {
        name: 'Bench Press',
        type: 'weighted',
        sets: 3,
        targetReps: 10,
        startingWeight: 100,
        increment: 5,
      },
      {
        name: 'Pushups',
        type: 'bodyweight',
        sets: 3,
        targetReps: 15,
      },
      {
        name: 'Plank',
        type: 'time-based',
        sets: 3,
        durationSeconds: 30,
      },
    ],
  }

  it('F2: Push Day walkthrough → final setLogs exactly match expected 9-entry array', () => {
    const actions: Action[] = [
      // Bench Press 3 sets
      { type: 'Increment' },
      { type: 'Stay' },
      { type: 'Complete' },
      // Pushups 3 sets
      { type: 'Failed', actualReps: 12 },
      { type: 'Complete' },
      { type: 'Complete' },
      // Plank 3 sets
      { type: 'Hold' },
      { type: 'Hold' },
      { type: 'Hold' },
    ]
    const final = dispatch(initialState(), actions, pushDay)
    expect(final.setLogs).toEqual([
      {
        exerciseIdx: 0,
        setIdx: 0,
        weight: 100,
        reps: 10,
        actualReps: 10,
        action: { type: 'Increment' },
      },
      {
        exerciseIdx: 0,
        setIdx: 1,
        weight: 105,
        reps: 10,
        actualReps: 10,
        action: { type: 'Stay' },
      },
      {
        exerciseIdx: 0,
        setIdx: 2,
        weight: 105,
        reps: 10,
        actualReps: 10,
        action: { type: 'Complete' },
      },
      {
        exerciseIdx: 1,
        setIdx: 0,
        reps: 15,
        actualReps: 12,
        action: { type: 'Failed', actualReps: 12 },
      },
      {
        exerciseIdx: 1,
        setIdx: 1,
        reps: 15,
        actualReps: 15,
        action: { type: 'Complete' },
      },
      {
        exerciseIdx: 1,
        setIdx: 2,
        reps: 15,
        actualReps: 15,
        action: { type: 'Complete' },
      },
      {
        exerciseIdx: 2,
        setIdx: 0,
        duration: 30,
        action: { type: 'Hold' },
      },
      {
        exerciseIdx: 2,
        setIdx: 1,
        duration: 30,
        action: { type: 'Hold' },
      },
      {
        exerciseIdx: 2,
        setIdx: 2,
        duration: 30,
        action: { type: 'Hold' },
      },
    ])
    // After the full session: nextTarget returns null (session complete)
    expect(nextTarget(final, pushDay)).toBeNull()
    // classifyPostSession emits one Case A prompt for Bench Press only
    expect(classifyPostSession(final, pushDay)).toEqual([
      {
        case: 'A',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 100,
        highest: 105,
        ending: 105,
        stayOption: 100,
        rollUpOption: 105,
      },
    ])
  })

  it('F3 Case A: Bench Press at 100/105/110 → Stay@100 or Roll up to 105', () => {
    // Produced via [Increment, Increment, Complete] on Bench Press
    const benchOnly: Routine = {
      exercises: [
        {
          name: 'Bench Press',
          type: 'weighted',
          sets: 3,
          targetReps: 10,
          startingWeight: 100,
          increment: 5,
        },
      ],
    }
    const state = dispatch(
      initialState(),
      [{ type: 'Increment' }, { type: 'Increment' }, { type: 'Complete' }],
      benchOnly,
    )
    expect(classifyPostSession(state, benchOnly)).toEqual([
      {
        case: 'A',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 100,
        highest: 110,
        ending: 110,
        stayOption: 100,
        rollUpOption: 105,
      },
    ])
  })

  it('F3 Case B: Bench Press at 100/100/95/95 → informational, new SW = 95', () => {
    // Hand-constructed state: 4 logs for a 3-set routine (not producible via applyAction;
    // demonstrates the classification operates over arbitrary log arrays).
    const benchOnly: Routine = {
      exercises: [
        {
          name: 'Bench Press',
          type: 'weighted',
          sets: 3,
          targetReps: 10,
          startingWeight: 100,
          increment: 5,
        },
      ],
    }
    const state: SessionState = {
      setLogs: [
        {
          exerciseIdx: 0,
          setIdx: 0,
          weight: 100,
          reps: 10,
          actualReps: 10,
          action: { type: 'Stay' },
        },
        {
          exerciseIdx: 0,
          setIdx: 1,
          weight: 100,
          reps: 10,
          actualReps: 10,
          action: { type: 'Stay' },
        },
        {
          exerciseIdx: 0,
          setIdx: 2,
          weight: 95,
          reps: 10,
          actualReps: 10,
          action: { type: 'Stay' },
        },
        {
          exerciseIdx: 0,
          setIdx: 3,
          weight: 95,
          reps: 10,
          actualReps: 10,
          action: { type: 'Stay' },
        },
      ],
    }
    expect(classifyPostSession(state, benchOnly)).toEqual([
      {
        case: 'B',
        exerciseIdx: 0,
        originalStartingWeight: 100,
        lowest: 95,
        highest: 100,
        ending: 95,
        newStartingWeight: 95,
      },
    ])
  })
})
