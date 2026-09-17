import type { DownloadJob } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

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
 * when the actor is the service (which has no email to filter by). Deliberately
 * *not* `requesterProfileHref`: that function answers a different question —
 * "may this viewer open somebody's profile" — and today returns a link only for
 * the viewer's own identity, so on an admin-only page where every requester is
 * legitimately inspectable it would silently drop every other row's link.
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
      <AdminActor
        actor={job.requester}
        avatarClassName={avatarClassName}
        href={href}
        nameless={nameless}
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
