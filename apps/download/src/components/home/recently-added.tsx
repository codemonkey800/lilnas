import type { GalleryItem } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { GALLERY_HREF } from 'src/components/home/quick-access'
import { RecentlyAddedGrid } from 'src/components/home/recently-added-grid'
import { ButtonLink } from 'src/components/ui/button-link'
import type { Viewer } from 'src/lib/viewer'

/**
 * How many cards the homepage shows. Six is `home.pug`'s grid, and at the
 * desktop card width (158px + a 16px gap) it is exactly the row that fits
 * under the quick-access tiles without a second one.
 */
export const RECENTLY_ADDED_LIMIT = 6

export type RecentlyAddedProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children'
> & {
  /** The first {@link RECENTLY_ADDED_LIMIT} rows of `GET /download/gallery`. */
  items: readonly GalleryItem[]
  /** One pinned instant for the whole grid — see {@link RecentCard}'s `now`. */
  now: number
  /** Who is looking, `null` for nobody — see {@link RecentCard}'s `viewer`. */
  viewer: Viewer | null
}

const HEADING_ID = 'recently-added-heading'

/**
 * Recently added — the newest handful of library rows, and the way through to
 * the rest of it.
 *
 * `See full library` stays visible at every width, where `home.pug` drops it
 * from the mobile panel: the app bar carries no library link, so on a phone
 * this is the only route to `/gallery` that isn't the back button.
 */
export function RecentlyAdded({
  className,
  items,
  now,
  viewer,
  ...props
}: RecentlyAddedProps): JSX.Element {
  return (
    <section {...props} aria-labelledby={HEADING_ID} className={className}>
      <div className="mb-[14px] flex items-center justify-between gap-3 sm:mb-4">
        <h2 className="text-h2" id={HEADING_ID}>
          Recently added
        </h2>
        <ButtonLink
          href={GALLERY_HREF}
          iconEnd="arrow"
          size="sm"
          variant="ghost"
        >
          See full library
        </ButtonLink>
      </div>
      <RecentlyAddedGrid items={items} now={now} viewer={viewer} />
    </section>
  )
}
