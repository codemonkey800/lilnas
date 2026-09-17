import type { DownloadClient } from '@lilnas/utils/download/client'
import type { DownloadJob } from '@lilnas/utils/download/types'

import type { AdminFilters } from 'src/lib/admin-filters'
import { adminFiltersToHistoryQuery } from 'src/lib/admin-filters'

/** How many history rows a page of the table holds. */
export const ADMIN_HISTORY_PAGE_SIZE = 24

/**
 * How many audit rows the panel shows.
 *
 * Deliberately unpaginated: `admin-dashboard.pug` draws the audit log as a
 * recent-activity panel beside the leaderboard rather than as a second infinite
 * list, and the cursor `GET /download/admin/audit-log` returns is discarded
 * here for that reason. Narrowing it is `?requester=`'s job, which the page
 * threads through as the route's `actor` filter.
 */
export const ADMIN_AUDIT_LOG_LIMIT = 20

/**
 * How deep the cross-user merge will scan per requester.
 *
 * `LimitSchema` caps a single `GET /download/history` page at 100, so this is
 * the ceiling rather than a policy choice. It bounds the unfiltered view to
 * "the most recent 100 jobs, correctly interleaved"; past that the remedy is
 * the requester filter, which drops straight onto the backend's own cursor
 * pagination with no ceiling at all.
 */
export const ADMIN_MERGED_SCAN_LIMIT = 100

/**
 * One page of the admin history table, in the same envelope every list in this
 * app uses.
 *
 * Not `DownloadPage<DownloadJob>` verbatim, because in the merged mode below
 * `nextCursor` is this module's own offset token rather than one the backend
 * minted — see {@link loadAdminHistory}.
 */
export type AdminHistoryPage = {
  items: DownloadJob[]
  nextCursor: string | null
  total: number
}

/**
 * Descending `(createdAt, id)` — the ordering `listJobsPage` gives every
 * paginated job list (`orderBy(desc(jobs.createdAt), desc(jobs.id))`).
 *
 * Re-derived here because the merge below interleaves several server-ordered
 * pages, and the only shared truth between them is the sort key itself. An
 * unparseable `createdAt` sorts as epoch 0 — last — rather than poisoning every
 * comparison it takes part in with `NaN`, which would leave `sort()` free to
 * produce any order at all.
 */
function compareJobs(a: DownloadJob, b: DownloadJob): number {
  const byCreatedAt = createdAtMs(b) - createdAtMs(a)

  return byCreatedAt !== 0 ? byCreatedAt : b.id.localeCompare(a.id)
}

function createdAtMs(job: DownloadJob): number {
  const parsed = Date.parse(job.createdAt)

  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * The merged view's cursor: how many rows have already been shown.
 *
 * A plain decimal rather than an opaque token because it is read back by this
 * same module one function down, and an offset is exactly what the re-scan
 * below needs. Anything else parses to `0`, which restarts the list rather than
 * erroring — a crafted cursor can then only ever ask for a page the URL could
 * have asked for anyway.
 */
function parseMergedOffset(cursor: string | null): number {
  return cursor !== null && /^\d+$/.test(cursor) ? Number(cursor) : 0
}

/**
 * One page of the admin dashboard's history table.
 *
 * ## Two modes, and why
 *
 * ⚠️ **`GET /download/history` is always scoped to exactly one requester.**
 * `DownloadController.getHistory` resolves `requesterEmail` to the caller's own
 * email when `?requester=` is absent and to the named user when it is present
 * (admin-only) — there is no "every user" mode on the route at all. So:
 *
 *   - **filtered** (`filters.requester` set) — one call, and the backend's own
 *     cursor pagination carries straight through. This is the mode the spec
 *     means by "per-user history is a filter on this view".
 *   - **merged** (no requester) — one call per known requester, interleaved by
 *     the sort key above. `AdminStatsResponse.topRequesters` is the requester
 *     vocabulary, which is why the caller supplies it.
 *
 * The merged mode scans `offset + pageSize` rows per requester, which is
 * exactly enough for the first `offset + pageSize` merged rows to be correct by
 * construction: no requester can contribute a row to that prefix that was not
 * in their own top `offset + pageSize`. Once that figure passes
 * {@link ADMIN_MERGED_SCAN_LIMIT} the merge stops offering more, because a
 * deeper page could no longer be proven complete.
 *
 * ⚠️ Two known gaps in merged mode, both inherited from the API rather than
 * introduced here: `topRequesters` is capped at 20 entries server-side
 * (`TOP_REQUESTERS_LIMIT`), and `countJobsByRequester` drops jobs with a null
 * requester — so a service-created job appears in the stat tiles and the audit
 * log but never in the merged table. The requester filter is unaffected by
 * either.
 */
export async function loadAdminHistory(
  client: DownloadClient,
  filters: AdminFilters,
  cursor: string | null,
  requesterEmails: readonly string[],
): Promise<AdminHistoryPage> {
  if (filters.requester !== null) {
    const page = await client.getHistory({
      ...adminFiltersToHistoryQuery(filters, cursor ?? undefined),
      limit: ADMIN_HISTORY_PAGE_SIZE,
    })

    return {
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    }
  }

  const offset = parseMergedOffset(cursor)
  const end = offset + ADMIN_HISTORY_PAGE_SIZE
  const scan = Math.min(end, ADMIN_MERGED_SCAN_LIMIT)

  if (requesterEmails.length === 0 || offset >= scan) {
    return { items: [], nextCursor: null, total: 0 }
  }

  const pages = await Promise.all(
    requesterEmails.map(requester =>
      client.getHistory({
        ...adminFiltersToHistoryQuery({ ...filters, requester }),
        limit: scan,
      }),
    ),
  )

  const merged = pages.flatMap(page => page.items).sort(compareJobs)
  const items = merged.slice(offset, end)
  // The exact filtered count across every requester, which is a different
  // number from `merged.length` — that one is bounded by the scan window.
  const total = pages.reduce((sum, page) => sum + page.total, 0)

  // Whether anything was left behind: either a requester's own page said so, or
  // the interleave produced more rows than this page shows. `merged.length`
  // alone cannot answer it, because the scan is sized to `end` — so a requester
  // with exactly `end` further rows would look exhausted.
  const more =
    merged.length > end || pages.some(page => page.nextCursor !== null)

  return {
    items,
    nextCursor: more && end < ADMIN_MERGED_SCAN_LIMIT ? String(end) : null,
    total,
  }
}
