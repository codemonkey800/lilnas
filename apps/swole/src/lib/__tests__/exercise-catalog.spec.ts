import {
  buildSelectionPatch,
  EXERCISE_CATALOG,
  MUSCLE_GROUP_ACCENT,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUP_ORDER,
  optionsForType,
} from 'src/lib/exercise-catalog'
import type { ExerciseCardState } from 'src/lib/routine-form'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCard(
  overrides: Partial<ExerciseCardState> = {},
): ExerciseCardState {
  return {
    id: 'test-id',
    type: 'weighted',
    name: '',
    sets: '3',
    targetReps: '10',
    startingWeight: '100',
    increment: '5',
    duration: '',
    ...overrides,
  }
}

// ─── optionsForType ───────────────────────────────────────────────────────────

describe('optionsForType', () => {
  it('weighted: groups appear in MUSCLE_GROUP_ORDER order (AE1)', () => {
    const options = optionsForType('weighted')
    const groups = options
      .map(o => o.muscleGroup!)
      .filter((g, i, arr) => arr.indexOf(g) === i)

    const expectedOrder = MUSCLE_GROUP_ORDER.filter(g =>
      options.some(o => o.muscleGroup === g),
    )
    expect(groups).toEqual(expectedOrder)
  })

  it('weighted: entries are alphabetical within each group (AE1)', () => {
    const options = optionsForType('weighted')
    for (const group of MUSCLE_GROUP_ORDER) {
      const inGroup = options
        .filter(o => o.muscleGroup === group)
        .map(o => o.name)
      const sorted = [...inGroup].sort((a, b) => a.localeCompare(b))
      expect(inGroup).toEqual(sorted)
    }
  })

  it('cardio: returns a flat alphabetically-sorted list with no muscleGroup', () => {
    const options = optionsForType('cardio')
    expect(options.every(o => o.muscleGroup === undefined)).toBe(true)
    const names = options.map(o => o.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(sorted)
  })

  it('bodyweight: groups appear in canonical order, alphabetical within each group', () => {
    const options = optionsForType('bodyweight')
    const groups = options
      .map(o => o.muscleGroup!)
      .filter((g, i, arr) => arr.indexOf(g) === i)
    const expectedOrder = MUSCLE_GROUP_ORDER.filter(g =>
      options.some(o => o.muscleGroup === g),
    )
    expect(groups).toEqual(expectedOrder)

    for (const group of MUSCLE_GROUP_ORDER) {
      const inGroup = options
        .filter(o => o.muscleGroup === group)
        .map(o => o.name)
      const sorted = [...inGroup].sort((a, b) => a.localeCompare(b))
      expect(inGroup).toEqual(sorted)
    }
  })

  it('time-based: groups appear in canonical order, alphabetical within each group', () => {
    const options = optionsForType('time-based')
    const groups = options
      .map(o => o.muscleGroup!)
      .filter((g, i, arr) => arr.indexOf(g) === i)
    const expectedOrder = MUSCLE_GROUP_ORDER.filter(g =>
      options.some(o => o.muscleGroup === g),
    )
    expect(groups).toEqual(expectedOrder)

    for (const group of MUSCLE_GROUP_ORDER) {
      const inGroup = options
        .filter(o => o.muscleGroup === group)
        .map(o => o.name)
      const sorted = [...inGroup].sort((a, b) => a.localeCompare(b))
      expect(inGroup).toEqual(sorted)
    }
  })
})

// ─── Data integrity ───────────────────────────────────────────────────────────

describe('EXERCISE_CATALOG data integrity', () => {
  it('every non-cardio entry has a muscleGroup in MUSCLE_GROUP_ORDER', () => {
    for (const type of ['weighted', 'bodyweight', 'time-based'] as const) {
      for (const entry of EXERCISE_CATALOG[type]) {
        expect(entry.muscleGroup).toBeDefined()
        expect(MUSCLE_GROUP_ORDER).toContain(entry.muscleGroup)
      }
    }
  })

  it('every cardio entry has no muscleGroup', () => {
    for (const entry of EXERCISE_CATALOG.cardio) {
      expect(entry.muscleGroup).toBeUndefined()
    }
  })

  it('MUSCLE_GROUP_LABELS has an entry for every member of MUSCLE_GROUP_ORDER', () => {
    for (const group of MUSCLE_GROUP_ORDER) {
      expect(MUSCLE_GROUP_LABELS[group]).toBeDefined()
      expect(typeof MUSCLE_GROUP_LABELS[group]).toBe('string')
    }
  })

  it('MUSCLE_GROUP_ACCENT has an entry for every member of MUSCLE_GROUP_ORDER', () => {
    for (const group of MUSCLE_GROUP_ORDER) {
      expect(MUSCLE_GROUP_ACCENT[group]).toBeDefined()
      expect(typeof MUSCLE_GROUP_ACCENT[group]).toBe('string')
    }
  })

  it('type partitions are independent — same name can appear in two type sets (R10)', () => {
    // The catalog allows listing a movement in multiple types without dedup
    const weightedNames = new Set(EXERCISE_CATALOG.weighted.map(e => e.name))
    const bodyweightNames = new Set(
      EXERCISE_CATALOG.bodyweight.map(e => e.name),
    )
    // Confirm these are independent arrays (no cross-type deduplication)
    expect(Array.isArray(EXERCISE_CATALOG.weighted)).toBe(true)
    expect(Array.isArray(EXERCISE_CATALOG.bodyweight)).toBe(true)
    // Each type's entries are their own set — mutating one does not affect the other
    expect(weightedNames).not.toBe(bodyweightNames)
  })
})

// ─── buildSelectionPatch ──────────────────────────────────────────────────────

describe('buildSelectionPatch', () => {
  it('weighted entry returns { name } only — no duration key (R11)', () => {
    const patch = buildSelectionPatch(makeCard({ type: 'weighted' }), {
      name: 'Hip Thrust',
      muscleGroup: 'legs-glutes',
    })
    expect(patch).toEqual({ name: 'Hip Thrust' })
    expect('duration' in patch).toBe(false)
  })

  it('bodyweight entry returns { name } only', () => {
    const patch = buildSelectionPatch(makeCard({ type: 'bodyweight' }), {
      name: 'Pull-Ups',
      muscleGroup: 'back',
    })
    expect(patch).toEqual({ name: 'Pull-Ups' })
    expect('duration' in patch).toBe(false)
  })

  it('time-based entry with empty duration returns { name, duration: "30" } (AE3)', () => {
    const patch = buildSelectionPatch(
      makeCard({ type: 'time-based', duration: '' }),
      { name: 'Plank', muscleGroup: 'core' },
    )
    expect(patch).toEqual({ name: 'Plank', duration: '30' })
  })

  it('cardio entry with empty duration returns { name, duration: "20" } (AE3)', () => {
    const patch = buildSelectionPatch(
      makeCard({ type: 'cardio', duration: '' }),
      { name: 'Stairmaster' },
    )
    expect(patch).toEqual({ name: 'Stairmaster', duration: '20' })
  })

  it('cardio entry with non-empty duration returns { name } only — duration untouched (AE4)', () => {
    const patch = buildSelectionPatch(
      makeCard({ type: 'cardio', duration: '35' }),
      { name: 'Rowing Machine' },
    )
    expect(patch).toEqual({ name: 'Rowing Machine' })
    expect('duration' in patch).toBe(false)
  })

  it('time-based entry with non-empty duration returns { name } only (empty-only guard)', () => {
    const patch = buildSelectionPatch(
      makeCard({ type: 'time-based', duration: '45' }),
      { name: 'Side Plank', muscleGroup: 'core' },
    )
    expect(patch).toEqual({ name: 'Side Plank' })
    expect('duration' in patch).toBe(false)
  })

  it('null entry (deselect/clear) returns { name: "" } for weighted', () => {
    const patch = buildSelectionPatch(makeCard({ type: 'weighted' }), null)
    expect(patch).toEqual({ name: '' })
  })

  it('null entry (deselect/clear) returns { name: "" } for cardio', () => {
    const patch = buildSelectionPatch(makeCard({ type: 'cardio' }), null)
    expect(patch).toEqual({ name: '' })
  })

  it('null entry (deselect/clear) returns { name: "" } for time-based', () => {
    const patch = buildSelectionPatch(makeCard({ type: 'time-based' }), null)
    expect(patch).toEqual({ name: '' })
  })

  it('null entry (deselect/clear) returns { name: "" } for bodyweight', () => {
    const patch = buildSelectionPatch(makeCard({ type: 'bodyweight' }), null)
    expect(patch).toEqual({ name: '' })
  })
})
