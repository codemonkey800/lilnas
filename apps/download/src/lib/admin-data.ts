import type { DownloadClient } from '@lilnas/utils/download/client'
import type { DownloadJob, DownloadPage } from '@lilnas/utils/download/types'

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
 * One page of the admin history table — the backend's own envelope, cursor
 * included, with nothing rewritten on the way through.
 */
export type AdminHistoryPage = DownloadPage<DownloadJob>

/**
 * One page of the admin dashboard's history table.
 *
 * One call, one backend cursor, in both of the page's modes — the difference
 * between them is a single query parameter:
 *
 *   - **filtered** (`filters.requester` set) — `?requester=`, the mode the spec
 *     means by "per-user history is a filter on this view".
 *   - **unfiltered** — `?scope=all`, the admin-only every-requester scope.
 *     ⚠️ Not the same as omitting `requester`, which means *the caller's own*
 *     history; see `HistoryQuerySchema`. The two are mutually exclusive
 *     server-side (400), which is why `scope` is set only in this branch.
 *
 * `scope=all` is what makes the table the complete record the page claims to
 * be: it reaches every requester rather than a capped leaderboard's worth, and
 * it includes service-created jobs, which have no requester to be keyed by and
 * so can appear under no `?requester=` value at all.
 */
export async function loadAdminHistory(
  client: DownloadClient,
  filters: AdminFilters,
  cursor: string | null,
): Promise<AdminHistoryPage> {
  const page = await client.getHistory({
    ...adminFiltersToHistoryQuery(filters, cursor ?? undefined),
    limit: ADMIN_HISTORY_PAGE_SIZE,
    scope: filters.requester === null ? 'all' : undefined,
  })

  return {
    items: page.items,
    nextCursor: page.nextCursor,
    total: page.total,
  }
}
