import type {
  AuditAction,
  AuditLogEntry,
  AuditLogQuery,
  AuditTargetType,
  DownloadPage,
} from '@lilnas/utils/download/types'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Counter, register } from 'prom-client'

import type { ForwardedUser } from 'src/auth/forwarded-user'
import {
  type AuditLogFilter,
  type AuditLogPageQuery,
  type AuditLogPageResult,
  insertAuditLog,
  listAuditLogPage,
} from 'src/db/audit-log.repo'
import { DbService } from 'src/db/db.service'
import {
  computeFilterKey,
  decodeListCursor,
  encodeListCursor,
  type ListCursor,
} from 'src/db/list-cursor'
import type { AuditLogRow } from 'src/db/schema'

/**
 * A module-level `prom-client` counter, matching the shape
 * `download-metrics.service.ts` uses for every other `download_*` series -
 * `register` is a process-wide singleton, so declaring it here registers it
 * exactly once and `/metrics` picks it up with no wiring.
 *
 * Deliberately *not* a method on `DownloadMetricsService`: that provider is
 * exported by `DownloadModule`, and injecting it here would make
 * `AuditModule` depend on `DownloadModule` - the exact reverse of the
 * direction every audit call site needs, since those live in `DownloadModule`
 * and `MediaModule` and will be importing `AuditModule`.
 *
 * This is the *only* externally visible signal that an audit write was lost,
 * because `record()` swallows the failure by design (see below). Worth an
 * alert: a non-zero rate means the log is no longer a complete record of
 * what happened.
 */
const auditWriteFailuresTotal = new Counter({
  name: 'download_audit_write_failures_total',
  help: 'Total number of audit log rows that could not be written',
  registers: [register],
})

/**
 * The prefix `listAuditLogPage()` throws with for a cursor whose id isn't a
 * positive integer. Repos in this package are deliberately framework-free
 * and cannot throw `BadRequestException` themselves, so recognising that
 * throw and re-labelling it is this layer's job - see `readPage()`.
 */
const INVALID_CURSOR_ERROR_PREFIX = 'Invalid audit log cursor'

const INVALID_CURSOR_MESSAGE =
  'Invalid or expired cursor - it may have been minted under a different filter'

/**
 * One thing worth remembering, as the caller sees it.
 *
 * `actor` is required-but-nullable rather than optional (`actor?:`) on
 * purpose: every call site has to state whether a human or a service did
 * this, and `undefined` - which the repo turns into `origin: 'service'` - has
 * to be written out rather than reached by forgetting the field.
 */
export interface AuditEvent {
  action: AuditAction
  actor: ForwardedUser | undefined
  metadata?: Record<string, unknown>
  target?: { id: string; type: AuditTargetType }
}

/**
 * `AuditLogRow` -> the wire shape. The two nullable actor columns collapse
 * back into the single nullable `actor` object `AuditLogEntrySchema`
 * describes; `origin` is carried across untouched, so a `web` row with a null
 * actor (a browser request that somehow arrived with no `X-Forwarded-User`)
 * stays visible as the anomaly it is rather than being laundered into
 * looking like a service call.
 */
function hydrateAuditLogRow(row: AuditLogRow): AuditLogEntry {
  return {
    action: row.action,
    actor:
      row.actorEmail && row.actorUserId
        ? { email: row.actorEmail, userId: row.actorUserId }
        : null,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    metadata: row.metadata,
    origin: row.origin,
    targetId: row.targetId,
    targetType: row.targetType,
  }
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name)

  constructor(private readonly dbService: DbService) {}

  /**
   * Appends one row to the audit log. Synchronous, `void`, and - the whole
   * contract - **never throws**.
   *
   * Every call site is the tail of an action the user already succeeded at:
   * the job is queued, the release is grabbed, the file is deleted. A failed
   * write is a lost record, not a failed request, and turning it into a 500
   * would undo nothing while telling the user their action didn't happen. So
   * the failure goes to the log and to
   * `download_audit_write_failures_total` instead, and callers neither await
   * this nor branch on it.
   */
  record(event: AuditEvent): void {
    try {
      insertAuditLog(this.dbService.db, {
        action: event.action,
        actor: event.actor ?? null,
        metadata: event.metadata,
        target: event.target,
      })
    } catch (error) {
      // Counter first: it is the alertable signal, and bumping it before
      // handing off to the logger keeps it accurate even in the (remote)
      // case where logging is itself what's broken.
      auditWriteFailuresTotal.inc()
      this.logger.warn(
        { action: 'record', auditAction: event.action, error },
        'Failed to append a row to the audit log - the action still happened',
      )
    }
  }

  /**
   * One page of the audit log, newest first - the read half of
   * `GET /download/admin/audit`.
   *
   * Structurally identical to `JobQueryService.runJobPage()`: hash the
   * filter, decode the cursor against that hash, fetch `limit + 1` rows, and
   * mint the next cursor from the last row of the page. `id` is
   * stringified on the way into the cursor because `ListCursor.id` is typed
   * for `jobs.id` (a nanoid); `listAuditLogPage()` parses it back.
   */
  async listAuditLog(
    query: AuditLogQuery,
  ): Promise<DownloadPage<AuditLogEntry>> {
    const filter: AuditLogFilter = {
      action: query.action,
      actorEmail: query.actor,
      createdFrom: query.from,
      createdTo: query.to,
    }

    const filterKey = computeFilterKey(filter)
    const cursor = this.decodeCursor(query.cursor, filterKey)

    const page = this.readPage({ cursor, filter, limit: query.limit })

    const lastRow = page.rows.at(-1)
    const nextCursor =
      page.hasMore && lastRow
        ? encodeListCursor({
            filterKey,
            id: String(lastRow.id),
            sortKeyMs: lastRow.createdAt.getTime(),
          })
        : null

    return {
      items: page.rows.map(hydrateAuditLogRow),
      nextCursor,
      total: page.total,
    }
  }

  /**
   * The second half of cursor validation. `decodeCursor()` below catches a
   * cursor that is malformed *as a cursor*; this catches one that decodes
   * cleanly but carries an id the audit table's integer PK can't be compared
   * against - which `listAuditLogPage()` rejects rather than silently
   * coercing (see `parseCursorId()` for why coercion would duplicate a row
   * across the page boundary).
   *
   * Matched on the repo's message rather than blanket-catching, so a genuine
   * sqlite failure still surfaces as a 500 instead of being mislabelled as
   * the caller's fault. The invalid-cursor tests are what keep this string
   * honest if the repo ever rewords it.
   */
  private readPage(query: AuditLogPageQuery): AuditLogPageResult {
    try {
      return listAuditLogPage(this.dbService.db, query)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(INVALID_CURSOR_ERROR_PREFIX)
      ) {
        throw new BadRequestException(INVALID_CURSOR_MESSAGE)
      }
      throw error
    }
  }

  /**
   * Same contract as `JobQueryService.decodeCursor()`: a cursor that fails to
   * decode - bad base64, a missing field, or a `filterKey` minted under a
   * different filter - is a 400, never a silent fall-back to page 1, which
   * would quietly skip or repeat rows.
   */
  private decodeCursor(
    cursor: string | undefined,
    filterKey: string,
  ): ListCursor | undefined {
    if (!cursor) return undefined

    const decoded = decodeListCursor(cursor, filterKey)
    if (!decoded) {
      throw new BadRequestException(INVALID_CURSOR_MESSAGE)
    }

    return decoded
  }
}
