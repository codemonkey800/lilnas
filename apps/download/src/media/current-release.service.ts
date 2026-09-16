import { DownloadType } from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import {
  getMediaFileRelease,
  listMediaFileReleasesByFileIds,
  upsertMediaFileRelease,
  type UpsertMediaFileReleaseInput,
} from 'src/db/media-file-releases.repo'
import type { MediaFileReleaseRow } from 'src/db/schema'

import { RadarrService } from './radarr.service'
import { type GrabbedRelease, mapFilesToReleases } from './release-history.util'
import { SonarrService } from './sonarr.service'

interface IndexerCacheEntry {
  expiresAtMs: number
  /** Keyed by lowercased name - see `getIndexerIds()`. */
  idsByName: Map<string, number>
}

/**
 * A history `publishedDate` as a `Date`. History hands every value over as a
 * string (see `HistoryRecordLike.data`) while the column is a
 * `timestamp_ms`, and an unparseable one is dropped rather than stored as an
 * `Invalid Date` that reads back as `NaN` forever.
 */
function historyDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined
  }

  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time)
}

/**
 * A joined release as the repo wants it.
 *
 * `episodeId` is passed explicitly rather than taken off the release so the
 * movie path can force it absent: Radarr's history never carries one, but the
 * `media_file_releases_episode_only_for_shows` CHECK is what would find out
 * if that ever changed, and a constraint violation on a *cache write* is a
 * poor way to learn it.
 */
function toUpsertInput({
  episodeId,
  indexerId,
  mediaId,
  mediaType,
  release,
  upstreamFileId,
}: {
  episodeId?: number
  indexerId?: number
  mediaId: string
  mediaType: DownloadType
  release: GrabbedRelease
  upstreamFileId: number
}): UpsertMediaFileReleaseInput {
  return {
    downloadId: release.downloadId,
    episodeId,
    indexer: release.indexer,
    indexerId,
    mediaId,
    mediaType,
    protocol: release.protocol,
    publishDate: historyDate(release.publishDate),
    releaseGroup: release.releaseGroup,
    releaseGuid: release.guid,
    releaseTitle: release.title,
    size: release.size,
    upstreamFileId,
  }
}

/**
 * "Which release produced the file on disk right now" - the cache-first
 * composition of `mapFilesToReleases()` (the join) over
 * `media_file_releases` (the cache).
 *
 * Neither *arr stores the guid on the file record, so answering costs a
 * history call; the whole point of the `media_file_releases` row is that it
 * costs one *once*. A hit answers straight from sqlite, and because the join
 * works retroactively off history that already exists, a file imported years
 * before this feature shipped resolves just as well as one grabbed today.
 *
 * **Nothing here ever throws.** Every method degrades to `undefined` / an
 * empty map on an upstream failure, mirroring `MediaResolverService`'s
 * contract for the same reason: this hangs off a detail page that renders
 * perfectly well without it, so a Radarr outage must cost a release label,
 * never the page.
 *
 * A file history *cannot* resolve is deliberately **not** negative-cached.
 * The common causes - a manual import, or history pruned past the grab - are
 * both repairable upstream, and a negative row would mean the repair never
 * showed up. The cost of retrying is one history call per view of a title
 * that has no answer yet.
 */
@Injectable()
export class CurrentReleaseService {
  private static readonly INDEXER_TTL_MS = 60_000

  private readonly logger = new Logger(CurrentReleaseService.name)
  private indexerCache?: IndexerCacheEntry

  constructor(
    private readonly dbService: DbService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  /**
   * The release behind a movie's file, resolving and caching it on a miss.
   *
   * The file id has to come from Radarr because that is the only handle the
   * cache is keyed by - but a movie with no file has nothing to resolve, so
   * that case stops before the (much more expensive) history call.
   */
  async forMovie(
    mediaId: string,
    radarrId: number,
  ): Promise<MediaFileReleaseRow | undefined> {
    const action = 'forMovie'

    let upstreamFileId: number | undefined
    try {
      const files = await this.radarrService.getMovieFiles(radarrId)
      // Radarr models a movie as one file, but the endpoint is a list and
      // nothing in the API guarantees that - the first real id is the file
      // the library is serving.
      upstreamFileId = files.find(file => file.id != null)?.id
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), mediaId },
        'Radarr movie file lookup failed - no release to show',
      )
      return undefined
    }

    if (upstreamFileId === undefined) {
      return undefined
    }

    const cached = getMediaFileRelease(
      this.dbService.db,
      DownloadType.Movie,
      upstreamFileId,
    )
    if (cached) {
      return cached
    }

    try {
      const history = await this.radarrService.getMovieHistory(radarrId)
      const release = mapFilesToReleases(history).get(upstreamFileId)

      if (!release) {
        return undefined
      }

      return upsertMediaFileRelease(
        this.dbService.db,
        toUpsertInput({
          // Radarr's grabbed history carries `data.indexerId` outright, so
          // this side never needs the name -> id map Sonarr's does.
          indexerId: release.indexerId,
          mediaId,
          mediaType: DownloadType.Movie,
          release,
          upstreamFileId,
        }),
      )
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), mediaId },
        'Radarr history lookup failed - no release to show',
      )
      return undefined
    }
  }

  /**
   * The releases behind a series' episode files, keyed by `episodeFileId`.
   *
   * Sonarr's history is per-*series*, so the whole season list costs exactly
   * one upstream call - and zero when every id is already cached, which is
   * what makes re-rendering a show page free. One uncached file is enough to
   * pay for the call, and once it is paid for, every file that call resolved
   * is written back rather than just the ones that were asked about.
   *
   * Ids history cannot resolve are simply absent from the result.
   */
  async forEpisodeFiles(
    mediaId: string,
    sonarrId: number,
    fileIds: readonly number[],
  ): Promise<Map<number, MediaFileReleaseRow>> {
    const action = 'forEpisodeFiles'
    const rows = new Map<number, MediaFileReleaseRow>()

    if (fileIds.length === 0) {
      return rows
    }

    for (const row of listMediaFileReleasesByFileIds(
      this.dbService.db,
      DownloadType.Show,
      fileIds,
    )) {
      rows.set(row.upstreamFileId, row)
    }

    const requested = new Set(fileIds)
    if (![...requested].some(fileId => !rows.has(fileId))) {
      return rows
    }

    try {
      const history = await this.sonarrService.getSeriesHistory(sonarrId)
      const releases = mapFilesToReleases(history)
      const indexerIds = await this.getIndexerIds(releases.values())

      for (const [upstreamFileId, release] of releases) {
        const row = upsertMediaFileRelease(
          this.dbService.db,
          toUpsertInput({
            episodeId: release.episodeId,
            indexerId: release.indexer
              ? indexerIds.get(release.indexer.toLowerCase())
              : undefined,
            mediaId,
            mediaType: DownloadType.Show,
            release,
            upstreamFileId,
          }),
        )

        // Everything the call resolved is cached above; only what the caller
        // asked about is returned, so the map it iterates is exactly its own
        // file ids and never the rest of the series.
        if (requested.has(upstreamFileId)) {
          rows.set(upstreamFileId, row)
        }
      }
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), mediaId },
        'Sonarr history lookup failed - returning only cached releases',
      )
    }

    return rows
  }

  /**
   * The cached release for one file, without ever going upstream. The read a
   * caller uses when it already holds a file id and wants whatever is known
   * *now* - a miss is an answer, not a reason to go resolve.
   */
  forFile(
    mediaType: DownloadType,
    upstreamFileId: number,
  ): MediaFileReleaseRow | undefined {
    return getMediaFileRelease(this.dbService.db, mediaType, upstreamFileId)
  }

  /**
   * Sonarr's indexer names mapped back to their ids, cached for 60s - the
   * same TTL (and the same reasoning) as `MediaResolverService`'s library
   * caches: the indexer list changes about once a year, and a series page is
   * viewed far more often than that.
   *
   * Fetched lazily, only when some release actually carries a name to
   * resolve, so a series whose history has no indexer detail costs nothing
   * extra. Keys are lowercased because the name is matched against a `data`
   * bag whose casing varies across *arr versions.
   *
   * A failure is warned about and answered with an empty map rather than
   * aborting the resolve: the id is an enrichment on a row whose guid,
   * indexer *name* and title are all already known. It is deliberately not
   * negative-cached - the cost of retrying is one call per series view, and
   * caching the failure would outlive the restart that fixed it.
   */
  private async getIndexerIds(
    releases: Iterable<GrabbedRelease>,
  ): Promise<Map<string, number>> {
    if (![...releases].some(release => release.indexer)) {
      return new Map()
    }

    const now = Date.now()
    if (this.indexerCache && this.indexerCache.expiresAtMs > now) {
      return this.indexerCache.idsByName
    }

    try {
      const indexers = await this.sonarrService.getIndexers()
      const idsByName = new Map<string, number>()

      for (const indexer of indexers) {
        // Both halves are optional on the generated type, and a half-formed
        // entry maps a name to nothing useful either way.
        if (indexer.id == null || !indexer.name) {
          continue
        }
        idsByName.set(indexer.name.toLowerCase(), indexer.id)
      }

      this.indexerCache = {
        expiresAtMs: now + CurrentReleaseService.INDEXER_TTL_MS,
        idsByName,
      }

      return idsByName
    } catch (err) {
      this.logger.warn(
        { action: 'getIndexerIds', error: getErrorMessage(err) },
        'Sonarr indexer lookup failed - storing releases without an indexer id',
      )
      return new Map()
    }
  }
}
