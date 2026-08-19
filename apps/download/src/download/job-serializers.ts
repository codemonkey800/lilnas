import {
  DownloadJob,
  DownloadJobListItem,
  DownloadType,
  GetDownloadJobResponse,
  GetMovieJobResponse,
  GetShowJobResponse,
  MovieDownloadJob,
  ShowDownloadJob,
} from '@lilnas/utils/download/types'

import { hydrateJobRow } from 'src/db/job-row'
import type { JobRow } from 'src/db/schema'

import { projectJobForViewer } from './attribution'

export function getJobResponse(
  job: DownloadJob,
  isAdmin: boolean,
): GetDownloadJobResponse {
  if (job.type !== DownloadType.Video) {
    throw new Error(
      `Expected a video job but got a '${job.type}' job (id: '${job.id}')`,
    )
  }

  const projected = projectJobForViewer(job, isAdmin)

  return {
    description: projected.description,
    downloadUrls: projected.downloadUrls,
    error: projected.error,
    hiddenAttribution: projected.hiddenAttribution,
    id: projected.id,
    requester: projected.requester,
    status: projected.status,
    timeRange: projected.timeRange,
    title: projected.title,
    type: projected.type,
    url: projected.url,
  }
}

export function getMovieJobResponse(
  job: MovieDownloadJob,
  isAdmin: boolean,
): GetMovieJobResponse {
  const projected = projectJobForViewer(job, isAdmin)

  return {
    description: projected.description,
    error: projected.error,
    id: projected.id,
    mediaTitle: projected.mediaTitle,
    posterUrl: projected.posterUrl,
    queueSnapshot: projected.queueSnapshot,
    radarrId: projected.radarrId,
    requester: projected.requester,
    status: projected.status,
    title: projected.title,
    type: projected.type,
  }
}

export function getShowJobResponse(
  job: ShowDownloadJob,
  isAdmin: boolean,
): GetShowJobResponse {
  const projected = projectJobForViewer(job, isAdmin)

  return {
    description: projected.description,
    error: projected.error,
    id: projected.id,
    mediaTitle: projected.mediaTitle,
    posterUrl: projected.posterUrl,
    queueSnapshot: projected.queueSnapshot,
    requester: projected.requester,
    sonarrId: projected.sonarrId,
    status: projected.status,
    title: projected.title,
    type: projected.type,
  }
}

/**
 * The single generic serializer for every DB-backed list endpoint (activity,
 * gallery, history). Hydrates the row into a `DownloadJob`, dispatches to
 * the matching per-type serializer above - each of which applies
 * `projectJobForViewer` exactly once - then spreads in the two fields a
 * list needs that the per-type responses don't carry: `createdAt` has no
 * home on `DownloadJob` at all (see `hydrateJobRow()`), and `completedAt`
 * travels as an ISO string rather than a `Date` for the wire.
 *
 * One generic serializer rather than three per-endpoint ones: the only
 * difference between activity/gallery/history is their `WHERE`, and
 * per-endpoint serializers would be three places to forget the masking.
 */
export function serializeJobListItem(
  row: JobRow,
  isAdmin: boolean,
): DownloadJobListItem {
  const job = hydrateJobRow(row)
  const listFields = {
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }

  switch (job.type) {
    case DownloadType.Video:
      return { ...getJobResponse(job, isAdmin), ...listFields }
    case DownloadType.Movie:
      return { ...getMovieJobResponse(job, isAdmin), ...listFields }
    case DownloadType.Show:
      return { ...getShowJobResponse(job, isAdmin), ...listFields }
  }
}
