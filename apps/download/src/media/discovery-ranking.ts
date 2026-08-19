import { DiscoveryResult, DownloadType } from '@lilnas/utils/download/types'

/**
 * A discovery result tagged with its 0-based position within its own
 * upstream array (Radarr's or Sonarr's lookup response, in the order
 * returned). Movies and shows both start their own rank sequence at 0 -
 * `sourceRank` is only ever compared within a tie-break chain alongside
 * `type`, never used to compare a movie against a show on its own.
 * `interleaveByRank()` below doesn't need this field (it zips two
 * still-separate, still-ordered arrays directly by position); it exists so
 * `sortDiscoveryResults()` can still recover each item's original per-source
 * order after movies and shows have been concatenated into one array.
 */
export type RankedDiscoveryResult = DiscoveryResult & { sourceRank: number }

export function rankBySourceOrder<T>(
  items: readonly T[],
): Array<T & { sourceRank: number }> {
  return items.map((item, sourceRank) => ({ ...item, sourceRank }))
}

/**
 * Round-robin merge of two still-ordered arrays: `a[0], b[0], a[1], b[1], …`,
 * appending whichever array is longer once the other is exhausted, in its
 * own remaining order. This is discovery's "relevance" (default) ordering -
 * the literal reading of "interleave into one ranked list", preserving each
 * source's internal order with no blended score.
 */
export function interleaveByRank<T>(a: readonly T[], b: readonly T[]): T[] {
  const merged: T[] = []
  const maxLength = Math.max(a.length, b.length)

  for (let i = 0; i < maxLength; i++) {
    const fromA = a[i]
    const fromB = b[i]
    if (fromA !== undefined) merged.push(fromA)
    if (fromB !== undefined) merged.push(fromB)
  }

  return merged
}

export interface DiscoveryFilterParams {
  genres?: readonly string[]
  yearFrom?: number
  yearTo?: number
}

/**
 * Filters by genre (case-insensitive, OR across selections) and/or by
 * inclusive release-year bounds. A row with no `releaseYear` is excluded
 * whenever either year bound is set - it can't be known to fall inside an
 * unknown range, so silently keeping it would be the wrong default. Called
 * twice by the discovery service with disjoint slices of `DiscoveryFilterParams`
 * (year-only, then genre-only) so genre facets can be computed from the
 * year-filtered-but-not-yet-genre-filtered set in between.
 */
export function applyDiscoveryFilters(
  results: readonly RankedDiscoveryResult[],
  filters: DiscoveryFilterParams,
): RankedDiscoveryResult[] {
  const wantedGenres = filters.genres?.map(g => g.toLowerCase())
  const hasYearBound =
    filters.yearFrom !== undefined || filters.yearTo !== undefined

  return results.filter(result => {
    if (wantedGenres && wantedGenres.length > 0) {
      const matchesGenre = result.genres.some(genre =>
        wantedGenres.includes(genre.toLowerCase()),
      )
      if (!matchesGenre) return false
    }

    if (hasYearBound) {
      if (result.releaseYear === undefined) return false
      if (
        filters.yearFrom !== undefined &&
        result.releaseYear < filters.yearFrom
      ) {
        return false
      }
      if (filters.yearTo !== undefined && result.releaseYear > filters.yearTo) {
        return false
      }
    }

    return true
  })
}

export interface GenreFacetCount {
  count: number
  genre: string
}

/**
 * The genre chip vocabulary, derived from `results` as given - the caller
 * is responsible for passing the year-filtered-but-not-genre-filtered set
 * (see `applyDiscoveryFilters()`'s comment): computing this after the genre
 * filter would be the classic faceting bug where selecting one genre erases
 * every other chip.
 */
export function collectGenreFacets(
  results: readonly RankedDiscoveryResult[],
): GenreFacetCount[] {
  const counts = new Map<string, number>()

  for (const result of results) {
    for (const genre of result.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([genre, count]) => ({ count, genre }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
}

function discoveryId(result: RankedDiscoveryResult): number {
  return result.type === DownloadType.Movie ? result.tmdbId : result.tvdbId
}

/**
 * The tail every comparator below ends with, so no two distinct results can
 * ever compare equal - cursor pagination over an array is unstable if any
 * tie is left unbroken. `sourceRank` mostly discriminates same-type ties
 * (two movies with the same title); cross-type ties fall through to `type`
 * (alphabetical: "movie" < "show"), then to the upstream numeric id.
 */
function tieBreak(a: RankedDiscoveryResult, b: RankedDiscoveryResult): number {
  if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank
  if (a.type !== b.type) return a.type.localeCompare(b.type)
  return discoveryId(a) - discoveryId(b)
}

export type DiscoverySort = 'releaseDate' | 'title'

/**
 * Comparator-based orderings for discovery - "relevance" isn't one of these
 * (it's `interleaveByRank()` above, a positional zip rather than a value
 * comparison); the discovery service dispatches between the two based on
 * the requested sort.
 */
export function sortDiscoveryResults(
  results: readonly RankedDiscoveryResult[],
  sort: DiscoverySort,
): RankedDiscoveryResult[] {
  const copy = [...results]

  if (sort === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title) || tieBreak(a, b))
    return copy
  }

  // releaseDate: descending, undefined last.
  copy.sort((a, b) => {
    if (a.releaseDate === undefined && b.releaseDate === undefined) {
      return tieBreak(a, b)
    }
    if (a.releaseDate === undefined) return 1
    if (b.releaseDate === undefined) return -1
    return b.releaseDate.localeCompare(a.releaseDate) || tieBreak(a, b)
  })
  return copy
}

export interface DiscoveryPageResult<T> {
  hasMore: boolean
  items: T[]
}

/**
 * Discovery pagination is offset semantics wearing a cursor's clothes - see
 * discovery.service.ts's own comment on why (every page re-runs both
 * upstream lookups and re-sorts, so the stability guarantee here is
 * strictly weaker than the DB-backed list endpoints').
 */
export function paginateDiscovery<T>(
  results: readonly T[],
  offset: number,
  limit: number,
): DiscoveryPageResult<T> {
  const items = results.slice(offset, offset + limit)
  const hasMore = offset + limit < results.length

  return { hasMore, items }
}
