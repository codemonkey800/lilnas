import { cns } from '@lilnas/utils/cns'
import type { JobRequester } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { Avatar } from 'src/components/ui/avatar'
import { initials } from 'src/lib/format'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

/** What a masked requester's name cell says, per `downloads-activity.pug`. */
export const MASKED_REQUESTER_LABEL = 'hidden'

/**
 * Whether `viewer` is allowed through to `requester`'s profile.
 *
 * The rule, from §12's access model: **your own identity always, anyone else's
 * only for an admin** — and a masked requester never, for either of them. There
 * is no identity behind the mask to send a viewer to, and this feed is not the
 * place that unmasks one (that is the admin dashboard's job).
 *
 * ⚠️ `requester` is already `null` when the viewer is not allowed the true
 * identity — `projectJobForViewer` masks it server-side and the gateway
 * re-resolves admin status on every broadcast. Nothing here re-derives that;
 * this decides only whether the name that *did* arrive is a link.
 *
 * Matched on `userId` rather than on `email`, because `userId` is the identity
 * the forwarded-auth header carries and two accounts could in principle share a
 * display email where they cannot share an id.
 */
export function canViewRequesterProfile(
  requester: JobRequester | null,
  viewer: Viewer | null,
): boolean {
  if (requester === null || viewer === null) {
    return false
  }

  return viewer.isAdmin || viewer.userId === requester.userId
}

/**
 * Where a requester cell points, or `undefined` for no link at all.
 *
 * Exactly as wide as {@link canViewRequesterProfile} now that `/profile` is
 * built: your own identity goes to `PROFILE_HREF` (the bare route, which the
 * backend resolves to whoever is asking), and an admin viewing somebody else
 * goes to that person's `?user=`. A masked requester still gets nothing — there
 * is no identity behind the mask to send anyone to.
 *
 * ⚠️ This is the **access rule as a link**, and it is the reason a forbidden
 * profile is reachable only by typing its URL: a non-admin is never handed an
 * href that the backend would answer 403 for. `/profile`'s own 403 handling
 * exists for the typed-URL case, not for anything this function emits.
 *
 * ⚠️ It is also the app's **only** spelling of that rule. `/admin` renders a
 * different primary link (its own `?requester=` filter, because scoping the
 * table is what a click means there) but gates its secondary profile
 * affordance on this function rather than re-deriving who may be inspected —
 * see `AdminActor`. A surface that shows a requester and decides for itself
 * whether to link them is the drift this function exists to prevent.
 */
export function requesterProfileHref(
  requester: JobRequester | null,
  viewer: Viewer | null,
): string | undefined {
  if (requester === null || !canViewRequesterProfile(requester, viewer)) {
    return undefined
  }

  return viewer?.userId === requester.userId
    ? PROFILE_HREF
    : profileHrefForEmail(requester.email)
}

const NAME = 'font-mono text-mono-sm'
const NAME_LINK = 'text-ink-3 transition-colors duration-200 ease-uv'

export type ActivityRequesterProps = {
  /** Avatar size utilities — the two layouts size their mark differently. */
  avatarClassName?: string
  /** Hide the name beside the avatar, as the stacked mobile row does. */
  nameless?: boolean
  /** Already masked per viewer, server-side. `null` means "not yours to see". */
  requester: JobRequester | null
  viewer: Viewer | null
}

/**
 * Who asked for a download: the avatar, and the name beside it on the layouts
 * that have room for one.
 *
 * ⚠️ Deviation from `downloads-activity.pug`, which shows a first name
 * (`Jeremy`, `Sam`). `JobRequester` carries an `email` and a `userId` and no
 * display name at all, and inventing one out of the local part would put a
 * different string on screen than the one the gallery's uploader facet, the
 * account tooltip and the admin dashboard all use for the same person. The
 * email is the identity this app speaks.
 */
export function ActivityRequester({
  avatarClassName,
  nameless = false,
  requester,
  viewer,
}: ActivityRequesterProps): JSX.Element {
  const href = requesterProfileHref(requester, viewer)

  if (requester === null) {
    return (
      <span className="flex items-center gap-1.5">
        {/*
          `hidden` excludes both `href` and `initials` at the type level, so a
          masked identity cannot leak through this branch even by accident.
        */}
        <Avatar className={avatarClassName} hidden title="Attribution hidden" />
        {nameless ? null : (
          <span className={cns(NAME, 'text-ink-4')}>
            {MASKED_REQUESTER_LABEL}
          </span>
        )}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1.5">
      <Avatar
        className={avatarClassName}
        href={href}
        initials={initials(requester.email)}
        title={requester.email}
      />
      {nameless ? null : href === undefined ? (
        <span className={cns(NAME, 'text-ink-3')}>{requester.email}</span>
      ) : (
        <a
          className={cns(NAME, NAME_LINK, 'hover:text-ink hover:underline')}
          href={href}
        >
          {requester.email}
        </a>
      )}
    </span>
  )
}
