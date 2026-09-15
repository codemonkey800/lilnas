import { cns } from '@lilnas/utils/cns'
import type { DownloadGalleryFacets } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { IconName } from 'src/components/ui/icon'
import { Tile } from 'src/components/ui/tile'

/** The activity feed — every job currently in flight, plus what just finished. */
export const ACTIVITY_HREF = '/activity'

/** The full library. */
export const GALLERY_HREF = '/gallery'

/**
 * The library, pre-filtered to one type.
 *
 * `type` is the name `GalleryQuerySchema` already gives this parameter, so the
 * search string the tile links to is the same vocabulary the API reads — a
 * gallery page that forwards its `searchParams` straight to `getGallery()`
 * needs no translation layer.
 */
export function galleryHrefForType(type: DownloadType): string {
  return `${GALLERY_HREF}?type=${type}`
}

/**
 * How many rows of one type the gallery holds.
 *
 * A type with nothing behind it is **absent** from `facets.types` rather than
 * present with `count: 0` — the live backend answers
 * `[{movie,1},{show,1},{video,40}]` today and drops `movie` entirely the
 * moment that one row goes away. So this is a lookup with a zero default, not
 * an index.
 */
export function galleryTypeCount(
  facets: DownloadGalleryFacets,
  type: DownloadType,
): number {
  return facets.types.find(facet => facet.type === type)?.count ?? 0
}

/**
 * The three browse tiles, in `home.pug`'s order. A table rather than three
 * copies of the same JSX, but a `DownloadType`-keyed `Record` would lose that
 * ordering, so it stays a list.
 */
const BROWSE_TILES: ReadonlyArray<{
  icon: IconName
  title: string
  type: DownloadType
}> = [
  { icon: 'film', title: 'Browse movies', type: DownloadType.Movie },
  { icon: 'tv', title: 'Browse shows', type: DownloadType.Show },
  { icon: 'play', title: 'Video library', type: DownloadType.Video },
]

/**
 * The downloads-activity tile's subtitle.
 *
 * Zero gets prose rather than `0 running now`: the number is paired with a
 * `live` dot, and a pulsing dot over a zero says "watch this" about nothing at
 * all. The browse tiles keep their literal `0 in the library`, which is a fact
 * about a collection rather than a claim that something is happening.
 */
export function runningMeta(running: number): string {
  return running > 0 ? `${running} running now` : 'Nothing running'
}

export type QuickAccessProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children'
> & {
  /** `GET /download/gallery/facets` — the per-type library counts. */
  facets: DownloadGalleryFacets
  /**
   * Jobs in flight. This is `getActivity().total` (the size of the whole
   * filtered set) and never `items.length`, which is only ever as large as the
   * page limit the caller asked for.
   */
  running: number
}

const HEADING_ID = 'quick-access-heading'

/**
 * Quick access — four tiles across the top of the homepage: browse each of the
 * three library types, then the live downloads feed.
 *
 * Ported from `home.pug`'s `QUICK` table. The mockup draws two separate
 * panels, a column of `row` tiles on mobile and a wrapping row of column tiles
 * on desktop; one responsive tree renders both here, so there is a single set
 * of four links in the accessible tree at every width.
 */
export function QuickAccess({
  className,
  facets,
  running,
  ...props
}: QuickAccessProps): JSX.Element {
  return (
    <section {...props} aria-labelledby={HEADING_ID} className={className}>
      <div className="mb-[14px] flex items-center justify-between sm:mb-4">
        <h2 className="text-h2" id={HEADING_ID}>
          Quick access
        </h2>
      </div>
      <div
        className={cns(
          'flex flex-col gap-2.5 stagger',
          'sm:flex-row sm:flex-wrap sm:gap-[14px]',
        )}
      >
        {BROWSE_TILES.map(({ icon, title, type }) => (
          <Tile
            key={type}
            className="sm:min-w-[220px] sm:flex-1 sm:flex-col sm:items-stretch"
            href={galleryHrefForType(type)}
            icon={icon}
            meta={`${galleryTypeCount(facets, type)} in the library`}
            row
            title={title}
          />
        ))}
        <Tile
          className="sm:min-w-[220px] sm:flex-1 sm:flex-col sm:items-stretch"
          href={ACTIVITY_HREF}
          icon="download"
          live={running > 0}
          meta={runningMeta(running)}
          row
          title="Downloads activity"
        />
      </div>
    </section>
  )
}
