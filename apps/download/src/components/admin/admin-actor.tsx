import { cns } from '@lilnas/utils/cns'
import type { JobRequester } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { Avatar } from 'src/components/ui/avatar'
import { MChip } from 'src/components/ui/mchip'
import { AUDIT_SERVICE_LABEL } from 'src/lib/admin-audit'
import { initials } from 'src/lib/format'
import type { Viewer } from 'src/lib/viewer'

const NAME = 'font-mono text-mono-sm'
const NAME_LINK = 'text-ink-3 transition-colors duration-200 ease-uv'

/** The service reads in the same mono/`ink-3` register every machine fact does. */
const SERVICE = 'font-mono text-mono-sm text-ink-3'

export type AdminActorProps = {
  /** `null` is the **service**, never a masked person — see the note below. */
  actor: JobRequester | null
  /** Avatar size utilities — the two layouts size their mark differently. */
  avatarClassName?: string
  /** Where the name points, or `undefined` for no link. */
  href?: string
  /** Hide the name beside the avatar, as the stacked mobile row does. */
  nameless?: boolean
  /** Overrides what a `null` actor is called. Defaults to `service`. */
  serviceLabel?: string
  /** Who is looking — decides which mark wears the "this is you" halo. */
  viewer: Viewer | null
}

/**
 * Who did the thing, on the one page where that is never masked.
 *
 * ⚠️ **This is not `ActivityRequester`, and the difference is the `null`.**
 * Everywhere else in the app a `null` requester means *masked*:
 * `projectJobForViewer` strips the identity for a viewer who is not entitled to
 * it, and `ActivityRequester` correctly renders that as a dashed avatar reading
 * "hidden". On `/admin` that masking never happens — `AdminGuard` is exactly
 * what makes true attribution safe here, and `AdminStatsService` skips the
 * hidden-attribution filter on purpose. A `null` that reaches this page is
 * therefore the *other* `null` the wire types carry: a service caller with no
 * forwarded identity (tdr-bot, the yt-dlp updater), which
 * `AuditLogEntrySchema` documents and which `DownloadJob.requester` shares.
 * Reusing the masked branch here would put "hidden" next to an action no person
 * took.
 *
 * The person branch is deliberately the same shape as `ActivityRequester`'s —
 * avatar, email, `ring` for yourself — because it is the same fact rendered in
 * the same table idiom. It is the `null` semantics, not the layout, that could
 * not be shared.
 *
 * ⚠️ Deviation from `admin-dashboard.pug`, which shows a first name (`Jeremy`,
 * `Sam`). `JobRequester` carries an `email` and a `userId` and no display name
 * at all, so the email is the identity this app speaks — the same call
 * `ActivityRequester` made, for the same reason.
 */
export function AdminActor({
  actor,
  avatarClassName,
  href,
  nameless = false,
  serviceLabel = AUDIT_SERVICE_LABEL,
  viewer,
}: AdminActorProps): JSX.Element {
  if (actor === null) {
    return (
      <MChip
        className={SERVICE}
        icon="layers"
        label={nameless ? null : serviceLabel}
        title={serviceLabel}
      />
    )
  }

  const you = viewer !== null && viewer.userId === actor.userId

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar
        className={avatarClassName}
        href={href}
        initials={initials(actor.email)}
        ring={you}
        title={you ? `${actor.email} · you` : actor.email}
      />
      {nameless ? null : href === undefined ? (
        <span className={cns(NAME, 'truncate text-ink-3')}>{actor.email}</span>
      ) : (
        <a
          className={cns(
            NAME,
            NAME_LINK,
            'truncate hover:text-ink hover:underline',
          )}
          href={href}
        >
          {actor.email}
        </a>
      )}
    </span>
  )
}
