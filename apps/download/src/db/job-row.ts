import {
  DiscordRequester,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  JobRequester,
} from '@lilnas/utils/download/types'

import { JOB_ROW_ORIGINS, type JobRow, jobs } from './schema'

/**
 * Maps a `DownloadJobRecord` onto the `jobs` table's row shape. No branch on
 * `type` anymore and no per-type column fillers: every media-shaped field
 * moved either onto the `videos` table or into a live Radarr/Sonarr lookup,
 * leaving `jobs` as a flat event log keyed to a title by `(type, media_id)`.
 */
export function buildJobRow(
  record: DownloadJobRecord,
): typeof jobs.$inferInsert {
  return {
    completedAt: record.completedAt ? new Date(record.completedAt) : null,
    createdAt: new Date(record.createdAt),
    // Phase 018. Null on every non-Discord job, and - per
    // `jobs_origin_matches_requester` - never set alongside the requester
    // pair below. `record.linkedDiscord` deliberately has no column: it is
    // resolved at read time from `apps/auth`'s link table, so persisting it
    // here would be a second cache with its own staleness.
    discordUserId: record.discordRequester?.discordUserId ?? null,
    discordUsername: record.discordRequester?.discordUsername ?? null,
    error: record.error ?? null,
    hiddenAttribution: record.hiddenAttribution,
    id: record.id,
    mediaId: record.mediaId,
    // A service caller (e.g. apps/tdr-bot) never carries a requester, and
    // this is the only place `origin` is derived - never set on the record
    // type itself, since it's fully determined by which attribution the
    // source-of-truth job carries. `requester` is checked first so that a
    // hypothetical job carrying both still lands as `web`: the two are
    // mutually exclusive at the DB layer, so a row carrying both would be
    // rejected by the CHECK rather than silently stored either way.
    // `startedUpstream` (plan 022, an adopted Radarr/Sonarr download) is
    // checked last for the same reason: a person's attribution always wins,
    // and the CHECK would reject an `upstream` row carrying one anyway.
    // Explicitly typed against JOB_ROW_ORIGINS's own element type (not left
    // to infer as `string`) since the object literal has no annotation for it
    // to be contextually typed against.
    origin: (record.requester
      ? 'web'
      : record.discordRequester
        ? 'discord'
        : record.startedUpstream
          ? 'upstream'
          : 'service') as (typeof JOB_ROW_ORIGINS)[number],
    requesterEmail: record.requester?.email ?? null,
    requesterUserId: record.requester?.userId ?? null,
    // `null`, not `undefined`, on the way *in* - a column is either set or
    // NULL, and drizzle would treat `undefined` as "leave this column out".
    // `hydrateJobRow` maps it back to `undefined`, matching how `error`
    // already crosses the same boundary.
    scope: record.scope ?? null,
    status: record.status,
    type: record.type,
    updatedAt: new Date(),
  }
}

/**
 * The inverse of `buildJobRow()` - reconstructs a `DownloadJobRecord` from a
 * persisted `jobs` row. `origin` still has no home on the record (it's a
 * write-only derived column, fully determined by which attribution the job
 * carries) - except that `upstream` is the one origin no attribution column
 * can express, so it comes back as `startedUpstream: true`, and every other
 * origin leaves that key off entirely. The two other round-trip caveats this
 * function used to carry
 * are gone: `createdAt`/`updatedAt` are on the record now, and there is no
 * longer a `proc`/`file` field with no column behind it.
 *
 * `linkedDiscord` is always `null` here and that is not a round-trip gap: it
 * has no column to come back from, being resolved from `apps/auth`'s link
 * table by a later read-path layer. A hydrated record is the *persisted*
 * truth; enrichment happens on top of it.
 */
export function hydrateJobRow(row: JobRow): DownloadJobRecord {
  const requester: JobRequester | null =
    row.requesterEmail && row.requesterUserId
      ? { email: row.requesterEmail, userId: row.requesterUserId }
      : null

  // Both columns or neither - the half-populated case is unrepresentable at
  // the DB layer (`jobs_origin_matches_requester`), so requiring both here
  // costs nothing and keeps this function total for rows written before the
  // columns existed.
  const discordRequester: DiscordRequester | null =
    row.discordUserId && row.discordUsername
      ? {
          discordUserId: row.discordUserId,
          discordUsername: row.discordUsername,
        }
      : null

  return {
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    discordRequester,
    error: row.error ?? undefined,
    hiddenAttribution: row.hiddenAttribution,
    id: row.id,
    linkedDiscord: null,
    mediaId: row.mediaId,
    requester,
    scope: row.scope ?? undefined,
    // Spread rather than `startedUpstream: row.origin === 'upstream'`: the
    // field is optional on the wire and absent means "no", so a `false` on
    // every other job would just be noise in every payload and fixture.
    ...(row.origin === 'upstream' ? { startedUpstream: true } : {}),
    status: row.status as DownloadJobStatus,
    type: row.type as DownloadType,
    updatedAt: row.updatedAt.toISOString(),
  }
}
