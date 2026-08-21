import {
  DownloadGalleryFacets,
  DownloadJob,
  DownloadJobStatus,
  DownloadPage,
  DownloadType,
  GalleryItem,
  IN_PROGRESS_DOWNLOAD_JOB_STATUSES,
  JobRequester,
} from '@lilnas/utils/download/types'
import { BadRequestException, Injectable } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import { hydrateJobRow } from 'src/db/job-row'
import {
  countJobsByRequester,
  countJobsByType,
  type JobListFilter,
  listJobsByMediaId,
  listJobsPage,
  listLatestJobsForMediaIds,
  listMediaGroupsPage,
  type MediaGroupRow,
} from 'src/db/jobs.repo'
import {
  computeFilterKey,
  decodeListCursor,
  encodeListCursor,
  type ListCursor,
} from 'src/db/list-cursor'
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
  createdFrom?: Date
  createdTo?: Date
  requesterEmail?: string
  types?: readonly DownloadType[]
}

export interface ListHistoryParams extends PageParams {
  requesterEmail: string
}

export interface GalleryFacetsParams {
  createdFrom?: Date
  createdTo?: Date
  isAdmin: boolean
}

interface LastRequester {
  hiddenAttribution: boolean
  requester: JobRequester | null
}

/**
 * The read side of the `jobs` table for every list route. Activity and
 * history stay job-centric - they're event feeds by nature - while the
 * gallery is media-centric: one card per title, grouped out of the same job
 * log (plan §3.2). Owns cursor decode/encode end-to-end so every route
 * shares one `BadRequestException` path for a malformed cursor.
 */
@Injectable()
export class JobQueryService {
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

  listHistory(params: ListHistoryParams): Promise<DownloadPage<DownloadJob>> {
    return this.runJobPage({ requesterEmail: params.requesterEmail }, params)
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
   * One item per *title*, newest download first. Filters apply directly to
   * `jobs` with no join and no EXISTS subquery, so
   * `?requester=alice&from=2026-03-01` groups only alice's March jobs -
   * i.e. "titles alice downloaded in March", the natural reading.
   */
  async listGallery(
    params: ListGalleryParams,
  ): Promise<DownloadPage<GalleryItem>> {
    const filter: JobListFilter = {
      createdFrom: params.createdFrom,
      createdTo: params.createdTo,
      // The attribution-oracle guard: a `requesterEmail` filter run by a
      // non-admin must not be able to confirm a hidden video exists for
      // that requester, via either the returned rows or `total`. The
      // *unfiltered* gallery still shows hidden videos (masked) - only
      // the requester-keyed lookup is suppressed.
      excludeHiddenVideos: params.requesterEmail ? !params.isAdmin : undefined,
      requesterEmail: params.requesterEmail,
      statuses: [DownloadJobStatus.Completed],
      types: params.types,
    }

    const filterKey = computeFilterKey(filter)
    const cursor = this.decodeCursor(params.cursor, filterKey)

    const page = listMediaGroupsPage(this.dbService.db, {
      cursor,
      filter,
      limit: params.limit,
    })

    const lastRequesters = this.resolveLastRequesters(filter, page.groups)
    const { media } = await this.mediaResolverService.resolve(
      page.groups.map(group => ({ mediaId: group.mediaId, type: group.type })),
    )

    const items = page.groups.map<GalleryItem>(group => {
      const last = lastRequesters.get(group.mediaId)
      const showRequester = showTrueAttribution(
        group.type,
        last?.hiddenAttribution ?? false,
        params.isAdmin,
      )

      return {
        downloadCount: group.downloadCount,
        lastDownloadedAt: new Date(group.lastJobAtMs).toISOString(),
        lastRequester: showRequester ? (last?.requester ?? null) : null,
        // `resolve()` answers for every key it's given (a miss degrades to a
        // placeholder), so this fallback is unreachable - it's here to
        // satisfy `Map.get`'s type rather than to paper over a real gap.
        media: media.get(group.mediaId) ?? {
          id: group.mediaId,
          sourceUrl: '',
          title: group.mediaId,
          type: DownloadType.Video,
        },
      }
    })

    const lastGroup = page.groups.at(-1)
    const nextCursor =
      page.hasMore && lastGroup
        ? encodeListCursor({
            filterKey,
            id: lastGroup.mediaId,
            sortKeyMs: lastGroup.lastJobAtMs,
          })
        : null

    return { items, nextCursor, total: page.total }
  }

  /**
   * The gallery's chip vocabulary, computed over only the date range - never
   * the currently-selected type/uploader - so narrowing by one facet can't
   * make the others disappear (the classic faceting bug). The uploader
   * aggregate gets `excludeHiddenVideos` unconditionally for a non-admin
   * viewer, not only when a `requester` filter is present like
   * `listGallery()` above - otherwise the facet list itself would reveal
   * that a given uploader contributed something they hid. The type
   * aggregate gets no such guard: a type count leaks no per-uploader
   * identity, hidden or otherwise.
   */
  getGalleryFacets(params: GalleryFacetsParams): DownloadGalleryFacets {
    const dateFilter: JobListFilter = {
      createdFrom: params.createdFrom,
      createdTo: params.createdTo,
      statuses: [DownloadJobStatus.Completed],
    }

    const uploaderFilter: JobListFilter = {
      ...dateFilter,
      excludeHiddenVideos: !params.isAdmin,
    }

    return {
      types: countJobsByType(this.dbService.db, dateFilter),
      uploaders: countJobsByRequester(this.dbService.db, uploaderFilter),
    }
  }

  /**
   * The most recent job per group, under the *same* filter the grouping ran
   * under - so the requester shown is the last one inside the filtered
   * window, consistent with what `downloadCount` counts. One query for the
   * whole page rather than one per card; the rows arrive newest-first, so
   * the first one seen per key wins.
   */
  private resolveLastRequesters(
    filter: JobListFilter,
    groups: readonly MediaGroupRow[],
  ): Map<string, LastRequester> {
    const latest = new Map<string, LastRequester>()

    const rows = listLatestJobsForMediaIds(
      this.dbService.db,
      filter,
      groups.map(group => group.mediaId),
    )

    for (const row of rows) {
      if (!row.mediaId || latest.has(row.mediaId)) continue

      const record = hydrateJobRow(row)
      latest.set(row.mediaId, {
        hiddenAttribution: record.hiddenAttribution,
        requester: record.requester,
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
