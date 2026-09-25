import {
  ActivityQuerySchema,
  CreateDownloadJobInputSchema,
  DeleteMediaFilesQuerySchema,
  DiscardImportQuerySchema,
  DiscoverQuerySchema,
  FlagBadFileInputSchema,
  GalleryFacetsQuerySchema,
  GalleryQuerySchema,
  GetMediaFileQuerySchema,
  GrabReleaseInputSchema,
  HistoryQuerySchema,
  ImportFilesInputSchema,
  ListImportCandidatesQuerySchema,
  ListReleasesQuerySchema,
  MediaSearchQuerySchema,
  ProfileQuerySchema,
  ReplaceReleaseInputSchema,
  RequestMovieInputSchema,
  RequestShowInputSchema,
} from '@lilnas/utils/download/schema'
import type {
  AuditAction,
  DeleteMediaFilesResponse,
  DiscardImportResponse,
  DiscordRequester,
  DiscoveryPage,
  DownloadGalleryFacets,
  DownloadJob,
  DownloadPage,
  DownloadType,
  FlagBadFileResponse,
  GalleryItem,
  ImportFilesResponse,
  ListBadFilesResponse,
  ListImportCandidatesResponse,
  ListReleasesResponse,
  ListSeasonsResponse,
  Media,
  MediaDetailResponse,
  ProfileResponse,
  SearchMediaResponse,
  UnflagBadFileResponse,
} from '@lilnas/utils/download/types'
import {
  DownloadType as DownloadTypeEnum,
  isMovie,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import contentDisposition from 'content-disposition'
import type { Response } from 'express'
import { createZodDto, ZodValidationPipe } from 'nestjs-zod'

import { AuditLogService } from 'src/audit/audit-log.service'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { AttributionResolutionService } from 'src/auth/attribution-resolution.service'
import { CurrentUser } from 'src/auth/current-user.decorator'
import { DiscordLinkService } from 'src/auth/discord-link.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { ForwardedUserGuard } from 'src/auth/forwarded-user.guard'
import { OptionalCurrentUser } from 'src/auth/optional-current-user.decorator'
import {
  OptionalDiscordDisplayName,
  OptionalDiscordUser,
} from 'src/auth/optional-discord-user.decorator'
import { mediaTypeFromKey } from 'src/db/media-id'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { ManualImportService } from 'src/media/manual-import.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import {
  MediaFileService,
  type MediaFileSource,
} from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

import { projectJobForViewer } from './attribution'
import { DownloadService } from './download.service'
import { DownloadMetricsService } from './download-metrics.service'
import { DownloadStateService } from './download-state.service'
import { JobQueryService } from './job-query.service'
import { ProfileService } from './profile.service'

class ActivityQueryDto extends createZodDto(ActivityQuerySchema) {}
class CreateJobInputDto extends createZodDto(CreateDownloadJobInputSchema) {}
class DeleteMediaFilesQueryDto extends createZodDto(
  DeleteMediaFilesQuerySchema,
) {}
class DiscardImportQueryDto extends createZodDto(DiscardImportQuerySchema) {}
class DiscoverQueryDto extends createZodDto(DiscoverQuerySchema) {}
class FlagBadFileInputDto extends createZodDto(FlagBadFileInputSchema) {}
class GalleryFacetsQueryDto extends createZodDto(GalleryFacetsQuerySchema) {}
class GalleryQueryDto extends createZodDto(GalleryQuerySchema) {}
class GetMediaFileQueryDto extends createZodDto(GetMediaFileQuerySchema) {}
class GrabReleaseInputDto extends createZodDto(GrabReleaseInputSchema) {}
class HistoryQueryDto extends createZodDto(HistoryQuerySchema) {}
class ImportFilesInputDto extends createZodDto(ImportFilesInputSchema) {}
class ListImportCandidatesQueryDto extends createZodDto(
  ListImportCandidatesQuerySchema,
) {}
class ListReleasesQueryDto extends createZodDto(ListReleasesQuerySchema) {}
class MediaSearchQueryDto extends createZodDto(MediaSearchQuerySchema) {}
class ProfileQueryDto extends createZodDto(ProfileQuerySchema) {}
class ReplaceReleaseInputDto extends createZodDto(ReplaceReleaseInputSchema) {}
class RequestMovieInputDto extends createZodDto(RequestMovieInputSchema) {}
class RequestShowInputDto extends createZodDto(RequestShowInputSchema) {}

/**
 * What one of the three shared route helpers below should append to the
 * audit log once its `run()` has resolved - i.e. once the action it
 * describes has actually happened.
 *
 * Deliberately *not* a full `AuditEvent`:
 *
 * - `actor` is the helper's own `user` parameter, so restating it per call
 *   site would only create a way for the audited actor and the attributed
 *   one to disagree.
 * - `target` is the helper's own `id` parameter - a job id for
 *   `videoInterruptRoute()`/`mediaJobRoute()`, a media key for
 *   `releaseActionRoute()` - and each helper knows which of the two its id
 *   space is, so it supplies the `type` itself.
 * - `metadata` is a function of the resolved job rather than a literal,
 *   because the only metadata any of these routes carries (grab/replace's
 *   `jobId`) does not exist until `run()` has resolved.
 */
interface RouteAuditEvent {
  action: AuditAction
  metadata?: (job: DownloadJob) => Record<string, unknown>
}

@Controller('/download')
export class DownloadController {
  private logger = new Logger(DownloadController.name)

  constructor(
    private adminCheckService: AdminCheckService,
    private attributionResolutionService: AttributionResolutionService,
    private auditLogService: AuditLogService,
    private currentReleaseService: CurrentReleaseService,
    private discordLinkService: DiscordLinkService,
    private discoveryService: DiscoveryService,
    private downloadMetricsService: DownloadMetricsService,
    private downloadService: DownloadService,
    private downloadStateService: DownloadStateService,
    private jobQueryService: JobQueryService,
    private manualImportService: ManualImportService,
    private mediaDownloadService: MediaDownloadService,
    private mediaFileService: MediaFileService,
    private mediaResolverService: MediaResolverService,
    private profileService: ProfileService,
    private releaseService: ReleaseService,
    private showService: ShowService,
  ) {}

  // No forwarded identity (e.g. apps/tdr-bot's DownloadClient.dockerInstance
  // calls) resolves to isAdmin: false without a network round trip -
  // AdminCheckService.checkIsAdmin() only ever needs to run for a real
  // email.
  private async resolveIsAdmin(user: ForwardedUser | undefined) {
    return user ? this.adminCheckService.checkIsAdmin(user.email) : false
  }

  /**
   * The Discord snowflake to OR onto a requester-scoped list filter, so one
   * person's Discord-submitted and web-submitted jobs read as one history
   * (plan 017 §E2).
   *
   * ⚠️ **This is the only producer of a Discord filter arm in the read path,
   * and it is what keeps that arm inside the existing authorization.** There
   * is no `?discordUserId=` query parameter; the snowflake is always derived
   * from `requesterEmail`'s owner, which the caller has already been 403'd
   * for if they were not allowed to name them. So the OR-ed filter is aimed
   * at exactly the one person the un-widened filter was, and the
   * attribution-oracle guard that gates `requesterEmail` (see
   * `JobListFilter.excludeHiddenVideos`) gates the Discord arm identically -
   * it cannot be steered at a third party to probe for their hidden videos.
   *
   * Three `undefined` cases, all meaning "leave the filter as it was":
   * - **No `requesterEmail`** (`?scope=all`): there is nobody to link *from*,
   *   and an unscoped list already contains every Discord job anyway.
   * - **Self view**: keyed by `user.userId` rather than the email. Same
   *   answer, but it reuses the `u:` cache entry that
   *   `AttributionResolutionService` warms while rendering the page's
   *   `linkedDiscord`, instead of minting a parallel `e:` one.
   * - **Someone else** (admin only, by the 403 above): keyed by their email,
   *   the only identifier this app has for them - there is no `users` table.
   *
   * Fails open to `undefined` (DiscordLinkService never rejects), which
   * degrades to the email-only history this route returned before.
   */
  private async resolveScopeDiscordUserId(params: {
    isSelfScope: boolean
    requesterEmail: string | undefined
    user: ForwardedUser
  }): Promise<string | undefined> {
    const { isSelfScope, requesterEmail, user } = params
    if (!requesterEmail) return undefined

    const linked = isSelfScope
      ? await this.discordLinkService.getLinkedDiscordUserId(user.userId)
      : await this.discordLinkService.getLinkedDiscordUserIdByEmail(
          requesterEmail,
        )

    return linked ?? undefined
  }

  /**
   * The read path's single exit, in three arities: **resolve, then mask**.
   *
   * Every job-returning route in this controller goes through one of these
   * rather than calling `projectJobForViewer` directly, so the ordering
   * requirement — link resolution strictly *before* masking, since the mask
   * nulls the very fields resolution fills — is satisfied once here instead
   * of being re-remembered at ~20 call sites. A new route that forgets to
   * use one of these degrades to "no linked handle shown", never to a leak,
   * because masking is still what the raw `projectJobForViewer` does.
   *
   * Resolution is fail-open and batched (see `AttributionResolutionService`),
   * so this adds at most one round of mostly-cached lookups per response and
   * cannot fail the request.
   */
  private async serveJob(
    job: DownloadJob,
    isAdmin: boolean,
  ): Promise<DownloadJob> {
    const [resolved] = await this.attributionResolutionService.resolveJobs([
      job,
    ])

    // `resolved` is only `undefined` to the type system (a one-element batch
    // always answers with one element); falling back to the unresolved job
    // keeps that impossible case a correct-but-unenriched response.
    return projectJobForViewer(resolved ?? job, isAdmin)
  }

  /** {@link serveJob} over a list — one batch of lookups for the whole list. */
  private async serveJobs(
    jobs: readonly DownloadJob[],
    isAdmin: boolean,
  ): Promise<DownloadJob[]> {
    const resolved = await this.attributionResolutionService.resolveJobs(jobs)

    return resolved.map(job => projectJobForViewer(job, isAdmin))
  }

  /** {@link serveJobs} with the `{ items, nextCursor, total }` envelope kept. */
  private async serveJobPage(
    page: DownloadPage<DownloadJob>,
    isAdmin: boolean,
  ): Promise<DownloadPage<DownloadJob>> {
    return { ...page, items: await this.serveJobs(page.items, isAdmin) }
  }

  /**
   * The gallery's equivalent. Masking for these rows happens inside
   * `JobQueryService.listGallery` (they are library titles, not jobs, so there
   * is no `projectJobForViewer` to sit in front of), which means resolution
   * necessarily runs *after* it here — and that is safe, because the mask
   * nulls `lastRequester` and `lastDiscordRequester` together and a row with
   * neither resolves to itself. See
   * `AttributionResolutionService.resolveGalleryItems`.
   */
  private async serveGalleryPage(
    page: DownloadPage<GalleryItem>,
  ): Promise<DownloadPage<GalleryItem>> {
    return {
      ...page,
      items: await this.attributionResolutionService.resolveGalleryItems(
        page.items,
      ),
    }
  }

  /**
   * Resolves the Discord half of a request's attribution - and, on the way
   * past, tells apps/auth that this Discord account exists.
   *
   * Two things happen here, deliberately in this order:
   *
   * 1. **Roster registration, unconditionally.** Any request that carried a
   *    Discord pair reports it to `DiscordLinkService`, *including* one that
   *    also carried a forwarded user and will therefore be attributed to the
   *    web identity below. An account worth seeing is worth listing in
   *    auth's admin link picker regardless of which identity won the
   *    attribution, and that list is the only way a Discord user who has
   *    never signed in to lilnas can be linked at all. The username comes
   *    from the requester pair; the display name is the separate optional
   *    header, which never reaches a job row (see `getDiscordDisplayName`).
   *
   *    Fire-and-forget by construction: `registerObservedIdentity()` returns
   *    synchronously, is never awaited, and cannot fail this request. The
   *    try/catch is belt-and-braces on top of that promise - the roster is
   *    bookkeeping for a screen nobody is looking at, and it must never be
   *    the reason a download 500s.
   *
   * 2. **Precedence.** A forwarded user wins and the Discord pair is
   *    dropped, with a warn: the two are mutually exclusive at the DB layer
   *    (`jobs_origin_matches_requester`), so a record carrying both does not
   *    mis-attribute, it throws. In practice this pair never arrives
   *    together - browser traffic reaches Traefik, tdr-bot reaches port 8081
   *    directly - so a hit here means something upstream changed and is
   *    worth a log line rather than a silent drop.
   */
  private resolveDiscordAttribution({
    action,
    discordDisplayName,
    discordUser,
    user,
  }: {
    action: string
    discordDisplayName: string | undefined
    discordUser: DiscordRequester | undefined
    user: ForwardedUser | undefined
  }): DiscordRequester | null {
    if (!discordUser) {
      return null
    }

    try {
      // `username`, not `discordUsername`: auth's roster contract spells the
      // handle differently from the job row's wire contract, so this is a
      // mapping and not a pass-through.
      this.discordLinkService.registerObservedIdentity({
        discordUserId: discordUser.discordUserId,
        displayName: discordDisplayName ?? null,
        username: discordUser.discordUsername,
      })
    } catch (err) {
      this.logger.warn(
        {
          action,
          discordUserId: discordUser.discordUserId,
          error: err instanceof Error ? err.message : String(err),
        },
        'Failed to report a Discord identity to auth - continuing',
      )
    }

    if (user) {
      this.logger.warn(
        {
          action,
          discordUserId: discordUser.discordUserId,
          requesterEmail: user.email,
        },
        'Request carried both a forwarded user and a Discord identity - attributing to the forwarded user',
      )
      return null
    }

    return discordUser
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

    return this.serveJobPage(page, isAdmin)
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

    return this.serveGalleryPage(page)
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
    const facets = await this.jobQueryService.getGalleryFacets({
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

    // `?scope=all` is the *only* route to the unfiltered branch. Omitting
    // `requester` still means "me", which is what a bare
    // GET /download/history has always meant - see HistoryQuerySchema.
    const allRequesters = query.scope === 'all'
    const isSelfScope =
      !allRequesters &&
      (!query.requester ||
        query.requester.toLowerCase() === user.email.toLowerCase())

    // Resolved unconditionally (not only for the other-user branch) -
    // masking applies the same way regardless of scope, so isAdmin is
    // needed either way.
    const isAdmin = await this.resolveIsAdmin(user)

    // One gate for both widenings: naming somebody else and asking for
    // everybody are the same privilege, so they get the same refusal rather
    // than two checks that could drift apart.
    if (!isSelfScope && !isAdmin) {
      this.logger.warn(
        {
          action,
          requestedRequester: query.requester,
          requestedScope: query.scope,
          statusCode: HttpStatus.FORBIDDEN,
          viewer: user.email,
        },
        allRequesters
          ? "GET /history - non-admin attempted to view every requester's history"
          : "GET /history - non-admin attempted to view another user's history",
      )

      throw new ForbiddenException(
        allRequesters
          ? "Only admins may view every requester's download history"
          : "Only admins may view another user's download history",
      )
    }

    // `undefined`, not a sentinel: `JobListFilter.requesterEmail` is optional
    // and `buildJobWhere` omits the predicate entirely when it is absent
    // (db/jobs.repo.ts). That absence is also what makes a service-created
    // job visible here - its `requester_email` is NULL, and no
    // `lower(requester_email) = ?` comparison can ever match NULL, so any
    // requester-keyed query necessarily excludes it.
    const requesterEmail = allRequesters
      ? undefined
      : isSelfScope
        ? user.email
        : (query.requester as string)

    // The unified-history arm (plan 017 §E2): the Discord snowflake belonging
    // to the *same person* `requesterEmail` names, so their Discord-submitted
    // jobs list alongside their web-submitted ones.
    const requesterDiscordUserId = await this.resolveScopeDiscordUserId({
      isSelfScope,
      requesterEmail,
      user,
    })

    const page = await this.jobQueryService.listHistory({
      cursor: query.cursor,
      isAdmin,
      limit: query.limit,
      requesterDiscordUserId,
      requesterEmail,
      statuses: query.status,
      types: query.type,
    })

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        resultCount: page.items.length,
        scopedTo: requesterEmail ?? 'all requesters',
        // Whether the two surfaces got unified, without logging the
        // snowflake itself - it identifies a person, and this line is
        // written on every history request.
        scopeUnifiedWithDiscord: Boolean(requesterDiscordUserId),
        statusCode: HttpStatus.OK,
        total: page.total,
      },
      'GET /history - listed download history',
    )

    return this.serveJobPage(page, isAdmin)
  }

  // ForwardedUserGuard for the same reason as /history above: a caller with
  // no forwarded identity has no "own profile" to default to, so 401 is the
  // honest answer. The self-or-admin split is a deliberate copy of
  // getHistory()'s - the 403 here is what satisfies plan 012's
  // attribution-oracle guard (see ProfileService for the other half).
  @Get('/profile')
  @UseGuards(ForwardedUserGuard)
  async getProfile(
    @Query(new ZodValidationPipe(ProfileQueryDto)) query: ProfileQueryDto,
    @CurrentUser() user: ForwardedUser,
  ): Promise<ProfileResponse> {
    const action = 'getProfile'
    const startTime = Date.now()

    const isSelfScope =
      !query.requester ||
      query.requester.toLowerCase() === user.email.toLowerCase()

    if (!isSelfScope && !(await this.resolveIsAdmin(user))) {
      this.logger.warn(
        {
          action,
          requestedRequester: query.requester,
          statusCode: HttpStatus.FORBIDDEN,
          viewer: user.email,
        },
        "GET /profile - non-admin attempted to view another user's profile",
      )

      throw new ForbiddenException(
        "Only admins may view another user's profile",
      )
    }

    const email = isSelfScope ? user.email : (query.requester as string)

    // No serveJobPage(): the response carries no job objects, only counts
    // and timestamps, so there is nothing to resolve or mask. Awaited since
    // plan 017 §E2 - the counts themselves are still a synchronous DB read,
    // but the subject's Discord link has to be fetched before they can be
    // scoped (see ProfileService).
    const profile = await this.profileService.getProfile({
      days: query.days,
      email,
    })

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        scopedTo: email,
        statusCode: HttpStatus.OK,
      },
      'GET /profile - computed user profile',
    )

    return profile
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

    const [jobs, annotated] = await Promise.all([
      this.jobQueryService.listJobsForMedia(id),
      this.withCurrentRelease(resolved),
    ])

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
      jobs: await this.serveJobs(jobs, isAdmin),
      media: annotated,
    }
  }

  /**
   * A movie annotated with the release behind the file on disk right now, so
   * the detail page can mark one release `current` and offer to report it.
   *
   * Detail route only. The answer costs a Radarr history call on a cache
   * miss, which is fine once per page and ruinous once per row - no list
   * route asks for it.
   *
   * The annotation lands on a **copy**: `MediaResolverService` caches the
   * object it hands back, so writing to it would publish this movie's guid
   * to every other reader of that cache entry. A movie with no `radarrId`
   * (a discover-only lookup), no file, or no recoverable history is returned
   * exactly as the resolver produced it, with the key absent rather than
   * present-and-undefined.
   */
  private async withCurrentRelease(resolved: Media): Promise<Media> {
    if (!isMovie(resolved) || resolved.radarrId == null) {
      return resolved
    }

    try {
      const release = await this.currentReleaseService.forMovie(
        resolved.id,
        resolved.radarrId,
      )

      return release
        ? { ...resolved, currentReleaseGuid: release.releaseGuid }
        : resolved
    } catch (err) {
      // forMovie() is documented never to throw, so this guards against a
      // future regression in it rather than a live path - the same reason
      // MediaResolverService wraps its Emby annotation. A release label is
      // never worth the detail page.
      this.logger.warn(
        {
          action: 'getMediaDetail',
          error: getErrorMessage(err),
          mediaId: resolved.id,
        },
        'GET /media/:id - current release lookup failed',
      )

      return resolved
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

  /**
   * A series' seasons and their episodes, with each episode's file and
   * monitoring state - what a detail page needs to offer per-episode and
   * per-season actions.
   *
   * No identity param and no masking, like `GET /media/:id/releases`: a
   * season list carries no attribution.
   *
   * Unlike the releases route this one does **not** write upstream. A show
   * that isn't in the library 404s rather than being added, because adding a
   * series as a side effect of a GET would be a genuine surprise.
   */
  @Get('/media/:id/seasons')
  async listSeasons(@Param('id') id: string): Promise<ListSeasonsResponse> {
    const action = 'listSeasons'
    const startTime = Date.now()

    const seasons = await this.showService.listSeasons(id)

    this.logger.log(
      {
        action,
        duration: Date.now() - startTime,
        episodeCount: seasons.reduce((n, s) => n + s.episodes.length, 0),
        mediaId: id,
        resultCount: seasons.length,
        statusCode: HttpStatus.OK,
      },
      'GET /media/:id/seasons - listed seasons and episodes',
    )

    return { seasons }
  }

  /**
   * Streams one media file back as an attachment - the "save to your device"
   * action, and the only route in this app that answers with bytes instead
   * of JSON. One route covers all three media types because
   * `MediaFileService` has already collapsed them into a `MediaFileSource`:
   * this handler decides *how* to send, never *what*.
   *
   * Deliberately **not** `mediaJobRoute()`, and with no mapping layer of its
   * own: `resolveFileSource()` already raises the right exception for every
   * case it can fail on, and that helper would rewrite "pass an episodeId"
   * (400) and "Sonarr is unreachable" (503) into a flat "not found" - the
   * same reasoning as `deleteMediaFiles`. Throwing still reaches Nest's
   * exception filter despite the `@Res()` below, because nothing has been
   * written to the response by the time `resolveFileSource()` rejects.
   *
   * `@OptionalCurrentUser()` rather than a guard, matching every other
   * mutating route here: a save is worth an audit row, but a service caller
   * with no forwarded identity must still be able to fetch bytes, and it
   * simply lands an unattributed (`origin: 'service'`) row. Traefik's
   * `lilnas-auth` gates the edge in production.
   */
  @Get('/media/:id/file')
  async getMediaFile(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(GetMediaFileQueryDto))
    query: GetMediaFileQueryDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
    // The house preference is "no @Res()" (health.controller.ts), and it is
    // about JSON response envelopes - Nest builds those better than a
    // handler can. A byte stream is the case that preference does not cover:
    // no return value expresses "pipe this, honour Range, for however long
    // it takes", so the raw response is the only way to write this route.
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.mediaFileService.resolveFileSource(id, query)

    if (source.kind === 'object') {
      // Opened *before* a single header is set. `getObjectStream()` can
      // still throw (MinIO unreachable), and a `Content-Length` already
      // parked on the response would leave Nest's exception filter writing a
      // short JSON error under a header promising megabytes - which a client
      // waits out rather than reports.
      const stream = await this.mediaFileService.getObjectStream(source)

      res.setHeader('Content-Disposition', contentDisposition(source.fileName))
      res.setHeader('Content-Type', source.contentType)
      res.setHeader('Content-Length', String(source.size))

      // No `Range` handling on this branch - the videos this app produces
      // are small next to a movie file, and `getPartialObject()` is the
      // documented escape hatch if that stops being true.
      stream.on('error', err => this.failTransfer(id, res, err, 'destroy'))
      // `pipe()` tears down neither end on the *other* end's close, so a
      // client that abandons the save mid-transfer would otherwise leave the
      // MinIO socket open for the length of the object.
      res.once('close', () => stream.destroy())
      stream.pipe(res)
    } else {
      res.setHeader('Content-Disposition', contentDisposition(source.fileName))

      // `sendFile` rather than a hand-rolled `createReadStream`: it supplies
      // `Range`/206, `Accept-Ranges`, ETag, Last-Modified and an
      // extension-derived `Content-Type` for free. Movie and episode files
      // run to multiple gigabytes, where resumability is the difference
      // between a save that survives a dropped connection and one that
      // starts over.
      res.sendFile(source.path, err => {
        if (err) {
          this.failTransfer(id, res, err, 'end')
        }
      })
    }

    this.recordFileSave(id, source)

    // Recorded at hand-off for the same reason the counter is (see
    // `recordFileSave`): the bytes leave over minutes and this request has no
    // later moment it can still speak for. Anything that fails *before* here
    // has thrown, so no row is written for a save that never started.
    this.auditLogService.record({
      action: 'media.save_file',
      actor: user,
      metadata: narrowScope({ episodeId: query.episodeId, part: query.part }),
      target: { id, type: 'media' },
    })
  }

  /**
   * Deletes the files a scope names - one episode, one season, or every file
   * of the title - and unmonitors that same scope so Sonarr doesn't treat
   * the result as a missing episode and re-grab it.
   *
   * **The delete cascades upward.** Emptying a season unmonitors that
   * season, and emptying the last monitored season removes the series from
   * Sonarr outright; a movie, or a whole-title show scope, always removes
   * the title from Radarr/Sonarr. The response's `removedFromLibrary` says
   * whether the title itself is gone, and the audit row's `cascade` says how
   * far the delete reached. Existing jobs keep their history, and nothing
   * here is permanent - requesting the title again re-adds it.
   *
   * Deliberately **not** `mediaJobRoute()`: that helper turns every failure
   * into a 404, which would report a movie-with-scope `BadRequestException`
   * as "not found". What the service throws is left to Nest's exception
   * filter to map honestly.
   */
  @Delete('/media/:id/files')
  async deleteMediaFiles(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(DeleteMediaFilesQueryDto))
    query: DeleteMediaFilesQueryDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DeleteMediaFilesResponse> {
    const action = 'deleteMediaFiles'
    const startTime = Date.now()

    const { cascade, deletedCount, removedFromLibrary } =
      await this.showService.deleteFiles(id, {
        episodeId: query.episodeId,
        seasonNumber: query.seasonNumber,
      })

    this.logger.log(
      {
        action,
        cascade,
        deletedCount,
        duration: Date.now() - startTime,
        episodeId: query.episodeId,
        mediaId: id,
        removedFromLibrary,
        // Not masked and not used for authorization - a delete is an action
        // someone took, and the log is the only place it's recorded.
        requestedBy: user?.email ?? null,
        seasonNumber: query.seasonNumber,
        statusCode: HttpStatus.OK,
      },
      'DELETE /media/:id/files - deleted files and cascaded the unmonitor',
    )

    // A zero-count delete is still recorded: the request succeeded, someone
    // asked for those files to be gone, and "nothing was there" is a fact
    // worth having in the log rather than a reason to omit the attempt.
    const scope = narrowScope({
      episodeId: query.episodeId,
      seasonNumber: query.seasonNumber,
    })

    this.auditLogService.record({
      action: 'media.delete_files',
      actor: user,
      // `cascade` is what tells a later reader whether this row is the one
      // that took the season - or the whole series - out of Sonarr.
      metadata: {
        cascade,
        deletedCount,
        removedFromLibrary,
        ...(scope ? { scope } : {}),
      },
      target: { id, type: 'media' },
    })

    return { deletedCount, mediaId: id, removedFromLibrary }
  }

  // @OptionalCurrentUser() rather than a guard, matching POST /movies: a
  // service caller with no forwarded identity can still grab, it just lands
  // an unattributed job.
  @Post('/media/:id/releases/grab')
  async grabRelease(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(GrabReleaseInputDto))
    input: GrabReleaseInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.releaseActionRoute({
      action: 'grabRelease',
      audit: {
        action: 'release.grab',
        metadata: job => ({
          guid: input.guid,
          indexerId: input.indexerId,
          jobId: job.id,
        }),
      },
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
    @Body(new ZodValidationPipe(ReplaceReleaseInputDto))
    input: ReplaceReleaseInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.releaseActionRoute({
      action: 'replaceRelease',
      audit: {
        action: 'release.replace',
        metadata: job => ({
          guid: input.guid,
          indexerId: input.indexerId,
          jobId: job.id,
        }),
      },
      id,
      run: () => this.releaseService.replaceRelease(id, input, user),
      user,
    })
  }

  /**
   * Every file Radarr/Sonarr is still offering for a download that finished
   * and then refused to import - the rows the manual-import dialog lists.
   *
   * Keyed on **media** with the show scope in the query, exactly like
   * `GET /media/:id/releases` and for the same reason `releaseActionRoute()`
   * records: the candidate list belongs to a title's download rather than to
   * a job, and one queue item can have several jobs pointed at it (a series
   * job and an episode job both waiting on the same release).
   *
   * No identity param and no audit row, like the release list - reading
   * what upstream is offering is not an event. An empty `candidates` is a
   * legitimate 200: the import may have gone through between the poller's
   * last tick and this call.
   *
   * Deliberately **not** `mediaJobRoute()`: that helper turns every failure
   * into a 404, which would report a season scope on a movie key as "not
   * found". What `ManualImportService` throws is left to Nest's exception
   * filter to map honestly.
   */
  @Get('/media/:id/imports')
  async listImportCandidates(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListImportCandidatesQueryDto))
    query: ListImportCandidatesQueryDto,
  ): Promise<ListImportCandidatesResponse> {
    const action = 'listImportCandidates'
    const startTime = Date.now()

    const candidates = await this.manualImportService.listCandidates(
      id,
      narrowScope({
        episodeId: query.episodeId,
        seasonNumber: query.seasonNumber,
      }),
    )

    this.logger.log(
      {
        action,
        duration: Date.now() - startTime,
        importableCount: candidates.filter(c => c.importable).length,
        mediaId: id,
        resultCount: candidates.length,
        statusCode: HttpStatus.OK,
      },
      'GET /media/:id/imports - listed manual-import candidates',
    )

    return { candidates }
  }

  /**
   * Commits the chosen files through upstream's `ManualImport` command - the
   * "import these" half of the dialog.
   *
   * The scope rides in the **body** rather than the query here, so the paths
   * and the season/episode they belong to arrive as one document;
   * `ManualImportService.importFiles` reads it off the input itself.
   *
   * `importedCount` is how many files were *submitted*: the command queues
   * at upstream's end, and the matching jobs move to `Importing` for the
   * poller to finish a tick or two later.
   *
   * `@OptionalCurrentUser()` rather than the guard, matching `grabRelease`:
   * a service caller with no forwarded identity can still import, the audit
   * row just records it as service-origin.
   */
  @Post('/media/:id/imports')
  async importFiles(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ImportFilesInputDto))
    input: ImportFilesInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<ImportFilesResponse> {
    const action = 'importFiles'
    const startTime = Date.now()

    const { importedCount } = await this.manualImportService.importFiles(
      id,
      input,
    )

    this.logger.log(
      {
        action,
        duration: Date.now() - startTime,
        episodeId: input.episodeId,
        importedCount,
        mediaId: id,
        pathCount: input.paths.length,
        // Not masked and not used for authorization - an import is an action
        // someone took, and the log is the only place it is recorded.
        requestedBy: user?.email ?? null,
        seasonNumber: input.seasonNumber,
        statusCode: HttpStatus.CREATED,
      },
      'POST /media/:id/imports - committed a stuck download',
    )

    // The **media** key is the target, not the job: an import is a statement
    // about a title's files, and it may well have moved more than one job.
    // The paths are kept verbatim because "which files did someone force in"
    // is the whole question a later reader brings to this row.
    this.auditLogService.record({
      action: 'media.manual_import',
      actor: user,
      metadata: {
        importedCount,
        paths: input.paths,
        ...narrowScope({
          episodeId: input.episodeId,
          seasonNumber: input.seasonNumber,
        }),
      },
      target: { id, type: 'media' },
    })

    return { importedCount }
  }

  /**
   * Throws the stuck download away - the "give up" half of the dialog.
   * Removes the queue rows in scope (with their files) and cancels whichever
   * jobs the scope answers.
   *
   * A zero `discardedCount` is a 200, like `DELETE /media/:id/files`: the
   * caller asked for a state and that state already held. Only a removal
   * that was attempted and failed for every row is an error, and that
   * surfaces as the service's own 503.
   */
  @Delete('/media/:id/imports')
  async discardImport(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(DiscardImportQueryDto))
    query: DiscardImportQueryDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DiscardImportResponse> {
    const action = 'discardImport'
    const startTime = Date.now()
    const scope = narrowScope({
      episodeId: query.episodeId,
      seasonNumber: query.seasonNumber,
    })

    const { discardedCount } = await this.manualImportService.discard(id, scope)

    this.logger.log(
      {
        action,
        discardedCount,
        duration: Date.now() - startTime,
        episodeId: query.episodeId,
        mediaId: id,
        requestedBy: user?.email ?? null,
        seasonNumber: query.seasonNumber,
        statusCode: HttpStatus.OK,
      },
      'DELETE /media/:id/imports - discarded a stuck download',
    )

    // Recorded even at zero, for the reason the file delete is: the request
    // succeeded, someone asked for that download to be gone, and "nothing
    // was there" is a fact worth having in the log.
    this.auditLogService.record({
      action: 'media.discard_download',
      actor: user,
      metadata: { discardedCount, ...scope },
      target: { id, type: 'media' },
    })

    return { discardedCount }
  }

  // ForwardedUserGuard (not @OptionalCurrentUser()) - a flag records a
  // judgement *someone* made, and an anonymous one would be unattributable.
  // The only Phase 3 route that requires identity.
  @Post('/media/:id/bad-files')
  @UseGuards(ForwardedUserGuard)
  flagBadFile(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FlagBadFileInputDto))
    input: FlagBadFileInputDto,
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

    this.auditLogService.record({
      action: 'file.flag_bad',
      actor: user,
      metadata: {
        guid: input.guid,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      target: { id, type: 'media' },
    })

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

  // ForwardedUserGuard, matching flagBadFile - undoing a judgement is a
  // judgement too, and an anonymous unflag would be just as unattributable.
  @Delete('/media/:id/bad-files/:flagId')
  @UseGuards(ForwardedUserGuard)
  unflagBadFile(
    @Param('id') id: string,
    @Param('flagId') flagIdParam: string,
    @CurrentUser() user: ForwardedUser,
  ): UnflagBadFileResponse {
    const flagId = Number(flagIdParam)

    // Not a route the service can 404 for on its own - `ReleaseService`
    // takes a `number`, so a non-numeric segment has to be rejected here
    // rather than handed down as `NaN`.
    if (!Number.isInteger(flagId)) {
      throw new NotFoundException(
        `No bad-file flag '${flagIdParam}' exists for '${id}'`,
      )
    }

    const badFile = this.releaseService.unflagBadFile(id, flagId)

    this.logger.log(
      {
        action: 'unflagBadFile',
        flagId,
        mediaId: id,
        statusCode: HttpStatus.OK,
        unflaggedBy: user.email,
      },
      'DELETE /media/:id/bad-files/:flagId - removed a bad-file flag',
    )

    this.auditLogService.record({
      action: 'file.unflag_bad',
      actor: user,
      metadata: { flagId },
      target: { id, type: 'media' },
    })

    return { badFile }
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

    return this.serveJob(job, isAdmin)
  }

  @Post('/videos')
  async createVideoJob(
    @Body(new ZodValidationPipe(CreateJobInputDto)) input: CreateJobInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
    // Trailing and optional (`?`) rather than `| undefined`: every existing
    // caller - the web UI, and every test of these routes predating Phase
    // 018 - passes neither, and a Discord-less call site should not have to
    // write two `undefined`s to say so.
    @OptionalDiscordUser() discordUser?: DiscordRequester,
    @OptionalDiscordDisplayName() discordDisplayName?: string,
  ): Promise<DownloadJob> {
    const action = 'createVideoJob'
    const startTime = Date.now()
    const sanitizedUrl = input.url.split('?')[0]

    // Before the work starts, and outside everything the response awaits:
    // the roster report inside must not add latency to the create, and the
    // account is worth recording whether or not the job goes on to succeed.
    const discordRequester = this.resolveDiscordAttribution({
      action,
      discordDisplayName,
      discordUser,
      user,
    })

    this.logger.log(
      {
        action,
        url: sanitizedUrl,
        hasTimeRange: !!input.timeRange,
        timeRange: input.timeRange,
        hasRequester: !!user,
        hasDiscordRequester: !!discordRequester,
        currentJobs: this.downloadStateService.jobs.size,
        queueSize: this.downloadStateService.queue.size(),
      },
      'POST /videos - Creating new video download job',
    )

    try {
      const [job, isAdmin] = await Promise.all([
        this.downloadService.createVideoDownloadJob(
          input,
          user,
          discordRequester,
        ),
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

      // Inside the `try`, but after the await: a job that failed to be
      // created must leave no row behind, and `record()` itself never throws
      // (see AuditLogService.record), so it can't turn a successful create
      // into the catch block's 500.
      //
      // Deliberately the raw url, NOT the `sanitizedUrl` the log lines above
      // use - do not "fix" this for consistency. For the URL shape this
      // service mostly sees, the video's identity lives entirely in the query
      // string (`youtube.com/watch?v=...`), so stripping it leaves an audit
      // entry that can't say what was downloaded. The audit log is a stricter
      // surface than the logs: it sits behind AdminGuard, is unmasked by
      // design, and is meant to outlive the job row it points at - so it has
      // to carry the url in full itself.
      this.auditLogService.record({
        action: 'video.create',
        actor: user,
        discordActor: discordRequester,
        metadata: { url: input.url },
        target: { id: job.id, type: 'job' },
      })

      return this.serveJob(job, isAdmin)
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
    @OptionalDiscordUser() discordUser?: DiscordRequester,
    @OptionalDiscordDisplayName() discordDisplayName?: string,
  ): Promise<DownloadJob> {
    const action = 'cancelVideoJob'
    const startTime = Date.now()

    // Cancel and delete carry the Discord identity for the *audit row* only:
    // there is no job record being minted here, so nothing about
    // `jobs.origin` changes. Together with the three create routes these are
    // the only routes apps/tdr-bot calls, which is exactly where this stops.
    const discordActor = this.resolveDiscordAttribution({
      action,
      discordDisplayName,
      discordUser,
      user,
    })

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

      this.auditLogService.record({
        action: 'video.cancel',
        actor: user,
        discordActor,
        target: { id, type: 'job' },
      })

      return this.serveJob(job, isAdmin)
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

  /**
   * Stops a running download without discarding what it has already fetched.
   * No admin gate, matching cancel: whoever can start a video download can
   * interrupt one.
   */
  @Patch('/videos/:id/pause')
  async pauseVideoJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.videoInterruptRoute({
      action: 'pauseVideoJob',
      audit: { action: 'video.pause' },
      // Web-only route - apps/tdr-bot has no pause/resume command, so there
      // is no Discord identity to attribute and the parameter is stated
      // rather than left to a default.
      discordActor: null,
      id,
      run: () => this.downloadService.pauseVideoDownloadJob(id),
      user,
      verb: 'pause',
    })
  }

  /** Puts a paused job back on the queue. */
  @Patch('/videos/:id/resume')
  async resumeVideoJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.videoInterruptRoute({
      action: 'resumeVideoJob',
      audit: { action: 'video.resume' },
      discordActor: null,
      id,
      run: () => this.downloadService.resumeVideoDownloadJob(id),
      user,
      verb: 'resume',
    })
  }

  /**
   * Removes a video download for good - stops it if it's still running,
   * deletes its MinIO objects, and clears the download URLs that pointed at
   * them.
   *
   * The video counterpart of `DELETE /movies/:id` and `DELETE /shows/:id`,
   * and the route whose absence left finished videos unremovable: `cancel`
   * 404s once a job is `Completed`, and `DELETE /media/:id/files` refuses a
   * `video:` key. Same gate as those two and as cancel - no admin check,
   * `@OptionalCurrentUser()` for attribution only.
   *
   * Addressed by **job** id, like the movie and show deletes, not by the
   * `video:` media key - the job is what the gallery and activity list link
   * to, and the `videos` row deliberately outlives the delete (see
   * `DownloadService.deleteVideoDownloadJob`).
   */
  @Delete('/videos/:id')
  async deleteVideoJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
    @OptionalDiscordUser() discordUser?: DiscordRequester,
    @OptionalDiscordDisplayName() discordDisplayName?: string,
  ): Promise<DownloadJob> {
    const action = 'deleteVideoJob'

    return this.videoInterruptRoute({
      action,
      audit: { action: 'video.delete' },
      // Audit attribution only - see `cancelVideoJob`.
      discordActor: this.resolveDiscordAttribution({
        action,
        discordDisplayName,
        discordUser,
        user,
      }),
      id,
      run: () => this.downloadService.deleteVideoDownloadJob(id),
      user,
      verb: 'delete',
    })
  }

  @Get('/movies/search')
  async searchMovies(
    @Query(new ZodValidationPipe(MediaSearchQueryDto))
    query: MediaSearchQueryDto,
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
    @Body(new ZodValidationPipe(RequestMovieInputDto))
    input: RequestMovieInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
    @OptionalDiscordUser() discordUser?: DiscordRequester,
    @OptionalDiscordDisplayName() discordDisplayName?: string,
  ): Promise<DownloadJob> {
    const action = 'requestMovie'

    const discordRequester = this.resolveDiscordAttribution({
      action,
      discordDisplayName,
      discordUser,
      user,
    })

    this.logger.log(
      {
        action,
        hasDiscordRequester: !!discordRequester,
        hasRequester: !!user,
        tmdbId: input.tmdbId,
      },
      'POST /movies - Requesting movie download',
    )

    const [job, isAdmin] = await Promise.all([
      this.mediaDownloadService.requestMovie(
        input.tmdbId,
        user,
        discordRequester,
      ),
      this.resolveIsAdmin(user),
    ])

    this.logger.log(
      { action, jobId: job.id, tmdbId: input.tmdbId, status: job.status },
      'Movie download requested',
    )

    // The job is the target (this is a job-lifecycle action, like every
    // other `*.request`); the title it is for rides along as metadata, since
    // that is what an admin reading the log recognizes.
    this.auditLogService.record({
      action: 'movie.request',
      actor: user,
      discordActor: discordRequester,
      metadata: { mediaId: job.media.id },
      target: { id: job.id, type: 'job' },
    })

    return this.serveJob(job, isAdmin)
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
      audit: { action: 'movie.delete' },
      id,
      notFoundMessage: 'Failed to delete movie job',
      run: () => this.mediaDownloadService.deleteMovieJob(id),
      user,
    })
  }

  /**
   * Stops an in-flight movie download: removes its Radarr queue items,
   * unmonitors the title if it has no file, and moves the job to
   * `Cancelling`. The poller settles it from there - `Cancelled`, or
   * `Completed` if a file lands anyway because the cancel came too late.
   *
   * `:id` is a job id, like `DELETE /movies/:id`. A finished job answers
   * 404, as `PATCH /videos/:id/cancel` does, and a job already `Cancelling`
   * is answered as it stands. Same gate as the delete - no admin check,
   * `@OptionalCurrentUser()` for attribution only.
   */
  @Patch('/movies/:id/cancel')
  async cancelMovieJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.mediaJobRoute({
      action: 'cancelMovieJob',
      audit: { action: 'movie.cancel' },
      id,
      notFoundMessage: 'Failed to cancel movie job',
      run: () => this.mediaDownloadService.cancelMovieJob(id),
      user,
    })
  }

  @Get('/shows/search')
  async searchShows(
    @Query(new ZodValidationPipe(MediaSearchQueryDto))
    query: MediaSearchQueryDto,
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

  /**
   * `episodeId`/`seasonNumber` are both optional and narrow the request to
   * one episode or one season; omitting them requests the whole series, and
   * that path is byte-for-byte what it was before Phase 4. Both are logged
   * so a scoped request is greppable.
   */
  @Post('/shows')
  async requestShow(
    @Body(new ZodValidationPipe(RequestShowInputDto))
    input: RequestShowInputDto,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
    @OptionalDiscordUser() discordUser?: DiscordRequester,
    @OptionalDiscordDisplayName() discordDisplayName?: string,
  ): Promise<DownloadJob> {
    const action = 'requestShow'

    const discordRequester = this.resolveDiscordAttribution({
      action,
      discordDisplayName,
      discordUser,
      user,
    })
    // Keys omitted rather than set to `undefined`, so the scope persisted on
    // the job is `{"seasonNumber":3}` rather than carrying a null episodeId.
    const scope = narrowScope({
      episodeId: input.episodeId,
      seasonNumber: input.seasonNumber,
    })

    this.logger.log(
      {
        action,
        episodeId: input.episodeId,
        hasDiscordRequester: !!discordRequester,
        hasRequester: !!user,
        seasonNumber: input.seasonNumber,
        tvdbId: input.tvdbId,
      },
      'POST /shows - Requesting show download',
    )

    const [job, isAdmin] = await Promise.all([
      this.mediaDownloadService.requestShow(
        input.tvdbId,
        user,
        scope,
        discordRequester,
      ),
      this.resolveIsAdmin(user),
    ])

    this.logger.log(
      {
        action,
        episodeId: input.episodeId,
        jobId: job.id,
        seasonNumber: input.seasonNumber,
        status: job.status,
        tvdbId: input.tvdbId,
      },
      'Show download requested',
    )

    // `scope` is omitted entirely for a whole-series request rather than
    // written as null - the same shape the job row carries.
    this.auditLogService.record({
      action: 'show.request',
      actor: user,
      discordActor: discordRequester,
      metadata: { mediaId: job.media.id, ...(scope ? { scope } : {}) },
      target: { id: job.id, type: 'job' },
    })

    return this.serveJob(job, isAdmin)
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
      audit: { action: 'show.delete' },
      id,
      notFoundMessage: 'Failed to delete show job',
      run: () => this.mediaDownloadService.deleteShowJob(id),
      user,
    })
  }

  /**
   * The show counterpart of `PATCH /movies/:id/cancel`: removes the Sonarr
   * queue items inside the job's scope, unmonitors what in that scope has no
   * file, and moves the job to `Cancelling` for the poller to settle.
   */
  @Patch('/shows/:id/cancel')
  async cancelShowJob(
    @Param('id') id: string,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<DownloadJob> {
    return this.mediaJobRoute({
      action: 'cancelShowJob',
      audit: { action: 'show.cancel' },
      id,
      notFoundMessage: 'Failed to cancel show job',
      run: () => this.mediaDownloadService.cancelShowJob(id),
      user,
    })
  }

  /**
   * The log line and the counter for a transfer that has *started*.
   *
   * Recorded at hand-off rather than at completion on purpose: the bytes
   * leave over minutes, the client may abandon the download at any point,
   * and once the response is piped this request has no later moment it can
   * still speak for. "Saves started" is therefore the only figure that is
   * both honest and attributable to a single request.
   */
  private recordFileSave(mediaId: string, source: MediaFileSource): void {
    this.logger.log(
      {
        action: 'getMediaFile',
        fileName: source.fileName,
        kind: source.kind,
        mediaId,
        statusCode: HttpStatus.OK,
      },
      'GET /media/:id/file - streaming a media file to be saved',
    )

    const type = mediaTypeFromKey(mediaId)

    // Unreachable in practice - `resolveFileSource()` has already 404'd any
    // key whose prefix doesn't parse - but a mislabelled sample is worse
    // than a missing one, so an unrecognized key is simply not counted.
    if (type) {
      this.downloadMetricsService.fileSaved(type)
    }
  }

  /**
   * The two ways a transfer can die after the route has committed to it.
   *
   * Which one it is turns entirely on `headersSent`. Before the first byte
   * there is still a status line to choose, so a file that has gone missing
   * becomes an honest 404 - in the exact JSON shape Nest's exception filter
   * would have produced, borrowed from the exception object rather than
   * hand-rolled, because `@Res()` has taken this response out of the
   * filter's hands by the time these callbacks run. After the first byte the
   * status is already on the wire and the only remaining signal is a body
   * shorter than the `Content-Length` the client was promised.
   *
   * `abort` differs by branch for a reason: `sendFile` has already torn its
   * own file stream down by the time it calls back, so the response only
   * needs closing, whereas a failed MinIO stream is still piped into a live
   * response - `pipe()` does not destroy the destination when the source
   * errors - and only `destroy()` stops a half-written body from being
   * mistaken for a complete one.
   */
  private failTransfer(
    mediaId: string,
    res: Response,
    err: unknown,
    abort: 'destroy' | 'end',
  ): void {
    const action = 'getMediaFile'
    const code =
      typeof err === 'object' && err !== null
        ? (err as NodeJS.ErrnoException).code
        : undefined
    const error = err instanceof Error ? err.message : String(err)

    if (res.headersSent) {
      this.logger.warn(
        { action, code, error, mediaId },
        'GET /media/:id/file - transfer failed after the response had started',
      )

      if (abort === 'destroy') {
        res.destroy()
      } else {
        res.end()
      }

      return
    }

    // ENOENT/EACCES means the file moved or lost its permissions between
    // Radarr/Sonarr naming it and this process opening it - "gone", not a
    // fault of this service. Anything else is a real failure and says so.
    const exception =
      code === 'ENOENT' || code === 'EACCES'
        ? new NotFoundException(`Media '${mediaId}' has no file to save`)
        : new InternalServerErrorException('Could not read the media file')

    this.logger.warn(
      { action, code, error, mediaId, statusCode: exception.getStatus() },
      'GET /media/:id/file - could not open the media file',
    )

    res.status(exception.getStatus()).json(exception.getResponse())
  }

  /**
   * The pause and resume routes, which differ only in which service method
   * they call.
   *
   * Deliberately does **not** copy `cancelVideoJob`'s catch block, which
   * rewrites every failure into a 404. That is survivable for cancel, whose
   * service method only ever throws bare `Error`s, but it would be actively
   * wrong here: `pauseVideoDownloadJob`/`resumeVideoDownloadJob` raise real
   * HTTP exceptions, and reporting "this job isn't downloading right now"
   * (409) as "job not found" (404) would tell a UI to drop a job that is
   * alive and well. The failure is logged and re-thrown untouched, leaving
   * Nest's exception filter to map it honestly - the same reasoning as
   * `releaseActionRoute()` and `deleteMediaFiles()`.
   */
  private async videoInterruptRoute({
    action,
    audit,
    discordActor,
    id,
    run,
    user,
    verb,
  }: {
    action: string
    audit: RouteAuditEvent
    /**
     * Required-but-nullable rather than optional: `delete` is reachable from
     * Discord and `pause`/`resume` are not, and which of the three a call
     * site is has to be stated rather than reached by omission.
     */
    discordActor: DiscordRequester | null
    id: string
    run: () => Promise<DownloadJob>
    user: ForwardedUser | undefined
    verb: 'delete' | 'pause' | 'resume'
  }): Promise<DownloadJob> {
    const startTime = Date.now()

    this.logger.log(
      {
        action,
        jobId: id,
        totalJobs: this.downloadStateService.jobs.size,
        inProgressJobs: this.downloadStateService.inProgressJobs.size,
      },
      `/videos/:id - handling video job ${verb} request`,
    )

    try {
      const [job, isAdmin] = await Promise.all([
        run(),
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
          inProgressJobs: this.downloadStateService.inProgressJobs.size,
        },
        `Video job ${verb} request accepted`,
      )

      // Inside the `try` but after the await, so a rejected `run()` skips
      // it - and outside nothing, since `record()` never throws.
      this.auditLogService.record({
        action: audit.action,
        actor: user,
        discordActor,
        metadata: audit.metadata?.(job),
        target: { id, type: 'job' },
      })

      return this.serveJob(job, isAdmin)
    } catch (err) {
      this.logger.warn(
        {
          action,
          jobId: id,
          error: err instanceof Error ? err.message : String(err),
          duration: Date.now() - startTime,
          // The status the caller will actually see, since the error is
          // re-thrown as-is - a 409/400/404 from the service, or a 500 for
          // anything that isn't an HttpException at all.
          statusCode:
            err instanceof HttpException
              ? err.getStatus()
              : HttpStatus.INTERNAL_SERVER_ERROR,
          inProgressJobs: this.downloadStateService.inProgressJobs.size,
        },
        `Failed to ${verb} video job`,
      )

      throw err
    }
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
    audit,
    id,
    run,
    user,
  }: {
    action: string
    audit: RouteAuditEvent
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

    // The **media** key is the target here, not the job: a grab is a
    // statement about a title's file, and the job it spawned is metadata
    // (which is also why the metadata is a function - the job id doesn't
    // exist until `run()` has resolved).
    this.auditLogService.record({
      action: audit.action,
      actor: user,
      metadata: audit.metadata?.(job),
      target: { id, type: 'media' },
    })

    return this.serveJob(job, isAdmin)
  }

  /**
   * The movie/show job routes (get, delete, cancel) were byte-identical
   * apart from their `action` string and which service method they called -
   * now that all of them return the same `DownloadJob`, that duplication has
   * nothing left to justify it.
   *
   * `audit` is optional here, and on this helper alone, because this is the
   * only one of the three that serves reads as well as writes: the two GETs
   * pass nothing and record nothing, while the DELETEs and cancels pass
   * their action. A read is not an event, and logging one would bury the
   * writes under thousands of rows nobody is looking for.
   */
  private async mediaJobRoute({
    action,
    audit,
    id,
    notFoundMessage,
    run,
    user,
  }: {
    action: string
    audit?: RouteAuditEvent
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

      if (audit) {
        this.auditLogService.record({
          action: audit.action,
          actor: user,
          metadata: audit.metadata?.(job),
          target: { id, type: 'job' },
        })
      }

      return this.serveJob(job, isAdmin)
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
 * The axes that narrow a request to part of a title - `episodeId` and
 * `seasonNumber` for a show request or a file delete, `part` for a video
 * save - collapsed into the object the service (or the audit row) should
 * carry.
 *
 * Absent axes are dropped rather than kept as `undefined`, so a season-only
 * scope persists as `{"seasonNumber":3}` instead of dragging a null
 * episodeId into the job row and the audit metadata; and an empty result is
 * reported as `undefined` rather than `{}`, since "nothing narrows this
 * request" is exactly what the whole-title path means.
 *
 * `0` is a real value on two of these axes - season 0 is specials, part 0 is
 * the first part of a multi-part video - so this tests for null/undefined
 * rather than for falsiness.
 */
function narrowScope<T extends Record<string, number | null | undefined>>(
  axes: T,
): Partial<T> | undefined {
  // `Object.fromEntries` is typed `Record<string, ...>`, which would lose
  // the caller's own key names; the filter it is given here is what makes
  // the assertion true.
  const scope = Object.fromEntries(
    Object.entries(axes).filter(([, value]) => value != null),
  ) as Partial<T>

  return Object.keys(scope).length > 0 ? scope : undefined
}
