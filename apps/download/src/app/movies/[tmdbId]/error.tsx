'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { DetailError } from 'src/components/detail/detail-error'
import { LibraryLink } from 'src/components/detail/library-link'

/** `mock.pug`'s `appBody` at both widths, spelled the way `src/app/(home)/page.tsx` does. */
const PAGE_SHELL = cns(
  'flex-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

export type MovieErrorProps = {
  /** Next hands the boundary the thrown error, with a `digest` in production. */
  error: Error & { digest?: string }
  /** Re-renders the segment from scratch, which re-fetches. */
  reset: () => void
}

/**
 * `/movies/<tmdbId>`'s error boundary.
 *
 * Only a genuinely unexpected failure reaches here. The two things that look
 * like errors on this route are not routed to it:
 *
 * - **Radarr being unreachable** resolves to a placeholder movie, which the
 *   page renders with a note of its own. A metadata outage is a degraded page,
 *   not a broken one.
 * - **A malformed id** is `notFound()`, which is the 404 boundary.
 *
 * ⚠️ `error.message` is deliberately not rendered — production replaces it with
 * a generic string and development makes it a stack trace's first line. The
 * `digest` is shown because it is the one thing that correlates this screen
 * with the server log that explains it.
 *
 * `LibraryLink` stays, because a dead end with no way back is worse than a dead
 * end.
 */
export default function MovieError({
  error,
  reset,
}: MovieErrorProps): JSX.Element {
  return (
    <main className={PAGE_SHELL}>
      <div className={cns('mx-auto max-w-[1080px]')}>
        <LibraryLink />
        <DetailError
          detail="None of this movie’s details or downloads could be read. Nothing has been changed — trying again is safe."
          digest={error.digest}
          lead="The download service didn’t answer."
          title="This movie couldn’t be loaded"
          onReset={reset}
        />
      </div>
    </main>
  )
}
