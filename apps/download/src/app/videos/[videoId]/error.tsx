'use client'

import type { JSX } from 'react'

import { DetailError } from 'src/components/detail/detail-error'
import { LibraryLink } from 'src/components/detail/library-link'
import { VideoDetailShell } from 'src/components/detail/video-detail'

export type VideoDetailErrorProps = {
  /** Next hands the boundary the thrown error, with a `digest` in production. */
  error: Error & { digest?: string }
  /** Re-runs the segment's render, which re-fetches. */
  reset: () => void
}

/**
 * The video detail route's error boundary.
 *
 * An unknown `video:` key never reaches here — that is a 404 the page turns
 * into `notFound()`, because a video that was never downloaded has no page
 * rather than a broken one. What lands here is the download service not
 * answering at all.
 *
 * ⚠️ A failed **Save to device** lands here too, and it is the one case where
 * "nothing has been lost" needs qualifying: the media-file route answers 404
 * for a title with no file and **503** for a resolver that is merely degraded.
 * The copy below therefore says the file could not be fetched *right now*
 * rather than that it is gone — the two are different facts and only one of
 * them is worth acting on.
 *
 * `error.message` is deliberately not rendered: a production build replaces it
 * with a generic string and a development one puts a stack trace's first line
 * there. The `digest` is shown because it is the one thing that correlates
 * this screen with the server log that explains it.
 */
export default function VideoDetailError({
  error,
  reset,
}: VideoDetailErrorProps): JSX.Element {
  return (
    <VideoDetailShell>
      <LibraryLink />
      <DetailError
        detail="None of this video’s details or downloads could be read. Nothing has been changed — trying again is safe."
        digest={error.digest}
        lead="The download service didn’t answer."
        title="This video couldn’t be loaded"
        onReset={reset}
      />
    </VideoDetailShell>
  )
}
