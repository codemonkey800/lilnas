import { cns } from '@lilnas/utils/cns'
import type { Media } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import {
  RESULT_KIND_ICONS,
  resultKindAndYear,
} from 'src/components/search/result-meta'
import {
  GalleryCard,
  GalleryCardLink,
  GalleryCardTitle,
} from 'src/components/ui/gallery-card'
import { MChip } from 'src/components/ui/mchip'
import { Poster } from 'src/components/ui/poster'
import { mediaHref } from 'src/lib/media-route'

/** `search.pug:132`. */
const RESULT_GRID = cns(
  'stagger grid gap-3 grid-cols-[repeat(auto-fill,minmax(128px,1fr))]',
  'sm:gap-4 sm:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]',
)

export type ResultCardProps = { media: Media }

/**
 * One result, as a poster card.
 *
 * `search.pug:140` makes the whole card an `<a>`, and unlike the gallery's
 * card there is nothing else interactive in it — no Watch button, no
 * attribution avatar — so the anchor fills a padding-less `GalleryCard` rather
 * than replacing it. That keeps the hover lift, the border and the fill on the
 * shipped component instead of retyping the recipe here, where it would drift.
 *
 * The href comes from `mediaHref()`, never from string assembly: it is the one
 * place that knows `tmdb:11` is `/movies/11`. The target exists whether or not
 * the title has been downloaded.
 */
export function ResultCard({ media }: ResultCardProps): JSX.Element {
  return (
    <GalleryCard className="p-0">
      <GalleryCardLink
        // `flex-1` so the anchor fills a card the grid stretched to its row's
        // height. In `search.pug` the `<a>` *is* the grid item and stretches on
        // its own; here it sits inside one, and without this the bottom of a
        // short card is border with nothing clickable behind it.
        className="flex-1 rounded-[inherit] p-[9px]"
        href={mediaHref(media)}
      >
        <Poster
          label={media.title}
          seed={media.id}
          shape="tall"
          src={media.posterUrl}
        />
        <GalleryCardTitle className="text-[12.5px]! sm:text-sm!">
          {media.title}
        </GalleryCardTitle>
        <MChip
          className="font-mono text-mono-sm text-ink-3"
          icon={RESULT_KIND_ICONS[media.type]}
          label={resultKindAndYear(media)}
        />
      </GalleryCardLink>
    </GalleryCard>
  )
}

export type ResultGridProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  items: Media[]
}

/**
 * Results as a grid of posters — the default view.
 *
 * Movies and shows are interleaved in one list, in whatever order the API
 * returned them. Nothing is re-ranked or regrouped here: `relevance` is a
 * positional zip of Radarr's and Sonarr's own rankings, and re-sorting it
 * client-side would both destroy that and disagree with the next page.
 */
export function ResultGrid({
  items,
  className,
  ...props
}: ResultGridProps): JSX.Element {
  return (
    <div {...props} className={cns(RESULT_GRID, className)}>
      {items.map(media => (
        <ResultCard key={media.id} media={media} />
      ))}
    </div>
  )
}
