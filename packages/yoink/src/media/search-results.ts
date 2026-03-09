import { and, eq, inArray, sql } from 'drizzle-orm'

import { db } from 'src/db'
import { downloadSearchResults } from 'src/db/schema'

// ---------------------------------------------------------------------------
// Movies
// ---------------------------------------------------------------------------

/**
 * Insert or update a "not found" record for a movie.
 * Call this when a Radarr search completes with no results.
 */
export async function recordMovieNotFound(tmdbId: number): Promise<void> {
  await db
    .insert(downloadSearchResults)
    .values({
      mediaType: 'movie',
      tmdbId,
      lastSearchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [downloadSearchResults.mediaType, downloadSearchResults.tmdbId],
      set: { lastSearchedAt: sql`excluded.last_searched_at` },
    })
}

/**
 * Remove the "not found" record for a movie.
 * Call this when a file is downloaded.
 */
export async function clearMovieSearchResult(tmdbId: number): Promise<void> {
  await db
    .delete(downloadSearchResults)
    .where(
      and(
        eq(downloadSearchResults.mediaType, 'movie'),
        eq(downloadSearchResults.tmdbId, tmdbId),
      ),
    )
}

/**
 * Get the "not found" record for a movie, if any.
 * Returns null if no record exists (meaning either never searched or was found).
 */
export async function getMovieSearchResult(
  tmdbId: number,
): Promise<{ lastSearchedAt: Date } | null> {
  const rows = await db
    .select({ lastSearchedAt: downloadSearchResults.lastSearchedAt })
    .from(downloadSearchResults)
    .where(
      and(
        eq(downloadSearchResults.mediaType, 'movie'),
        eq(downloadSearchResults.tmdbId, tmdbId),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

export interface EpisodeSearchKey {
  seasonNumber: number
  episodeNumber: number
}

/**
 * Insert or update "not found" records for a batch of episodes from a show.
 * Call this when a Sonarr search completes with no results for those episodes.
 */
export async function recordEpisodesNotFound(
  tvdbId: number,
  episodes: EpisodeSearchKey[],
): Promise<void> {
  if (episodes.length === 0) return

  const now = new Date()
  const values = episodes.map(ep => ({
    mediaType: 'episode' as const,
    tvdbId,
    seasonNumber: ep.seasonNumber,
    episodeNumber: ep.episodeNumber,
    lastSearchedAt: now,
  }))

  await db
    .insert(downloadSearchResults)
    .values(values)
    .onConflictDoUpdate({
      target: [
        downloadSearchResults.mediaType,
        downloadSearchResults.tvdbId,
        downloadSearchResults.seasonNumber,
        downloadSearchResults.episodeNumber,
      ],
      set: { lastSearchedAt: sql`excluded.last_searched_at` },
    })
}

/**
 * Remove the "not found" record for a single episode.
 * Call this when a file is downloaded.
 */
export async function clearEpisodeSearchResult(
  tvdbId: number,
  seasonNumber: number,
  episodeNumber: number,
): Promise<void> {
  await db
    .delete(downloadSearchResults)
    .where(
      and(
        eq(downloadSearchResults.mediaType, 'episode'),
        eq(downloadSearchResults.tvdbId, tvdbId),
        eq(downloadSearchResults.seasonNumber, seasonNumber),
        eq(downloadSearchResults.episodeNumber, episodeNumber),
      ),
    )
}

/**
 * Get all "not found" records for a show's episodes, keyed by "S{season}E{episode}".
 * Returns an empty map if no records exist.
 */
export async function getShowSearchResults(
  tvdbId: number,
): Promise<Map<string, { lastSearchedAt: Date }>> {
  const rows = await db
    .select({
      seasonNumber: downloadSearchResults.seasonNumber,
      episodeNumber: downloadSearchResults.episodeNumber,
      lastSearchedAt: downloadSearchResults.lastSearchedAt,
    })
    .from(downloadSearchResults)
    .where(
      and(
        eq(downloadSearchResults.mediaType, 'episode'),
        eq(downloadSearchResults.tvdbId, tvdbId),
      ),
    )

  const result = new Map<string, { lastSearchedAt: Date }>()
  for (const row of rows) {
    if (row.seasonNumber != null && row.episodeNumber != null) {
      const key = `S${row.seasonNumber}E${row.episodeNumber}`
      result.set(key, { lastSearchedAt: row.lastSearchedAt })
    }
  }
  return result
}

/**
 * Bulk-delete "not found" records for episodes that now have files.
 * Used during page load to auto-clear stale records.
 */
export async function clearEpisodeSearchResultsBulk(
  tvdbId: number,
  episodes: EpisodeSearchKey[],
): Promise<void> {
  if (episodes.length === 0) return

  // Build a list of composite season+episode values to match against.
  // We use inArray on a concatenated key column expression for a single query.
  await Promise.all(
    episodes.map(ep =>
      clearEpisodeSearchResult(tvdbId, ep.seasonNumber, ep.episodeNumber),
    ),
  )
}

/**
 * Delete all "not found" records for every episode of a show.
 * Call this when the series is removed from the library.
 */
export async function clearAllShowSearchResults(tvdbId: number): Promise<void> {
  await db
    .delete(downloadSearchResults)
    .where(
      and(
        eq(downloadSearchResults.mediaType, 'episode'),
        eq(downloadSearchResults.tvdbId, tvdbId),
      ),
    )
}
