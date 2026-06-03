import {
  buildFormSnapshot,
  isFormDirty,
} from 'src/hooks/use-unsaved-changes-guard'
import type { ExerciseCardState } from 'src/lib/routine-form'

const baseCard: ExerciseCardState = {
  id: 'card-1',
  dbId: 7,
  type: 'weighted',
  name: 'Bench Press',
  sets: '3',
  targetReps: '10',
  startingWeight: '100',
  increment: '5',
  duration: '',
}

function makeSnapshot(overrides: Partial<typeof baseCard> = {}) {
  return buildFormSnapshot(
    'Push Day',
    ['mon', 'wed'],
    [{ ...baseCard, ...overrides }],
  )
}

describe('isFormDirty', () => {
  it('returns false for an identical form state', () => {
    const snap = makeSnapshot()
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon', 'wed'],
        cards: [{ ...baseCard }],
      }),
    ).toBe(false)
  })

  it('returns true when name changes', () => {
    const snap = makeSnapshot()
    expect(
      isFormDirty(snap, {
        name: 'Different Name',
        days: ['mon', 'wed'],
        cards: [{ ...baseCard }],
      }),
    ).toBe(true)
  })

  it('ignores leading/trailing whitespace in name comparison', () => {
    const snap = buildFormSnapshot('  Push Day  ', ['mon'], [{ ...baseCard }])
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon'],
        cards: [{ ...baseCard }],
      }),
    ).toBe(false)
  })

  it('returns true when a day is added', () => {
    const snap = makeSnapshot()
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon', 'wed', 'fri'],
        cards: [{ ...baseCard }],
      }),
    ).toBe(true)
  })

  it('returns true when a day is removed', () => {
    const snap = makeSnapshot()
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon'],
        cards: [{ ...baseCard }],
      }),
    ).toBe(true)
  })

  it('returns true when a card field changes', () => {
    const snap = makeSnapshot()
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon', 'wed'],
        cards: [{ ...baseCard, sets: '4' }],
      }),
    ).toBe(true)
  })

  it('returns true when card name changes', () => {
    const snap = makeSnapshot()
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon', 'wed'],
        cards: [{ ...baseCard, name: 'Squat' }],
      }),
    ).toBe(true)
  })

  it('returns true when a card is added', () => {
    const snap = makeSnapshot()
    const extra: ExerciseCardState = {
      ...baseCard,
      id: 'card-2',
      dbId: undefined,
      name: 'Pushups',
    }
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon', 'wed'],
        cards: [{ ...baseCard }, extra],
      }),
    ).toBe(true)
  })

  it('returns true when a card is removed', () => {
    const extra: ExerciseCardState = {
      ...baseCard,
      id: 'card-2',
      dbId: 8,
      name: 'Pushups',
    }
    const snap = buildFormSnapshot(
      'Push Day',
      ['mon'],
      [{ ...baseCard }, extra],
    )
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon'],
        cards: [{ ...baseCard }],
      }),
    ).toBe(true)
  })

  it('returns true when cards are reordered (same set, different order)', () => {
    const cardA: ExerciseCardState = {
      ...baseCard,
      id: 'card-a',
      dbId: 7,
      name: 'Bench',
    }
    const cardB: ExerciseCardState = {
      ...baseCard,
      id: 'card-b',
      dbId: 8,
      name: 'Pushups',
      type: 'bodyweight',
      startingWeight: '',
      increment: '',
    }
    const snap = buildFormSnapshot('Push Day', ['mon'], [cardA, cardB])
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon'],
        cards: [cardB, cardA],
      }),
    ).toBe(true)
  })

  it('returns true when dbId differs (identity change)', () => {
    const snap = makeSnapshot()
    expect(
      isFormDirty(snap, {
        name: 'Push Day',
        days: ['mon', 'wed'],
        cards: [{ ...baseCard, dbId: 99 }],
      }),
    ).toBe(true)
  })

  it('days canonicalization: same days in different order → not dirty', () => {
    const snap = buildFormSnapshot('Push', ['fri', 'mon'], [{ ...baseCard }])
    expect(
      isFormDirty(snap, {
        name: 'Push',
        days: ['mon', 'fri'],
        cards: [{ ...baseCard }],
      }),
    ).toBe(false)
  })
})
