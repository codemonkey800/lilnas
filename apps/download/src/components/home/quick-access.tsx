import { type IconName, StatusDot, Tile } from '@lilnas/ui'
import { ACTIVITY_HREF } from '@lilnas/utils/download/media-route'
import type { DownloadGalleryFacets } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/** The activity feed — every job currently in flight, plus what just finished. */
export { ACTIVITY_HREF }

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
  { icon: 'film', title: 'Movies', type: DownloadType.Movie },
  { icon: 'tv', title: 'Shows', type: DownloadType.Show },
  { icon: 'play', title: 'Videos', type: DownloadType.Video },
]

/**
 * The downloads-activity tile's subtitle.
 *
 * Zero gets prose rather than `0 running now`: the number is paired with a
 * green dot, and a green dot over a zero says "watch this" about nothing at
 * all. The browse tiles keep their literal `0`, which is a fact about a
 * collection rather than a claim that something is happening.
 */
export function runningMeta(running: number): string {
  return running > 0 ? `${running} running` : 'Nothing running'
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
 * Quick access — four tiles across the top of the library: each of the three
 * types with how many it holds, then the live jobs feed.
 *
 * Ported from `home.pug`'s `QUICK` table: one column on a phone, four across
 * from `sm`. The activity tile's dot breathes (`StatusDot pulse`) only while
 * something is actually running; at zero it is the idle dot and plain words.
 */
export function QuickAccess({
  className,
  facets,
  running,
  ...props
}: QuickAccessProps): JSX.Element {
  return (
    <section {...props} aria-labelledby={HEADING_ID} className={className}>
      <h2 className="mb-3 text-h2" id={HEADING_ID}>
        Quick access
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {BROWSE_TILES.map(({ icon, title, type }) => (
          <Tile
            key={type}
            href={galleryHrefForType(type)}
            icon={icon}
            // A string: `Tile` drops a falsy status, and an empty type is a `0`.
            status={String(galleryTypeCount(facets, type))}
            title={title}
          />
        ))}
        <Tile href={ACTIVITY_HREF} icon="activity" title="Activity">
          <span className="flex shrink-0 items-center gap-1.5 text-cap text-ink-3">
            <StatusDot
              pulse={running > 0}
              tone={running > 0 ? 'accent' : 'idle'}
            />
            {runningMeta(running)}
          </span>
        </Tile>
      </div>
    </section>
  )
}
