import {
  DownloadJob,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  JobRequester,
  Media,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { mediaId } from 'src/db/media-id'
import { DownloadStateService } from 'src/download/download-state.service'

import { MediaResolverService } from './media-resolver.service'
import { RadarrService } from './radarr.service'
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
    return this.request({
      action: 'requestMovie',
      mediaId: mediaId({ tmdbId, type: DownloadType.Movie }),
      requester,
      submit: () => this.radarrService.requestMovie(tmdbId),
      type: DownloadType.Movie,
      upstreamId: tmdbId,
    })
  }

  async requestShow(
    tvdbId: number,
    requester?: JobRequester | null,
  ): Promise<DownloadJob> {
    return this.request({
      action: 'requestShow',
      mediaId: mediaId({ tvdbId, type: DownloadType.Show }),
      requester,
      submit: () => this.sonarrService.requestShow(tvdbId),
      type: DownloadType.Show,
      upstreamId: tvdbId,
    })
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

  private async request({
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
