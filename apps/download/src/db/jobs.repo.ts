import type {
  DownloadJobStatus,
  DownloadType,
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
  excludeHiddenVideos?: boolean
  // The derived `(type, mediaId)` key (plan §"What 'derived' means") -
  // `/media/:id`'s job lookup (Phase 6) filters on this instead of a job id,
  // since a title's jobs span every request for it, not just one.
  mediaId?: string
  requesterEmail?: string
  statuses?: readonly DownloadJobStatus[]
  // Plural/array, not a single value - the query schema accepts
  // comma-separated multi-select (`?type=movie,video`), matched here with
  // `inArray` the same way `statuses` above is.
  types?: readonly DownloadType[]
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
    // Case-insensitive: the stored value is whatever casing arrived on the
    // `X-Forwarded-User` header verbatim (see forwarded-user.ts), which may
    // not match the casing a caller passes on `?requester=`.
    filter.requesterEmail
      ? sql`lower(${jobs.requesterEmail}) = ${filter.requesterEmail.toLowerCase()}`
      : undefined,
    filter.createdFrom ? gte(jobs.createdAt, filter.createdFrom) : undefined,
    filter.createdTo ? lte(jobs.createdAt, filter.createdTo) : undefined,
    filter.excludeHiddenVideos
      ? sql`NOT (${jobs.type} = 'video' AND ${jobs.hiddenAttribution} = 1)`
      : undefined,
  ]

  return and(...conditions)
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

export interface MediaGroupRow {
  downloadCount: number
  lastJobAtMs: number
  mediaId: string
  type: DownloadType
}

export interface MediaGroupPageResult {
  groups: MediaGroupRow[]
  hasMore: boolean
  total: number
}

/**
 * The media-centric gallery: one row per *title*, derived straight from the
 * job log rather than from a media table (plan §3.2). Because
 * `lastJobAt`/`downloadCount` are aggregates over the same `WHERE` the
 * filters apply to, `?requester=alice&from=2026-03-01` means "titles alice
 * downloaded in March" - the natural reading - and there is no denormalized
 * `last_job_at` column that can drift.
 *
 * `ORDER BY MAX(created_at) DESC` cannot be answered from an index, so
 * unlike `listJobsPage()` this one query gets a temp b-tree sort. That's an
 * accepted, documented cost at a home-NAS row count (see the plan test in
 * `schema.spec.ts`), not an oversight.
 *
 * The cursor is a descending row-value comparison on
 * `(lastJobAt, media_id)`, applied in `HAVING` rather than `WHERE` because
 * `lastJobAt` is an aggregate - a `WHERE` on it would filter the rows going
 * *into* each group instead of the groups coming out, silently splitting a
 * title's history across pages.
 */
export function listMediaGroupsPage(
  db: Db,
  query: JobPageQuery,
): MediaGroupPageResult {
  const { cursor, filter, limit } = query
  const whereClause = buildJobWhere(filter)
  const lastJobAt = sql<number>`max(${jobs.createdAt})`

  return db.transaction(() => {
    const base = db
      .select({
        downloadCount: count(),
        lastJobAtMs: lastJobAt,
        mediaId: jobs.mediaId,
        type: jobs.type,
      })
      .from(jobs)

    const grouped = (whereClause ? base.where(whereClause) : base).groupBy(
      jobs.type,
      jobs.mediaId,
    )

    const fetched = (
      cursor
        ? grouped.having(
            sql`(${lastJobAt}, ${jobs.mediaId}) < (${cursor.sortKeyMs}, ${cursor.id})`,
          )
        : grouped
    )
      .orderBy(desc(lastJobAt), desc(jobs.mediaId))
      .limit(limit + 1)
      .all()

    // One extra row to detect a further page without a second round-trip -
    // same technique as listJobsPage().
    const hasMore = fetched.length > limit
    const page = hasMore ? fetched.slice(0, limit) : fetched

    // `total` is the number of *groups*, not of jobs - the gallery counts
    // titles. A plain `count()` over the grouped select would count rows per
    // group instead, hence the subquery.
    const totalBase = db
      .select({ one: sql<number>`1` })
      .from(jobs)
      .groupBy(jobs.type, jobs.mediaId)
    const totalSubquery = (
      whereClause ? totalBase.where(whereClause) : totalBase
    ).as('groups')
    const totalRow = db.select({ total: count() }).from(totalSubquery).get() as
      | { total: number }
      | undefined

    return {
      groups: page.flatMap(row =>
        row.mediaId
          ? [
              {
                downloadCount: row.downloadCount,
                lastJobAtMs: Number(row.lastJobAtMs),
                mediaId: row.mediaId,
                type: row.type as DownloadType,
              },
            ]
          : [],
      ),
      hasMore,
      total: totalRow?.total ?? 0,
    }
  })
}

/**
 * Every job matching `filter` whose `media_id` is in `mediaIds`, newest
 * first - the gallery's `lastRequester` follow-up query. One query for the
 * whole page (≤100 keys) rather than one per card; the caller takes the
 * first row it sees per `(type, media_id)`, which the ordering makes the
 * most recent.
 *
 * Runs under the *same* filter as the grouping query, so the requester
 * shown is the last one within the filtered window rather than the last one
 * overall - consistent with what `downloadCount` counts.
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
