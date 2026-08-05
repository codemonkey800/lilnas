import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  isMovieDownloadJob,
  isShowDownloadJob,
  MovieDownloadJob,
  MovieSearchResult,
  ShowDownloadJob,
  ShowSearchResult,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { DownloadStateService } from 'src/download/download-state.service'

import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'

function assertMovieJob(job: DownloadJob, id: string): MovieDownloadJob {
  if (!isMovieDownloadJob(job)) {
    throw new Error(
      `Expected a movie job but got a '${job.type}' job (id: '${id}')`,
    )
  }

  return job
}

function assertShowJob(job: DownloadJob, id: string): ShowDownloadJob {
  if (!isShowDownloadJob(job)) {
    throw new Error(
      `Expected a show job but got a '${job.type}' job (id: '${id}')`,
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
 */
@Injectable()
export class MediaDownloadService {
  private logger = new Logger(MediaDownloadService.name)

  constructor(
    private readonly downloadStateService: DownloadStateService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  async searchMovies(query: string): Promise<MovieSearchResult[]> {
    return this.radarrService.search(query)
  }

  async searchShows(query: string): Promise<ShowSearchResult[]> {
    return this.sonarrService.search(query)
  }

  async requestMovie(tmdbId: number): Promise<MovieDownloadJob> {
    const action = 'requestMovie'
    const id = nanoid()

    const job: MovieDownloadJob = {
      id,
      status: DownloadJobStatus.Requested,
      type: DownloadType.Movie,
      url: `radarr://tmdb/${tmdbId}`,
    }
    this.downloadStateService.jobs.set(id, job)

    this.logger.log({ action, jobId: id, tmdbId }, 'Requesting movie download')

    try {
      const result = await this.radarrService.requestMovie(tmdbId)

      const updated = this.downloadStateService.updateJob(id, {
        mediaTitle: result.title,
        posterUrl: result.posterUrl,
        radarrId: result.radarrId,
        status: DownloadJobStatus.Searching,
      })

      return assertMovieJob(updated, id)
    } catch (err) {
      const error = getErrorMessage(err)

      this.logger.error(
        { action, jobId: id, tmdbId, error },
        'Failed to request movie download',
      )

      const updated = this.downloadStateService.updateJob(id, {
        error,
        status: DownloadJobStatus.Failed,
      })

      return assertMovieJob(updated, id)
    }
  }

  async requestShow(tvdbId: number): Promise<ShowDownloadJob> {
    const action = 'requestShow'
    const id = nanoid()

    const job: ShowDownloadJob = {
      id,
      status: DownloadJobStatus.Requested,
      type: DownloadType.Show,
      url: `sonarr://tvdb/${tvdbId}`,
    }
    this.downloadStateService.jobs.set(id, job)

    this.logger.log({ action, jobId: id, tvdbId }, 'Requesting show download')

    try {
      const result = await this.sonarrService.requestShow(tvdbId)

      const updated = this.downloadStateService.updateJob(id, {
        mediaTitle: result.title,
        posterUrl: result.posterUrl,
        sonarrId: result.sonarrId,
        status: DownloadJobStatus.Searching,
      })

      return assertShowJob(updated, id)
    } catch (err) {
      const error = getErrorMessage(err)

      this.logger.error(
        { action, jobId: id, tvdbId, error },
        'Failed to request show download',
      )

      const updated = this.downloadStateService.updateJob(id, {
        error,
        status: DownloadJobStatus.Failed,
      })

      return assertShowJob(updated, id)
    }
  }

  getMovieJob(id: string): MovieDownloadJob {
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      throw new Error(`Job with ID '${id}' not found`)
    }

    return assertMovieJob(job, id)
  }

  getShowJob(id: string): ShowDownloadJob {
    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      throw new Error(`Job with ID '${id}' not found`)
    }

    return assertShowJob(job, id)
  }

  async deleteMovieJob(id: string): Promise<MovieDownloadJob> {
    const action = 'deleteMovieJob'
    const job = this.getMovieJob(id)

    if (job.radarrId != null) {
      this.logger.log(
        { action, jobId: id, radarrId: job.radarrId },
        'Unmonitoring and deleting movie from Radarr',
      )
      await this.radarrService.unmonitorAndDelete(job.radarrId)
    }

    const updated = this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Cancelled,
    })

    return assertMovieJob(updated, id)
  }

  async deleteShowJob(id: string): Promise<ShowDownloadJob> {
    const action = 'deleteShowJob'
    const job = this.getShowJob(id)

    if (job.sonarrId != null) {
      this.logger.log(
        { action, jobId: id, sonarrId: job.sonarrId },
        'Unmonitoring and deleting series from Sonarr',
      )
      await this.sonarrService.unmonitorAndDelete(job.sonarrId)
    }

    const updated = this.downloadStateService.updateJob(id, {
      status: DownloadJobStatus.Cancelled,
    })

    return assertShowJob(updated, id)
  }
}
