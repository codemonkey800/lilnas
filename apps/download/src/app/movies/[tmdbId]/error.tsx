'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { LibraryLink } from 'src/components/detail/library-link'
import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

/** `mock.pug`'s `appBody` at both widths, spelled the way `src/app/(home)/page.tsx` does. */
const PAGE_SHELL = cns(
  'flex-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const ERROR_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

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
        <h1 className={cns('mb-[14px] text-h2 sm:mb-4')}>
          This movie could not be loaded
        </h1>
        <Note className={cns(ERROR_NOTE)} icon="alert">
          <p>
            The download service didn&rsquo;t answer, so none of this
            movie&rsquo;s details or downloads could be read. Nothing has been
            changed &mdash; trying again is safe.
          </p>
          {error.digest === undefined ? null : (
            <p className={cns('mt-1.5 font-mono text-mono-sm text-ink-4')}>
              Reference {error.digest}
            </p>
          )}
          <Button
            className={cns('mt-2.5')}
            icon="activity"
            onClick={reset}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        </Note>
      </div>
    </main>
  )
}
