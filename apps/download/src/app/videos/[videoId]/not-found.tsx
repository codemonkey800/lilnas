import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { LIBRARY_HREF, LibraryLink } from 'src/components/detail/library-link'
import { VideoDetailShell } from 'src/components/detail/video-detail'
import { ButtonLink } from 'src/components/ui/button-link'
import { Note } from 'src/components/ui/card'

/**
 * The video route's not-found state.
 *
 * ⚠️ Segment-scoped on purpose. The app's root `not-found.tsx` belongs to a
 * later task; this one lives inside `/videos/[videoId]` so the state renders
 * in this route's own column, under this route's own back link, instead of
 * replacing the whole document with the framework's default.
 *
 * Two different things arrive here and both are the same answer. A segment
 * that is not a plain nanoid never reaches the backend at all
 * (`mediaIdFromRoute` rejects it), and a well-formed id with no `videos` row
 * behind it is a 404 from `GET /download/media/:id` — because a video cannot
 * exist before somebody downloaded it, unlike a movie or a show, which always
 * resolve to *something* upstream.
 *
 * Calm rather than loud, and deliberately not the error boundary's register:
 * nothing is broken. `Note`'s default appearance is the one for an aside the
 * interface is making, which is exactly what this is.
 */
export default function VideoNotFound(): JSX.Element {
  return (
    <VideoDetailShell>
      <h1 className="sr-only">Video not found</h1>
      <LibraryLink />
      <Note className={cns('max-w-[560px]')} icon="alert">
        <p className={cns('font-[620] text-ink')}>No such video</p>
        <p className="mt-1">
          Nothing has been downloaded under this address. A video only gets a
          page once someone has asked for it — paste the link in the search
          field at the top to start one, or go back to the library.
        </p>
        <ButtonLink
          className="mt-3.5"
          href={LIBRARY_HREF}
          icon="grid"
          size="sm"
          variant="outline"
        >
          Library
        </ButtonLink>
      </Note>
    </VideoDetailShell>
  )
}
