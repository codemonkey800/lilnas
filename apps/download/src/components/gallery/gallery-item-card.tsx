import { cns } from '@lilnas/utils/cns'
import type { GalleryItem, Media } from '@lilnas/utils/download/types'
import { DownloadType, isManagedMedia } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { Avatar } from 'src/components/ui/avatar'
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
import {
  formatRelative,
  formatRuntime,
  initials,
  UNKNOWN_VALUE,
} from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'

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
   * The instant `lastDownloadedAt` is measured against, pinned once by the
   * page. Required rather than defaulted to `Date.now()`: a grid of cards each
   * reading the clock for itself is a hydration mismatch on every stamp.
   */
  now: number
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
}: GalleryItemCardProps): JSX.Element {
  const { media } = item
  const managed = isManagedMedia(media) ? media : null
  const watchUrl = managed?.embyStatus?.watchUrl
  const indexing = managed?.embyStatus?.state === 'indexing'
  const requester = item.lastRequester
  const when = formatRelative(item.lastDownloadedAt, now)
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
          {requester ? (
            <Avatar
              initials={initials(requester.email)}
              title={requester.email}
            />
          ) : (
            <Avatar hidden />
          )}
          <span className={cns(CARD_ANNOTATION, 'truncate text-ink-4')}>
            {requester ? when : `hidden · ${when}`}
          </span>
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
