import {
  DiscordRequester,
  DownloadGalleryFacets,
  DownloadJob,
  DownloadJobStatus,
  DownloadPage,
  DownloadType,
  GalleryItem,
  IN_PROGRESS_DOWNLOAD_JOB_STATUSES,
  JobRequester,
} from '@lilnas/utils/download/types'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import { hydrateJobRow } from 'src/db/job-row'
import {
  countCompletedJobsByMediaIds,
  countJobsByRequester,
  isRequesterScoped,
  type JobListFilter,
  listJobsByMediaId,
  listJobsPage,
  listLatestJobsForMediaIds,
} from 'src/db/jobs.repo'
import {
  computeFilterKey,
  decodeListCursor,
  encodeListCursor,
  type ListCursor,
} from 'src/db/list-cursor'
import { mediaId } from 'src/db/media-id'
import { listVideosWithFiles } from 'src/db/videos.repo'
import { MediaResolverService } from 'src/media/media-resolver.service'

import { showTrueAttribution } from './attribution'
import { DownloadStateService } from './download-state.service'

interface PageParams {
  cursor?: string
  isAdmin: boolean
  limit: number
}

export interface ListActivityParams extends PageParams {
  types?: readonly DownloadType[]
}

export interface ListGalleryParams extends PageParams {
  /** Inclusive lower bound on the title's `addedAt` (plan 021). */
  createdFrom?: Date
  /** Inclusive upper bound on the title's `addedAt` (plan 021). */
  createdTo?: Date
  requesterEmail?: string
  types?: readonly DownloadType[]
}

export interface ListHistoryParams extends PageParams {
  /**
   * The Discord snowflake linked to whoever {@link requesterEmail} names,
   * OR-ed onto the email so a linked person's Discord-submitted and
   * web-submitted jobs come back as one history (plan 017 §E2).
   *
   * Omitted when that person has no linked account, when auth could not
   * answer, or when there is no `requesterEmail` to link *from* (`?scope=all`)
   * - all three degrade to the email-only filter this route had before.
   *
   * ⚠️ Resolved by the controller from `requesterEmail`'s owner, never read
   * off the request. See `JobListFilter.requesterDiscordUserId`.
   */
  requesterDiscordUserId?: string
  /**
   * Omitted = every requester - `?scope=all`, which
   * `DownloadController.getHistory` gates to admins. Optional for the same
   * mechanical reason {@link ListGalleryParams.requesterEmail} is:
   * `JobListFilter.requesterEmail` is optional and `buildJobWhere` drops the
   * predicate when it is absent. Absence is also the *only* way a
   * service-created job (NULL `requester_email`) can appear, since no email
   * comparison matches NULL.
   */
  requesterEmail?: string
  statuses?: readonly DownloadJobStatus[]
  types?: readonly DownloadType[]
}

export interface GalleryFacetsParams {
  /**
   * The date range, inclusive - on a title's `addedAt` for the type counts
   * and on a job's `created_at` for the uploader counts (see
   * `getGalleryFacets`).
   */
  createdFrom?: Date
  createdTo?: Date
  isAdmin: boolean
}

/** One title in the gallery's library, before it is resolved to a `Media`. */
interface LibraryTitle {
  addedAtMs: number
  mediaId: string
  type: DownloadType
}

interface LastRequester {
  /**
   * The Discord identity that submitted the last download, when it came in
   * over Discord. Mutually exclusive with `requester` at the DB layer
   * (`jobs_origin_matches_requester`), so exactly one of the two is ever
   * non-null - but both are carried rather than collapsed into a union, so
   * the gallery mapping stays a straight field copy.
   */
  discordRequester: DiscordRequester | null
  /** When the job behind this entry finished - `GalleryItem.lastDownloadedAt`. */
  downloadedAt: string
  hiddenAttribution: boolean
  requester: JobRequester | null
  /**
   * The job was adopted from Radarr's/Sonarr's own UI (plan 022) -
   * `GalleryItem.lastStartedUpstream`. Absent rather than `false` otherwise,
   * mirroring `DownloadJob.startedUpstream`.
   */
  startedUpstream?: true
}

function isWithinRange(addedAtMs: number, from?: Date, to?: Date): boolean {
  return (
    (!from || addedAtMs >= from.getTime()) && (!to || addedAtMs <= to.getTime())
  )
}

/**
 * The gallery's total order: newest `addedAt` first, ties broken by media id
 * ascending. Plain code-unit comparison, not `localeCompare`, because
 * {@link isAfterCursor} has to agree with it exactly.
 */
function compareGalleryOrder(a: LibraryTitle, b: LibraryTitle): number {
  if (a.addedAtMs !== b.addedAtMs) return b.addedAtMs - a.addedAtMs
  return a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0
}

/** Whether `title` sorts strictly after `cursor` under {@link compareGalleryOrder}. */
function isAfterCursor(title: LibraryTitle, cursor: ListCursor): boolean {
  return (
    title.addedAtMs < cursor.sortKeyMs ||
    (title.addedAtMs === cursor.sortKeyMs && title.mediaId > cursor.id)
  )
}

/**
 * The read side of every list route. Activity and history stay job-centric -
 * they're event feeds by nature - while the gallery is media-centric: one
 * card per title in the library, with the job log joined on for its download
 * summary (plan 021). Owns cursor decode/encode end-to-end so every route
 * shares one `BadRequestException` path for a malformed cursor.
 */
@Injectable()
export class JobQueryService {
  private readonly logger = new Logger(JobQueryService.name)

  constructor(
    private readonly dbService: DbService,
    private readonly downloadStateService: DownloadStateService,
    private readonly mediaResolverService: MediaResolverService,
  ) {}

  // No `requesterEmail` param by design (spec) - the activity feed is a
  // cross-user, in-progress-only view, not scoped to any one requester.
  listActivity(params: ListActivityParams): Promise<DownloadPage<DownloadJob>> {
    return this.runJobPage(
      { statuses: IN_PROGRESS_DOWNLOAD_JOB_STATUSES, types: params.types },
      params,
    )
  }

  /**
   * ⚠️ **No `excludeHiddenVideos` here, unlike `listGallery` below - and that
   * is deliberate, not an omission.** That flag is the attribution-oracle
   * guard against a *non-admin* using a requester-keyed lookup to confirm a
   * hidden video exists for somebody else. It cannot apply on this route,
   * because a non-admin can only ever reach two of the three scopes:
   * `requesterEmail` equal to their own email (their own hidden videos, which
   * they may see), or nothing at all - and `?scope=all`, the only way to get
   * `undefined` here, is 403'd for them at the controller. Setting it would
   * instead hide a user's own hidden videos from their own history.
   *
   * Plan 017 §E2's `requesterDiscordUserId` arm does not change that count of
   * reachable scopes. It is not a scope of its own: it only ever carries the
   * snowflake linked to the *same* person `requesterEmail` already names, so
   * a non-admin still reaches precisely "me" or a 403. Their own hidden
   * videos remain visible to them on both surfaces, which is the point.
   *
   * Attribution on the returned rows is masked either way, by
   * `serveJobPage(page, isAdmin)` at the controller.
   */
  listHistory(params: ListHistoryParams): Promise<DownloadPage<DownloadJob>> {
    return this.runJobPage(
      {
        requesterDiscordUserId: params.requesterDiscordUserId,
        requesterEmail: params.requesterEmail,
        statuses: params.statuses,
        types: params.types,
      },
      params,
    )
  }

  /**
   * Every job for one title, newest first - `GET /media/:id`'s `jobs[]`.
   * Unpaginated on purpose: this is one title's own history, which is
   * bounded by how many times someone re-requested it, not by the size of
   * the log.
   */
  listJobsForMedia(mediaId: string): Promise<DownloadJob[]> {
    return this.downloadStateService.hydrate(
      listJobsByMediaId(this.dbService.db, mediaId).map(hydrateJobRow),
    )
  }

  /**
   * One item per *title in the library*, newest `addedAt` first (plan 021).
   * The library is Radarr's movies with a file, Sonarr's series with at
   * least one episode file (`MediaResolverService.listLibrary()`), and the
   * videos with a finished file - so a title deleted upstream drops out when
   * the resolver's cache next refreshes, and a title nobody downloaded
   * through this app still gets a card (`downloadCount: 0`,
   * `lastDownloadedAt: null`).
   *
   * `type` and `from`/`to` filter the library itself (`from`/`to` on
   * `addedAt`). `?requester=` joins the job log: "titles this requester has a
   * completed job for", and `downloadCount`/the last requester are then that
   * requester's. Paged in memory - the library is a home NAS's, and the join
   * has to see all of it before `total` means anything.
   *
   * A library source that can't be read is left out and logged rather than
   * thrown, so the page degrades to the other sources - the same call
   * `resolve()`'s placeholders make for this route, which has never carried
   * `degradedSources` on its response.
   *
   * ⚠️ **Still email-only, unlike `listHistory` above** - a deliberate plan
   * 017 §E2 scope cut, not an oversight. `?requester=` here is driven by the
   * uploader facet chips, and those come from `countJobsByRequester`, which
   * groups by `requester_email`; a Discord-only job has no email and so never
   * produces a chip to click. Widening the *filter* without widening the
   * *facet* would only add an arm nothing in the UI can reach, and widening
   * the facet means resolving links inside SQL aggregation. Deferred whole.
   */
  async listGallery(
    params: ListGalleryParams,
  ): Promise<DownloadPage<GalleryItem>> {
    const requesterScoped = isRequesterScoped(params)
    // The join onto the job log - both "which titles does this requester
    // have" and each card's download summary run under it.
    const jobFilter: JobListFilter = {
      // The attribution-oracle guard: a requester-keyed filter run by a
      // non-admin must not be able to confirm a hidden video exists for
      // that requester, via either the returned rows or `total`. The
      // *unfiltered* gallery still shows hidden videos (masked) - only
      // the requester-keyed lookup is suppressed.
      //
      // Asked as `isRequesterScoped(params)` rather than
      // `params.requesterEmail ? ...` so that the day the gallery grows a
      // Discord arm of its own (plan 017 deferred it - see above), the guard
      // already covers it instead of silently going `undefined`.
      excludeHiddenVideos: requesterScoped ? !params.isAdmin : undefined,
      requesterEmail: params.requesterEmail,
      statuses: [DownloadJobStatus.Completed],
    }

    const filterKey = computeFilterKey({
      ...jobFilter,
      addedFrom: params.createdFrom,
      addedTo: params.createdTo,
      types: params.types,
    })
    const cursor = this.decodeCursor(params.cursor, filterKey)

    let titles = (await this.listLibraryTitles(params.types)).filter(title =>
      isWithinRange(title.addedAtMs, params.createdFrom, params.createdTo),
    )

    // A requester-scoped gallery has to join the whole filtered library
    // before it can page or count; the unscoped one only needs counts for
    // the page it ends up rendering.
    const joinedCounts = requesterScoped
      ? countCompletedJobsByMediaIds(
          this.dbService.db,
          jobFilter,
          titles.map(title => title.mediaId),
        )
      : undefined
    if (joinedCounts) {
      titles = titles.filter(title => joinedCounts.has(title.mediaId))
    }

    titles.sort(compareGalleryOrder)
    const start = cursor
      ? titles.findIndex(title => isAfterCursor(title, cursor))
      : 0
    const remaining = start === -1 ? [] : titles.slice(start)
    const page = remaining.slice(0, params.limit)
    const pageIds = page.map(title => title.mediaId)

    const downloadCounts =
      joinedCounts ??
      countCompletedJobsByMediaIds(this.dbService.db, jobFilter, pageIds)
    const lastRequesters = this.resolveLastRequesters(jobFilter, pageIds)
    // Only the page is resolved - `listLibrary()`'s objects are unannotated
    // (or stale-annotated), and this is what puts Emby status and `state`
    // on the cards actually rendered.
    const { media } = await this.mediaResolverService.resolve(
      page.map(title => ({ mediaId: title.mediaId, type: title.type })),
    )

    const items = page.map<GalleryItem>(title => {
      const last = lastRequesters.get(title.mediaId)
      const showRequester = showTrueAttribution(
        title.type,
        last?.hiddenAttribution ?? false,
        params.isAdmin,
      )

      return {
        addedAt: new Date(title.addedAtMs).toISOString(),
        downloadCount: downloadCounts.get(title.mediaId) ?? 0,
        // Masked by the same `showRequester` decision as `lastRequester`:
        // the Discord handle identifies the uploader just as squarely as the
        // email does, so hiding one while showing the other would make
        // `hiddenAttribution` a no-op for every Discord-submitted video.
        lastDiscordRequester: showRequester
          ? (last?.discordRequester ?? null)
          : null,
        lastDownloadedAt: last?.downloadedAt ?? null,
        lastRequester: showRequester ? (last?.requester ?? null) : null,
        // Outside `showRequester` on purpose: it names nobody, and it is what
        // keeps an adopted title's two `null` slots from reading as masked.
        // Spread so every other row keeps the key off, as `hydrateJobRow`
        // does for the job's own flag.
        ...(last?.startedUpstream ? { lastStartedUpstream: true } : {}),
        // `resolve()` answers for every key it's given (a miss degrades to a
        // placeholder), so this fallback is unreachable - it's here to
        // satisfy `Map.get`'s type rather than to paper over a real gap.
        media: media.get(title.mediaId) ?? {
          id: title.mediaId,
          sourceUrl: '',
          title: title.mediaId,
          type: DownloadType.Video,
        },
      }
    })

    const lastTitle = page.at(-1)
    const nextCursor =
      remaining.length > page.length && lastTitle
        ? encodeListCursor({
            filterKey,
            id: lastTitle.mediaId,
            sortKeyMs: lastTitle.addedAtMs,
          })
        : null

    return { items, nextCursor, total: titles.length }
  }

  /**
   * The gallery's chip vocabulary, computed over only the date range - never
   * the currently-selected type/uploader - so narrowing by one facet can't
   * make the others disappear (the classic faceting bug).
   *
   * The two halves count different things on purpose (plan 021). `types`
   * counts the *library* - titles whose `addedAt` is in range, exactly what
   * `listGallery()` would list for that type. `uploaders` still counts
   * completed jobs by `created_at`: an uploader chip is a claim about
   * people, and people live in `jobs`.
   *
   * The uploader aggregate gets `excludeHiddenVideos` unconditionally for a
   * non-admin viewer, not only when a `requester` filter is present like
   * `listGallery()` above - otherwise the facet list itself would reveal
   * that a given uploader contributed something they hid. The type
   * aggregate gets no such guard: a type count leaks no per-uploader
   * identity, hidden or otherwise.
   */
  async getGalleryFacets(
    params: GalleryFacetsParams,
  ): Promise<DownloadGalleryFacets> {
    const typeCounts = new Map<DownloadType, number>()
    for (const title of await this.listLibraryTitles()) {
      if (!isWithinRange(title.addedAtMs, params.createdFrom, params.createdTo))
        continue
      typeCounts.set(title.type, (typeCounts.get(title.type) ?? 0) + 1)
    }

    const uploaderFilter: JobListFilter = {
      createdFrom: params.createdFrom,
      createdTo: params.createdTo,
      excludeHiddenVideos: !params.isAdmin,
      statuses: [DownloadJobStatus.Completed],
    }

    return {
      // Only types with a title, as the old `GROUP BY` had it - an empty
      // type is absent rather than a `0` chip.
      types: Object.values(DownloadType).flatMap(type => {
        const count = typeCounts.get(type)
        return count ? [{ count, type }] : []
      }),
      uploaders: countJobsByRequester(this.dbService.db, uploaderFilter),
    }
  }

  /**
   * Every title the gallery can list, narrowed to `types` when given (an
   * omitted or empty `types` means all three). Radarr/Sonarr are only asked
   * when a movie or show is wanted, and `videos` only when a video is, so a
   * type-filtered page costs nothing from the sources it isn't showing.
   */
  private async listLibraryTitles(
    types?: readonly DownloadType[],
  ): Promise<LibraryTitle[]> {
    const wanted = new Set<DownloadType>(
      types?.length ? types : Object.values(DownloadType),
    )
    const titles: LibraryTitle[] = []

    if (wanted.has(DownloadType.Movie) || wanted.has(DownloadType.Show)) {
      const listing = await this.mediaResolverService.listLibrary()

      for (const entry of listing.entries) {
        if (!wanted.has(entry.media.type)) continue
        titles.push({
          addedAtMs: entry.addedAt.getTime(),
          mediaId: entry.media.id,
          type: entry.media.type,
        })
      }

      const degradedSources = listing.degradedSources.filter(type =>
        wanted.has(type),
      )
      if (degradedSources.length > 0) {
        this.logger.warn(
          { action: 'listLibraryTitles', degradedSources },
          'Library source unreadable - listing the gallery without it',
        )
      }
    }

    if (wanted.has(DownloadType.Video)) {
      for (const row of listVideosWithFiles(this.dbService.db)) {
        titles.push({
          // The same stand-in `hydrateVideo()` puts on `Video.addedAt`: the
          // pipeline's last write is the one that sets `download_urls`.
          addedAtMs: row.updatedAt.getTime(),
          mediaId: mediaId({ id: row.id, type: DownloadType.Video }),
          type: DownloadType.Video,
        })
      }
    }

    return titles
  }

  /**
   * The most recent job per title, under the *same* filter the gallery's
   * download counts ran under - so the requester shown is the last one
   * inside that filter, consistent with what `downloadCount` counts. One
   * query for the whole page rather than one per card; the rows arrive
   * newest-first, so the first one seen per key wins.
   */
  private resolveLastRequesters(
    filter: JobListFilter,
    mediaIds: readonly string[],
  ): Map<string, LastRequester> {
    const latest = new Map<string, LastRequester>()

    const rows = listLatestJobsForMediaIds(this.dbService.db, filter, mediaIds)

    for (const row of rows) {
      if (!row.mediaId || latest.has(row.mediaId)) continue

      const record = hydrateJobRow(row)
      latest.set(row.mediaId, {
        discordRequester: record.discordRequester,
        // Every completed job is stamped on its way into `completed`
        // (`DownloadStateService.updateJob`); `updatedAt` covers a row
        // written before that stamp existed, and is no earlier than it.
        downloadedAt: record.completedAt ?? record.updatedAt,
        hiddenAttribution: record.hiddenAttribution,
        requester: record.requester,
        ...(record.startedUpstream ? { startedUpstream: true } : {}),
      })
    }

    return latest
  }

  private async runJobPage(
    filter: JobListFilter,
    params: PageParams,
  ): Promise<DownloadPage<DownloadJob>> {
    const filterKey = computeFilterKey(filter)
    const cursor = this.decodeCursor(params.cursor, filterKey)

    const page = listJobsPage(this.dbService.db, {
      cursor,
      filter,
      limit: params.limit,
    })

    // One resolver call for the whole page (plan §4.1) - twenty movie jobs
    // on the activity feed cost one Radarr call per TTL window, not twenty.
    const items = await this.downloadStateService.hydrate(
      page.rows.map(hydrateJobRow),
    )

    const lastRow = page.rows.at(-1)
    const nextCursor =
      page.hasMore && lastRow
        ? encodeListCursor({
            filterKey,
            id: lastRow.id,
            sortKeyMs: lastRow.createdAt.getTime(),
          })
        : null

    return { items, nextCursor, total: page.total }
  }

  private decodeCursor(
    cursor: string | undefined,
    filterKey: string,
  ): ListCursor | undefined {
    if (!cursor) return undefined

    const decoded = decodeListCursor(cursor, filterKey)
    if (!decoded) {
      throw new BadRequestException(
        'Invalid or expired cursor - it may have been minted under a different filter',
      )
    }

    return decoded
  }
}
