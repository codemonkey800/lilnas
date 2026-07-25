import {
  isAnimState,
  isPeerLeavePayload,
  isPeerPresencePayload,
  isPeerSnapshot,
  isPeerTabletPayload,
  isPositionTuple,
  isTabletState,
  type TabletState,
} from 'src/multiplayer/store'

// Pure validation-predicate tests only (per this app's no-browser-
// verification convention) — the socket lifecycle itself (connect/disconnect,
// StrictMode-safe deferred teardown) needs a real/mocked `socket.io-client`
// connection to exercise meaningfully, which isn't worth the mocking cost for
// this unit; see store.ts's own comments for that behavior's rationale.

const VALID_TABLET: TabletState = {
  open: true,
  view: 'grid',
  seriesId: null,
  seasonId: null,
  search: '',
  typeFilter: 'all',
  scrollTop: 0,
}

describe('isPositionTuple', () => {
  it('accepts a tuple of three finite numbers', () => {
    expect(isPositionTuple([1, -2.5, 0])).toBe(true)
  })

  it('rejects the wrong length', () => {
    expect(isPositionTuple([1, 2])).toBe(false)
    expect(isPositionTuple([1, 2, 3, 4])).toBe(false)
    expect(isPositionTuple([])).toBe(false)
  })

  it('rejects NaN/Infinity components', () => {
    expect(isPositionTuple([1, NaN, 3])).toBe(false)
    expect(isPositionTuple([1, Infinity, 3])).toBe(false)
    expect(isPositionTuple([1, -Infinity, 3])).toBe(false)
  })

  it('rejects non-number components', () => {
    expect(isPositionTuple([1, '2', 3])).toBe(false)
    expect(isPositionTuple([1, null, 3])).toBe(false)
  })

  it('rejects non-array values', () => {
    expect(isPositionTuple('not an array')).toBe(false)
    expect(isPositionTuple(null)).toBe(false)
    expect(isPositionTuple(undefined)).toBe(false)
    expect(isPositionTuple({ 0: 1, 1: 2, 2: 3, length: 3 })).toBe(false)
  })
})

describe('isAnimState', () => {
  it('accepts every one of the 5 wire states', () => {
    expect(isAnimState('idle')).toBe(true)
    expect(isAnimState('walk_fwd')).toBe(true)
    expect(isAnimState('walk_back')).toBe(true)
    expect(isAnimState('strafe_left')).toBe(true)
    expect(isAnimState('strafe_right')).toBe(true)
  })

  it('rejects strings from an earlier/later draft of the contract', () => {
    expect(isAnimState('walking')).toBe(false) // old 2-state draft
    expect(isAnimState('sitting')).toBe(false) // Phase 5, not this contract
  })

  it('rejects non-strings', () => {
    expect(isAnimState(123)).toBe(false)
    expect(isAnimState(null)).toBe(false)
    expect(isAnimState(undefined)).toBe(false)
  })
})

describe('isTabletState', () => {
  it('accepts a well-formed TabletState', () => {
    expect(isTabletState(VALID_TABLET)).toBe(true)
    expect(
      isTabletState({
        ...VALID_TABLET,
        view: 'episodes',
        seriesId: 'series-1',
        seasonId: 'season-1',
        search: 'kanna',
        typeFilter: 'series',
        scrollTop: 240,
      }),
    ).toBe(true)
  })

  it('rejects a non-boolean open', () => {
    expect(isTabletState({ ...VALID_TABLET, open: 'yes' })).toBe(false)
  })

  it('rejects an invalid view/typeFilter enum value', () => {
    expect(isTabletState({ ...VALID_TABLET, view: 'movies' })).toBe(false)
    expect(isTabletState({ ...VALID_TABLET, typeFilter: 'anime' })).toBe(false)
  })

  it('rejects a non-string, non-null seriesId/seasonId', () => {
    expect(isTabletState({ ...VALID_TABLET, seriesId: 42 })).toBe(false)
    expect(isTabletState({ ...VALID_TABLET, seasonId: 42 })).toBe(false)
  })

  it('rejects a negative or non-finite scrollTop', () => {
    expect(isTabletState({ ...VALID_TABLET, scrollTop: -1 })).toBe(false)
    expect(isTabletState({ ...VALID_TABLET, scrollTop: NaN })).toBe(false)
    expect(isTabletState({ ...VALID_TABLET, scrollTop: Infinity })).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isTabletState(null)).toBe(false)
    expect(isTabletState('tablet')).toBe(false)
  })
})

describe('isPeerSnapshot', () => {
  const VALID_SNAPSHOT = {
    id: 'abc123',
    username: 'jeremy',
    characterId: 'kanna',
    p: [1, 0, 2] as [number, number, number],
    y: 0.5,
    a: 'idle' as const,
  }

  it('accepts a minimal well-formed snapshot', () => {
    expect(isPeerSnapshot(VALID_SNAPSHOT)).toBe(true)
  })

  it('accepts optional muted/tablet fields when well-formed', () => {
    expect(
      isPeerSnapshot({
        ...VALID_SNAPSHOT,
        muted: true,
        tablet: VALID_TABLET,
      }),
    ).toBe(true)
  })

  it('rejects a missing/empty id', () => {
    const missingId: Record<string, unknown> = { ...VALID_SNAPSHOT }
    delete missingId.id
    expect(isPeerSnapshot(missingId)).toBe(false)
    expect(isPeerSnapshot({ ...VALID_SNAPSHOT, id: '' })).toBe(false)
  })

  it('rejects an invalid animState', () => {
    expect(isPeerSnapshot({ ...VALID_SNAPSHOT, a: 'flying' })).toBe(false)
  })

  it('rejects a malformed position', () => {
    expect(isPeerSnapshot({ ...VALID_SNAPSHOT, p: [1, NaN, 2] })).toBe(false)
  })

  it('rejects a non-boolean muted', () => {
    expect(isPeerSnapshot({ ...VALID_SNAPSHOT, muted: 'yes' })).toBe(false)
  })

  it('rejects a malformed nested tablet', () => {
    expect(
      isPeerSnapshot({
        ...VALID_SNAPSHOT,
        tablet: { ...VALID_TABLET, scrollTop: -5 },
      }),
    ).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isPeerSnapshot(null)).toBe(false)
    expect(isPeerSnapshot('peer')).toBe(false)
  })
})

describe('isPeerLeavePayload', () => {
  it('accepts { id: string }', () => {
    expect(isPeerLeavePayload({ id: 'abc123' })).toBe(true)
  })

  it('rejects an empty/missing id', () => {
    expect(isPeerLeavePayload({ id: '' })).toBe(false)
    expect(isPeerLeavePayload({})).toBe(false)
  })

  it('rejects non-objects', () => {
    expect(isPeerLeavePayload(null)).toBe(false)
    expect(isPeerLeavePayload('abc123')).toBe(false)
  })
})

describe('isPeerPresencePayload', () => {
  const VALID_PRESENCE = {
    id: 'abc123',
    p: [1, 0, 2] as [number, number, number],
    y: 0.5,
    a: 'walk_fwd' as const,
  }

  it('accepts a well-formed presence update', () => {
    expect(isPeerPresencePayload(VALID_PRESENCE)).toBe(true)
  })

  it('rejects a malformed position', () => {
    expect(
      isPeerPresencePayload({ ...VALID_PRESENCE, p: [1, Infinity, 2] }),
    ).toBe(false)
  })

  it('rejects a non-finite yaw', () => {
    expect(isPeerPresencePayload({ ...VALID_PRESENCE, y: NaN })).toBe(false)
  })

  it('rejects an unknown animState', () => {
    expect(isPeerPresencePayload({ ...VALID_PRESENCE, a: 'running' })).toBe(
      false,
    )
  })

  it('rejects a missing id', () => {
    const missingId: Record<string, unknown> = { ...VALID_PRESENCE }
    delete missingId.id
    expect(isPeerPresencePayload(missingId)).toBe(false)
  })
})

describe('isPeerTabletPayload', () => {
  it('accepts { id } & TabletState', () => {
    expect(isPeerTabletPayload({ id: 'abc123', ...VALID_TABLET })).toBe(true)
  })

  it('rejects a missing id', () => {
    expect(isPeerTabletPayload({ ...VALID_TABLET })).toBe(false)
  })

  it('rejects a malformed TabletState', () => {
    expect(
      isPeerTabletPayload({ id: 'abc123', ...VALID_TABLET, view: 'bad' }),
    ).toBe(false)
  })
})
