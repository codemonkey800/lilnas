import { cns } from '@lilnas/utils/cns'
import type {
  DiscordIdentity,
  DiscordRequester,
  DownloadJob,
  GalleryItem,
  JobRequester,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
import { Avatar } from 'src/components/ui/avatar'
import { initials } from 'src/lib/format'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

/** What a masked requester's name cell says, per `downloads-activity.pug`. */
export const MASKED_REQUESTER_LABEL = 'hidden'

/**
 * The service a download adopted from Radarr's or Sonarr's own UI is credited
 * to, written where a person's name would be — `movie-detail.pug`'s "Started
 * from Radarr" and `show-detail.pug`'s "Started from Sonarr" frames.
 */
export type UpstreamSource = 'Radarr' | 'Sonarr'

/**
 * Which service started `job`, or `undefined` for a job this app started.
 *
 * ⚠️ This is the one thing that tells an adopted job apart from a *masked*
 * one. Both arrive with every identity field `null`, and reading the pair of
 * nulls alone — as every requester surface did before plan 022 — puts
 * `hidden` beside a download nobody hid: movies and shows are never masked
 * (`showTrueAttribution`), and `projectJobForViewer` spreads the job, so
 * `startedUpstream` reaches admins and regular viewers alike.
 *
 * Keyed on the media type rather than stored as a name, because Radarr only
 * ever holds movies and Sonarr only ever holds shows. A video is never
 * adopted, so it has no source even if the flag were somehow set.
 */
export function jobUpstreamSource(
  job: Pick<DownloadJob, 'media' | 'startedUpstream'>,
): UpstreamSource | undefined {
  if (job.startedUpstream !== true) {
    return undefined
  }

  switch (job.media.type) {
    case DownloadType.Movie:
      return 'Radarr'
    case DownloadType.Show:
      return 'Sonarr'
    default:
      return undefined
  }
}

/**
 * {@link jobUpstreamSource} for a gallery row, whose latest job's flag rides
 * as `lastStartedUpstream`. `undefined` when that job was not adopted — a
 * requester on an *older* job never makes the title read as Radarr's.
 */
export function galleryUpstreamSource(
  item: Pick<GalleryItem, 'lastStartedUpstream' | 'media'>,
): UpstreamSource | undefined {
  return jobUpstreamSource({
    media: item.media,
    startedUpstream: item.lastStartedUpstream,
  })
}

/**
 * Whether `viewer` is allowed through to `requester`'s profile.
 *
 * The rule, from §12's access model: **your own identity always, anyone else's
 * only for an admin** — and a masked requester never, for either of them. There
 * is no identity behind the mask to send a viewer to, and this feed is not the
 * place that unmasks one (that is the admin dashboard's job). An adopted
 * Radarr/Sonarr job ({@link jobUpstreamSource}) is refused by the same `null`:
 * a service is not a person, and has no profile to open.
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

/**
 * The run that holds a name and whatever mark sits beside it.
 *
 * `min-w-0` so the `truncate` on the name inside it can actually engage in a
 * table cell, and `gap-1` rather than the outer `gap-1.5` so the mark reads as
 * belonging to the name rather than as a third item in the row.
 */
const NAME_RUN = 'flex min-w-0 items-center gap-1'

/**
 * The tooltip on a linked handle. It has to say *which* of the two Discord
 * facts this is: "linked to this person" and "submitted this job" look alike on
 * screen and mean completely different things.
 */
export const LINKED_DISCORD_TITLE = 'Linked Discord account'

/** How an unlinked Discord requester's avatar names itself on hover. */
export function discordAvatarTitle(discordUsername: string): string {
  return `${discordUsername} · Discord`
}

/** The handle as it is written when it is a fact about a person, not a source. */
export function linkedDiscordLabel(discordUsername: string): string {
  return `@${discordUsername}`
}

export type ActivityRequesterProps = {
  /** Avatar size utilities — the two layouts size their mark differently. */
  avatarClassName?: string
  /**
   * The Discord account this job was **submitted from** — populated for
   * `origin: 'discord'` jobs whose snowflake no lilnas account claims yet.
   *
   * ⚠️ Not the same fact as {@link ActivityRequesterProps.linkedDiscord}, and
   * the two are never interchangeable: a linked Discord job arrives here with
   * `requester` already filled by the server, so this field being set *is* the
   * statement "nobody has claimed this account".
   */
  discordRequester?: DiscordRequester | null
  /**
   * The Discord account **linked to** `requester`, whoever submitted the job —
   * a web job by a linked person carries it just as a resolved Discord job
   * does. Rendered beside the email as identity, not as provenance.
   */
  linkedDiscord?: DiscordIdentity | null
  /** Hide the name beside the avatar, as the stacked mobile row does. */
  nameless?: boolean
  /** Already masked per viewer, server-side. `null` means "not yours to see". */
  requester: JobRequester | null
  /**
   * The service that started an adopted job — {@link jobUpstreamSource}. Read
   * only when both identity fields are `null`, where it turns what would
   * otherwise be the masked branch into a plain `Radarr` / `Sonarr` label.
   */
  upstreamSource?: UpstreamSource
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
 *
 * ## The order the three identity fields are read in
 *
 * 1. **Masked** — every identity field `null` — renders `hidden`, and renders
 *    nothing else. Masking outranks disclosure, so no username, no snowflake
 *    and no {@link DiscordIdentityMark} exist in the DOM for such a job.
 *    **Unless `upstreamSource` is set**: then the nulls are an adopted
 *    Radarr/Sonarr download with nobody behind it, not a mask, and the cell
 *    is the service's name as plain text — no avatar (there is no person to
 *    draw) and no link (there is no profile to open). It is not a disclosure
 *    either: an adopted job is a movie or a show, which are never masked.
 * 2. **`requester`** — the email. A *linked* Discord job lands here without
 *    this component knowing it was one: `AttributionResolutionService` fills
 *    `requester` from the link before the job is serialized, which is the whole
 *    point of resolving at read time.
 * 3. **`discordRequester`** — an unlinked Discord submission: the handle plus
 *    the mark that discloses the raw snowflake. The handle is rendered exactly
 *    as it arrives; the server has already refreshed it to the roster's current
 *    value, so a rename is not a case this component has to know about.
 *
 * `linkedDiscord` is not a fourth branch — it is an extra beside the email on
 * branch 2, because it describes the person rather than the job's origin.
 */
export function ActivityRequester({
  avatarClassName,
  discordRequester = null,
  linkedDiscord = null,
  nameless = false,
  requester,
  upstreamSource,
  viewer,
}: ActivityRequesterProps): JSX.Element {
  if (requester === null) {
    // An adopted job, not a masked one — see `jobUpstreamSource`. Rendered on
    // the nameless row too: with no avatar to fall back on, the name is the
    // whole cell, and six characters fit where an email does not.
    if (discordRequester === null && upstreamSource !== undefined) {
      return <span className={cns(NAME, 'text-ink-4')}>{upstreamSource}</span>
    }

    // ⚠️ Masking outranks everything below, and it is spelled as one branch
    // rather than checked again further down. `projectJobForViewer` nulls all
    // three identity fields together, so a masked job reaches this branch with
    // nothing to render — no username, no snowflake, and therefore no
    // `DiscordIdentityMark` anywhere in the DOM for it.
    if (discordRequester === null) {
      return (
        <span className="flex items-center gap-1.5">
          {/*
            `hidden` excludes both `href` and `initials` at the type level, so a
            masked identity cannot leak through this branch even by accident.
          */}
          <Avatar
            className={avatarClassName}
            hidden
            title="Attribution hidden"
          />
          {nameless ? null : (
            <span className={cns(NAME, 'text-ink-4')}>
              {MASKED_REQUESTER_LABEL}
            </span>
          )}
        </span>
      )
    }

    const { discordUserId, discordUsername } = discordRequester

    return (
      <span className="flex min-w-0 items-center gap-1.5">
        {/*
          No `href`: `requesterProfileHref` is email-based on purpose. There is
          no lilnas account behind this snowflake yet, so there is no profile to
          open — and once an admin links one, this branch is never reached again
          because the server resolves it into `requester` instead.
        */}
        <Avatar
          className={avatarClassName}
          initials={initials(discordUsername)}
          title={discordAvatarTitle(discordUsername)}
        />
        <span className={NAME_RUN}>
          {nameless ? null : (
            <span className={cns(NAME, 'truncate text-ink-3')}>
              {discordUsername}
            </span>
          )}
          {/*
            Rendered on the nameless row too. The mark is the only thing that
            says "this came from Discord and nobody has claimed it", and a 12px
            glyph fits beside an 18px avatar where a username does not — hiding
            it there would leave the 390px layout with an avatar bearing
            initials nothing on screen explains.
          */}
          <DiscordIdentityMark
            discordUserId={discordUserId}
            discordUsername={discordUsername}
          />
        </span>
      </span>
    )
  }

  const href = requesterProfileHref(requester, viewer)

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar
        className={avatarClassName}
        href={href}
        initials={initials(requester.email)}
        title={requester.email}
      />
      {nameless ? null : (
        <span className={NAME_RUN}>
          {href === undefined ? (
            <span className={cns(NAME, 'truncate text-ink-3')}>
              {requester.email}
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
              {requester.email}
            </a>
          )}
          {/*
            ⚠️ Deliberately **not** a `DiscordIdentityMark`. That mark is a
            disclosure affordance for an identity the viewer cannot otherwise
            resolve — here the viewer is already looking at the person, so the
            snowflake behind the handle is not the actionable fact and a popover
            on it would read as the same state as an unlinked account. Plain
            `ink-4` text, one step below the name and with nothing to click, is
            what keeps the two apart.
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
    </span>
  )
}
