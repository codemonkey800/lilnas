import {
  DownloadJobStatus,
  type DownloadType,
  TERMINAL_DOWNLOAD_JOB_STATUSES,
} from '@lilnas/utils/download/types'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'

import type { Db } from './db.service'
import type { ListCursor } from './list-cursor'
import { type JobRow, jobs } from './schema'

/**
 * Every field is optional/omittable - an absent field means "don't filter
 * on this dimension" rather than "filter on the empty set". Shared by every
 * Phase 2 list/facet query; each caller (JobQueryService) builds one of
 * these per route rather than exposing a free-form filter to callers, so
 * the authorization rules documented on each route stay enforced before a
 * filter object is ever constructed.
 */
export interface JobListFilter {
  createdFrom?: Date
  createdTo?: Date
  // See job-query.service.ts's gallery/facets handling: set whenever a
  // `requesterEmail` filter is applied by a non-admin viewer. Without this,
  // the filter itself becomes an attribution oracle - every returned row is
  // still masked, but the fact that a hidden video *matched* the filter (and
  // is counted in `total`) leaks the hidden requester's identity just as
  // surely as showing it would.
  //
  // ⚠️ The oracle is about *filtering by a person*, not about which column
  // names that person. `requesterDiscordUserId` below is a second way to
  // spell the same thing, so the guard has to trip on either - which is why
  // callers compute it from {@link isRequesterScoped} rather than from
  // `requesterEmail` alone.
  excludeHiddenVideos?: boolean
  // The derived `(type, mediaId)` key (plan §"What 'derived' means") -
  // `/media/:id`'s job lookup (Phase 6) filters on this instead of a job id,
  // since a title's jobs span every request for it, not just one.
  mediaId?: string
  // The *other* half of one person's identity (plan 017 §E2). Set alongside
  // `requesterEmail` when the person being filtered for has a linked Discord
  // account, at which point the two become a single OR-ed arm - see
  // `buildJobWhere` - so a linked person's web-submitted and
  // Discord-submitted jobs come back as one list.
  //
  // ⚠️ **Never caller-supplied.** There is no `?discordUserId=` query
  // parameter anywhere in this app; every producer of this field derives it
  // from the *same person* `requesterEmail` names (the viewer's own link on a
  // self view, or `DiscordLinkService.getLinkedDiscordUserIdByEmail()` of the
  // requester an admin named). That is what keeps the two arms
  // indistinguishable to the authorization checks in front of them - see the
  // note on `excludeHiddenVideos` below.
  requesterDiscordUserId?: string
  requesterEmail?: string
  statuses?: readonly DownloadJobStatus[]
  // Plural/array, not a single value - the query schema accepts
  // comma-separated multi-select (`?type=movie,video`), matched here with
  // `inArray` the same way `statuses` above is.
  types?: readonly DownloadType[]
}

/**
 * The two fields that aim a query at one *person*. Named as its own type so
 * the hidden-attribution guard has something to key off that isn't "whichever
 * requester field I happened to remember".
 */
export type RequesterScope = Pick<
  JobListFilter,
  'requesterDiscordUserId' | 'requesterEmail'
>

/**
 * "Is this query aimed at one person?" - the single predicate the
 * attribution-oracle guard (`excludeHiddenVideos`) is computed from.
 *
 * ⚠️ Exists so that widening the filter from one identity column to two could
 * not silently widen the *oracle* too. Before plan 017, callers wrote
 * `params.requesterEmail ? !params.isAdmin : undefined`; a filter carrying
 * only the Discord arm would have sailed straight past that test with the
 * guard left `undefined`, and a non-admin who could aim such a filter would
 * learn "this person has a hidden video" from a non-zero `total`. Routing
 * every such decision through here means a third identity column, whenever it
 * arrives, is added in one place and the guard follows automatically.
 */
export function isRequesterScoped(scope: RequesterScope): boolean {
  return Boolean(scope.requesterEmail ?? scope.requesterDiscordUserId)
}

export interface JobPageQuery {
  cursor?: ListCursor
  filter: JobListFilter
  limit: number
}

export interface JobPageResult {
  hasMore: boolean
  rows: JobRow[]
  total: number
}

/**
 * Builds the shared `WHERE` clause for a filter - used by both halves of
 * `listJobsPage()` (the page query and the `total` count) so the two can
 * never drift onto different predicates, and reused as-is by the
 * gallery-facets aggregates (job-query.service.ts), which apply the same
 * filter dimensions minus the cursor.
 */
function buildJobWhere(filter: JobListFilter): SQL | undefined {
  const conditions: Array<SQL | undefined> = [
    filter.statuses && filter.statuses.length > 0
      ? inArray(jobs.status, [...filter.statuses])
      : undefined,
    filter.types && filter.types.length > 0
      ? inArray(jobs.type, [...filter.types])
      : undefined,
    filter.mediaId ? eq(jobs.mediaId, filter.mediaId) : undefined,
    buildRequesterWhere(filter),
    filter.createdFrom ? gte(jobs.createdAt, filter.createdFrom) : undefined,
    filter.createdTo ? lte(jobs.createdAt, filter.createdTo) : undefined,
    filter.excludeHiddenVideos
      ? sql`NOT (${jobs.type} = 'video' AND ${jobs.hiddenAttribution} = 1)`
      : undefined,
  ]

  return and(...conditions)
}

/**
 * The "which rows belong to this person" arm of {@link buildJobWhere},
 * extracted so both it and {@link getRequesterActivityBounds} share one
 * definition of that question.
 *
 * Zero arms -> `undefined`, i.e. no predicate at all. That absence is load
 * bearing: it is the only way a service-created job (NULL `requester_email`
 * *and* NULL `discord_user_id`) appears in a list, since neither comparison
 * below can ever match NULL.
 *
 * One arm -> plain equality. Two arms -> `(email = ? OR discord_user_id = ?)`,
 * parenthesized by drizzle's `or()` so it can never absorb the sibling
 * conditions it is AND-ed with.
 *
 * The OR selects **disjoint** row sets by construction, not by luck: D1's
 * `jobs_origin_matches_requester` CHECK makes `requester_*` and `discord_*`
 * mutually exclusive per row, so no row can satisfy both arms and no
 * `DISTINCT`/dedupe is needed anywhere downstream (`total`, the `MAX()`
 * grouping, the bounds aggregate).
 *
 * Both arms are indexed - `jobs_discord_user_id_idx` (D1) for the second -
 * though the `lower()` on the first has always been a scan-side expression
 * rather than an index seek, which is unchanged here.
 */
function buildRequesterWhere(scope: RequesterScope): SQL | undefined {
  const arms: SQL[] = []

  // Case-insensitive: the stored value is whatever casing arrived on the
  // `X-Forwarded-User` header verbatim (see forwarded-user.ts), which may
  // not match the casing a caller passes on `?requester=`.
  if (scope.requesterEmail) {
    arms.push(
      sql`lower(${jobs.requesterEmail}) = ${scope.requesterEmail.toLowerCase()}`,
    )
  }

  // No normalization, unlike the email above: a snowflake is an opaque digit
  // string with no case to fold, and it never arrives from a caller anyway
  // (see `JobListFilter.requesterDiscordUserId`).
  if (scope.requesterDiscordUserId) {
    arms.push(eq(jobs.discordUserId, scope.requesterDiscordUserId))
  }

  return arms.length > 0 ? or(...arms) : undefined
}

/**
 * Fetches one page of `jobs` rows (newest first) plus the total count of the
 * filtered set, as a single atomic read - the only way `total` can never be
 * computed against a different `WHERE` than the page itself. Runs inside a
 * `db.transaction()`; better-sqlite3's driver is fully synchronous, so this
 * function is too.
 *
 * Cursor pagination is a descending row-value comparison on
 * `(created_at, id)`, matching `jobs_created_at_id_idx`
 * (schema.ts) exactly - `id` breaks ties between rows sharing the same
 * `created_at` millisecond, which a plain `created_at <` predicate would
 * silently drop or duplicate across a page boundary. `cursor.sortKeyMs`
 * is bound as a plain number (not a `Date`) because this is a raw `sql`
 * template - unlike `gte`/`lte` above, a raw template bypasses the
 * `timestamp_ms` column mapper entirely, and better-sqlite3 cannot bind a
 * `Date` directly.
 */
export function listJobsPage(db: Db, query: JobPageQuery): JobPageResult {
  const { cursor, filter, limit } = query
  const whereClause = buildJobWhere(filter)

  return db.transaction(() => {
    const pageConditions: Array<SQL | undefined> = [
      whereClause,
      cursor
        ? sql`(${jobs.createdAt}, ${jobs.id}) < (${cursor.sortKeyMs}, ${cursor.id})`
        : undefined,
    ]
    const pageWhere = and(...pageConditions)

    const pageBase = db.select().from(jobs)
    const fetched = (pageWhere ? pageBase.where(pageWhere) : pageBase)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(limit + 1)
      .all()

    // Fetch one extra row to detect a further page without a second
    // round-trip; `.slice()` (not indexed access) drops it, since
    // noUncheckedIndexedAccess makes `rows[limit]`/`rows[limit - 1]`
    // possibly-undefined even though the length check already guarantees
    // it's present.
    const hasMore = fetched.length > limit
    const rows = hasMore ? fetched.slice(0, limit) : fetched

    const totalQuery = db.select({ total: count() }).from(jobs)
    const totalRow = (
      whereClause ? totalQuery.where(whereClause) : totalQuery
    ).get()

    return { hasMore, rows, total: totalRow?.total ?? 0 }
  })
}

/**
 * A single row by id, or `undefined` if it doesn't exist. Used as the
 * durable-storage fallback for the three detail routes
 * (`/videos/:id`, `/movies/:id`, `/shows/:id`) when the in-memory `Map`
 * has no entry - the only way those routes survive a restart, since the
 * Map itself is emptied by one (see `DownloadStateService.resolveJob()`).
 */
export function getJobById(db: Db, id: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()
}

/**
 * Every job for one title, newest first - `GET /download/media/:id`'s
 * `jobs[]`. An empty array is the endpoint's "not downloaded yet" state,
 * not an error: a movie has a detail page whether or not anyone has ever
 * requested it (plan §3.1).
 */
export function listJobsByMediaId(db: Db, mediaId: string): JobRow[] {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.mediaId, mediaId))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .all()
}

/**
 * Every job at one status, newest first. Used at boot by
 * `DownloadStateService.adoptOpenJobs()` to find the `needs_attention` rows
 * `reconcileInterruptedJobs()` spares whatever their type - a boot-path
 * reader that needs a whole status bucket without any of the list endpoints'
 * filtering, paging or attribution masking.
 */
export function listJobsByStatus(db: Db, status: DownloadJobStatus): JobRow[] {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.status, status))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .all()
}

/**
 * Every non-terminal job, newest first, optionally narrowed to `types` (an
 * omitted or empty `types` means every type). Used at boot by
 * `DownloadStateService.adoptOpenJobs()` to re-adopt the movie/show attempts
 * a restart leaves open - like `listJobsByStatus()`, an unfiltered, unpaged
 * boot-path reader with no attribution masking.
 */
export function listOpenJobs(
  db: Db,
  types?: readonly DownloadType[],
): JobRow[] {
  const open = notInArray(jobs.status, [...TERMINAL_DOWNLOAD_JOB_STATUSES])

  return db
    .select()
    .from(jobs)
    .where(types?.length ? and(open, inArray(jobs.type, [...types])) : open)
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .all()
}

/**
 * How many ids go into one `IN (...)` list. A requester-scoped gallery asks
 * about every title in the library at once, and the library is not bounded
 * by anything this app controls - so the list is split well under SQLite's
 * bound-parameter limit rather than trusted to fit.
 */
const MEDIA_ID_CHUNK_SIZE = 500

/**
 * Completed jobs per title, for the titles in `mediaIds` - the gallery's
 * `downloadCount`, and (keys only) its "titles this requester has a completed
 * job for" join (plan 021). A title with no matching job is absent from the
 * map rather than present as `0`, so `.has()` is the join.
 *
 * `filter.statuses` is overridden to completed-only, whatever the caller set:
 * a count of *downloads* has no other sensible status, and the name says so.
 * Every other dimension (requester, `excludeHiddenVideos`, ...) goes through
 * the shared `buildJobWhere()`, so the attribution-oracle guard applies here
 * exactly as it does to every list query.
 */
export function countCompletedJobsByMediaIds(
  db: Db,
  filter: JobListFilter,
  mediaIds: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>()
  const whereClause = buildJobWhere({
    ...filter,
    statuses: [DownloadJobStatus.Completed],
  })

  for (let start = 0; start < mediaIds.length; start += MEDIA_ID_CHUNK_SIZE) {
    const chunk = mediaIds.slice(start, start + MEDIA_ID_CHUNK_SIZE)
    const rows = db
      .select({ count: count(), mediaId: jobs.mediaId })
      .from(jobs)
      .where(and(whereClause, inArray(jobs.mediaId, chunk)))
      .groupBy(jobs.mediaId)
      .all()

    for (const row of rows) {
      if (row.mediaId) counts.set(row.mediaId, row.count)
    }
  }

  return counts
}

/**
 * Every job matching `filter` whose `media_id` is in `mediaIds`, newest
 * first - the gallery's `lastRequester`/`lastDownloadedAt` follow-up query.
 * One query for the whole page (≤100 keys) rather than one per card; the
 * caller takes the first row it sees per `(type, media_id)`, which the
 * ordering makes the most recent.
 *
 * The gallery runs it under the *same* filter as its
 * `countCompletedJobsByMediaIds()` call, so the requester shown is the last
 * one within that filter rather than the last one overall - consistent with
 * what `downloadCount` counts.
 */
export function listLatestJobsForMediaIds(
  db: Db,
  filter: JobListFilter,
  mediaIds: readonly string[],
): JobRow[] {
  if (mediaIds.length === 0) return []

  const conditions: Array<SQL | undefined> = [
    buildJobWhere(filter),
    inArray(jobs.mediaId, [...mediaIds]),
  ]

  return db
    .select()
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .all()
}

export interface RequesterFacetCount {
  count: number
  email: string
}

export interface TypeFacetCount {
  count: number
  type: DownloadType
}

/**
 * Distinct requesters (with counts) matching `filter`, for the gallery
 * facets endpoint's uploader chip list. Rows with no requester (a
 * service-origin job) are excluded entirely rather than surfaced as a
 * `null`/"unknown" bucket - `JobQueryService` is responsible for passing an
 * `excludeHiddenVideos`-bearing `filter` here so a hidden video's uploader
 * can never be inferred from this list either.
 */
export function countJobsByRequester(
  db: Db,
  filter: JobListFilter,
): RequesterFacetCount[] {
  const whereClause = buildJobWhere(filter)
  const conditions: Array<SQL | undefined> = [
    whereClause,
    isNotNull(jobs.requesterEmail),
  ]

  return db
    .select({ count: count(), email: jobs.requesterEmail })
    .from(jobs)
    .where(and(...conditions))
    .groupBy(jobs.requesterEmail)
    .all()
    .filter((row): row is RequesterFacetCount => row.email !== null)
}

/**
 * Distinct job types (with counts) matching `filter`, for the gallery
 * facets endpoint's type chip list. Unlike `countJobsByRequester()` above,
 * this is never given an `excludeHiddenVideos` filter - a type count leaks
 * no per-uploader identity, hidden or otherwise.
 */
export function countJobsByType(
  db: Db,
  filter: JobListFilter,
): TypeFacetCount[] {
  const whereClause = buildJobWhere(filter)

  const base = db.select({ count: count(), type: jobs.type }).from(jobs)

  return (whereClause ? base.where(whereClause) : base)
    .groupBy(jobs.type)
    .all() as TypeFacetCount[]
}

export interface StatusFacetCount {
  count: number
  status: DownloadJobStatus
}

/**
 * Distinct job statuses (with counts) matching `filter` - the admin
 * dashboard's status breakdown. Structurally identical to
 * `countJobsByType()` above, and like it never given an
 * `excludeHiddenVideos` filter: a status count leaks no per-uploader
 * identity.
 *
 * Only statuses actually present in the filtered set appear; a status with
 * zero rows is absent rather than returned as `{ count: 0 }`, so callers
 * that need a fixed-shape breakdown must fill the gaps themselves.
 */
export function countJobsByStatus(
  db: Db,
  filter: JobListFilter,
): StatusFacetCount[] {
  const whereClause = buildJobWhere(filter)

  const base = db.select({ count: count(), status: jobs.status }).from(jobs)

  return (whereClause ? base.where(whereClause) : base)
    .groupBy(jobs.status)
    .all() as StatusFacetCount[]
}

export interface DailyJobCount {
  count: number
  /** `YYYY-MM-DD`, always a **UTC** calendar day (see below). */
  day: string
  type: DownloadType
}

/**
 * Job counts bucketed by calendar day *and* type - the admin dashboard's
 * activity chart. One row per `(day, type)` pair that has at least one job;
 * empty days/types are absent rather than zero-filled, so the caller is
 * responsible for densifying the series across its own window.
 *
 * `created_at` is `timestamp_ms` (epoch **milliseconds**, see schema.ts's
 * timestamp convention), hence the `/ 1000` before `'unixepoch'`, which
 * expects seconds. SQLite's `/` is integer division when both operands are
 * integers, so this truncates to the second rather than producing a float.
 *
 * **Day boundaries are UTC, deliberately.** `date(..., 'unixepoch')` with
 * no `'localtime'` modifier interprets the timestamp in UTC; adding
 * `'localtime'` would make the buckets depend on the container's `TZ`, so a
 * chart would silently reshape on redeploy and two clients in different
 * zones would disagree about the same data. Do not "fix" this to local
 * time - if a local-day view is ever wanted, shift the window in the
 * caller's `filter.createdFrom`/`createdTo` instead.
 *
 * The window itself comes from `filter` (`createdFrom`/`createdTo`) through
 * the shared `buildJobWhere()`, so this aggregate can never drift onto a
 * different predicate than the list and facet queries above.
 */
export function countJobsByDay(db: Db, filter: JobListFilter): DailyJobCount[] {
  const whereClause = buildJobWhere(filter)
  const day = sql<string>`date(${jobs.createdAt} / 1000, 'unixepoch')`

  const base = db.select({ count: count(), day, type: jobs.type }).from(jobs)

  return (whereClause ? base.where(whereClause) : base)
    .groupBy(day, jobs.type)
    .orderBy(asc(day))
    .all() as DailyJobCount[]
}

export interface RequesterActivityBounds {
  firstCreatedAtMs: number | null
  lastCreatedAtMs: number | null
}

/**
 * The `created_at` extremes of one requester's jobs - the profile page's
 * first/last download timestamps. Epoch **milliseconds** (raw `min`/`max`
 * over a `timestamp_ms` column bypasses the `Date` mapper), or both `null`
 * for a requester with no jobs: SQLite's `min`/`max` over an empty set
 * yields one row of NULLs, which is mapped here rather than surfaced as a
 * zero-row result.
 *
 * Takes the whole {@link RequesterScope} rather than a bare email so a linked
 * person's first download is their first download on *either* surface - a
 * profile that said "first download: March" while listing a Discord job from
 * January would be self-contradicting. The match goes through the shared
 * `buildJobWhere()`, so it stays case-insensitive (and OR-ed) exactly the way
 * every other requester filter is.
 *
 * Hidden videos are deliberately included - see `ProfileService` for why the
 * profile route never applies `excludeHiddenVideos`.
 */
export function getRequesterActivityBounds(
  db: Db,
  scope: RequesterScope,
): RequesterActivityBounds {
  const whereClause = buildJobWhere(scope)

  const row = db
    .select({
      firstCreatedAtMs: sql<number | null>`min(${jobs.createdAt})`,
      lastCreatedAtMs: sql<number | null>`max(${jobs.createdAt})`,
    })
    .from(jobs)
    .where(whereClause)
    .get()

  return {
    firstCreatedAtMs: row?.firstCreatedAtMs ?? null,
    lastCreatedAtMs: row?.lastCreatedAtMs ?? null,
  }
}
