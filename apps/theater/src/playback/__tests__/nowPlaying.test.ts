import {
  buildArtworkUrl,
  findNextEntry,
  resolveNowPlaying,
} from 'src/playback/nowPlaying'
import type { QueueEntry } from 'src/playback/queue'

function entry(entryId: string, itemId = `item-${entryId}`): QueueEntry {
  return {
    entryId,
    itemId,
    title: `Title ${entryId}`,
    subtitle: null,
    imageTag: null,
    runTimeTicks: null,
    addedBy: 'someone',
  }
}

const QUEUE: QueueEntry[] = [entry('a'), entry('b'), entry('c')]

describe('resolveNowPlaying', () => {
  it('returns the entry matching the cursor', () => {
    expect(resolveNowPlaying(QUEUE, 'b')).toBe(QUEUE[1])
  })

  it('returns null when nothing is playing', () => {
    expect(resolveNowPlaying(QUEUE, null)).toBeNull()
  })

  it('returns null for a cursor that is not in the queue', () => {
    expect(resolveNowPlaying(QUEUE, 'missing')).toBeNull()
  })

  it('returns null for an empty queue', () => {
    expect(resolveNowPlaying([], 'a')).toBeNull()
  })

  // The whole reason entryId exists alongside itemId: queueing the same title
  // twice is legitimate, and matching on itemId would resolve to the wrong copy.
  it('distinguishes two entries that share an itemId', () => {
    const duplicated = [
      entry('first', 'same-item'),
      entry('second', 'same-item'),
    ]
    expect(resolveNowPlaying(duplicated, 'second')).toBe(duplicated[1])
  })
})

describe('findNextEntry', () => {
  it('returns the following entry from the middle of the queue', () => {
    expect(findNextEntry(QUEUE, 'b')).toBe(QUEUE[2])
  })

  // Mirrors presence/queue.ts's applyNext: advancing off the end clears the
  // room cursor rather than wrapping around, which is why the player's Next
  // button has to be disabled here instead of silently stopping the movie.
  it('returns null on the last entry — no wraparound', () => {
    expect(findNextEntry(QUEUE, 'c')).toBeNull()
  })

  it('returns null for a single-entry queue', () => {
    expect(findNextEntry([entry('only')], 'only')).toBeNull()
  })

  it('returns null when nothing is playing', () => {
    expect(findNextEntry(QUEUE, null)).toBeNull()
  })

  it('returns null for a cursor that is not in the queue', () => {
    expect(findNextEntry(QUEUE, 'missing')).toBeNull()
  })
})

describe('buildArtworkUrl', () => {
  it('omits the query entirely with no options, matching the poster grid', () => {
    expect(buildArtworkUrl('abc123')).toBe('/api/theater/items/abc123/image')
  })

  it('passes through type and maxWidth', () => {
    expect(
      buildArtworkUrl('abc123', { type: 'Backdrop', maxWidth: 1920 }),
    ).toBe('/api/theater/items/abc123/image?type=Backdrop&maxWidth=1920')
  })

  it('supports either option on its own', () => {
    expect(buildArtworkUrl('abc123', { type: 'Primary' })).toBe(
      '/api/theater/items/abc123/image?type=Primary',
    )
    expect(buildArtworkUrl('abc123', { maxWidth: 800 })).toBe(
      '/api/theater/items/abc123/image?maxWidth=800',
    )
  })

  it('percent-encodes the item id so it cannot escape the path segment', () => {
    expect(buildArtworkUrl('a/b c')).toBe('/api/theater/items/a%2Fb%20c/image')
  })
})
