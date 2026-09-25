import type { JSX } from 'react'

import {
  ProfileAppliedFilters,
  ProfileFilterProvider,
  ProfileTotals,
} from 'src/components/profile/profile-filter-controls'
import {
  LifetimeTile,
  ProfileHeader,
} from 'src/components/profile/profile-header'
import { ProfileHistory } from 'src/components/profile/profile-history'
import {
  PROFILE_TITLE,
  ProfilePageShell,
} from 'src/components/profile/profile-page-shell'
import { ProfileTrend } from 'src/components/profile/profile-trend'
import { NotAuthorized } from 'src/components/shell/not-authorized'
import { fillJobsPerDay } from 'src/lib/jobs-per-day'
import {
  FOREIGN_PROFILE_DESCRIPTION,
  loadProfileView,
} from 'src/lib/profile-data'
import type { ProfileSearchParams } from 'src/lib/profile-filters'
import {
  hasProfileFilters,
  parseProfileFilters,
  profileFiltersToSearch,
} from 'src/lib/profile-filters'
import { sumProfileTotals } from 'src/lib/profile-totals'

export const metadata = {
  title: 'User profile · Download',
}

export type ProfilePageProps = {
  searchParams: Promise<ProfileSearchParams>
}

/**
 * `/profile` — one person's downloads, and what they add up to.
 *
 * ## A profile is a computed view, not an entity
 *
 * There is no `users` table. Everything here is derived from the `jobs` table at
 * query time, so an email that has never downloaded anything is an **empty
 * profile** — nulls, empty arrays, a zero — and never a 404. That is why this
 * route takes no dynamic segment: `/profile/newuser@lilnas.io` would promise a
 * resource that can be missing, where `?user=` asks a question that always has
 * an answer.
 *
 * ## What is windowed and what is not
 *
 * Only the trend. `windowDays` is echoed by the API and rendered as-is rather
 * than assumed to be 30, and the totals and the first/last stamps are all-time.
 * The aggregates are sparse — a type or status that never occurred is absent,
 * not zero — and there is no `totalJobs` field, so the headline figure is
 * `sumProfileTotals(totalsByType)`.
 *
 * ## Access
 *
 * Self-or-admin, enforced by the backend. A non-admin who opens `?user=` for
 * somebody else gets a 403, which arrives here as the shared not-authorized
 * panel rather than as an error boundary: nothing failed, the app answered the
 * question it was asked. The links that would *lead* somewhere forbidden are not
 * rendered in the first place — see `requesterProfileHref`.
 *
 * Nothing else is caught: `loadProfileView` reads `headers()` (which makes this
 * route dynamic, correctly — whose profile this is is per-request truth) and a
 * failing backend throws through to `error.tsx`.
 */
export default async function ProfilePage({
  searchParams,
}: ProfilePageProps): Promise<JSX.Element> {
  const filters = parseProfileFilters(await searchParams)
  const view = await loadProfileView(filters)

  if (view.forbidden) {
    return (
      <ProfilePageShell>
        {/*
          `NotAuthorized` renders an `<h2>`, so the route still owes the
          document its own heading — and it is not worth showing twice.
        */}
        <h1 className="sr-only">User profile</h1>
        <NotAuthorized description={FOREIGN_PROFILE_DESCRIPTION} />
      </ProfilePageShell>
    )
  }

  const { history, now, profile, viewer } = view
  const you = viewer !== null && viewer.email === profile.user.email
  // Also this view's identity: `ProfileHistory` is keyed by it, so a chip press
  // unmounts the pages accumulated under the previous filter rather than needing
  // an effect to reconcile them.
  const search = profileFiltersToSearch(filters)

  return (
    <ProfilePageShell>
      <h1 className={PROFILE_TITLE}>User profile</h1>
      <ProfileHeader
        email={profile.user.email}
        firstDownloadAt={profile.firstDownloadAt}
        lastDownloadAt={profile.lastDownloadAt}
        now={now}
        you={you}
      />
      <LifetimeTile total={sumProfileTotals(profile.totalsByType)} />
      <ProfileFilterProvider filters={filters}>
        <ProfileTotals
          totalsByStatus={profile.totalsByStatus}
          totalsByType={profile.totalsByType}
        />
        {/*
          Server-rendered and passed straight through the provider — it sits
          between the two controls in the layout, not inside either of them.
        */}
        <ProfileTrend
          days={fillJobsPerDay({
            jobsPerDay: profile.jobsPerDay,
            now,
            windowDays: profile.windowDays,
          })}
          windowDays={profile.windowDays}
        />
        <h2 className="mb-3 text-h2">Download history</h2>
        <ProfileAppliedFilters />
      </ProfileFilterProvider>
      <ProfileHistory
        filtered={hasProfileFilters(filters)}
        initialJobs={history.items}
        initialNextCursor={history.nextCursor}
        initialTotal={history.total}
        key={search}
        now={now}
        search={search}
        you={you}
      />
    </ProfilePageShell>
  )
}
