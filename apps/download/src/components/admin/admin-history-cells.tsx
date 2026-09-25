import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { jobUpstreamSource } from 'src/components/activity/activity-requester'
import { AdminActor } from 'src/components/admin/admin-actor'
import { Icon } from 'src/components/ui/icon'
import type { AdminFilters } from 'src/lib/admin-filters'
import { adminHref } from 'src/lib/admin-filters'
import type { Viewer } from 'src/lib/viewer'

/** What the eye-slash marker says it means, as its tooltip and its alt text. */
export const HIDDEN_ATTRIBUTION_LABEL = 'Hidden from other users'

export type AdminHistoryRequesterProps = {
  /** Avatar size utilities — the two layouts size their mark differently. */
  avatarClassName?: string
  /** The filter the page is currently at, so the link can extend it. */
  filters: AdminFilters
  job: DownloadJob
  /** Hide the name beside the avatar, as the stacked mobile row does. */
  nameless?: boolean
  viewer: Viewer | null
}

/**
 * The history table's requester cell: who asked for the download, and whether
 * this row is one only an admin can attribute.
 *
 * ⚠️ The eye-slash marks the **privilege, not the person**, exactly as
 * `admin-dashboard.pug` puts it: `hiddenAttribution` survives
 * `projectJobForViewer` in both directions precisely so an admin can tell that
 * a record they can read is one everybody else sees masked. It is therefore
 * rendered next to a fully-named requester, which is the whole point.
 *
 * The name links to this same page with `?requester=` set, because per-user
 * history is a filter on this view rather than a route of its own. It is
 * omitted when that filter is already applied (the link would go nowhere) and
 * when the actor is the service (which has no email to filter by).
 *
 * That is deliberately *not* `requesterProfileHref`, which answers a different
 * question — "may this viewer open somebody's profile" — and would send a click
 * off the page the admin is reading. The profile is still reachable: `AdminActor`
 * renders it as a secondary glyph beside the name, gated on that same helper so
 * this page imports the access rule rather than restating it.
 */
export function AdminHistoryRequester({
  avatarClassName,
  filters,
  job,
  nameless = false,
  viewer,
}: AdminHistoryRequesterProps): JSX.Element {
  const email = job.requester?.email ?? null
  const href =
    email !== null && filters.requester !== email
      ? adminHref({ ...filters, requester: email })
      : undefined

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {/*
        ⚠️ `discordRequester` is passed as `discordActor`, and the rename is the
        whole point: on this page a null `requester` means the *service*, so
        without it an unlinked Discord download would render as a machine
        action. `/admin` never masks, so both Discord fields always arrive
        populated when they exist.

        A download adopted from Radarr or Sonarr is the service too, just a
        named one — `serviceLabel` says which, and falls back to `service`.
      */}
      <AdminActor
        actor={job.requester}
        avatarClassName={avatarClassName}
        discordActor={job.discordRequester}
        href={href}
        linkedDiscord={job.linkedDiscord}
        nameless={nameless}
        serviceLabel={jobUpstreamSource(job)}
        viewer={viewer}
      />
      {job.hiddenAttribution ? (
        <span
          className="inline-flex shrink-0 text-ink-4"
          title={HIDDEN_ATTRIBUTION_LABEL}
        >
          <Icon
            aria-hidden={undefined}
            aria-label={HIDDEN_ATTRIBUTION_LABEL}
            className="h-3 w-3"
            name="eye-slash"
            role="img"
          />
        </span>
      ) : null}
    </span>
  )
}
