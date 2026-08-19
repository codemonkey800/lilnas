import type {
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import {
  and,
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
import type { JobCursor } from './job-cursor'
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
  requesterEmail?: string
  statuses?: readonly DownloadJobStatus[]
  // Plural/array, not a single value - the query schema accepts
  // comma-separated multi-select (`?type=movie,video`), matched here with
  // `inArray` the same way `statuses` above is.
  types?: readonly DownloadType[]
}

export interface JobPageQuery {
  cursor?: JobCursor
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
 * silently drop or duplicate across a page boundary. `cursor.createdAtMs`
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
        ? sql`(${jobs.createdAt}, ${jobs.id}) < (${cursor.createdAtMs}, ${cursor.id})`
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
