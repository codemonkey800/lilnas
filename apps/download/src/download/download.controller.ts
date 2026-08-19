import {
  ActivityQuerySchema,
  CreateDownloadJobInputSchema,
  DiscoverQuerySchema,
  GalleryFacetsQuerySchema,
  GalleryQuerySchema,
  HistoryQuerySchema,
  MediaSearchQuerySchema,
  RequestMovieInputSchema,
  RequestShowInputSchema,
} from '@lilnas/utils/download/schema'
import type {
  DiscoveryPage,
  DownloadGalleryFacets,
  DownloadJobListItem,
  DownloadPage,
  DownloadType,
  GetDownloadJobResponse,
  GetMovieJobResponse,
  GetShowJobResponse,
  SearchMoviesResponse,
  SearchShowsResponse,
} from '@lilnas/utils/download/types'
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { createZodDto, ZodValidationPipe } from 'nestjs-zod'

import { AdminCheckService } from 'src/auth/admin-check.service'
import { CurrentUser } from 'src/auth/current-user.decorator'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { ForwardedUserGuard } from 'src/auth/forwarded-user.guard'
import { OptionalCurrentUser } from 'src/auth/optional-current-user.decorator'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'

import { DownloadService } from './download.service'
import { DownloadStateService } from './download-state.service'
import { JobQueryService } from './job-query.service'
import {
  getJobResponse,
  getMovieJobResponse,
  getShowJobResponse,
} from './job-serializers'

class ActivityQueryDto extends createZodDto(ActivityQuerySchema) {}
class CreateJobInputDto extends createZodDto(CreateDownloadJobInputSchema) {}
class DiscoverQueryDto extends createZodDto(DiscoverQuerySchema) {}
class GalleryFacetsQueryDto extends createZodDto(GalleryFacetsQuerySchema) {}
class GalleryQueryDto extends createZodDto(GalleryQuerySchema) {}
class HistoryQueryDto extends createZodDto(HistoryQuerySchema) {}
class MediaSearchQueryDto extends createZodDto(MediaSearchQuerySchema) {}
class RequestMovieInputDto extends createZodDto(RequestMovieInputSchema) {}
class RequestShowInputDto extends createZodDto(RequestShowInputSchema) {}

@Controller('/download')
export class DownloadController {
  private logger = new Logger(DownloadController.name)

  constructor(
    private adminCheckService: AdminCheckService,
    private discoveryService: DiscoveryService,
    private downloadService: DownloadService,
    private downloadStateService: DownloadStateService,
    private jobQueryService: JobQueryService,
    private mediaDownloadService: MediaDownloadService,
  ) {}

  // No forwarded identity (e.g. apps/tdr-bot's DownloadClient.dockerInstance
  // calls) resolves to isAdmin: false without a network round trip -
  // AdminCheckService.checkIsAdmin() only ever needs to run for a real
  // email.
  private async resolveIsAdmin(user: ForwardedUser | undefined) {
    return user ? this.adminCheckService.checkIsAdmin(user.email) : false
  }

  // No guard: the container is reachable ungated on the shared Docker
  // network regardless of any guard here (see forwarded-user.ts's
  // ForwardedUser comment) - public-but-attribution-masked is the spec'd
  // behaviour, and a guard would only add a false sense of restriction.
  @Get('/activity')
  async getActivity(
    @Query(new ZodValidationPipe(ActivityQueryDto)) query: ActivityQueryDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadPage<DownloadJobListItem>> {
    const action = 'getActivity'
    const startTime = Date.now()

    // The DB read inside listActivity() is synchronous (better-sqlite3) -
    // nothing to Promise.all() against, unlike the movie/show handlers
    // below which do have a second async call to race.
    const isAdmin = await this.resolveIsAdmin(user)
    const page = this.jobQueryService.listActivity({
      cursor: query.cursor,
      isAdmin,
      limit: query.limit,
      types: query.type as DownloadType[] | undefined,
    })

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        resultCount: page.items.length,
        statusCode: HttpStatus.OK,
        total: page.total,
      },
      'GET /activity - listed in-progress jobs',
    )

    return page
  }

  @Get('/gallery')
  async getGallery(
    @Query(new ZodValidationPipe(GalleryQueryDto)) query: GalleryQueryDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadPage<DownloadJobListItem>> {
    const action = 'getGallery'
    const startTime = Date.now()

    const isAdmin = await this.resolveIsAdmin(user)
    // excludeHiddenVideos (the attribution-oracle guard for a
    // requester-scoped lookup) is computed inside JobQueryService.listGallery
    // itself from `requesterEmail`/`isAdmin`, not here - keeping it there
    // means it can never be forgotten by a future caller of that method.
    const page = this.jobQueryService.listGallery({
      createdFrom: query.from,
      createdTo: query.to,
      cursor: query.cursor,
      isAdmin,
      limit: query.limit,
      requesterEmail: query.requester,
      types: query.type as DownloadType[] | undefined,
    })

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        resultCount: page.items.length,
        total: page.total,
        statusCode: HttpStatus.OK,
      },
      'GET /gallery - listed completed jobs',
    )

    return page
  }

  @Get('/gallery/facets')
  async getGalleryFacets(
    @Query(new ZodValidationPipe(GalleryFacetsQueryDto))
    query: GalleryFacetsQueryDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadGalleryFacets> {
    const action = 'getGalleryFacets'
    const startTime = Date.now()

    const isAdmin = await this.resolveIsAdmin(user)
    const facets = this.jobQueryService.getGalleryFacets({
      createdFrom: query.from,
      createdTo: query.to,
      isAdmin,
    })

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        statusCode: HttpStatus.OK,
        typeCount: facets.types.length,
        uploaderCount: facets.uploaders.length,
      },
      'GET /gallery/facets - listed gallery facets',
    )

    return facets
  }

  // No identity param, unlike every route above - discovery touches no
  // attribution and no DB at all, consistent with the existing
  // /movies/search, /shows/search endpoints. An unused param would trip
  // noUnusedParameters.
  @Get('/discover')
  async discover(
    @Query(new ZodValidationPipe(DiscoverQueryDto)) query: DiscoverQueryDto,
  ): Promise<DiscoveryPage> {
    const action = 'discover'
    const startTime = Date.now()

    const page = await this.discoveryService.search({
      cursor: query.cursor,
      genres: query.genre,
      limit: query.limit,
      query: query.query,
      sort: query.sort,
      yearFrom: query.yearFrom,
      yearTo: query.yearTo,
    })

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        degradedSources: page.degradedSources,
        duration,
        query: query.query,
        resultCount: page.items.length,
        statusCode: HttpStatus.OK,
        total: page.total,
      },
      'GET /discover - listed discovery results',
    )

    return page
  }

  // ForwardedUserGuard (not @OptionalCurrentUser()) - a service caller with
  // no forwarded identity has no "own history" to default to, so 401 is the
  // honest answer here, unlike activity/gallery above.
  @Get('/history')
  @UseGuards(ForwardedUserGuard)
  async getHistory(
    @Query(new ZodValidationPipe(HistoryQueryDto)) query: HistoryQueryDto,
    @CurrentUser() user: ForwardedUser,
  ): Promise<DownloadPage<DownloadJobListItem>> {
    const action = 'getHistory'
    const startTime = Date.now()

    const isSelfScope =
      !query.requester ||
      query.requester.toLowerCase() === user.email.toLowerCase()

    // Resolved unconditionally (not only for the other-user branch) -
    // masking applies the same way regardless of scope, so isAdmin is
    // needed either way.
    const isAdmin = await this.resolveIsAdmin(user)

    if (!isSelfScope && !isAdmin) {
      this.logger.warn(
        {
          action,
          requestedRequester: query.requester,
          statusCode: HttpStatus.FORBIDDEN,
          viewer: user.email,
        },
        "GET /history - non-admin attempted to view another user's history",
      )

      throw new ForbiddenException(
        "Only admins may view another user's download history",
      )
    }

    const requesterEmail = isSelfScope
      ? user.email
      : (query.requester as string)

    const page = this.jobQueryService.listHistory({
      cursor: query.cursor,
      isAdmin,
      limit: query.limit,
      requesterEmail,
    })

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        resultCount: page.items.length,
        scopedTo: requesterEmail,
        statusCode: HttpStatus.OK,
        total: page.total,
      },
      'GET /history - listed download history',
    )

    return page
  }

  @Get('/videos/:id')
  async getVideoJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetDownloadJobResponse> {
    const action = 'getVideoJob'
    const startTime = Date.now()

    this.logger.log(
      { action, jobId: id },
      'GET /videos/:id - Retrieving video job',
    )

    // Falls back to the durable `jobs` row when the in-memory Map has no
    // entry (e.g. after a restart) - see resolveJob()'s own comment.
    const job = this.downloadStateService.resolveJob(id)

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

    const isAdmin = await this.resolveIsAdmin(user)
    const sanitizedUrl = job.url.split('?')[0]
    const duration = Date.now() - startTime
    const response = getJobResponse(job, isAdmin)

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
    @OptionalCurrentUser() user: ForwardedUser | undefined,
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
        hasRequester: !!user,
        currentJobs: this.downloadStateService.jobs.size,
        queueSize: this.downloadStateService.queue.size(),
      },
      'POST /videos - Creating new video download job',
    )

    try {
      const [job, isAdmin] = await Promise.all([
        this.downloadService.createVideoDownloadJob(input, user),
        this.resolveIsAdmin(user),
      ])
      const duration = Date.now() - startTime
      const response = getJobResponse(job, isAdmin)

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
  async cancelVideoJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetDownloadJobResponse> {
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
      const [job, isAdmin] = await Promise.all([
        Promise.resolve(this.downloadService.cancelVideoDownloadJob(id)),
        this.resolveIsAdmin(user),
      ])
      const duration = Date.now() - startTime
      const sanitizedUrl = job.url.split('?')[0]
      const response = getJobResponse(job, isAdmin)

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
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetMovieJobResponse> {
    const action = 'requestMovie'

    this.logger.log(
      { action, tmdbId: input.tmdbId, hasRequester: !!user },
      'POST /movies - Requesting movie download',
    )

    const [job, isAdmin] = await Promise.all([
      this.mediaDownloadService.requestMovie(input.tmdbId, user),
      this.resolveIsAdmin(user),
    ])

    this.logger.log(
      { action, jobId: job.id, tmdbId: input.tmdbId, status: job.status },
      'Movie download requested',
    )

    return getMovieJobResponse(job, isAdmin)
  }

  @Get('/movies/:id')
  async getMovieJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetMovieJobResponse> {
    const action = 'getMovieJob'

    this.logger.log({ action, jobId: id }, 'GET /movies/:id - Retrieving job')

    try {
      const [job, isAdmin] = await Promise.all([
        Promise.resolve(this.mediaDownloadService.getMovieJob(id)),
        this.resolveIsAdmin(user),
      ])
      return getMovieJobResponse(job, isAdmin)
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
  async deleteMovieJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetMovieJobResponse> {
    const action = 'deleteMovieJob'

    this.logger.log(
      { action, jobId: id },
      'DELETE /movies/:id - Unmonitoring and deleting movie',
    )

    try {
      const [job, isAdmin] = await Promise.all([
        this.mediaDownloadService.deleteMovieJob(id),
        this.resolveIsAdmin(user),
      ])
      return getMovieJobResponse(job, isAdmin)
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
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetShowJobResponse> {
    const action = 'requestShow'

    this.logger.log(
      { action, tvdbId: input.tvdbId, hasRequester: !!user },
      'POST /shows - Requesting show download',
    )

    const [job, isAdmin] = await Promise.all([
      this.mediaDownloadService.requestShow(input.tvdbId, user),
      this.resolveIsAdmin(user),
    ])

    this.logger.log(
      { action, jobId: job.id, tvdbId: input.tvdbId, status: job.status },
      'Show download requested',
    )

    return getShowJobResponse(job, isAdmin)
  }

  @Get('/shows/:id')
  async getShowJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetShowJobResponse> {
    const action = 'getShowJob'

    this.logger.log({ action, jobId: id }, 'GET /shows/:id - Retrieving job')

    try {
      const [job, isAdmin] = await Promise.all([
        Promise.resolve(this.mediaDownloadService.getShowJob(id)),
        this.resolveIsAdmin(user),
      ])
      return getShowJobResponse(job, isAdmin)
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
  async deleteShowJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<GetShowJobResponse> {
    const action = 'deleteShowJob'

    this.logger.log(
      { action, jobId: id },
      'DELETE /shows/:id - Unmonitoring and deleting series',
    )

    try {
      const [job, isAdmin] = await Promise.all([
        this.mediaDownloadService.deleteShowJob(id),
        this.resolveIsAdmin(user),
      ])
      return getShowJobResponse(job, isAdmin)
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
