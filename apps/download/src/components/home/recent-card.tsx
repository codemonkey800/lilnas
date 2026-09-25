import { cns } from '@lilnas/utils/cns'
import type {
  EmbyStatus,
  GalleryItem,
  Media,
} from '@lilnas/utils/download/types'
import { DownloadType, isManagedMedia } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import {
  ActivityRequester,
  galleryUpstreamSource,
} from 'src/components/activity/activity-requester'
import { ButtonLink } from 'src/components/ui/button-link'
import { Chip } from 'src/components/ui/chip'
import {
  GalleryCard,
  GalleryCardAttrib,
  GalleryCardLink,
  GalleryCardRow,
  GalleryCardTitle,
} from 'src/components/ui/gallery-card'
import type { IconName } from 'src/components/ui/icon'
import { MChip } from 'src/components/ui/mchip'
import { Poster } from 'src/components/ui/poster'
import { formatRelative, formatRuntime, UNKNOWN_VALUE } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'
import type { Viewer } from 'src/lib/viewer'

/** The glyph each library type wears, from `home.pug`'s `kindIcon`. */
const KIND_ICONS: Record<DownloadType, IconName> = {
  [DownloadType.Movie]: 'film',
  [DownloadType.Show]: 'tv',
  [DownloadType.Video]: 'play',
}

/** Lower case, as the mockup writes them — `movie`, not `Movie`. */
const KIND_LABELS: Record<DownloadType, string> = {
  [DownloadType.Movie]: 'movie',
  [DownloadType.Show]: 'show',
  [DownloadType.Video]: 'video',
}

/**
 * The one line of metadata beside the kind chip.
 *
 * A video's is its duration to the second (`2:58`), which is exactly what its
 * player will read out; a movie's or show's is the release year. `home.pug`
 * writes `s2` for its show card, which is a *job* scope — `GalleryItem`
 * carries no scope (a show is deliberately one card however many episodes were
 * grabbed), so the year is the honest equivalent here.
 */
export function recentCardMeta(media: Media): string {
  if (media.type === DownloadType.Video) {
    return formatRuntime(media.runtime, 'clock')
  }

  return media.year === undefined ? UNKNOWN_VALUE : String(media.year)
}

/**
 * Emby's view of a title, or nothing at all: a video is never indexed by Emby,
 * and a movie/show with no file on disk has no `embyStatus` because Emby was
 * never asked.
 */
function embyStatusOf(media: Media): EmbyStatus | undefined {
  return isManagedMedia(media) ? media.embyStatus : undefined
}

export type RecentCardProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /** One row of `GET /download/gallery`. */
  item: GalleryItem
  /**
   * The instant every relative timestamp in the grid is measured against.
   * Required, and pinned by the caller: `formatRelative`'s default
   * `Date.now()` would be read once on the server and again on the client, so
   * a card rendered on the minute boundary would hydrate with different text
   * than it was served with.
   */
  now: number
  /**
   * Who is looking. Decides whether the attribution avatar is a link, per
   * `requesterProfileHref`'s access rule — own identity always, anyone else's
   * only for an admin, a masked uploader never.
   *
   * Required, and nullable: `null` is a real answer (nobody is signed in) and
   * the caller has to give it. Optional would let a page that renders a
   * requester forget to say who is reading, and the failure is silent — every
   * avatar quietly loses its link and looks exactly like a correctly-masked
   * one. Matches `GalleryItemCard`, which has always spelled it this way.
   */
  viewer: Viewer | null
}

/**
 * One "recently added" card — poster, title, kind, attribution.
 *
 * Videos take the **tall** 2:3 crop here rather than their native 16:9, so the
 * grid stays one rhythm of shapes; `video-detail` is where a video gets its
 * own aspect back.
 *
 * Two independently interactive regions, never one anchor around the whole
 * card: the top half links to the detail page, and the attribution row keeps
 * its own avatar link and `Watch`.
 */
export function RecentCard({
  className,
  item,
  now,
  viewer,
  ...props
}: RecentCardProps): JSX.Element {
  const {
    addedAt,
    lastDiscordRequester,
    lastDownloadedAt,
    lastRequester,
    media,
  } = item
  // A title nobody downloaded through this app has no uploader to draw, so
  // the card carries no avatar at all. `lastDownloadedAt` comes out of the
  // same job lookup as the two identity slots, which makes it the one field
  // that tells "nobody" apart from "somebody, masked" — the masked case still
  // gets its dashed circle.
  const showUploader =
    lastDownloadedAt !== null ||
    lastRequester !== null ||
    lastDiscordRequester !== null
  // An adopted Radarr/Sonarr download: the same two `null` slots as a masked
  // one, read as the service's name instead of the dashed circle.
  const upstreamSource = galleryUpstreamSource(item)
  const emby = embyStatusOf(media)
  const indexing = emby?.state === 'indexing'
  // `watchUrl` is populated only while the state is `indexed`; a title that is
  // still being indexed has nothing to point a player at yet, which is the
  // whole reason the chip stands in for the action.
  const watchUrl = emby?.state === 'indexed' ? emby.watchUrl : undefined

  return (
    <GalleryCard
      {...props}
      className={cns('w-[calc(50%-8px)] sm:w-[158px]', className)}
    >
      <GalleryCardLink href={mediaHref(media)}>
        <Poster
          label={media.title}
          play={media.type === DownloadType.Video}
          playSize="h-[22px] w-[22px]"
          seed={media.id}
          shape="tall"
          src={media.posterUrl}
        />
        <GalleryCardTitle>{media.title}</GalleryCardTitle>
        <GalleryCardRow>
          <MChip
            className="font-mono text-mono-sm text-ink-3"
            icon={KIND_ICONS[media.type]}
            label={KIND_LABELS[media.type]}
          />
          {indexing ? (
            <Chip
              className="h-[19px] text-[10px]"
              label="indexing…"
              tone="warn"
            />
          ) : (
            <span className="font-mono text-mono-sm text-ink-4">
              {recentCardMeta(media)}
            </span>
          )}
        </GalleryCardRow>
      </GalleryCardLink>
      <GalleryCardRow className="mt-auto">
        <GalleryCardAttrib>
          {/*
            One spelling of the three-state rule, shared with the activity
            feed: masked renders the dashed circle and nothing else (no
            username, no snowflake, no `DiscordIdentityMark` in the DOM at
            all), a resolved identity renders the email avatar and its profile
            link, and an unlinked Discord upload renders the handle's initials
            plus E5's mark — which `ActivityRequester` already puts on its
            `nameless` row, so this card must not add a second one.

            `avatarClassName` rather than `size="xs"`: the two spell the same
            18px circle, and `ActivityRequester` sizes through the class.
          */}
          {showUploader ? (
            <ActivityRequester
              avatarClassName="h-[18px] w-[18px] text-[8.5px]"
              discordRequester={lastDiscordRequester}
              nameless
              requester={lastRequester}
              upstreamSource={upstreamSource}
              viewer={viewer}
            />
          ) : null}
          {/* When the title landed in the library, not when anyone downloaded
              it. `added` is for a screen reader only — the mockup draws a bare
              `3h ago`, and without the verb it reads as a download time. */}
          <time
            className="font-mono text-mono-sm text-ink-4"
            dateTime={addedAt}
          >
            <span className="sr-only">added </span>
            {formatRelative(addedAt, now)}
          </time>
        </GalleryCardAttrib>
        {watchUrl === undefined ? null : (
          <ButtonLink
            className="h-6 px-2 text-[11.5px]"
            href={watchUrl}
            size="sm"
            variant="ghost"
          >
            Watch
          </ButtonLink>
        )}
      </GalleryCardRow>
    </GalleryCard>
  )
}
