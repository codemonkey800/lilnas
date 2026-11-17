'use client'

import { Note } from '@lilnas/ui'
import type { GalleryItem } from '@lilnas/utils/download/types'
import type { JSX } from 'react'

import { RecentCard } from 'src/components/home/recent-card'
import { useLiveLibraryItems } from 'src/lib/use-live-library-items'
import type { Viewer } from 'src/lib/viewer'

export type RecentlyAddedGridProps = {
  items: readonly GalleryItem[]
  now: number
  viewer: Viewer | null
}

/**
 * {@link RecentlyAdded}'s cards, or its empty note. A client island of its own
 * so a card whose title leaves the library while the page is open drops out
 * live (`useLiveLibraryItems`) - needs a `<JobEventsProvider>` ancestor.
 */
export function RecentlyAddedGrid({
  items,
  now,
  viewer,
}: RecentlyAddedGridProps): JSX.Element {
  const visible = useLiveLibraryItems(items)

  if (visible.length === 0) {
    return (
      <Note lead="Nothing in the library yet.">
        Paste a link in the search field above to download something, or search
        for a title to request it.
      </Note>
    )
  }

  return (
    <div className="stagger grid grid-cols-2 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(158px,1fr))]">
      {visible.map(item => (
        <RecentCard key={item.media.id} item={item} now={now} viewer={viewer} />
      ))}
    </div>
  )
}
