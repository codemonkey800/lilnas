import { cns } from '@lilnas/utils/cns'
import type { JobRequester } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { requesterProfileHref } from 'src/components/activity/activity-requester'
import { Avatar } from 'src/components/ui/avatar'
import { Icon } from 'src/components/ui/icon'
import { MChip } from 'src/components/ui/mchip'
import { AUDIT_SERVICE_LABEL } from 'src/lib/admin-audit'
import { initials } from 'src/lib/format'
import type { Viewer } from 'src/lib/viewer'

const NAME = 'font-mono text-mono-sm'
const NAME_LINK = 'text-ink-3 transition-colors duration-200 ease-uv'

/** The service reads in the same mono/`ink-3` register every machine fact does. */
const SERVICE = 'font-mono text-mono-sm text-ink-3'

/**
 * The profile link is `ink-4` against the name's `ink-3` — one step quieter, so
 * the row still reads as one primary target with a smaller door beside it.
 *
 * The glyph is 12px, which is the right *weight* for a secondary affordance and
 * the wrong *size* for a pointer target (WCAG 2.5.8 asks for 24px). The
 * `before:-inset-1.5` pseudo-element is the hit area: it takes the anchor to
 * 24x24 while the anchor's own box stays 12x12, so the row's rhythm and the
 * 6px gap either side of it are unchanged. Padding would have moved the name.
 * It extends into the flex gap rather than over the name link, so the primary
 * target loses nothing to it.
 */
const PROFILE_LINK = cns(
  'relative inline-flex shrink-0 items-center text-ink-4',
  'transition-colors duration-200 ease-uv hover:text-ink-2',
  'before:absolute before:-inset-1.5',
)

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
 * ## Two targets, because a name on this page means two things
 *
 * The **primary** click is whatever `href` the call site passes, which on
 * `/admin` is this page's own `?requester=` filter: the useful reading of
 * "click a name" in a table is "scope the table to them", and it keeps you on
 * the page you were reading.
 *
 * The **secondary** click — the small outbound glyph beside the name — is that
 * person's `/profile`, and it is gated on {@link requesterProfileHref} rather
 * than on `viewer.isAdmin`. On `/admin` behind `AdminGuard` that gate is
 * effectively always open, so the gate buys nothing at runtime; what it buys is
 * that this page *imports* the app's access rule instead of restating it. Every
 * other surface that renders a requester already calls that function, and a
 * page that decides for itself who may be inspected is a rule with two
 * definitions waiting to disagree.
 *
 * ⚠️ It is asked only about a **person**. A `null` actor is the service, and
 * the helper's `null` means *masked* — feeding one to the other would be asking
 * the wrong question of the wrong `null`.
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
  // Asked only here, in the branch where `actor` is a person — see the note.
  const profileHref = requesterProfileHref(actor, viewer)
  const profileLabel = `Open ${actor.email}’s profile`

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
      {/*
        Suppressed on the `nameless` (390px) row, where there is no name for it
        to sit beside and the cell is already an avatar plus a 12px eye-slash —
        a third mark in that run reads as decoration rather than as a control.
        The desktop table keeps it, and `/profile` stays reachable by URL.
      */}
      {nameless || profileHref === undefined ? null : (
        <a
          aria-label={profileLabel}
          className={PROFILE_LINK}
          href={profileHref}
          title={profileLabel}
        >
          <Icon className="h-3 w-3" name="external" />
        </a>
      )}
    </span>
  )
}
