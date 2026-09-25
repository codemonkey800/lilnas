'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

export type HomeErrorProps = {
  /**
   * Next.js hands the boundary a digest instead of the message in production,
   * so this is rendered as a correlation id and never as prose — the real
   * stack is in the server log.
   */
  error: Error & { digest?: string }
  /** Re-runs the segment's render, which re-fetches. */
  reset: () => void
}

/**
 * The homepage's error boundary — the library, activity or facets call threw.
 *
 * A client component because Next.js requires it: the boundary owns `reset`,
 * which is a callback the browser has to be able to invoke.
 *
 * `Note` wears the loud override `ui.pug` uses for its one alarming aside.
 * `Note` has no `tone` prop by design, so the three `!` utilities below are
 * the sanctioned way to say "this one is bad".
 */
export default function HomeError({
  error,
  reset,
}: HomeErrorProps): JSX.Element {
  return (
    <main
      className={cns(
        'flex-auto px-6 pt-[18px] pb-[30px]',
        'sm:px-8 sm:pt-[30px] sm:pb-11',
      )}
    >
      <div className="mx-auto max-w-[1080px]">
        <h1 className="mb-[14px] text-h2 sm:mb-4">Library unavailable</h1>
        <Note className="border-bad/35! bg-bad-ghost! [&>svg]:text-bad!">
          <p>
            The library didn&rsquo;t load. The download service answered with an
            error, so the counts and the recently-added grid are both missing
            rather than stale.
          </p>
          {error.digest === undefined ? null : (
            <p className="mt-1.5 font-mono text-mono-sm text-ink-4">
              {error.digest}
            </p>
          )}
          <Button
            className="mt-2.5"
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
