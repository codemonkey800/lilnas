import {
  DiscoveryPage,
  DiscoveryResult,
  DiscoverySource,
  DownloadType,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common'

import { computeFilterKey } from 'src/db/job-cursor'

import {
  applyDiscoveryFilters,
  collectGenreFacets,
  type DiscoverySort,
  interleaveByRank,
  paginateDiscovery,
  rankBySourceOrder,
  type RankedDiscoveryResult,
  sortDiscoveryResults,
} from './discovery-ranking'
import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'

export interface DiscoveryParams {
  cursor?: string
  genres?: readonly string[]
  limit: number
  query: string
  sort: 'relevance' | DiscoverySort
  yearFrom?: number
  yearTo?: number
}

function encodeDiscoveryCursor(offset: number, filterKey: string): string {
  return Buffer.from(`${offset}:${filterKey}`, 'utf8').toString('base64url')
}

/**
 * Simpler than `job-cursor.ts`'s codec - discovery has no row identity to
 * carry, only an offset - but the same filter-key guard: a cursor minted
 * for one query/filter/sort combination must never be silently replayed
 * against a different one.
 */
function decodeDiscoveryCursor(
  cursor: string,
  expectedFilterKey: string,
): number | undefined {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8')
  const separatorIndex = raw.indexOf(':')
  if (separatorIndex === -1) return undefined

  const offsetRaw = raw.slice(0, separatorIndex)
  const filterKey = raw.slice(separatorIndex + 1)
  if (!filterKey || filterKey !== expectedFilterKey) return undefined
  if (!/^\d+$/.test(offsetRaw)) return undefined

  const offset = Number(offsetRaw)
  return Number.isInteger(offset) ? offset : undefined
}

function stripSourceRank(result: RankedDiscoveryResult): DiscoveryResult {
  const { sourceRank: _sourceRank, ...rest } = result
  // Referenced only to satisfy no-unused-vars - see the destructure above.
  void _sourceRank
  return rest
}

/**
 * Merges Radarr + Sonarr search into one browsable list. Unlike the
 * DB-backed list endpoints (activity/gallery/history), this is NOT a stable
 * cursor - it's offset semantics wearing a cursor's clothes. Every page
 * re-runs both upstream lookups and re-sorts from scratch; there is no
 * underlying row identity to seek from. If Radarr/Sonarr's own results
 * shift between two page requests (a title is added, removed, or
 * re-ranked upstream), a row can be skipped or repeated across the page
 * boundary. That's an accepted, documented weaker guarantee - not an
 * oversight - because there is no stable key to page by across two
 * independent upstream searches.
 */
@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name)

  constructor(
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  async search(params: DiscoveryParams): Promise<DiscoveryPage> {
    const action = 'search'

    const [movieResult, showResult] = await Promise.allSettled([
      this.radarrService.searchDetailed(params.query),
      this.sonarrService.searchDetailed(params.query),
    ])

    const degradedSources: DiscoverySource[] = []

    if (movieResult.status === 'rejected' && showResult.status === 'rejected') {
      this.logger.error(
        {
          action,
          movieError: getErrorMessage(movieResult.reason),
          showError: getErrorMessage(showResult.reason),
        },
        'Both Radarr and Sonarr discovery lookups failed',
      )
      throw new BadGatewayException(
        'Discovery is temporarily unavailable - both Radarr and Sonarr lookups failed',
      )
    }

    if (movieResult.status === 'rejected') {
      degradedSources.push('movies')
      this.logger.warn(
        { action, error: getErrorMessage(movieResult.reason) },
        'Radarr discovery lookup failed - returning show-only results',
      )
    }

    if (showResult.status === 'rejected') {
      degradedSources.push('shows')
      this.logger.warn(
        { action, error: getErrorMessage(showResult.reason) },
        'Sonarr discovery lookup failed - returning movie-only results',
      )
    }

    const movies = rankBySourceOrder(
      movieResult.status === 'fulfilled' ? movieResult.value : [],
    )
    const shows = rankBySourceOrder(
      showResult.status === 'fulfilled' ? showResult.value : [],
    )

    const merged: RankedDiscoveryResult[] = [...movies, ...shows]

    // Year filter first, then facets, then genre filter - in that order,
    // deliberately (see applyDiscoveryFilters()'s and collectGenreFacets()'s
    // own comments): computing facets after the genre filter would make
    // selecting one genre chip erase every other chip.
    const yearFiltered = applyDiscoveryFilters(merged, {
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
    })
    const genreFacets = collectGenreFacets(yearFiltered)
    const filtered = applyDiscoveryFilters(yearFiltered, {
      genres: params.genres,
    })

    // Explicit type argument: TS's control-flow type-predicate inference
    // would otherwise narrow these two `.filter()` calls to
    // `DiscoveryMovieResult[]`/`DiscoveryShowResult[]` respectively, and
    // `interleaveByRank<T>` can't unify two incompatible sibling members of
    // the `DiscoveryResult` union into one `T`.
    const ordered =
      params.sort === 'relevance'
        ? interleaveByRank<RankedDiscoveryResult>(
            filtered.filter(r => r.type === DownloadType.Movie),
            filtered.filter(r => r.type === DownloadType.Show),
          )
        : sortDiscoveryResults(filtered, params.sort)

    const filterKey = computeFilterKey({
      genres: params.genres,
      query: params.query,
      sort: params.sort,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
    })

    const offset = this.decodeCursor(params.cursor, filterKey)
    const { hasMore, items } = paginateDiscovery(ordered, offset, params.limit)

    const nextCursor = hasMore
      ? encodeDiscoveryCursor(offset + params.limit, filterKey)
      : null

    return {
      degradedSources,
      facets: { genres: genreFacets },
      items: items.map(stripSourceRank),
      nextCursor,
      total: ordered.length,
    }
  }

  private decodeCursor(cursor: string | undefined, filterKey: string): number {
    if (!cursor) return 0

    const offset = decodeDiscoveryCursor(cursor, filterKey)
    if (offset === undefined) {
      throw new BadRequestException(
        'Invalid or expired discovery cursor - it may have been minted under a different search',
      )
    }

    return offset
  }
}
