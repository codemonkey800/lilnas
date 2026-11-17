import { cns } from '@lilnas/utils/cns'
import type {
  DiscordIdentity,
  DiscordRequester,
  JobRequester,
  Media,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import type { UpstreamSource } from 'src/components/activity/activity-requester'
import {
  discordAvatarTitle,
  LINKED_DISCORD_TITLE,
  linkedDiscordLabel,
} from 'src/components/activity/activity-requester'
import { DiscordIdentityMark } from 'src/components/activity/discord-identity-mark'
import { PersonAvatar } from 'src/components/ui/person-avatar'
import type { PosterShape } from 'src/components/ui/poster'
import { Poster } from 'src/components/ui/poster'
import { formatRelative, initials } from 'src/lib/format'

/**
 * The poster column at each width, one entry per shape.
 *
 * `tall` is `movie-detail.pug`/`show-detail.pug`'s `detailHead`: a 132px
 * thumbnail above the title on a phone, a fixed 200px column beside it from
 * `sm`. `wide` keeps the 16:9 crop for any caller that wants a landscape
 * poster; the video page itself draws its picture as the player, below the
 * header, and passes `'none'`.
 */
const POSTER_SHAPES: Record<PosterShape, string> = {
  tall: 'mb-4 w-[132px] sm:mb-0 sm:w-[200px]',
  wide: 'mb-4 w-full sm:mb-0 sm:w-[340px]',
}

export type DetailHeaderProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /** The page's own buttons - Watch, Delete, Download series. Rendered last. */
  actions?: ReactNode
  /** Who fetched it and when. {@link DetailAttribution} is the shared shape. */
  attribution?: ReactNode
  /**
   * The media-state panel — every detail page puts its `MediaStatus` here. On
   * `video-detail.pug` the status chip and the progress card sit *inside* the
   * header column, above the actions; the movie and show pages have no slot
   * under their metadata line, so theirs lands here too, just above the
   * actions it gates.
   */
  lifecycle?: ReactNode
  /** Out-of-app links - `video-detail.pug`'s "View original post". */
  links?: ReactNode
  media: Media
  /**
   * The one metadata line under the title: `2009 · 2h 42m · PG-13`, or
   * `@slowferment · 14:02`. Rendered inside a `text-sm text-ink-3` paragraph;
   * the video page's mono treatment comes from the node the page passes in.
   */
  meta?: ReactNode
  /** Rendered as the poster's children - `video-detail.pug`'s player controls. */
  posterOverlay?: ReactNode
  /** The centred play mark. */
  posterPlay?: boolean
  /**
   * Defaults to `'tall'`. `'none'` draws no poster at all - the video page,
   * whose picture is the player under the header.
   */
  posterShape?: PosterShape | 'none'
  /** The long description. */
  synopsis?: ReactNode
}

/**
 * Poster on one side, everything the title is on the other - the block all
 * three detail pages open with.
 *
 * Reconciles `movie-detail.pug`'s `movieHeader`, `show-detail.pug`'s
 * `showHeader` and `video-detail.pug`'s inline header. Those are each written
 * as two branches because the mockups draw both viewports side by side on one
 * page; the real app is one document that responds, so the branches are
 * reconciled here into one stack that becomes a row at `sm` - the same
 * treatment `AppBar` gave `navBar`.
 *
 * Slot order is fixed and follows the mixins': title and metadata, synopsis,
 * links, the lifecycle (badge and its sentence), the actions, then who added
 * it. The title is the page's one `h1`. Cast and facts are sections of their
 * own under the header, not slots in it. Every slot is optional, so a page
 * renders the subset it has.
 *
 * ⚠️ A video passes no poster label, exactly as `GalleryItemCard` does and for
 * the same reason: a video fetched before poster frames were grabbed, or
 * whose grab failed, has no `posterUrl` and falls through to the gradient,
 * where a centred label and the centred play mark paint on top of each other.
 */
export function DetailHeader({
  actions,
  attribution,
  className,
  lifecycle,
  links,
  media,
  meta,
  posterOverlay,
  posterPlay = false,
  posterShape = 'tall',
  synopsis,
  ...props
}: DetailHeaderProps): JSX.Element {
  const video = media.type === DownloadType.Video

  return (
    <header
      {...props}
      className={cns(
        'flex flex-col sm:flex-row sm:items-start sm:gap-6',
        className,
      )}
    >
      {posterShape === 'none' ? null : (
        <Poster
          className={cns(POSTER_SHAPES[posterShape])}
          label={video ? null : media.title}
          play={posterPlay}
          seed={media.id}
          shape={posterShape}
          src={media.posterUrl}
        >
          {posterOverlay}
        </Poster>
      )}
      <div className={cns('flex min-w-0 flex-1 flex-col gap-4')}>
        <div className={cns('flex flex-col gap-1')}>
          <h1 className={cns('text-h1 text-balance')}>{media.title}</h1>
          {meta ? <p className={cns('text-sm text-ink-3')}>{meta}</p> : null}
        </div>
        {synopsis ? (
          <p className={cns('max-w-[64ch] text-body text-ink-2')}>{synopsis}</p>
        ) : null}
        {links}
        {lifecycle}
        {actions}
        {attribution}
      </div>
    </header>
  )
}

/** The mockups' one wording for who put a title here, on all three pages. */
export const ATTRIBUTION_PREFIX = 'Added by '

export type DetailAttributionProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /**
   * The Discord account the job was **submitted from**, when no lilnas account
   * claims that snowflake yet. See `ActivityRequester` for why this and
   * `linkedDiscord` are two fields and not one.
   */
  discordRequester?: DiscordRequester | null
  /** The Discord account **linked to** `requester`, whoever submitted the job. */
  linkedDiscord?: DiscordIdentity | null
  /** The instant `timestamp` is measured against, pinned once by the page. */
  now: number
  /**
   * Already masked server-side by `projectJobForViewer` - `null` means the
   * viewer is not allowed this identity, not that nobody asked.
   */
  requester: JobRequester | null
  /** Words before the name. Defaults to the mockups' `Added by `. */
  prefix?: string
  /** An ISO instant - the job's `createdAt` or `completedAt`. */
  timestamp: string
  /**
   * The service that started an adopted job - `jobUpstreamSource(job)`. Read
   * only when `requester` and `discordRequester` are both `null`, so an
   * identity always wins over it.
   */
  upstreamSource?: UpstreamSource
}

/**
 * "downloaded by jeremy.asuncion · 12m ago" - the attribution run under a
 * detail header.
 *
 * Its own component rather than a slot the three pages each fill, because
 * three separate spellings of an attribution line are three chances to get the
 * masking wrong.
 *
 * Two decisions worth stating, both following the two prior tasks that hit
 * them:
 *
 * - **It never links.** The mockups link the avatar to `profile.html`;
 *   `/profile` does not exist in this app yet, and an anchor to a 404 is worse
 *   than no anchor. When the route lands, this one component grows an `href`
 *   and all three pages get it.
 * - **It renders the email's local part**, not a display name. The mockups say
 *   "Jeremy"; the wire carries only `email`, and inventing a first name from
 *   it is a guess where `jeremy.asuncion` is a fact. The full address stays in
 *   the avatar's `title`.
 *
 * A masked requester reads `hidden · 12m ago` beside the dashed avatar, which
 * is `GalleryItemCard`'s own wording - the dashed circle alone is easy to miss
 * at 20px.
 *
 * ## An adopted download
 *
 * A job adopted from Radarr's or Sonarr's own UI carries the same nulls as a
 * masked one, and `upstreamSource` is what tells them apart: it reads
 * `Radarr · 12m ago` / `Sonarr · 1h ago` as plain text - no avatar, since
 * there is no person to draw, and no `prefix`, exactly as the mockups'
 * "Started from Radarr/Sonarr" frames write it. `requested by Sonarr` would
 * credit a service with a request nobody made through this app.
 *
 * ## The Discord identities, in `ActivityRequester`'s order
 *
 * Masked first (and it renders *only* `hidden`: no handle, no snowflake, no
 * mark), then `requester`, then `discordRequester`. A job with an unlinked
 * Discord requester reads `sam.pham <mark> · 12m ago`; one whose requester has
 * a linked account reads `downloaded by jeremy @sam.pham · 12m ago`, with the
 * handle inert. The line stays a single text node whenever neither Discord
 * field is present, so the common case is byte-for-byte what it always was.
 */
export function DetailAttribution({
  className,
  discordRequester = null,
  linkedDiscord = null,
  now,
  prefix = ATTRIBUTION_PREFIX,
  requester,
  timestamp,
  upstreamSource,
  ...props
}: DetailAttributionProps): JSX.Element {
  const when = formatRelative(timestamp, now)

  if (requester === null && discordRequester === null && upstreamSource) {
    return (
      <div {...props} className={cns('flex items-center gap-2', className)}>
        <span className={cns('text-cap text-ink-3')}>
          {`${upstreamSource} · ${when}`}
        </span>
      </div>
    )
  }

  const discord = requester === null ? discordRequester : null
  const who =
    requester !== null
      ? (requester.email.split('@')[0] ?? 'hidden')
      : (discord?.discordUsername ?? 'hidden')

  const avatar =
    requester !== null ? (
      <PersonAvatar
        className={cns('size-6 shrink-0 text-[10px]')}
        initials={initials(requester.email)}
        title={requester.email}
      />
    ) : discord !== null ? (
      <PersonAvatar
        className={cns('size-6 shrink-0 text-[10px]')}
        initials={initials(discord.discordUsername)}
        title={discordAvatarTitle(discord.discordUsername)}
      />
    ) : (
      <PersonAvatar className={cns('size-6 shrink-0 text-[10px]')} hidden />
    )

  const linked = requester === null ? null : linkedDiscord

  return (
    <div {...props} className={cns('flex items-center gap-2', className)}>
      {avatar}
      {discord === null && linked === null ? (
        <span className={cns('text-cap text-ink-3')}>
          {`${prefix}${who} · ${when}`}
        </span>
      ) : (
        <span
          className={cns('flex min-w-0 items-center gap-1 text-cap text-ink-3')}
        >
          <span className={cns('truncate')}>{`${prefix}${who}`}</span>
          {linked === null ? null : (
            <span className={cns('truncate')} title={LINKED_DISCORD_TITLE}>
              {linkedDiscordLabel(linked.discordUsername)}
            </span>
          )}
          {discord === null ? null : (
            <DiscordIdentityMark
              discordUserId={discord.discordUserId}
              discordUsername={discord.discordUsername}
            />
          )}
          <span className={cns('shrink-0')}>{` · ${when}`}</span>
        </span>
      )}
    </div>
  )
}
