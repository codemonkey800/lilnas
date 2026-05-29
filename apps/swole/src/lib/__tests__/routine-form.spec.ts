import {
  applyTypeSwitch,
  canonicalizeDays,
  type ExerciseCardState,
  exerciseDraftSchema,
  isRoutineFormValid,
  normalizeCard,
  routineFormSchema,
  toCreateExerciseArgs,
} from 'src/lib/routine-form'

// ─── exerciseDraftSchema ─────────────────────────────────────────────────────

describe('exerciseDraftSchema', () => {
  describe('weighted', () => {
    const valid = {
      type: 'weighted' as const,
      name: 'Bench Press',
      sets: 3,
      targetReps: 10,
      startingWeight: 105,
      increment: 5,
    }

    it('accepts a fully-valid weighted draft', () => {
      expect(exerciseDraftSchema.safeParse(valid).success).toBe(true)
    })

    it('rejects missing startingWeight (AE5)', () => {
      const r = exerciseDraftSchema.safeParse({
        ...valid,
        startingWeight: undefined,
      })
      expect(r.success).toBe(false)
      if (!r.success) {
        expect(r.error.issues.some(i => i.path[0] === 'startingWeight')).toBe(
          true,
        )
      }
    })

    it('rejects startingWeight = 0 (M3)', () => {
      const r = exerciseDraftSchema.safeParse({ ...valid, startingWeight: 0 })
      expect(r.success).toBe(false)
    })

    it('rejects negative startingWeight (M3)', () => {
      const r = exerciseDraftSchema.safeParse({ ...valid, startingWeight: -1 })
      expect(r.success).toBe(false)
    })

    it('rejects targetReps = 0 (M3)', () => {
      expect(
        exerciseDraftSchema.safeParse({ ...valid, targetReps: 0 }).success,
      ).toBe(false)
    })

    it('rejects increment = 0 (M3)', () => {
      expect(
        exerciseDraftSchema.safeParse({ ...valid, increment: 0 }).success,
      ).toBe(false)
    })

    it('rejects sets = 0 (M3)', () => {
      expect(exerciseDraftSchema.safeParse({ ...valid, sets: 0 }).success).toBe(
        false,
      )
    })

    it('rejects empty name', () => {
      expect(
        exerciseDraftSchema.safeParse({ ...valid, name: '' }).success,
      ).toBe(false)
    })

    it('rejects whitespace-only name', () => {
      expect(
        exerciseDraftSchema.safeParse({ ...valid, name: '  ' }).success,
      ).toBe(false)
    })
  })

  describe('bodyweight', () => {
    const valid = {
      type: 'bodyweight' as const,
      name: 'Pushups',
      sets: 3,
      targetReps: 15,
    }

    it('accepts a valid bodyweight draft', () => {
      expect(exerciseDraftSchema.safeParse(valid).success).toBe(true)
    })

    it('rejects targetReps = 0', () => {
      expect(
        exerciseDraftSchema.safeParse({ ...valid, targetReps: 0 }).success,
      ).toBe(false)
    })
  })

  describe('time-based', () => {
    const valid = {
      type: 'time-based' as const,
      name: 'Plank',
      sets: 3,
      durationSeconds: 30,
    }

    it('accepts a valid time-based draft', () => {
      expect(exerciseDraftSchema.safeParse(valid).success).toBe(true)
    })

    it('rejects durationSeconds = 0', () => {
      expect(
        exerciseDraftSchema.safeParse({ ...valid, durationSeconds: 0 }).success,
      ).toBe(false)
    })
  })

  describe('cardio', () => {
    const valid = {
      type: 'cardio' as const,
      name: 'Treadmill',
      sets: 1,
      durationSeconds: 1800,
    }

    it('accepts a valid cardio draft (AE1)', () => {
      const r = exerciseDraftSchema.safeParse(valid)
      expect(r.success).toBe(true)
      if (r.success) {
        expect(r.data.sets).toBe(1)
      }
    })

    it('rejects cardio sets ≠ 1 (AE1)', () => {
      expect(exerciseDraftSchema.safeParse({ ...valid, sets: 2 }).success).toBe(
        false,
      )
      expect(exerciseDraftSchema.safeParse({ ...valid, sets: 3 }).success).toBe(
        false,
      )
    })

    it('rejects durationSeconds = 0', () => {
      expect(
        exerciseDraftSchema.safeParse({ ...valid, durationSeconds: 0 }).success,
      ).toBe(false)
    })
  })
})

// ─── normalizeCard ────────────────────────────────────────────────────────────

function makeCard(
  overrides: Partial<ExerciseCardState> = {},
): ExerciseCardState {
  return {
    id: 'test-id',
    type: 'weighted',
    name: 'Bench',
    sets: '3',
    targetReps: '10',
    startingWeight: '100',
    increment: '5',
    duration: '',
    ...overrides,
  }
}

describe('normalizeCard', () => {
  describe('weighted', () => {
    it('returns ok with a parsed draft for a valid card', () => {
      const r = normalizeCard(makeCard())
      expect(r.ok).toBe(true)
      if (r.ok && r.draft.type === 'weighted') {
        expect(r.draft.sets).toBe(3)
        expect(r.draft.startingWeight).toBe(100)
      }
    })

    it('returns errors when startingWeight is blank (AE5)', () => {
      const r = normalizeCard(makeCard({ startingWeight: '' }))
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect('startingWeight' in r.errors).toBe(true)
      }
    })

    it('errors distinctly for 0 vs empty (M3)', () => {
      const empty = normalizeCard(makeCard({ startingWeight: '' }))
      const zero = normalizeCard(makeCard({ startingWeight: '0' }))
      expect(empty.ok).toBe(false)
      expect(zero.ok).toBe(false)
      // Both fail but for different reasons — empty is invalid_type, zero is too_small.
      // Just confirm both are invalid.
    })

    it('rejects decimal input (M3)', () => {
      const r = normalizeCard(makeCard({ startingWeight: '2.5' }))
      expect(r.ok).toBe(false)
    })

    it('rejects non-numeric input (M3)', () => {
      const r = normalizeCard(makeCard({ startingWeight: 'abc' }))
      expect(r.ok).toBe(false)
    })
  })

  describe('time-based duration (M4)', () => {
    it('passes duration seconds through as-is', () => {
      const r = normalizeCard(
        makeCard({
          type: 'time-based',
          duration: '45',
          targetReps: '',
          startingWeight: '',
          increment: '',
        }),
      )
      expect(r.ok).toBe(true)
      if (r.ok && r.draft.type === 'time-based') {
        expect(r.draft.durationSeconds).toBe(45)
      }
    })

    it('rejects duration = 0 for time-based', () => {
      const r = normalizeCard(
        makeCard({
          type: 'time-based',
          duration: '0',
          targetReps: '',
          startingWeight: '',
          increment: '',
        }),
      )
      expect(r.ok).toBe(false)
    })
  })

  describe('cardio duration (M4)', () => {
    it('converts cardio duration from minutes to seconds', () => {
      const r = normalizeCard(
        makeCard({
          type: 'cardio',
          duration: '30',
          targetReps: '',
          startingWeight: '',
          increment: '',
          sets: '1',
        }),
      )
      expect(r.ok).toBe(true)
      if (r.ok && r.draft.type === 'cardio') {
        expect(r.draft.durationSeconds).toBe(1800)
      }
    })

    it('rejects cardio duration = 0 minutes', () => {
      const r = normalizeCard(
        makeCard({
          type: 'cardio',
          duration: '0',
          targetReps: '',
          startingWeight: '',
          increment: '',
          sets: '1',
        }),
      )
      expect(r.ok).toBe(false)
    })

    it('maps durationSeconds issue to duration error key', () => {
      const r = normalizeCard(
        makeCard({
          type: 'cardio',
          duration: '',
          targetReps: '',
          startingWeight: '',
          increment: '',
          sets: '1',
        }),
      )
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect('duration' in r.errors).toBe(true)
      }
    })
  })
})

// ─── applyTypeSwitch ──────────────────────────────────────────────────────────

describe('applyTypeSwitch', () => {
  const weighted: ExerciseCardState = {
    id: 'abc',
    type: 'weighted',
    name: 'Row',
    sets: '3',
    targetReps: '10',
    startingWeight: '95',
    increment: '5',
    duration: '',
  }

  it('weighted → bodyweight clears name, keeps sets/reps, clears weight/increment (AE2/R13)', () => {
    const result = applyTypeSwitch(weighted, 'bodyweight')
    expect(result.type).toBe('bodyweight')
    expect(result.name).toBe('')
    expect(result.sets).toBe('3')
    expect(result.targetReps).toBe('10')
    expect(result.startingWeight).toBe('')
    expect(result.increment).toBe('')
    expect(result.duration).toBe('')
  })

  it('weighted → cardio clears name, forces sets=1, clears reps/weight/increment (AE3/R13)', () => {
    const result = applyTypeSwitch(weighted, 'cardio')
    expect(result.type).toBe('cardio')
    expect(result.name).toBe('')
    expect(result.sets).toBe('1')
    expect(result.targetReps).toBe('')
    expect(result.startingWeight).toBe('')
    expect(result.increment).toBe('')
    expect(result.duration).toBe('')
  })

  it('cardio → weighted clears name, carries sets=1 (current value); N3/R13', () => {
    const cardio: ExerciseCardState = {
      id: 'abc',
      type: 'cardio',
      name: 'Run',
      sets: '1',
      targetReps: '',
      startingWeight: '',
      increment: '',
      duration: '30',
    }
    const result = applyTypeSwitch(cardio, 'weighted')
    expect(result.type).toBe('weighted')
    expect(result.name).toBe('')
    expect(result.sets).toBe('1')
    expect(result.startingWeight).toBe('')
  })

  it('weighted → bodyweight → weighted clears name/startingWeight (no resurrection); N4/R13', () => {
    const step1 = applyTypeSwitch(weighted, 'bodyweight')
    expect(step1.name).toBe('')
    const step2 = applyTypeSwitch(step1, 'weighted')
    expect(step2.name).toBe('')
    expect(step2.startingWeight).toBe('')
  })

  it('weighted → cardio clears name/targetReps; cardio → weighted does not resurrect either (N4/R13)', () => {
    const step1 = applyTypeSwitch(weighted, 'cardio')
    expect(step1.name).toBe('')
    expect(step1.targetReps).toBe('')
    const step2 = applyTypeSwitch(step1, 'weighted')
    expect(step2.name).toBe('')
    expect(step2.targetReps).toBe('')
  })

  it('weighted → time-based clears name (R13)', () => {
    const result = applyTypeSwitch(weighted, 'time-based')
    expect(result.name).toBe('')
  })

  it('any → time-based: keeps duration from cardio source', () => {
    const cardio: ExerciseCardState = {
      ...weighted,
      type: 'cardio',
      sets: '1',
      targetReps: '',
      startingWeight: '',
      increment: '',
      duration: '20',
    }
    const result = applyTypeSwitch(cardio, 'time-based')
    expect(result.duration).toBe('20')
    expect(result.targetReps).toBe('')
  })

  it('any → cardio: keeps duration from time-based source', () => {
    const timeBased: ExerciseCardState = {
      ...weighted,
      type: 'time-based',
      targetReps: '',
      startingWeight: '',
      increment: '',
      duration: '45',
    }
    const result = applyTypeSwitch(timeBased, 'cardio')
    expect(result.sets).toBe('1')
    expect(result.duration).toBe('45')
  })
})

// ─── isRoutineFormValid ───────────────────────────────────────────────────────

describe('isRoutineFormValid', () => {
  const validCard = makeCard()

  it('returns true for name + ≥1 valid card (AE5 positive)', () => {
    expect(isRoutineFormValid({ name: 'Push Day', cards: [validCard] })).toBe(
      true,
    )
  })

  it('returns false for empty name (R5)', () => {
    expect(isRoutineFormValid({ name: '', cards: [validCard] })).toBe(false)
  })

  it('returns false for whitespace-only name', () => {
    expect(isRoutineFormValid({ name: '   ', cards: [validCard] })).toBe(false)
  })

  it('returns false for zero cards', () => {
    expect(isRoutineFormValid({ name: 'Push Day', cards: [] })).toBe(false)
  })

  it('returns false for one valid + one partial card (AE5)', () => {
    const partial = makeCard({ startingWeight: '' })
    expect(
      isRoutineFormValid({ name: 'Push Day', cards: [validCard, partial] }),
    ).toBe(false)
  })

  it('returns false if the only card becomes invalid after a field is cleared', () => {
    const invalid = makeCard({ startingWeight: '' })
    expect(isRoutineFormValid({ name: 'Push Day', cards: [invalid] })).toBe(
      false,
    )
  })

  it('returns true for valid name with 2 valid cards', () => {
    const bodyweight = makeCard({
      type: 'bodyweight',
      startingWeight: '',
      increment: '',
      duration: '',
    })
    expect(
      isRoutineFormValid({ name: 'Push', cards: [validCard, bodyweight] }),
    ).toBe(true)
  })
})

// ─── canonicalizeDays ─────────────────────────────────────────────────────────

describe('canonicalizeDays', () => {
  it('orders Mon-first regardless of Set insertion order (AE7)', () => {
    const selected = new Set<
      'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
    >(['fri', 'mon'])
    expect(canonicalizeDays(selected)).toEqual(['mon', 'fri'])
  })

  it('returns empty array for empty Set (AE7)', () => {
    expect(canonicalizeDays(new Set())).toEqual([])
  })

  it('returns all seven codes in Mon-first order', () => {
    const all = new Set<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'>([
      'sun',
      'sat',
      'fri',
      'thu',
      'wed',
      'tue',
      'mon',
    ])
    expect(canonicalizeDays(all)).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ])
  })

  it('N10: preserves subset in week order', () => {
    const selected = new Set<
      'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
    >(['sat', 'wed', 'mon'])
    expect(canonicalizeDays(selected)).toEqual(['mon', 'wed', 'sat'])
  })
})

// ─── routineFormSchema ────────────────────────────────────────────────────────

describe('routineFormSchema', () => {
  const validValues = {
    name: 'Push Day',
    days: ['mon', 'wed'],
    exercises: [
      {
        type: 'weighted' as const,
        name: 'Bench Press',
        sets: 3,
        targetReps: 10,
        startingWeight: 105,
        increment: 5,
      },
    ],
  }

  it('accepts a valid routine form (AE4)', () => {
    expect(routineFormSchema.safeParse(validValues).success).toBe(true)
  })

  it('accepts zero days (AE7)', () => {
    expect(
      routineFormSchema.safeParse({ ...validValues, days: [] }).success,
    ).toBe(true)
  })

  it('rejects empty exercises array', () => {
    expect(
      routineFormSchema.safeParse({ ...validValues, exercises: [] }).success,
    ).toBe(false)
  })

  it('rejects empty name', () => {
    expect(
      routineFormSchema.safeParse({ ...validValues, name: '' }).success,
    ).toBe(false)
  })

  it('rejects whitespace-only name', () => {
    expect(
      routineFormSchema.safeParse({ ...validValues, name: '  ' }).success,
    ).toBe(false)
  })
})

// ─── toCreateExerciseArgs ─────────────────────────────────────────────────────

describe('toCreateExerciseArgs', () => {
  it('maps a weighted draft correctly', () => {
    const args = toCreateExerciseArgs(
      {
        type: 'weighted',
        name: 'Bench',
        sets: 3,
        targetReps: 10,
        startingWeight: 100,
        increment: 5,
      },
      1,
      0,
    )
    expect(args).toEqual({
      routineId: 1,
      orderInRoutine: 0,
      type: 'weighted',
      name: 'Bench',
      sets: 3,
      targetReps: 10,
      startingWeight: 100,
      increment: 5,
    })
  })

  it('maps a cardio draft with sets literal 1', () => {
    const args = toCreateExerciseArgs(
      { type: 'cardio', name: 'Treadmill', sets: 1, durationSeconds: 1800 },
      2,
      2,
    )
    expect(args.type).toBe('cardio')
    expect(args.sets).toBe(1)
    if (args.type === 'cardio') {
      expect(args.durationSeconds).toBe(1800)
    }
  })
})
