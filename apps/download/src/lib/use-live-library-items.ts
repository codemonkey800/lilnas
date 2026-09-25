'use client'

import {
  DownloadType,
  type GalleryItem,
  isMovie,
  isShow,
  type Media,
} from '@lilnas/utils/download/types'
import { useMemo } from 'react'

import { useMediaEvents } from 'src/lib/use-job-events'

/**
 * Whether a live media copy still has what put it in the library listing -
 * the same file signal `MediaResolverService.listLibrary()` filters on: a
 * movie's file, and a show's `episodeFileCount`, never its `filePath` (the
 * series folder, set files or not).
 */
function inLibrary(media: Media): boolean {
  if (isMovie(media)) return Boolean(media.filePath)
  if (isShow(media)) return (media.episodeFileCount ?? 0) > 0
  return true
}

/**
 * `items` minus every movie or show whose file has left the library since the
 * server rendered them - deleted here, or in Radarr's/Sonarr's own UI. The
 * gateway re-reads the whole library once a minute and sends a frame for each
 * title that changed, so a card disappears within about a minute without a
 * reload. A title that comes back (a frame with its file again) reappears.
 *
 * Titles added to the library are not inserted: where one sorts depends on
 * the page's filters and cursor, which only the server knows. They show up on
 * the next load.
 *
 * Needs a `<JobEventsProvider>` ancestor, like every live hook.
 */
export function useLiveLibraryItems(
  items: readonly GalleryItem[],
): readonly GalleryItem[] {
  const mediaIds = items.flatMap(item =>
    item.media.type === DownloadType.Video ? [] : [item.media.id],
  )
  const { media } = useMediaEvents({ mediaIds })

  return useMemo(() => {
    if (media.size === 0) return items

    return items.filter(item => {
      const live = media.get(item.media.id)?.media
      return !live || live.type !== item.media.type || inLibrary(live)
    })
  }, [items, media])
}
