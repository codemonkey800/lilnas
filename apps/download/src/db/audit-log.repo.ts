import type { AuditAction, AuditTargetType } from '@lilnas/utils/download/types'
import { and, count, desc, eq, gte, lte, type SQL, sql } from 'drizzle-orm'

import type { Db } from './db.service'
import type { ListCursor } from './list-cursor'
import { auditLog, type AuditLogRow } from './schema'

/**
 * `actor` is the whole of the origin decision - callers never pass `origin`
 * themselves. A forwarded identity means `'web'`; its absence means
 * `'service'` (tdr-bot, the yt-dlp update poller). Deriving it here rather
 * than at each of the ~14 call sites is what makes
 * `audit_log_origin_matches_actor` (schema.ts) unfalsifiable in practice
 * instead of merely checked at the DB boundary.
 *
 * `target` is a pair or nothing, mirroring `audit_log_target_pair`: an action
 * like `ytdlp.check_update` acts on nothing addressable, and a half-written
 * `{ type }` with no id would render as a link to nowhere.
 */
export interface InsertAuditLogInput {
  action: AuditAction
  actor: { email: string; userId: string } | null
  metadata?: Record<string, unknown>
  target?: { id: string; type: AuditTargetType }
}

/**
 * Appends one row to the audit log and returns it as stored.
 *
 * There is deliberately no update or delete counterpart in this file: the log
 * is append-only *by construction*, not by convention. Anything that needs to
 * correct a record appends a new row describing the correction.
 *
 * `createdAt` is passed explicitly rather than left to the column's
 * `$defaultFn` - the house style established by `bad-files.repo.ts`, and the
 * reason every insert path in this package produces a `Date` the caller can
 * see in the returned row.
 */
export function insertAuditLog(
  db: Db,
  input: InsertAuditLogInput,
): AuditLogRow {
  return db
    .insert(auditLog)
    .values({
      action: input.action,
      actorEmail: input.actor?.email,
      actorUserId: input.actor?.userId,
      createdAt: new Date(),
      metadata: input.metadata,
      origin: input.actor ? 'web' : 'service',
      targetId: input.target?.id,
      targetType: input.target?.type,
    })
    .returning()
    .get()
}

/**
 * As with `JobListFilter` (jobs.repo.ts), every field is omittable and an
 * absent field means "don't filter on this dimension" rather than "match the
 * empty set". These are exactly the four facets the admin audit UI exposes,
 * and the first two line up with `audit_log_action_idx` /
 * `audit_log_actor_email_idx`.
 */
export interface AuditLogFilter {
  action?: AuditAction
  actorEmail?: string
  createdFrom?: Date
  createdTo?: Date
}

export interface AuditLogPageQuery {
  cursor?: ListCursor
  filter: AuditLogFilter
  limit: number
}

export interface AuditLogPageResult {
  hasMore: boolean
  rows: AuditLogRow[]
  total: number
}

/**
 * The shared `WHERE` for a filter, used by both halves of
 * `listAuditLogPage()` - the page query and the `total` count - so the two
 * can never drift onto different predicates. Same contract as
 * `buildJobWhere()` in jobs.repo.ts.
 */
function buildAuditLogWhere(filter: AuditLogFilter): SQL | undefined {
  const conditions: Array<SQL | undefined> = [
    filter.action ? eq(auditLog.action, filter.action) : undefined,
    // Case-insensitive for the same reason `jobs.requesterEmail` is: the
    // stored value is whatever casing arrived on the `X-Forwarded-User`
    // header verbatim (see forwarded-user.ts), which need not match the
    // casing a caller passes on `?actor=`.
    filter.actorEmail
      ? sql`lower(${auditLog.actorEmail}) = ${filter.actorEmail.toLowerCase()}`
      : undefined,
    filter.createdFrom
      ? gte(auditLog.createdAt, filter.createdFrom)
      : undefined,
    filter.createdTo ? lte(auditLog.createdAt, filter.createdTo) : undefined,
  ]

  return and(...conditions)
}

/**
 * `ListCursor.id` is typed as a `string` because it was minted for `jobs.id`
 * (a nanoid) and the gallery's derived `media_id`. `audit_log.id` is an
 * INTEGER PRIMARY KEY, so the decoded id has to be turned back into a number
 * before it is bound into the row-value predicate below.
 *
 * A well-formed numeric string would in fact survive being bound as text -
 * SQLite applies the INTEGER column's NUMERIC affinity to the bare parameter
 * on the other side of the comparison. A *malformed* one would not: affinity
 * conversion only happens for text that already looks numeric, so `id <
 * 'not-a-number'` leaves an integer compared against text, and SQLite's type
 * ordering puts every integer before every string - the predicate becomes
 * vacuously true and the cursor row itself is handed back a second time, i.e.
 * a silent duplicate across the page boundary rather than an error.
 *
 * Hence: reject rather than coerce. `decodeListCursor()` already refuses a
 * malformed *timestamp*; this is the same guarantee for the id half, and the
 * same rule applies - never silently fall back to page 1 (or, here, to a
 * boundary-free scan).
 */
function parseCursorId(cursor: ListCursor): number {
  if (!/^\d+$/.test(cursor.id)) {
    throw new Error(
      `Invalid audit log cursor: id '${cursor.id}' is not a positive integer`,
    )
  }

  return Number(cursor.id)
}

/**
 * One page of `audit_log` rows (newest first) plus the total count of the
 * filtered set, read atomically - structurally identical to `listJobsPage()`
 * (jobs.repo.ts), including the single `db.transaction()` that keeps `total`
 * from being counted against a different snapshot than the page.
 *
 * Cursor pagination is a descending row-value comparison on
 * `(created_at, id)`, matching `audit_log_created_at_id_idx` (schema.ts)
 * exactly. `id` breaks ties between rows sharing a `created_at` millisecond,
 * which a bare `created_at <` predicate would silently drop or duplicate -
 * and audit rows tie constantly, since a single admin action writes its row
 * in the same millisecond as its neighbours.
 *
 * `cursor.sortKeyMs` is bound as a plain number rather than a `Date`: this is
 * a raw `sql` template, which bypasses the `timestamp_ms` column mapper that
 * `gte`/`lte` in `buildAuditLogWhere()` go through, and better-sqlite3 cannot
 * bind a `Date` directly. `parseCursorId()` covers the id half - see its
 * comment for why binding it as a string is not merely untidy.
 *
 * Throws on a malformed cursor id; callers should map that to a 400 the same
 * way `JobQueryService.decodeCursor()` maps a malformed cursor string.
 */
export function listAuditLogPage(
  db: Db,
  query: AuditLogPageQuery,
): AuditLogPageResult {
  const { cursor, filter, limit } = query
  const whereClause = buildAuditLogWhere(filter)
  const cursorId = cursor ? parseCursorId(cursor) : undefined

  return db.transaction(() => {
    const pageConditions: Array<SQL | undefined> = [
      whereClause,
      cursor
        ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (${cursor.sortKeyMs}, ${cursorId})`
        : undefined,
    ]
    const pageWhere = and(...pageConditions)

    const pageBase = db.select().from(auditLog)
    const fetched = (pageWhere ? pageBase.where(pageWhere) : pageBase)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(limit + 1)
      .all()

    // One extra row detects a further page without a second round-trip;
    // `.slice()` rather than indexed access, since noUncheckedIndexedAccess
    // makes `fetched[limit]` possibly-undefined even where the length check
    // already guarantees it's present.
    const hasMore = fetched.length > limit
    const rows = hasMore ? fetched.slice(0, limit) : fetched

    const totalQuery = db.select({ total: count() }).from(auditLog)
    const totalRow = (
      whereClause ? totalQuery.where(whereClause) : totalQuery
    ).get()

    return { hasMore, rows, total: totalRow?.total ?? 0 }
  })
}
