'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { LibraryLink } from 'src/components/detail/library-link'
import { VideoDetailShell } from 'src/components/detail/video-detail'
import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const ERROR_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

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
      <Note className={cns(ERROR_NOTE)} icon="alert">
        <p className={cns('font-[620] text-ink')}>
          This video could not be loaded
        </p>
        <p className="mt-1">
          The download service did not answer. Whatever has already been
          downloaded is still on the server — trying again is safe, and so is
          leaving and coming back.
        </p>
        {error.digest ? (
          <p className={cns('mt-2 font-mono text-mono-sm text-ink-4')}>
            Reference {error.digest}
          </p>
        ) : null}
        <Button
          className="mt-3.5"
          icon="activity"
          onClick={reset}
          size="sm"
          variant="outline"
        >
          Try again
        </Button>
      </Note>
    </VideoDetailShell>
  )
}
