import {
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  JobRequester,
} from '@lilnas/utils/download/types'

import { mediaIdFromLegacyJobUrl } from './media-id'
import { JOB_ORIGINS, type JobRow, jobs } from './schema'

/**
 * Maps a `DownloadJobRecord` onto the `jobs` table's row shape. No branch on
 * `type` anymore and no per-type column fillers: every media-shaped field
 * moved either onto the `videos` table or into a live Radarr/Sonarr lookup,
 * leaving `jobs` as a flat event log keyed to a title by `(type, media_id)`.
 *
 * The twelve legacy media columns are still written - as explicit `null`s -
 * rather than omitted, because this is a full upsert and drizzle's `set:`
 * type makes every key optional, so an omission would silently leave a
 * pre-Media row's stale `title`/`url`/`poster_url` in place. They are
 * dropped outright by the next migration.
 */
export function buildJobRow(
  record: DownloadJobRecord,
): typeof jobs.$inferInsert {
  return {
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
    createdAt: new Date(record.createdAt),
    error: record.error ?? null,
    hiddenAttribution: record.hiddenAttribution,
    id: record.id,
    mediaId: record.mediaId,
    // A service caller (e.g. apps/tdr-bot) never carries a requester, and
    // this is the only place `origin` is derived - never set on the record
    // type itself, since it's fully determined by `requester`'s presence on
    // the source-of-truth job. Explicitly typed against JOB_ORIGINS's own
    // element type (not left to infer as `string`) since the object literal
    // has no annotation for it to be contextually typed against.
    origin: (record.requester
      ? 'web'
      : 'service') as (typeof JOB_ORIGINS)[number],
    requesterEmail: record.requester?.email ?? null,
    requesterUserId: record.requester?.userId ?? null,
    status: record.status,
    type: record.type,
    updatedAt: new Date(),

    // ---- Dropped by the next migration; written null so no stale
    // pre-Media value can survive an upsert. `url` is the one that can't be
    // null yet (NOT NULL until the drop), so it carries the media key -
    // nothing reads this column anymore.
    description: null,
    downloadUrls: null,
    filePath: null,
    mediaTitle: null,
    overview: null,
    posterUrl: null,
    queueSnapshot: null,
    radarrId: null,
    sonarrId: null,
    timeRange: null,
    title: null,
    url: record.mediaId,
  }
}

/**
 * The inverse of `buildJobRow()` - reconstructs a `DownloadJobRecord` from a
 * persisted `jobs` row. `origin` still has no home on the record (it's a
 * write-only derived column, fully determined by `requester`'s presence), but
 * the two other round-trip caveats this function used to carry are gone:
 * `createdAt`/`updatedAt` are on the record now, and there is no longer a
 * `proc`/`file` field with no column behind it.
 *
 * `media_id` is read through `mediaIdFromLegacyJobUrl()` as a fallback for
 * the window before the backfill migration has run against a given database
 * - the column is nullable until the next migration tightens it.
 */
export function hydrateJobRow(row: JobRow): DownloadJobRecord {
  const requester: JobRequester | null =
    row.requesterEmail && row.requesterUserId
      ? { email: row.requesterEmail, userId: row.requesterUserId }
      : null

  const type = row.type as DownloadType

  return {
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    error: row.error ?? undefined,
    hiddenAttribution: row.hiddenAttribution,
    id: row.id,
    mediaId: row.mediaId ?? mediaIdFromLegacyJobUrl(type, row.url) ?? '',
    requester,
    status: row.status as DownloadJobStatus,
    type,
    updatedAt: row.updatedAt.toISOString(),
  }
}
