import {
  DownloadJob,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  JobRequester,
  Media,
  type Release,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { listBadFilesByMediaId } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { mediaId } from 'src/db/media-id'
import { DownloadStateService } from 'src/download/download-state.service'

import { MediaResolverService } from './media-resolver.service'
import { RadarrService } from './radarr.service'
import { pickBestRelease } from './release-selection.util'
import { SonarrService } from './sonarr.service'

/**
 * One assertion for both media types, replacing the byte-identical
 * `assertMovieJob`/`assertShowJob` twins - now that a job is a plain object
 * with the union nested at `media`, the only thing that varied between them
 * was the literal in the message.
 */
function assertJobMediaType(
  job: DownloadJobRecord,
  type: DownloadType,
  id: string,
): DownloadJobRecord {
  if (job.type !== type) {
    throw new Error(
      `Expected a ${type} job but got a '${job.type}' job (id: '${id}')`,
    )
  }

  return job
}

/**
 * Orchestrates movie/show job lifecycle on top of the shared
 * `DownloadStateService.jobs` map, delegating the actual Radarr/Sonarr API
 * calls to RadarrService/SonarrService. Movie/show jobs are tracked entirely
 * by polling (see MediaPollerService) - they're never handed to
 * DownloadSchedulerService, which is video-pipeline-only.
 *
 * Requesting a title writes **no metadata at all**: Radarr/Sonarr are the
 * system of record for it, so a job stores only the derived `media_id` and
 * every read re-derives the title/poster/overview through
 * `MediaResolverService`.
 */
@Injectable()
export class MediaDownloadService {
  private logger = new Logger(MediaDownloadService.name)

  constructor(
    private readonly dbService: DbService,
    private readonly downloadStateService: DownloadStateService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  async searchMovies(query: string): Promise<Media[]> {
    return this.radarrService.search(query)
  }

  async searchShows(query: string): Promise<Media[]> {
    return this.sonarrService.search(query)
  }

  async requestMovie(
    tmdbId: number,
    requester?: JobRequester | null,
  ): Promise<DownloadJob> {
    const jobMediaId = mediaId({ tmdbId, type: DownloadType.Movie })

    return this.request({
      action: 'requestMovie',
      mediaId: jobMediaId,
      requester,
      // Ensure first, *then* decide - the upstream id doesn't exist until
      // the title is in the library, and both branches need it.
      submit: async () => {
        const { radarrId } = await this.radarrService.ensureMovie(tmdbId)
        const flagged = this.flaggedGuids(jobMediaId)

        if (flagged.size === 0) {
          // Byte-for-byte the pre-Phase-3 path: hand it to Radarr's own
          // scoring and let it pick.
          await this.radarrService.triggerSearch(radarrId)
          return
        }

        const release = this.pickUnflaggedRelease(
          jobMediaId,
          await this.radarrService.getReleases(radarrId),
          flagged,
        )
        await this.radarrService.grabRelease(release.guid, release.indexerId)
      },
      type: DownloadType.Movie,
      upstreamId: tmdbId,
    })
  }

  async requestShow(
    tvdbId: number,
    requester?: JobRequester | null,
  ): Promise<DownloadJob> {
    const jobMediaId = mediaId({ tvdbId, type: DownloadType.Show })

    return this.request({
      action: 'requestShow',
      mediaId: jobMediaId,
      requester,
      submit: async () => {
        const { sonarrId } = await this.sonarrService.ensureSeries(tvdbId)
        const flagged = this.flaggedGuids(jobMediaId)

        if (flagged.size === 0) {
          await this.sonarrService.triggerSearch(sonarrId)
          return
        }

        const release = this.pickUnflaggedRelease(
          jobMediaId,
          await this.sonarrService.getReleases(sonarrId),
          flagged,
        )
        await this.sonarrService.grabRelease(release.guid, release.indexerId)
      },
      type: DownloadType.Show,
      upstreamId: tvdbId,
    })
  }

  /**
   * Every release guid flagged as bad for a title. An empty set is the
   * common case and the one that matters most - it's what keeps a title with
   * no flags on the untouched command path.
   */
  private flaggedGuids(jobMediaId: string): Set<string> {
    return new Set(
      listBadFilesByMediaId(this.dbService.db, jobMediaId).map(
        row => row.releaseGuid,
      ),
    )
  }

  /**
   * The app's own pick, used only once a title has flagged releases: the
   * generic `MoviesSearch`/`SeriesSearch` command has no way to be told
   * "anything but that one", so this app has to do the choosing itself.
   *
   * Throws when nothing survives the filter. That failure lands on the job
   * (via `request()`'s catch) with a message that says *why* - which beats a
   * job that sits in `Searching` forever waiting for a grab that will never
   * come.
   */
  private pickUnflaggedRelease(
    jobMediaId: string,
    releases: Release[],
    flagged: ReadonlySet<string>,
  ): Release {
    const release = pickBestRelease(releases, flagged)

    if (!release) {
      throw new Error(
        `No usable release for ${jobMediaId}: all ${releases.length} ` +
          `release(s) were either rejected upstream or flagged as bad files`,
      )
    }

    this.logger.log(
      {
        action: 'pickUnflaggedRelease',
        candidates: releases.length,
        flaggedCount: flagged.size,
        guid: release.guid,
        mediaId: jobMediaId,
      },
      'Picked a release ourselves - this title has flagged bad files',
    )

    return release
  }

  getMovieJob(id: string): Promise<DownloadJob> {
    return this.getJob(id, DownloadType.Movie)
  }

  getShowJob(id: string): Promise<DownloadJob> {
    return this.getJob(id, DownloadType.Show)
  }

  async deleteMovieJob(id: string): Promise<DownloadJob> {
    return this.deleteJob(id, DownloadType.Movie, radarrId =>
      this.radarrService.unmonitorAndDelete(radarrId),
    )
  }

  async deleteShowJob(id: string): Promise<DownloadJob> {
    return this.deleteJob(id, DownloadType.Show, sonarrId =>
      this.sonarrService.unmonitorAndDelete(sonarrId),
    )
  }

  /**
   * The single job-creation choke point for movies and shows: mint a
   * `Requested` job, run `submit()`, then move it to `Searching` or `Failed`.
   * Everything downstream - requester attribution, `hiddenAttribution`, the
   * WS `created`/`updated` events, `MediaPollerService` picking the job up
   * off the queue - hangs off `DownloadStateService.addJob()` happening here
   * and nowhere else.
   *
   * Public (rather than private, as it was before Phase 3) so
   * `ReleaseService`'s grab path can reuse it verbatim with a different
   * `submit`. A second job-creation path would have had to re-derive all of
   * the above and would drift the first time either side changed.
   */
  async request({
    action,
    mediaId: jobMediaId,
    requester,
    submit,
    type,
    upstreamId,
  }: {
    action: string
    mediaId: string
    requester?: JobRequester | null
    submit: () => Promise<unknown>
    type: DownloadType
    upstreamId: number
  }): Promise<DownloadJob> {
    const id = nanoid()
    const now = new Date().toISOString()

    const record: DownloadJobRecord = {
      completedAt: null,
      createdAt: now,
      // Movies/shows are always attributed - there's no hiding toggle for
      // them by design (spec §Core Concepts).
      hiddenAttribution: false,
      id,
      mediaId: jobMediaId,
      requester: requester ?? null,
      status: DownloadJobStatus.Requested,
      type,
      updatedAt: now,
    }
    this.downloadStateService.addJob(record)

    this.logger.log({ action, jobId: id, upstreamId }, 'Requesting download')

    try {
      await submit()

      return this.downloadStateService.hydrateOne(
        this.downloadStateService.updateJob(id, {
          status: DownloadJobStatus.Searching,
        }),
      )
    } catch (err) {
      const error = getErrorMessage(err)

      this.logger.error(
        { action, jobId: id, upstreamId, error },
        'Failed to request download',
      )

      return this.downloadStateService.hydrateOne(
        this.downloadStateService.updateJob(id, {
          error,
          status: DownloadJobStatus.Failed,
        }),
      )
    }
  }

  private async getJob(id: string, type: DownloadType): Promise<DownloadJob> {
    // Falls back to the durable `jobs` row when the in-memory Map has no
    // entry (e.g. after a restart) - see DownloadStateService's own comment.
    const record = this.downloadStateService.resolveJobRecord(id)

    if (!record) {
      throw new Error(`Job with ID '${id}' not found`)
    }

    return this.downloadStateService.hydrateOne(
      assertJobMediaType(record, type, id),
    )
  }

  /**
   * Unmonitors and deletes upstream, then cancels the job. The upstream id
   * (`radarrId`/`sonarrId`) is read off the *resolved* media rather than a
   * persisted column - it's Radarr's own primary key, so Radarr is the only
   * honest place to get it, and a title that has since been removed from the
   * library simply resolves without one and skips the upstream call.
   */
  private async deleteJob(
    id: string,
    type: DownloadType,
    remove: (upstreamId: number) => Promise<void>,
  ): Promise<DownloadJob> {
    const action = 'deleteJob'
    const job = await this.getJob(id, type)

    const upstreamId = isManagedMedia(job.media)
      ? job.media.type === DownloadType.Movie
        ? job.media.radarrId
        : job.media.sonarrId
      : undefined

    if (upstreamId != null) {
      this.logger.log(
        { action, jobId: id, type, upstreamId },
        'Unmonitoring and deleting from the upstream library',
      )
      await remove(upstreamId)
    }

    // The library cache still holds the pre-delete entry, so drop it - the
    // next read must see Radarr's post-delete truth (no `filePath`), not a
    // stale one from up to a TTL window ago.
    this.mediaResolverService.invalidate(job.media.id)

    return this.downloadStateService.hydrateOne(
      this.downloadStateService.updateJob(id, {
        status: DownloadJobStatus.Cancelled,
      }),
    )
  }
}
