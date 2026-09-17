import type { JSX } from 'react'

import { VideoDetailShell } from 'src/components/detail/video-detail'
import { NotFound } from 'src/components/shell/not-found'

/**
 * The heading. Names the *video* rather than the address, which is the whole
 * reason this boundary survives alongside the root one.
 */
export const VIDEO_NOT_FOUND_TITLE = 'No such video'

/**
 * ⚠️ The sentence the root 404 cannot say.
 *
 * A `tmdb:`/`tvdb:` key always resolves to *something* upstream, so a movie or
 * a show that nobody has requested is still a perfectly good page. A video is
 * the opposite: it exists only because somebody downloaded it, so an address
 * with no `videos` row behind it means the download never happened — or its
 * files have since been removed. That is a fact about the library, not about
 * the URL, and it comes with a different next step: start one.
 */
export const VIDEO_NOT_FOUND_DESCRIPTION =
  'Nothing has been downloaded under this address. A video only gets a page once somebody asks for it, so either this one never ran or its files have been removed — paste the link in the search field at the top to start it again.'

/**
 * The video route's not-found state.
 *
 * ⚠️ **Kept, deliberately, now that `src/app/not-found.tsx` exists.** The test
 * for a segment-scoped boundary is whether it says something the root one
 * cannot, and this one does: see {@link VIDEO_NOT_FOUND_DESCRIPTION}. It also
 * lands in this route's own column (`VideoDetailShell`, shared with the page,
 * its skeleton and its error boundary) rather than replacing the document.
 *
 * Everything below the copy is the root 404's — the same `NotFound` panel, the
 * same `search` icon, the same back link — so the two read as one state told at
 * two levels of detail rather than as two designs. Before this task they were
 * the latter: a left-aligned `Note` wearing `alert`, which is this system's
 * *error* register and the wrong reading entirely. Nothing here is broken.
 *
 * Two different failures arrive here and both get this answer. A segment that
 * is not a plain nanoid never reaches the backend at all (`mediaIdFromRoute`
 * rejects it), and a well-formed id with no row behind it is a 404 from
 * `GET /download/media/:id`.
 */
export default function VideoNotFound(): JSX.Element {
  return (
    <VideoDetailShell>
      <h1 className="sr-only">{VIDEO_NOT_FOUND_TITLE}</h1>
      <NotFound
        description={VIDEO_NOT_FOUND_DESCRIPTION}
        title={VIDEO_NOT_FOUND_TITLE}
      />
    </VideoDetailShell>
  )
}
