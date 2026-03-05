import {
  getApiV3QueueDetails,
  putApiV3EpisodeMonitor,
  type QueueResource,
} from '@lilnas/media/sonarr'

import { getSonarrClient } from './clients'
import { recordEpisodesNotFound } from './search-results'

const SEARCH_TIMEOUT_MS = 30_000
const TIMED_OUT_TTL_MS = 60_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpisodeSearchEntry {
  episodeId: number
  seriesId: number
  tvdbId: number
  seasonNumber: number
  episodeNumber: number
}

interface LiveSearchEntry extends EpisodeSearchEntry {
  timer: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

// episodeId -> entry currently being searched
const searchStore = new Map<number, LiveSearchEntry>()

// seriesId -> Set of episode IDs that timed out without a download appearing
const timedOutStore = new Map<number, Set<number>>()

// ---------------------------------------------------------------------------
// Queue cache to avoid hammering Sonarr when many timers fire at once
// ---------------------------------------------------------------------------

interface QueueCache {
  data: Set<number> // episodeIds currently in queue
  expiresAt: number
}
const queueCache = new Map<number, QueueCache>()
const QUEUE_CACHE_TTL_MS = 2_000

async function getQueuedEpisodeIds(seriesId: number): Promise<Set<number>> {
  const cached = queueCache.get(seriesId)
  if (cached && Date.now() < cached.expiresAt) return cached.data

  try {
    const client = getSonarrClient()
    const result = await getApiV3QueueDetails({
      client,
      query: { seriesId, includeEpisode: false },
      cache: 'no-store',
    })
    const items = (result.data ?? []) as QueueResource[]
    const ids = new Set(
      items.map(q => q.episodeId).filter((id): id is number => id != null),
    )
    queueCache.set(seriesId, { data: ids, expiresAt: Date.now() + QUEUE_CACHE_TTL_MS })
    return ids
  } catch {
    return new Set()
  }
}

// ---------------------------------------------------------------------------
// Timer handler
// ---------------------------------------------------------------------------

async function handleTimeout(entry: EpisodeSearchEntry): Promise<void> {
  // Always remove from the active search store
  searchStore.delete(entry.episodeId)

  try {
    const queuedIds = await getQueuedEpisodeIds(entry.seriesId)

    if (queuedIds.has(entry.episodeId)) {
      // Episode made it into the download queue — nothing to record
      return
    }

    // Episode was not found — persist to DB and unmonitor
    await Promise.all([
      recordEpisodesNotFound(entry.tvdbId, [
        {
          seasonNumber: entry.seasonNumber,
          episodeNumber: entry.episodeNumber,
        },
      ]),
      (async () => {
        try {
          const client = getSonarrClient()
          await putApiV3EpisodeMonitor({
            client,
            body: { episodeIds: [entry.episodeId], monitored: false },
          })
        } catch {
          // Non-fatal — the DB record is the source of truth
        }
      })(),
    ])

    // Add to transient timed-out store so the UI can show it immediately
    // without waiting for the next page load (which will read from DB)
    if (!timedOutStore.has(entry.seriesId)) {
      timedOutStore.set(entry.seriesId, new Set())
    }
    timedOutStore.get(entry.seriesId)!.add(entry.episodeId)

    // Auto-clear from transient store after TTL — DB row persists for future loads
    setTimeout(() => {
      const set = timedOutStore.get(entry.seriesId)
      if (set) {
        set.delete(entry.episodeId)
        if (set.size === 0) timedOutStore.delete(entry.seriesId)
      }
    }, TIMED_OUT_TTL_MS)
  } catch {
    // Ignore errors — worst case the episode stays in "not found" state after reload
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a batch of episodes as actively being searched.
 * Episodes already in the store (from a prior click) are skipped — their
 * original timer is preserved.
 */
export function registerEpisodeSearches(
  entries: EpisodeSearchEntry[],
): void {
  for (const entry of entries) {
    if (searchStore.has(entry.episodeId)) continue

    const timer = setTimeout(() => {
      void handleTimeout(entry)
    }, SEARCH_TIMEOUT_MS)

    searchStore.set(entry.episodeId, { ...entry, timer })

    // Clear any stale timed-out record for this episode since it's being searched again
    timedOutStore.get(entry.seriesId)?.delete(entry.episodeId)
  }
}

/**
 * Returns the current search state for a given series.
 */
export function getSearchState(seriesId: number): {
  searchingEpisodeIds: number[]
  timedOutEpisodeIds: number[]
} {
  const searchingEpisodeIds: number[] = []
  for (const [episodeId, entry] of searchStore) {
    if (entry.seriesId === seriesId) {
      searchingEpisodeIds.push(episodeId)
    }
  }

  const timedOutEpisodeIds = [
    ...(timedOutStore.get(seriesId) ?? new Set<number>()),
  ]

  return { searchingEpisodeIds, timedOutEpisodeIds }
}

/**
 * Returns the set of episode IDs currently being searched across the entire
 * store. Used by server actions to filter out already-tracked episodes.
 */
export function getSearchingEpisodeIds(): Set<number> {
  return new Set(searchStore.keys())
}

/**
 * Clears all active searches and timed-out entries for a series.
 * Call this when the user cancels all downloads.
 */
export function clearSearches(seriesId: number): void {
  for (const [episodeId, entry] of searchStore) {
    if (entry.seriesId === seriesId) {
      clearTimeout(entry.timer)
      searchStore.delete(episodeId)
    }
  }
  timedOutStore.delete(seriesId)
}
