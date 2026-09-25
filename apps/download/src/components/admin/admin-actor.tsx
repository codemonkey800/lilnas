import { cns } from '@lilnas/utils/cns'
import type {
  DiscordIdentity,
  DiscordRequester,
  JobRequester,
} from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import {
  discordAvatarTitle,
  LINKED_DISCORD_TITLE,
  linkedDiscordLabel,
  requesterProfileHref,
} from 'src/components/activity/activity-requester'
import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
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
  /**
   * The Discord identity behind an `origin: 'discord'` row whose snowflake no
   * lilnas account claims yet.
   *
   * ⚠️ **It is what keeps a null `actor` from being read as the service.** An
   * unlinked Discord action has a person behind it and no forwarded identity,
   * so `actor` is `null` while this is not — rendering that as the service chip
   * would attribute a person's action to a machine.
   */
  discordActor?: DiscordRequester | null
  /** Where the name points, or `undefined` for no link. */
  href?: string
  /** The Discord account **linked to** `actor`, whoever performed the action. */
  linkedDiscord?: DiscordIdentity | null
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
 * ⚠️ **Since plan 017 that `null` has two readings, and `discordActor` is what
 * separates them.** An `origin: 'discord'` action by an account no lilnas user
 * has claimed also arrives with `actor === null` — there is no forwarded
 * identity to fill it — but a person performed it, and it renders as that
 * person's Discord handle plus `DiscordIdentityMark`. The service chip is
 * reserved for the null with genuinely nobody behind it.
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
  discordActor = null,
  href,
  linkedDiscord = null,
  nameless = false,
  serviceLabel = AUDIT_SERVICE_LABEL,
  viewer,
}: AdminActorProps): JSX.Element {
  if (actor === null) {
    // ⚠️ The service chip is for a null actor with **nothing** behind it. An
    // unlinked Discord submission also arrives with `actor === null`, because
    // no lilnas account claims that snowflake yet — but a person did the thing,
    // and the chip would say a machine did.
    if (discordActor !== null) {
      const { discordUserId, discordUsername } = discordActor

      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {/*
            No `href` on either the avatar or the handle. Both of this page's
            targets are email-keyed — `?requester=` filters on an email and
            `requesterProfileHref` resolves one — and an unlinked snowflake has
            neither. The mark is the only affordance it gets, and what it opens
            is the id an admin pastes into `apps/auth` to link the account.
          */}
          <Avatar
            className={avatarClassName}
            initials={initials(discordUsername)}
            title={discordAvatarTitle(discordUsername)}
          />
          <span className="flex min-w-0 items-center gap-1">
            {nameless ? null : (
              <span className={cns(NAME, 'truncate text-ink-3')}>
                {discordUsername}
              </span>
            )}
            <DiscordIdentityMark
              discordUserId={discordUserId}
              discordUsername={discordUsername}
            />
          </span>
        </span>
      )
    }

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
      {nameless ? null : (
        <span className="flex min-w-0 items-center gap-1">
          {href === undefined ? (
            <span className={cns(NAME, 'truncate text-ink-3')}>
              {actor.email}
            </span>
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
            Inert text, never a `DiscordIdentityMark`: this says *who this
            person also is*, not *where the action came from*. Giving it the
            unlinked mark's popover would make a linked account and an unlinked
            one read as the same state on a page whose entire job is telling
            identities apart.
          */}
          {linkedDiscord === null ? null : (
            <span
              className={cns(NAME, 'truncate text-ink-4')}
              title={LINKED_DISCORD_TITLE}
            >
              {linkedDiscordLabel(linkedDiscord.discordUsername)}
            </span>
          )}
        </span>
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
