'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { PageMain } from 'src/components/shell/page-main'

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
 * The root error boundary — the library, activity or facets call threw.
 *
 * A client component because Next.js requires it: the boundary owns `reset`,
 * which is a callback the browser has to be able to invoke. Drawn as the
 * mockups' boundary row: the page title, a `bad` `Note` saying what broke and
 * what to do, then the one Try again button beside the digest.
 */
export default function HomeError({
  error,
  reset,
}: HomeErrorProps): JSX.Element {
  return (
    <PageMain>
      <h1 className="mb-4 text-h2">The library didn&rsquo;t load</h1>
      <Note
        icon={<Icon name="alert" />}
        lead="The download service didn’t answer."
        tone="bad"
      >
        Counts and recently added are missing rather than stale. It may be
        restarting — try again in a minute.
      </Note>
      <div className="mt-3 flex items-center gap-3">
        <Button icon="refresh" onClick={reset} size="sm" variant="outline">
          Try again
        </Button>
        {error.digest === undefined ? null : (
          <span className="font-mono text-mono-sm text-ink-3">
            digest {error.digest}
          </span>
        )}
      </div>
    </PageMain>
  )
}
