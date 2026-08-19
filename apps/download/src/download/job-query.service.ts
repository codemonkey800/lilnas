import {
  DownloadGalleryFacets,
  DownloadJobListItem,
  DownloadJobStatus,
  DownloadPage,
  DownloadType,
  IN_PROGRESS_DOWNLOAD_JOB_STATUSES,
} from '@lilnas/utils/download/types'
import { BadRequestException, Injectable } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import {
  computeFilterKey,
  decodeJobCursor,
  encodeJobCursor,
  type JobCursor,
} from 'src/db/job-cursor'
import {
  countJobsByRequester,
  countJobsByType,
  type JobListFilter,
  listJobsPage,
} from 'src/db/jobs.repo'

import { serializeJobListItem } from './job-serializers'

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

/**
 * The read side of the `jobs` table for every list route (activity,
 * gallery, history). Owns cursor decode/encode end-to-end so all three
 * routes share one `BadRequestException` path for a malformed cursor,
 * rather than each route re-deriving it.
 */
@Injectable()
export class JobQueryService {
  constructor(private readonly dbService: DbService) {}

  // No `requesterEmail` param by design (spec) - the activity feed is a
  // cross-user, in-progress-only view, not scoped to any one requester.
  listActivity(params: ListActivityParams): DownloadPage<DownloadJobListItem> {
    return this.runPage(
      { statuses: IN_PROGRESS_DOWNLOAD_JOB_STATUSES, types: params.types },
      params,
    )
  }

  listGallery(params: ListGalleryParams): DownloadPage<DownloadJobListItem> {
    return this.runPage(
      {
        createdFrom: params.createdFrom,
        createdTo: params.createdTo,
        // The attribution-oracle guard: a `requesterEmail` filter run by a
        // non-admin must not be able to confirm a hidden video exists for
        // that requester, via either the returned rows or `total`. The
        // *unfiltered* gallery still shows hidden videos (masked) - only
        // the requester-keyed lookup is suppressed.
        excludeHiddenVideos: params.requesterEmail
          ? !params.isAdmin
          : undefined,
        requesterEmail: params.requesterEmail,
        statuses: [DownloadJobStatus.Completed],
        types: params.types,
      },
      params,
    )
  }

  listHistory(params: ListHistoryParams): DownloadPage<DownloadJobListItem> {
    return this.runPage({ requesterEmail: params.requesterEmail }, params)
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

  private runPage(
    filter: JobListFilter,
    params: PageParams,
  ): DownloadPage<DownloadJobListItem> {
    const filterKey = computeFilterKey(filter)
    const cursor = this.decodeCursor(params.cursor, filterKey)

    const page = listJobsPage(this.dbService.db, {
      cursor,
      filter,
      limit: params.limit,
    })

    const items = page.rows.map(row =>
      serializeJobListItem(row, params.isAdmin),
    )

    const lastRow = page.rows.at(-1)
    const nextCursor =
      page.hasMore && lastRow
        ? encodeJobCursor({
            createdAtMs: lastRow.createdAt.getTime(),
            filterKey,
            id: lastRow.id,
          })
        : null

    return { items, nextCursor, total: page.total }
  }

  private decodeCursor(
    cursor: string | undefined,
    filterKey: string,
  ): JobCursor | undefined {
    if (!cursor) return undefined

    const decoded = decodeJobCursor(cursor, filterKey)
    if (!decoded) {
      throw new BadRequestException(
        'Invalid or expired cursor - it may have been minted under a different filter',
      )
    }

    return decoded
  }
}
