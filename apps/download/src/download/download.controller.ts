import {
  CreateDownloadJobInputSchema,
  MediaSearchQuerySchema,
  RequestMovieInputSchema,
  RequestShowInputSchema,
} from '@lilnas/utils/download/schema'
import type {
  DownloadJob,
  GetDownloadJobResponse,
  GetMovieJobResponse,
  GetShowJobResponse,
  MovieDownloadJob,
  SearchMoviesResponse,
  SearchShowsResponse,
  ShowDownloadJob,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { createZodDto } from 'nestjs-zod'

import { MediaDownloadService } from 'src/media/media-download.service'

import { DownloadService } from './download.service'
import { DownloadStateService } from './download-state.service'

class CreateJobInputDto extends createZodDto(CreateDownloadJobInputSchema) {}
class MediaSearchQueryDto extends createZodDto(MediaSearchQuerySchema) {}
class RequestMovieInputDto extends createZodDto(RequestMovieInputSchema) {}
class RequestShowInputDto extends createZodDto(RequestShowInputSchema) {}

@Controller('/download')
export class DownloadController {
  private logger = new Logger(DownloadController.name)

  constructor(
    private downloadService: DownloadService,
    private downloadStateService: DownloadStateService,
    private mediaDownloadService: MediaDownloadService,
  ) {}

  private getJobResponse(job: DownloadJob): GetDownloadJobResponse {
    if (job.type !== DownloadType.Video) {
      throw new Error(
        `Expected a video job but got a '${job.type}' job (id: '${job.id}')`,
      )
    }

    return {
      description: job.description,
      downloadUrls: job.downloadUrls,
      error: job.error,
      id: job.id,
      status: job.status,
      timeRange: job.timeRange,
      title: job.title,
      type: job.type,
      url: job.url,
    }
  }

  @Get('/videos/:id')
  getVideoJob(@Param('id') id: string): GetDownloadJobResponse {
    const action = 'getVideoJob'
    const startTime = Date.now()

    this.logger.log(
      { action, jobId: id },
      'GET /videos/:id - Retrieving video job',
    )

    const job = this.downloadStateService.jobs.get(id)

    if (!job) {
      const duration = Date.now() - startTime
      this.logger.warn(
        {
          action,
          jobId: id,
          duration,
          statusCode: HttpStatus.NOT_FOUND,
          totalJobs: this.downloadStateService.jobs.size,
        },
        'Job not found',
      )

      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error: 'Job not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    const sanitizedUrl = job.url.split('?')[0]
    const duration = Date.now() - startTime
    const response = this.getJobResponse(job)

    this.logger.log(
      {
        action,
        jobId: id,
        url: sanitizedUrl,
        status: job.status,
        duration,
        statusCode: HttpStatus.OK,
        hasTitle: !!response.title,
        hasDescription: !!response.description,
        hasDownloadUrls: !!response.downloadUrls?.length,
      },
      'Video job retrieved successfully',
    )

    return response
  }

  @Post('/videos')
  async createVideoJob(
    @Body() input: CreateJobInputDto,
  ): Promise<GetDownloadJobResponse> {
    const action = 'createVideoJob'
    const startTime = Date.now()
    const sanitizedUrl = input.url.split('?')[0]

    this.logger.log(
      {
        action,
        url: sanitizedUrl,
        hasTimeRange: !!input.timeRange,
        timeRange: input.timeRange,
        currentJobs: this.downloadStateService.jobs.size,
        queueSize: this.downloadStateService.queue.size(),
      },
      'POST /videos - Creating new video download job',
    )

    try {
      const job = await this.downloadService.createVideoDownloadJob(input)
      const duration = Date.now() - startTime
      const response = this.getJobResponse(job)

      this.logger.log(
        {
          action,
          jobId: job.id,
          url: sanitizedUrl,
          status: job.status,
          duration,
          statusCode: HttpStatus.CREATED,
          totalJobs: this.downloadStateService.jobs.size,
          queueSize: this.downloadStateService.queue.size(),
        },
        'Video download job created successfully',
      )

      return response
    } catch (err) {
      const duration = Date.now() - startTime
      const error = err instanceof Error ? err.message : String(err)

      this.logger.error(
        {
          action,
          url: sanitizedUrl,
          error,
          duration,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        },
        'Failed to create video download job',
      )

      throw err
    }
  }

  @Patch('/videos/:id/cancel')
  cancelVideoJob(@Param('id') id: string): GetDownloadJobResponse {
    const action = 'cancelVideoJob'
    const startTime = Date.now()

    this.logger.log(
      {
        action,
        jobId: id,
        totalJobs: this.downloadStateService.jobs.size,
        inProgressJobs: this.downloadStateService.inProgressJobs.size,
      },
      'PATCH /videos/:id/cancel - Canceling video job',
    )

    try {
      const job = this.downloadService.cancelVideoDownloadJob(id)
      const duration = Date.now() - startTime
      const sanitizedUrl = job.url.split('?')[0]
      const response = this.getJobResponse(job)

      this.logger.log(
        {
          action,
          jobId: id,
          url: sanitizedUrl,
          oldStatus: job.status === 'cancelling' ? 'in_progress' : job.status, // Status was already updated
          newStatus: job.status,
          duration,
          statusCode: HttpStatus.OK,
          inProgressJobsRemaining:
            this.downloadStateService.inProgressJobs.size,
        },
        'Video job cancellation initiated successfully',
      )

      return response
    } catch (err) {
      const duration = Date.now() - startTime
      const error = err instanceof Error ? err.message : String(err)

      this.logger.warn(
        {
          action,
          jobId: id,
          error,
          duration,
          statusCode: HttpStatus.NOT_FOUND,
          totalJobs: this.downloadStateService.jobs.size,
        },
        'Failed to cancel video job - job not found or not started',
      )

      throw new HttpException(
        {
          status: HttpStatus.NOT_FOUND,
          error: 'Job not found',
        },
        HttpStatus.NOT_FOUND,
        { cause: err },
      )
    }
  }

  private getMovieJobResponse(job: MovieDownloadJob): GetMovieJobResponse {
    return {
      description: job.description,
      error: job.error,
      id: job.id,
      mediaTitle: job.mediaTitle,
      posterUrl: job.posterUrl,
      queueSnapshot: job.queueSnapshot,
      radarrId: job.radarrId,
      status: job.status,
      title: job.title,
      type: job.type,
    }
  }

  private getShowJobResponse(job: ShowDownloadJob): GetShowJobResponse {
    return {
      description: job.description,
      error: job.error,
      id: job.id,
      mediaTitle: job.mediaTitle,
      posterUrl: job.posterUrl,
      queueSnapshot: job.queueSnapshot,
      sonarrId: job.sonarrId,
      status: job.status,
      title: job.title,
      type: job.type,
    }
  }

  @Get('/movies/search')
  async searchMovies(
    @Query() query: MediaSearchQueryDto,
  ): Promise<SearchMoviesResponse> {
    const action = 'searchMovies'

    this.logger.log(
      { action, query: query.query },
      'GET /movies/search - Searching Radarr',
    )

    const results = await this.mediaDownloadService.searchMovies(query.query)

    this.logger.log(
      { action, query: query.query, resultCount: results.length },
      'Movie search completed',
    )

    return { results }
  }

  @Post('/movies')
  async requestMovie(
    @Body() input: RequestMovieInputDto,
  ): Promise<GetMovieJobResponse> {
    const action = 'requestMovie'

    this.logger.log(
      { action, tmdbId: input.tmdbId },
      'POST /movies - Requesting movie download',
    )

    const job = await this.mediaDownloadService.requestMovie(input.tmdbId)

    this.logger.log(
      { action, jobId: job.id, tmdbId: input.tmdbId, status: job.status },
      'Movie download requested',
    )

    return this.getMovieJobResponse(job)
  }

  @Get('/movies/:id')
  getMovieJob(@Param('id') id: string): GetMovieJobResponse {
    const action = 'getMovieJob'

    this.logger.log({ action, jobId: id }, 'GET /movies/:id - Retrieving job')

    try {
      const job = this.mediaDownloadService.getMovieJob(id)
      return this.getMovieJobResponse(job)
    } catch (err) {
      this.logger.warn(
        { action, jobId: id, error: err instanceof Error ? err.message : err },
        'Movie job not found',
      )

      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Job not found' },
        HttpStatus.NOT_FOUND,
        { cause: err },
      )
    }
  }

  @Delete('/movies/:id')
  async deleteMovieJob(@Param('id') id: string): Promise<GetMovieJobResponse> {
    const action = 'deleteMovieJob'

    this.logger.log(
      { action, jobId: id },
      'DELETE /movies/:id - Unmonitoring and deleting movie',
    )

    try {
      const job = await this.mediaDownloadService.deleteMovieJob(id)
      return this.getMovieJobResponse(job)
    } catch (err) {
      this.logger.warn(
        { action, jobId: id, error: err instanceof Error ? err.message : err },
        'Failed to delete movie job',
      )

      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Job not found' },
        HttpStatus.NOT_FOUND,
        { cause: err },
      )
    }
  }

  @Get('/shows/search')
  async searchShows(
    @Query() query: MediaSearchQueryDto,
  ): Promise<SearchShowsResponse> {
    const action = 'searchShows'

    this.logger.log(
      { action, query: query.query },
      'GET /shows/search - Searching Sonarr',
    )

    const results = await this.mediaDownloadService.searchShows(query.query)

    this.logger.log(
      { action, query: query.query, resultCount: results.length },
      'Show search completed',
    )

    return { results }
  }

  @Post('/shows')
  async requestShow(
    @Body() input: RequestShowInputDto,
  ): Promise<GetShowJobResponse> {
    const action = 'requestShow'

    this.logger.log(
      { action, tvdbId: input.tvdbId },
      'POST /shows - Requesting show download',
    )

    const job = await this.mediaDownloadService.requestShow(input.tvdbId)

    this.logger.log(
      { action, jobId: job.id, tvdbId: input.tvdbId, status: job.status },
      'Show download requested',
    )

    return this.getShowJobResponse(job)
  }

  @Get('/shows/:id')
  getShowJob(@Param('id') id: string): GetShowJobResponse {
    const action = 'getShowJob'

    this.logger.log({ action, jobId: id }, 'GET /shows/:id - Retrieving job')

    try {
      const job = this.mediaDownloadService.getShowJob(id)
      return this.getShowJobResponse(job)
    } catch (err) {
      this.logger.warn(
        { action, jobId: id, error: err instanceof Error ? err.message : err },
        'Show job not found',
      )

      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Job not found' },
        HttpStatus.NOT_FOUND,
        { cause: err },
      )
    }
  }

  @Delete('/shows/:id')
  async deleteShowJob(@Param('id') id: string): Promise<GetShowJobResponse> {
    const action = 'deleteShowJob'

    this.logger.log(
      { action, jobId: id },
      'DELETE /shows/:id - Unmonitoring and deleting series',
    )

    try {
      const job = await this.mediaDownloadService.deleteShowJob(id)
      return this.getShowJobResponse(job)
    } catch (err) {
      this.logger.warn(
        { action, jobId: id, error: err instanceof Error ? err.message : err },
        'Failed to delete show job',
      )

      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Job not found' },
        HttpStatus.NOT_FOUND,
        { cause: err },
      )
    }
  }
}
