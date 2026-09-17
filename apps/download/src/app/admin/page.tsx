import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { AdminAuditLog } from 'src/components/admin/admin-audit-log'
import { AdminFilterChips } from 'src/components/admin/admin-filter-chips'
import { AdminHistory } from 'src/components/admin/admin-history'
import { AdminLeaderboard } from 'src/components/admin/admin-leaderboard'
import {
  ADMIN_NOT_AUTHORIZED_DESCRIPTION,
  ADMIN_SECTION_HEADING,
  ADMIN_TITLE,
  ADMIN_TITLE_TEXT,
  AdminPageShell,
} from 'src/components/admin/admin-page-shell'
import { AdminStats } from 'src/components/admin/admin-stats'
import { NotAuthorized } from 'src/components/shell/not-authorized'
import { Chip } from 'src/components/ui/chip'
import { ADMIN_AUDIT_LOG_LIMIT, loadAdminHistory } from 'src/lib/admin-data'
import type { AdminSearchParams } from 'src/lib/admin-filters'
import {
  adminFiltersToSearch,
  adminFiltersToStatsQuery,
  parseAdminFilters,
} from 'src/lib/admin-filters'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getRequestInstant } from 'src/lib/request-instant'
import { getViewer } from 'src/lib/viewer'

export const metadata = {
  title: 'Admin dashboard · Download',
}

export type AdminPageProps = {
  searchParams: Promise<AdminSearchParams>
}

/**
 * `/admin` — the whole system, for the people who run it.
 *
 * ## What makes this page different from every other one
 *
 * ⚠️ **Attribution is never masked here.** Everywhere else a video with
 * `hiddenAttribution` arrives with `requester: null` and renders as a dashed
 * avatar reading "hidden"; on this route `AdminGuard` on the backend and the
 * gate below are what make the true identity safe to show, and
 * `AdminStatsService` deliberately skips the hidden-attribution filter its
 * sibling aggregates apply. A `null` that reaches this page is therefore the
 * *other* null the wire types carry — a service caller — and is rendered as the
 * service. See `AdminActor`.
 *
 * ⚠️ **The table is not `/activity`.** That feed is in-progress-only and drops
 * a row seconds after it finishes. This is the complete record across every
 * status, and per-user history is a **filter** on it (`?requester=`) rather
 * than a route of its own.
 *
 * ## The gate
 *
 * `getViewer()` answers `null` for a genuinely unresolved identity and a
 * `Viewer` with `isAdmin: false` for an ordinary user. Both get the same
 * `NotAuthorized` panel — they are different facts, but neither is one this
 * page can act on, and telling a stranger which of the two applies to them is
 * the one thing an access-control message should not do. The gate runs *before*
 * any admin data is fetched, so a non-admin's request never even asks the
 * backend for rows it would then have to discard.
 *
 * Nothing else is caught: `getIdentifiedDownloadClient()` reads `headers()`
 * (which makes this route dynamic, correctly — an admin dashboard describing a
 * build-time snapshot would be worse than useless) and a failing backend throws
 * through to `error.tsx`.
 */
export default async function AdminPage({
  searchParams,
}: AdminPageProps): Promise<JSX.Element> {
  const filters = parseAdminFilters(await searchParams)
  const viewer = await getViewer()

  if (!viewer?.isAdmin) {
    return (
      <AdminPageShell>
        {/*
          `NotAuthorized` renders an `<h2>`, so the route still owes the
          document its own heading — the same pairing `app/gallery/page.tsx`
          and `videos/[videoId]/not-found.tsx` use.
        */}
        <h1 className="sr-only">{ADMIN_TITLE_TEXT}</h1>
        <NotAuthorized description={ADMIN_NOT_AUTHORIZED_DESCRIPTION} />
      </AdminPageShell>
    )
  }

  const client = await getIdentifiedDownloadClient()

  // All three together: the history's every-requester scope is a query
  // parameter the backend resolves (`?scope=all`), so nothing here depends on
  // the stats having answered first.
  const [stats, history, auditLog] = await Promise.all([
    client.getStats(adminFiltersToStatsQuery(filters)),
    loadAdminHistory(client, filters, null),
    client.getAuditLog({
      // The requester filter scopes the whole page, not just the table: asking
      // "what has Sam been doing" and getting everybody's audit trail beside
      // Sam's downloads would answer a question nobody asked.
      actor: filters.requester ?? undefined,
      limit: ADMIN_AUDIT_LOG_LIMIT,
    }),
  ])

  // One instant for every relative timestamp on the page, resolved on the
  // server and handed down — see `getRequestInstant` for why that matters.
  const now = getRequestInstant()
  // Also this view's identity: the history island is keyed by it, so a filter
  // change unmounts the pages accumulated under the previous filter rather than
  // needing an effect to reconcile them.
  const search = adminFiltersToSearch(filters)

  return (
    <AdminPageShell>
      <h1 className={ADMIN_TITLE}>{ADMIN_TITLE_TEXT}</h1>
      <AdminStats stats={stats} />
      <div className="mb-[14px] flex items-center justify-between gap-4">
        <h2 className={ADMIN_SECTION_HEADING}>Download history</h2>
        <Chip
          label={filters.requester === null ? 'every user' : 'one requester'}
          tone="mute"
        />
      </div>
      <AdminFilterChips filters={filters} />
      <AdminHistory
        filters={filters}
        initialJobs={history.items}
        initialNextCursor={history.nextCursor}
        initialTotal={history.total}
        key={search}
        now={now}
        search={search}
        viewer={viewer}
      />
      <div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-5">
        <div className="sm:flex-[0_0_320px]">
          <h2 className={cns('mb-3 sm:mb-[14px]', ADMIN_SECTION_HEADING)}>
            Top downloaders
          </h2>
          <AdminLeaderboard filters={filters} stats={stats} viewer={viewer} />
        </div>
        <div className="min-w-0 sm:flex-1">
          <h2 className={cns('mb-3 sm:mb-[14px]', ADMIN_SECTION_HEADING)}>
            Audit log
          </h2>
          <AdminAuditLog entries={auditLog.items} filters={filters} now={now} />
        </div>
      </div>
    </AdminPageShell>
  )
}
