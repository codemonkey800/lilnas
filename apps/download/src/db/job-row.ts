import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  isMovieDownloadJob,
  isShowDownloadJob,
  isVideoDownloadJob,
  JobRequester,
} from '@lilnas/utils/download/types'

import { JOB_ORIGINS, type JobRow, jobs } from './schema'

/**
 * Maps a `DownloadJob` (whichever member of the union) onto the `jobs`
 * table's row shape. Fields that don't apply to a given job type (e.g.
 * `radarrId` on a video job) are written as `null` rather than omitted -
 * this is a full upsert, not a partial patch, so every column must have an
 * explicit value on every write.
 */
export function buildJobRow(job: DownloadJob): typeof jobs.$inferInsert {
  // Fields common to every member of the union. `completedAt` is carried on
  // the job itself (stamped once by updateJob() on the Completed
  // transition, see there) rather than re-derived from `job.status` here -
  // that re-derivation used to clear the timestamp on any later write,
  // including a Completed -> Cancelled transition.
  const base = {
    completedAt: job.completedAt ?? null,
    description: job.description ?? null,
    error: job.error ?? null,
    id: job.id,
    // A service caller (e.g. apps/tdr-bot) never carries a requester, and
    // this is the only place `origin` is derived - never set on the
    // DownloadJob TS type itself, since it's fully determined by
    // `requester`'s presence on the source-of-truth job. Explicitly typed
    // against JOB_ORIGINS's own element type (not left to infer as `string`)
    // since `base` itself has no annotation for the branches below to
    // contextually type this literal against.
    origin: (job.requester ? 'web' : 'service') as (typeof JOB_ORIGINS)[number],
    requesterEmail: job.requester?.email ?? null,
    requesterUserId: job.requester?.userId ?? null,
    status: job.status,
    title: job.title ?? null,
    type: job.type,
    updatedAt: new Date(),
    url: job.url,
  }

  // Branch once on the discriminant, rather than repeating
  // `isVideoDownloadJob(job)` per-field in both polarities - each arm below
  // supplies every video-only/media-only column exactly once, narrowed by a
  // single guard call, so a mirror-image slip (e.g. `radarrId` written into
  // the `sonarrId` slot) can't hide behind an unrelated field's polarity.
  if (isVideoDownloadJob(job)) {
    return {
      ...base,
      downloadUrls: job.downloadUrls ?? null,
      filePath: null,
      hiddenAttribution: job.hiddenAttribution ?? false,
      mediaTitle: null,
      overview: null,
      posterUrl: null,
      queueSnapshot: null,
      radarrId: null,
      sonarrId: null,
      timeRange: job.timeRange ?? null,
    }
  }

  return {
    ...base,
    downloadUrls: null,
    filePath: job.filePath ?? null,
    hiddenAttribution: false,
    mediaTitle: job.mediaTitle ?? null,
    overview: job.overview ?? null,
    posterUrl: job.posterUrl ?? null,
    queueSnapshot: job.queueSnapshot ?? null,
    radarrId: isMovieDownloadJob(job) ? (job.radarrId ?? null) : null,
    sonarrId: isShowDownloadJob(job) ? (job.sonarrId ?? null) : null,
    timeRange: null,
  }
}

/**
 * The inverse of `buildJobRow()` - reconstructs a `DownloadJob` from a
 * persisted `jobs` row. Not a lossless round-trip in both directions:
 *
 * - `origin` has no home on `DownloadJob` - it's a write-only derived
 *   column, fully determined by `requester`'s presence, so it's dropped
 *   here rather than threaded through.
 * - `createdAt`/`updatedAt` have no home on `DownloadJob` either - callers
 *   that need them (e.g. a list serializer) must read them off the row
 *   directly rather than through this function.
 * - `VideoDownloadJob.proc` (a live `ChildProcess` handle) and `.file` (a
 *   transient local filesystem path used mid-pipeline) have no columns and
 *   can never be reconstructed - a restart kills the underlying yt-dlp
 *   process too, so there is nothing to hydrate back.
 * - `hiddenAttribution` is video-only on the domain types; it's read here
 *   only in the video branch and ignored on the movie/show arms, matching
 *   `buildJobRow()`'s own video-only write.
 */
export function hydrateJobRow(row: JobRow): DownloadJob {
  const requester: JobRequester | null =
    row.requesterEmail && row.requesterUserId
      ? { email: row.requesterEmail, userId: row.requesterUserId }
      : null

  switch (row.type) {
    case 'video':
      return {
        completedAt: row.completedAt ?? undefined,
        description: row.description ?? undefined,
        downloadUrls: row.downloadUrls ?? undefined,
        error: row.error ?? undefined,
        hiddenAttribution: row.hiddenAttribution,
        id: row.id,
        requester,
        status: row.status as DownloadJobStatus,
        timeRange: row.timeRange ?? undefined,
        title: row.title ?? undefined,
        type: DownloadType.Video,
        url: row.url,
      }
    case 'movie':
      return {
        completedAt: row.completedAt ?? undefined,
        description: row.description ?? undefined,
        error: row.error ?? undefined,
        filePath: row.filePath ?? undefined,
        id: row.id,
        mediaTitle: row.mediaTitle ?? undefined,
        overview: row.overview ?? undefined,
        posterUrl: row.posterUrl ?? undefined,
        queueSnapshot: row.queueSnapshot ?? undefined,
        radarrId: row.radarrId ?? undefined,
        requester,
        status: row.status as DownloadJobStatus,
        title: row.title ?? undefined,
        type: DownloadType.Movie,
        url: row.url,
      }
    case 'show':
      return {
        completedAt: row.completedAt ?? undefined,
        description: row.description ?? undefined,
        error: row.error ?? undefined,
        filePath: row.filePath ?? undefined,
        id: row.id,
        mediaTitle: row.mediaTitle ?? undefined,
        overview: row.overview ?? undefined,
        posterUrl: row.posterUrl ?? undefined,
        queueSnapshot: row.queueSnapshot ?? undefined,
        requester,
        sonarrId: row.sonarrId ?? undefined,
        status: row.status as DownloadJobStatus,
        title: row.title ?? undefined,
        type: DownloadType.Show,
        url: row.url,
      }
    default:
      throw new Error(`Unknown job row type: '${row.type as string}'`)
  }
}
