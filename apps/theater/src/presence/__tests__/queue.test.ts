import {
  applyEnqueue,
  applyMove,
  applyNext,
  applyRemove,
  type QueueEntry,
  type QueueState,
} from 'src/presence/queue'

// Small fixture factory so each test only spells out the field it actually
// cares about — mirrors presence.gateway.test.ts's DEFAULT_SNAPSHOT_*
// pattern one directory up.
function makeEntry(
  entryId: string,
  overrides: Partial<QueueEntry> = {},
): QueueEntry {
  return {
    entryId,
    itemId: overrides.itemId ?? `item-${entryId}`,
    title: overrides.title ?? `Title ${entryId}`,
    subtitle: overrides.subtitle ?? null,
    imageTag: overrides.imageTag ?? null,
    runTimeTicks: overrides.runTimeTicks ?? null,
    addedBy: overrides.addedBy ?? 'alice',
  }
}

const EMPTY_STATE: QueueState = { queue: [], currentEntryId: null }

describe('applyEnqueue', () => {
  it('sets the cursor to the new entry when the room was empty (nothing current)', () => {
    const a = makeEntry('a')

    const result = applyEnqueue(EMPTY_STATE, a)

    expect(result.queue).toEqual([a])
    expect(result.currentEntryId).toBe('a')
  })

  it('only appends when the queue already has a current entry', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a], currentEntryId: 'a' }

    const result = applyEnqueue(state, b)

    expect(result.queue).toEqual([a, b])
    expect(result.currentEntryId).toBe('a')
  })

  // The precise condition is `currentEntryId === null`, not
  // `queue.length === 0` — a queue can be non-empty with nothing current
  // (applyRemove's "removed entry was last in pre-removal order" case,
  // tested below), and enqueuing into that state must still resume
  // playback rather than silently append behind a stopped cursor.
  it('becomes current again when the queue is non-empty but nothing is current', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a], currentEntryId: null }

    const result = applyEnqueue(state, b)

    expect(result.queue).toEqual([a, b])
    expect(result.currentEntryId).toBe('b')
  })

  it('does not mutate the input state', () => {
    const a = makeEntry('a')
    const state: QueueState = { queue: [], currentEntryId: null }

    applyEnqueue(state, a)

    expect(state.queue).toEqual([])
    expect(state.currentEntryId).toBeNull()
  })
})

describe('applyRemove', () => {
  it('removes the entry addressed by entryId', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a, b], currentEntryId: 'a' }

    const result = applyRemove(state, 'b')

    expect(result.queue).toEqual([a])
  })

  it('advances the cursor to whichever entry followed the removed current entry, pre-removal order', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const state: QueueState = { queue: [a, b, c], currentEntryId: 'b' }

    const result = applyRemove(state, 'b')

    expect(result.queue).toEqual([a, c])
    expect(result.currentEntryId).toBe('c')
  })

  it('clears the cursor when removing the last entry while it is current', () => {
    const a = makeEntry('a')
    const state: QueueState = { queue: [a], currentEntryId: 'a' }

    const result = applyRemove(state, 'a')

    expect(result.queue).toEqual([])
    expect(result.currentEntryId).toBeNull()
  })

  // Distinct from the case above: the queue is NOT left empty, because
  // earlier entries remain — only the cursor clears, since the removed
  // entry had no follower. This is the scenario that makes applyEnqueue's
  // `currentEntryId === null` check (rather than `queue.length === 0`)
  // load-bearing.
  it('clears the cursor (without emptying the queue) when the removed current entry was last among several', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a, b], currentEntryId: 'b' }

    const result = applyRemove(state, 'b')

    expect(result.queue).toEqual([a])
    expect(result.currentEntryId).toBeNull()
  })

  it('never disturbs the cursor when removing a non-current entry', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const state: QueueState = { queue: [a, b, c], currentEntryId: 'b' }

    const result = applyRemove(state, 'a')

    expect(result.queue).toEqual([b, c])
    expect(result.currentEntryId).toBe('b')
  })

  it('is a no-op when entryId is not in the queue', () => {
    const a = makeEntry('a')
    const state: QueueState = { queue: [a], currentEntryId: 'a' }

    const result = applyRemove(state, 'does-not-exist')

    expect(result).toBe(state)
  })

  it('does not mutate the input queue array', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a, b], currentEntryId: 'a' }

    applyRemove(state, 'a')

    expect(state.queue).toEqual([a, b])
  })
})

describe('applyMove', () => {
  it('reorders entries without ever changing currentEntryId', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const state: QueueState = { queue: [a, b, c], currentEntryId: 'b' }

    const result = applyMove(state, 'c', 'a')

    expect(result.queue).toEqual([c, a, b])
    expect(result.currentEntryId).toBe('b')
  })

  it('never changes currentEntryId even when the moved entry IS the current one', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const state: QueueState = { queue: [a, b, c], currentEntryId: 'b' }

    const result = applyMove(state, 'b', 'a')

    expect(result.queue).toEqual([b, a, c])
    expect(result.currentEntryId).toBe('b')
  })

  it('appends to the end when beforeEntryId is null', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const state: QueueState = { queue: [a, b, c], currentEntryId: 'a' }

    const result = applyMove(state, 'a', null)

    expect(result.queue).toEqual([b, c, a])
    expect(result.currentEntryId).toBe('a')
  })

  it('is a no-op when beforeEntryId does not exist in the queue', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a, b], currentEntryId: 'a' }

    const result = applyMove(state, 'a', 'does-not-exist')

    expect(result).toBe(state)
  })

  it('is a no-op when entryId does not exist in the queue', () => {
    const a = makeEntry('a')
    const state: QueueState = { queue: [a], currentEntryId: 'a' }

    const result = applyMove(state, 'does-not-exist', 'a')

    expect(result).toBe(state)
  })

  it('is a no-op when beforeEntryId equals entryId ("move before itself")', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a, b], currentEntryId: 'a' }

    const result = applyMove(state, 'a', 'a')

    expect(result).toBe(state)
  })

  it('does not mutate the input queue array', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const state: QueueState = { queue: [a, b, c], currentEntryId: 'a' }

    applyMove(state, 'c', 'a')

    expect(state.queue).toEqual([a, b, c])
  })
})

describe('applyNext', () => {
  it('advances the cursor to the entry following the current one', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const c = makeEntry('c')
    const state: QueueState = { queue: [a, b, c], currentEntryId: 'a' }

    const result = applyNext(state)

    expect(result.currentEntryId).toBe('b')
    expect(result.queue).toEqual([a, b, c])
  })

  it('stops (nothing current) at the end of the queue rather than wrapping to the first entry', () => {
    const a = makeEntry('a')
    const b = makeEntry('b')
    const state: QueueState = { queue: [a, b], currentEntryId: 'b' }

    const result = applyNext(state)

    expect(result.currentEntryId).toBeNull()
  })

  it('is a no-op when nothing is currently playing', () => {
    const a = makeEntry('a')
    const state: QueueState = { queue: [a], currentEntryId: null }

    const result = applyNext(state)

    expect(result).toBe(state)
  })
})

describe('duplicate itemId handling', () => {
  // The same title queued twice must produce two independently addressable
  // rows (ORCHESTRATE.md §1: "the same title can legitimately be queued
  // twice, so itemId is not a handle") — entryId, not itemId, is the only
  // thing removal (or any other mutation) addresses.
  it('yields two distinct entryIds for the same itemId, and removing one leaves the other untouched', () => {
    const first = makeEntry('entry-1', { itemId: 'item-99' })
    const second = makeEntry('entry-2', { itemId: 'item-99' })

    const afterEnqueue = applyEnqueue(applyEnqueue(EMPTY_STATE, first), second)

    expect(afterEnqueue.queue).toHaveLength(2)
    expect(afterEnqueue.queue[0]?.entryId).not.toBe(
      afterEnqueue.queue[1]?.entryId,
    )
    expect(afterEnqueue.queue.every(entry => entry.itemId === 'item-99')).toBe(
      true,
    )

    const afterRemove = applyRemove(afterEnqueue, 'entry-1')

    expect(afterRemove.queue).toEqual([second])
  })
})
