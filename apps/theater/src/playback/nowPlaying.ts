import type { QueueEntry } from './queue'

// ---------------------------------------------------------------------------
// Derivations the full-page player needs from the room queue, kept as pure
// functions in their own `.ts` so they're reachable from jest (`testMatch` only
// picks up `.ts`, never `.tsx`).
//
// `QueueEntry` already carries every piece of "what's playing" metadata the
// player shows — title, subtitle, runtime, who queued it — and it's room-synced
// via `video:state`/`queue:state`, so the player needs no fetch of its own and
// can't disagree with the tablet about what's on screen.
// ---------------------------------------------------------------------------

/**
 * The currently-playing queue entry, or `null` when the room has nothing
 * playing (empty queue, or a cursor that doesn't resolve).
 *
 * Matches on `entryId`, never `itemId`: the same title can legitimately appear
 * in the queue more than once, and `entryId` is the server-generated identity
 * that distinguishes those copies.
 */
export function resolveNowPlaying(
  queue: QueueEntry[],
  currentEntryId: string | null,
): QueueEntry | null {
  if (currentEntryId === null) {
    return null
  }
  return queue.find(entry => entry.entryId === currentEntryId) ?? null
}

/**
 * The entry a `commandNext` would advance to, or `null` if there isn't one.
 *
 * Mirrors `src/presence/queue.ts`'s `applyNext` exactly — including that
 * there is **no wraparound**: advancing off the last entry clears the room's
 * cursor to `null` and stops playback. That's why the player's Next button
 * reads this rather than just checking `queue.length > 1`; without the check a
 * click on the last title would silently stop the movie for everyone.
 */
export function findNextEntry(
  queue: QueueEntry[],
  currentEntryId: string | null,
): QueueEntry | null {
  if (currentEntryId === null) {
    return null
  }
  const currentIndex = queue.findIndex(
    entry => entry.entryId === currentEntryId,
  )
  if (currentIndex === -1) {
    return null
  }
  return queue[currentIndex + 1] ?? null
}

// Emby image kinds this app's proxy route accepts. Mirrors
// `src/emby/emby.schema.ts`'s `ItemImageQuerySchema.type` enum — hand-mirrored
// across the frontend/backend boundary like every other wire shape in this app
// (see `queue.ts`'s "Keep in sync" note).
export type ArtworkType = 'Primary' | 'Backdrop' | 'Thumb' | 'Logo'

export type ArtworkOptions = {
  type?: ArtworkType
  maxWidth?: number
}

/**
 * URL for an item's artwork through the backend's Emby image proxy.
 *
 * Omitting both options reproduces the poster grid's existing request exactly
 * (`Primary` at the backend's default width), so the tablet and the player
 * share one cache entry for the same poster.
 */
export function buildArtworkUrl(
  itemId: string,
  options: ArtworkOptions = {},
): string {
  const search = new URLSearchParams()
  if (options.type !== undefined) {
    search.set('type', options.type)
  }
  if (options.maxWidth !== undefined) {
    search.set('maxWidth', String(options.maxWidth))
  }
  const query = search.toString()
  const base = `/api/theater/items/${encodeURIComponent(itemId)}/image`
  return query.length > 0 ? `${base}?${query}` : base
}
