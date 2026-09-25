import { cns } from '@lilnas/utils/cns'
import type { GalleryItem, Media } from '@lilnas/utils/download/types'
import { DownloadType, isManagedMedia } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

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

/** `gallery.pug`'s `entry.icon`, one per type. */
const TYPE_ICONS: Record<DownloadType, IconName> = {
  [DownloadType.Movie]: 'film',
  [DownloadType.Show]: 'tv',
  [DownloadType.Video]: 'play',
}

/**
 * `gallery.pug`'s `entry.kind` — singular and lowercase, because it reads as
 * one half of a `video · 14:02` run rather than as a heading.
 */
const TYPE_KINDS: Record<DownloadType, string> = {
  [DownloadType.Movie]: 'movie',
  [DownloadType.Show]: 'show',
  [DownloadType.Video]: 'video',
}

/**
 * The card's one line of metadata.
 *
 * A video's is its duration to the second, the way a player reads it out; a
 * movie's or a show's is its year. When neither is known the kind stands alone
 * rather than being followed by an em dash — `video · —` announces an absence
 * nobody asked about, where `video` is simply the true and complete thing that
 * is known.
 */
function metaLabel(media: Media): string {
  const kind = TYPE_KINDS[media.type]
  const meta =
    media.type === DownloadType.Video
      ? formatRuntime(media.runtime, 'clock')
      : (media.year?.toString() ?? UNKNOWN_VALUE)

  return meta === UNKNOWN_VALUE ? kind : `${kind} · ${meta}`
}

/** Both mono-annotation runs under a card, in the one place they are spelled. */
const CARD_ANNOTATION = 'font-mono text-mono-sm'

/**
 * The 2-up / fixed-column split, straight from the two frames `gallery.pug`
 * draws: `w-[calc(50%-8px)]` inside the 390px frame (two cards and one 16px
 * gap), `w-[158px]` inside the 1280px one.
 *
 * 640px is the switch, matching the shell's own threshold — a fixed 158px
 * column on a 500px phone would leave a third of the row empty, and the 2-up
 * grid keeps filling the width until there is genuinely room for three.
 */
export const GALLERY_CARD_WIDTH = 'w-[calc(50%-8px)] sm:w-[158px]'

export type GalleryItemCardProps = {
  /** One row of `GET /download/gallery`. */
  item: GalleryItem
  /**
   * The instant `addedAt` is measured against, pinned once by the
   * page. Required rather than defaulted to `Date.now()`: a grid of cards each
   * reading the clock for itself is a hydration mismatch on every stamp.
   */
  now: number
  /**
   * Who is looking. Decides whether the attribution avatar is a link, per
   * `requesterProfileHref`'s access rule — own identity always, anyone else's
   * only for an admin, a masked uploader never.
   */
  viewer: Viewer | null
}

/**
 * One tile in the unified gallery — a video, a movie and a show all take the
 * same 2:3 crop so the grid keeps one rhythm regardless of what a clip's native
 * aspect ratio happens to be.
 *
 * Ported from `gallery.pug`'s `item` mixin. One deviation: a masked upload
 * reads `hidden · 3h ago` rather than just `3h ago`, which is `gallery.pug`'s
 * own data (`when: 'hidden · 3h ago'`) — the dashed avatar alone is easy to
 * miss at 24px.
 *
 * ⚠️ There is no `linkedDiscord` handle beside the email on this surface, and
 * not because it would not fit: `GalleryItemSchema` carries `lastRequester`
 * and `lastDiscordRequester` and no third identity field, so the reverse link
 * lookup is
 * never run for a gallery page (see `resolveGalleryItems`). A page of
 * web-origin cards therefore costs zero link lookups, which is the property
 * that keeps the grid cheap — adding the handle here would trade it away for a
 * string this card has nowhere to put anyway.
 *
 * ⚠️ A video passes no poster `label`, exactly as the mixin does, and that is
 * load-bearing rather than cosmetic: the backend never populates `posterUrl`
 * for a video, so every video tile falls through to the gradient, and a
 * centred label plus the centred play mark render *on top of each other*. The
 * play mark is the video's stand-in for a poster; the title is already the
 * line directly underneath it.
 */
export function GalleryItemCard({
  item,
  now,
  viewer,
}: GalleryItemCardProps): JSX.Element {
  const { media } = item
  const managed = isManagedMedia(media) ? media : null
  const watchUrl = managed?.embyStatus?.watchUrl
  const indexing = managed?.embyStatus?.state === 'indexing'
  const requester = item.lastRequester
  const discordRequester = item.lastDiscordRequester
  // A title whose latest download was adopted from Radarr's or Sonarr's own UI
  // arrives with the same two `null` slots as a masked one; this is the flag
  // that says nobody hid anything — see `jobUpstreamSource`.
  const upstreamSource = galleryUpstreamSource(item)
  // A title nobody downloaded through this app — straight from Radarr/Sonarr,
  // or a job log that no longer reaches it — has no uploader to draw, so the
  // card carries no attribution mark at all. `lastDownloadedAt` comes out of
  // the same job lookup as the two identity slots, which makes it the one
  // field that can tell "nobody" apart from "somebody, masked".
  const downloadedHere = item.lastDownloadedAt !== null
  // Both identity slots null on a title somebody *did* download is the
  // *masked* state, and only that. An unlinked Discord upload has no
  // `lastRequester` either, but it is fully attributed — reading it as
  // `hidden · …` would tell every viewer the uploader asked to be hidden when
  // they did not. `JobQueryService.listGallery` nulls the two together, so
  // this pair is the honest test — once an adopted title is taken out of it.
  const masked =
    downloadedHere &&
    requester === null &&
    discordRequester === null &&
    upstreamSource === undefined
  const showUploader =
    masked ||
    requester !== null ||
    discordRequester !== null ||
    upstreamSource !== undefined
  // When the title landed in the library, not when anyone downloaded it —
  // the gallery is the library, so its cards date what is in it.
  const when = formatRelative(item.addedAt, now)
  const video = media.type === DownloadType.Video

  return (
    <GalleryCard className={GALLERY_CARD_WIDTH}>
      <GalleryCardLink href={mediaHref(media)}>
        <Poster
          label={video ? null : media.title}
          play={video}
          seed={media.id}
          shape="tall"
          src={media.posterUrl}
        />
        <GalleryCardRow>
          <GalleryCardTitle className="min-h-[2.7em] flex-1">
            {media.title}
          </GalleryCardTitle>
        </GalleryCardRow>
        <GalleryCardRow>
          <MChip
            className={cns(CARD_ANNOTATION, 'text-ink-3')}
            icon={TYPE_ICONS[media.type]}
            label={metaLabel(media)}
          />
        </GalleryCardRow>
      </GalleryCardLink>
      <GalleryCardRow className="mt-auto">
        <GalleryCardAttrib>
          {/*
            `nameless`, because a 158px card has no room for an email or a
            handle beside a timestamp and a `Watch` button — the avatar and,
            for an unlinked Discord upload, its mark are the whole of the
            attribution here. The mark is `ActivityRequester`'s own (E5's
            `DiscordIdentityMark`, rendered on its nameless row), so this card
            adds none of its own: a second trigger for one account would open
            two popovers saying the same thing.
          */}
          {showUploader ? (
            <ActivityRequester
              discordRequester={discordRequester}
              nameless
              requester={requester}
              upstreamSource={upstreamSource}
              viewer={viewer}
            />
          ) : null}
          {/* `added` for a screen reader only — the mockup draws a bare
              `3h ago`, and without the verb it reads as a download time. */}
          <time
            className={cns(CARD_ANNOTATION, 'truncate text-ink-4')}
            dateTime={item.addedAt}
          >
            {masked ? 'hidden · ' : null}
            <span className="sr-only">added </span>
            {when}
          </time>
        </GalleryCardAttrib>
        {watchUrl ? (
          <ButtonLink
            className="h-6 shrink-0 px-2 text-[11.5px]"
            href={watchUrl}
            rel="noreferrer"
            size="sm"
            target="_blank"
            variant="ghost"
          >
            Watch
          </ButtonLink>
        ) : null}
      </GalleryCardRow>
      {indexing ? (
        <GalleryCardRow>
          <Chip className="h-5 text-[10px]" label="indexing…" tone="warn" />
        </GalleryCardRow>
      ) : null}
    </GalleryCard>
  )
}
