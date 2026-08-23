import {
  ActivityQuerySchema,
  CreateDownloadJobInputSchema,
  DiscoverQuerySchema,
  FlagBadFileInputSchema,
  GalleryFacetsQuerySchema,
  GalleryQuerySchema,
  GrabReleaseInputSchema,
  HistoryQuerySchema,
  ListReleasesQuerySchema,
  MediaSearchQuerySchema,
  ReplaceReleaseInputSchema,
  RequestMovieInputSchema,
  RequestShowInputSchema,
} from '@lilnas/utils/download/schema'
import type {
  DiscoveryPage,
  DownloadGalleryFacets,
  DownloadJob,
  DownloadPage,
  DownloadType,
  FlagBadFileResponse,
  GalleryItem,
  ListBadFilesResponse,
  ListReleasesResponse,
  MediaDetailResponse,
  SearchMediaResponse,
} from '@lilnas/utils/download/types'
import { DownloadType as DownloadTypeEnum } from '@lilnas/utils/download/types'
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
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
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'

import { projectJobForViewer } from './attribution'
import { DownloadService } from './download.service'
import { DownloadStateService } from './download-state.service'
import { JobQueryService } from './job-query.service'

class ActivityQueryDto extends createZodDto(ActivityQuerySchema) {}
class CreateJobInputDto extends createZodDto(CreateDownloadJobInputSchema) {}
class DiscoverQueryDto extends createZodDto(DiscoverQuerySchema) {}
class FlagBadFileInputDto extends createZodDto(FlagBadFileInputSchema) {}
class GalleryFacetsQueryDto extends createZodDto(GalleryFacetsQuerySchema) {}
class GalleryQueryDto extends createZodDto(GalleryQuerySchema) {}
class GrabReleaseInputDto extends createZodDto(GrabReleaseInputSchema) {}
class HistoryQueryDto extends createZodDto(HistoryQuerySchema) {}
class ListReleasesQueryDto extends createZodDto(ListReleasesQuerySchema) {}
class MediaSearchQueryDto extends createZodDto(MediaSearchQuerySchema) {}
class ReplaceReleaseInputDto extends createZodDto(ReplaceReleaseInputSchema) {}
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
    private mediaResolverService: MediaResolverService,
    private releaseService: ReleaseService,
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
  ): Promise<DownloadPage<DownloadJob>> {
    const action = 'getActivity'
    const startTime = Date.now()

    const isAdmin = await this.resolveIsAdmin(user)
    const page = await this.jobQueryService.listActivity({
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

    return projectPage(page, isAdmin)
  }

  @Get('/gallery')
  async getGallery(
    @Query(new ZodValidationPipe(GalleryQueryDto)) query: GalleryQueryDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadPage<GalleryItem>> {
    const action = 'getGallery'
    const startTime = Date.now()

    const isAdmin = await this.resolveIsAdmin(user)
    // excludeHiddenVideos (the attribution-oracle guard for a
    // requester-scoped lookup) is computed inside JobQueryService.listGallery
    // itself from `requesterEmail`/`isAdmin`, not here - keeping it there
    // means it can never be forgotten by a future caller of that method.
    const page = await this.jobQueryService.listGallery({
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
      'GET /gallery - listed downloaded titles',
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
  ): Promise<DownloadPage<DownloadJob>> {
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

    const page = await this.jobQueryService.listHistory({
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

    return projectPage(page, isAdmin)
  }

  /**
   * The library view: a title's metadata plus every job that ever fetched
   * it. `jobs: []` **is** the "not downloaded yet" state - a movie has a
   * detail page whether or not anyone has requested it, which is what makes
   * "selecting any movie/show surface opens that title's detail page"
   * (spec §Navigation) possible at all. Job-keyed routes stay job-keyed;
   * this is the media-keyed one.
   */
  @Get('/media/:id')
  async getMediaDetail(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<MediaDetailResponse> {
    const action = 'getMediaDetail'

    // A video can't exist before it's downloaded (spec §8 reaches its
    // detail page from the nav bar with the download already under way), so
    // an unknown `video:` key is a genuine 404 rather than a metadata
    // lookup - unlike a tmdb/tvdb key, which always resolves.
    if (
      id.startsWith(`${DownloadTypeEnum.Video}:`) &&
      !this.downloadStateService.getVideo(id)
    ) {
      this.logger.warn(
        { action, mediaId: id, statusCode: HttpStatus.NOT_FOUND },
        'GET /media/:id - unknown video key',
      )

      throw new NotFoundException('Media not found')
    }

    const type = mediaTypeFromKey(id)
    if (!type) {
      throw new NotFoundException('Media not found')
    }

    const [isAdmin, { media }] = await Promise.all([
      this.resolveIsAdmin(user),
      this.mediaResolverService.resolve([{ mediaId: id, type }]),
    ])

    const resolved = media.get(id)
    if (!resolved) {
      throw new NotFoundException('Media not found')
    }

    const jobs = await this.jobQueryService.listJobsForMedia(id)

    this.logger.log(
      {
        action,
        mediaId: id,
        jobCount: jobs.length,
        statusCode: HttpStatus.OK,
        type,
      },
      'GET /media/:id - resolved media detail',
    )

    return {
      jobs: jobs.map(job => projectJobForViewer(job, isAdmin)),
      media: resolved,
    }
  }

  /**
   * The interactive-search results for a title, annotated with this app's own
   * `flaggedBad`. Keyed on **media** id rather than job id: releases belong
   * to a title, not to a download event, and the primary use case is browsing
   * them for something nobody has requested yet.
   *
   * No identity param, like `/discover` - a release list carries no
   * attribution to mask.
   *
   * Note this route can *write* upstream despite being a GET: Radarr/Sonarr
   * won't surface releases for an unmonitored title, so it borrows monitoring
   * and puts it back (see `ReleaseService.withMonitoring`).
   */
  @Get('/media/:id/releases')
  async listReleases(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListReleasesQueryDto))
    query: ListReleasesQueryDto,
  ): Promise<ListReleasesResponse> {
    const action = 'listReleases'
    const startTime = Date.now()

    const releases = await this.releaseService.listReleases(id, {
      episodeId: query.episodeId,
      seasonNumber: query.seasonNumber,
    })

    this.logger.log(
      {
        action,
        duration: Date.now() - startTime,
        flaggedCount: releases.filter(r => r.flaggedBad).length,
        mediaId: id,
        resultCount: releases.length,
        statusCode: HttpStatus.OK,
      },
      'GET /media/:id/releases - listed indexer releases',
    )

    return { releases }
  }

  // @OptionalCurrentUser() rather than a guard, matching POST /movies: a
  // service caller with no forwarded identity can still grab, it just lands
  // an unattributed job.
  @Post('/media/:id/releases/grab')
  async grabRelease(
    @Param('id') id: string,
    @Body() input: GrabReleaseInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.releaseActionRoute({
      action: 'grabRelease',
      id,
      run: () => this.releaseService.grabRelease(id, input, user),
      user,
    })
  }

  /**
   * Delete what's on disk, then grab the chosen release - one action, so the
   * user can't be left with a deleted file and no replacement.
   */
  @Post('/media/:id/releases/replace')
  async replaceRelease(
    @Param('id') id: string,
    @Body() input: ReplaceReleaseInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.releaseActionRoute({
      action: 'replaceRelease',
      id,
      run: () => this.releaseService.replaceRelease(id, input, user),
      user,
    })
  }

  // ForwardedUserGuard (not @OptionalCurrentUser()) - a flag records a
  // judgement *someone* made, and an anonymous one would be unattributable.
  // The only Phase 3 route that requires identity.
  @Post('/media/:id/bad-files')
  @UseGuards(ForwardedUserGuard)
  flagBadFile(
    @Param('id') id: string,
    @Body() input: FlagBadFileInputDto,
    @CurrentUser() user: ForwardedUser,
  ): FlagBadFileResponse {
    const badFile = this.releaseService.flagBadFile(id, input, user)

    this.logger.log(
      {
        action: 'flagBadFile',
        flaggedBy: user.email,
        guid: input.guid,
        mediaId: id,
        statusCode: HttpStatus.CREATED,
      },
      'POST /media/:id/bad-files - flagged a release as bad',
    )

    return { badFile }
  }

  // Admin-agnostic and unmasked: a flag is a statement about a *release*,
  // not about a download, so the attribution-oracle rules that govern
  // job listings don't apply to it.
  @Get('/media/:id/bad-files')
  listBadFiles(@Param('id') id: string): ListBadFilesResponse {
    const badFiles = this.releaseService.listBadFiles(id)

    this.logger.log(
      {
        action: 'listBadFiles',
        mediaId: id,
        resultCount: badFiles.length,
        statusCode: HttpStatus.OK,
      },
      'GET /media/:id/bad-files - listed flagged releases',
    )

    return { badFiles }
  }

  @Get('/videos/:id')
  async getVideoJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    const action = 'getVideoJob'
    const startTime = Date.now()

    this.logger.log(
      { action, jobId: id },
      'GET /videos/:id - Retrieving video job',
    )

    // Falls back to the durable `jobs` row when the in-memory Map has no
    // entry (e.g. after a restart) - see resolveJob()'s own comment.
    const [job, isAdmin] = await Promise.all([
      this.downloadStateService.resolveJob(id),
      this.resolveIsAdmin(user),
    ])

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

    this.logger.log(
      {
        action,
        jobId: id,
        mediaId: job.media.id,
        status: job.status,
        duration: Date.now() - startTime,
        statusCode: HttpStatus.OK,
      },
      'Video job retrieved successfully',
    )

    return projectJobForViewer(job, isAdmin)
  }

  @Post('/videos')
  async createVideoJob(
    @Body() input: CreateJobInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
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

      this.logger.log(
        {
          action,
          jobId: job.id,
          url: sanitizedUrl,
          status: job.status,
          duration: Date.now() - startTime,
          statusCode: HttpStatus.CREATED,
          totalJobs: this.downloadStateService.jobs.size,
          queueSize: this.downloadStateService.queue.size(),
        },
        'Video download job created successfully',
      )

      return projectJobForViewer(job, isAdmin)
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
  ): Promise<DownloadJob> {
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
        this.downloadService.cancelVideoDownloadJob(id),
        this.resolveIsAdmin(user),
      ])

      this.logger.log(
        {
          action,
          jobId: id,
          mediaId: job.media.id,
          newStatus: job.status,
          duration: Date.now() - startTime,
          statusCode: HttpStatus.OK,
          inProgressJobsRemaining:
            this.downloadStateService.inProgressJobs.size,
        },
        'Video job cancellation initiated successfully',
      )

      return projectJobForViewer(job, isAdmin)
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
  ): Promise<SearchMediaResponse> {
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
  ): Promise<DownloadJob> {
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

    return projectJobForViewer(job, isAdmin)
  }

  @Get('/movies/:id')
  async getMovieJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.mediaJobRoute({
      action: 'getMovieJob',
      id,
      notFoundMessage: 'Movie job not found',
      run: () => this.mediaDownloadService.getMovieJob(id),
      user,
    })
  }

  @Delete('/movies/:id')
  async deleteMovieJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.mediaJobRoute({
      action: 'deleteMovieJob',
      id,
      notFoundMessage: 'Failed to delete movie job',
      run: () => this.mediaDownloadService.deleteMovieJob(id),
      user,
    })
  }

  @Get('/shows/search')
  async searchShows(
    @Query() query: MediaSearchQueryDto,
  ): Promise<SearchMediaResponse> {
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
  ): Promise<DownloadJob> {
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

    return projectJobForViewer(job, isAdmin)
  }

  @Get('/shows/:id')
  async getShowJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.mediaJobRoute({
      action: 'getShowJob',
      id,
      notFoundMessage: 'Show job not found',
      run: () => this.mediaDownloadService.getShowJob(id),
      user,
    })
  }

  @Delete('/shows/:id')
  async deleteShowJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.mediaJobRoute({
      action: 'deleteShowJob',
      id,
      notFoundMessage: 'Failed to delete show job',
      run: () => this.mediaDownloadService.deleteShowJob(id),
      user,
    })
  }

  /**
   * The grab and replace routes, which differ only in which service method
   * they call.
   *
   * Deliberately **not** `mediaJobRoute()`: that helper turns every failure
   * into a 404, which is the right answer for "fetch this job by id" and the
   * wrong one here. A flagged guid must surface as the 409 `ReleaseService`
   * raised, and an upstream failure is already recorded on the returned job
   * rather than thrown - so anything that does escape is a real error and is
   * left to Nest's exception filter to map honestly.
   */
  private async releaseActionRoute({
    action,
    id,
    run,
    user,
  }: {
    action: string
    id: string
    run: () => Promise<DownloadJob>
    user: ForwardedUser | undefined
  }): Promise<DownloadJob> {
    const startTime = Date.now()

    const [job, isAdmin] = await Promise.all([run(), this.resolveIsAdmin(user)])

    this.logger.log(
      {
        action,
        duration: Date.now() - startTime,
        jobId: job.id,
        mediaId: id,
        status: job.status,
        statusCode: HttpStatus.CREATED,
      },
      `POST /media/:id/releases - ${action} accepted`,
    )

    return projectJobForViewer(job, isAdmin)
  }

  /**
   * The four movie/show job routes were byte-identical apart from their
   * `action` string and which service method they called - now that all
   * four return the same `DownloadJob`, that duplication has nothing left
   * to justify it.
   */
  private async mediaJobRoute({
    action,
    id,
    notFoundMessage,
    run,
    user,
  }: {
    action: string
    id: string
    notFoundMessage: string
    run: () => Promise<DownloadJob>
    user: ForwardedUser | undefined
  }): Promise<DownloadJob> {
    this.logger.log({ action, jobId: id }, `${action} - Retrieving job`)

    try {
      const [job, isAdmin] = await Promise.all([
        run(),
        this.resolveIsAdmin(user),
      ])

      return projectJobForViewer(job, isAdmin)
    } catch (err) {
      this.logger.warn(
        { action, jobId: id, error: err instanceof Error ? err.message : err },
        notFoundMessage,
      )

      throw new HttpException(
        { status: HttpStatus.NOT_FOUND, error: 'Job not found' },
        HttpStatus.NOT_FOUND,
        { cause: err },
      )
    }
  }
}

/**
 * The media type a derived key names, or `undefined` for an unrecognized
 * prefix. The inverse of `mediaId()`'s prefix choice (`db/media-id.ts`) -
 * the only place a raw path param becomes a type, and the reason a garbage
 * `:id` 404s rather than reaching Radarr.
 */
function mediaTypeFromKey(key: string): DownloadType | undefined {
  if (key.startsWith('tmdb:')) return DownloadTypeEnum.Movie
  if (key.startsWith('tvdb:')) return DownloadTypeEnum.Show
  if (key.startsWith('video:')) return DownloadTypeEnum.Video
  return undefined
}

/** Applies the attribution mask across a whole page of jobs. */
function projectPage(
  page: DownloadPage<DownloadJob>,
  isAdmin: boolean,
): DownloadPage<DownloadJob> {
  return {
    ...page,
    items: page.items.map(job => projectJobForViewer(job, isAdmin)),
  }
}
