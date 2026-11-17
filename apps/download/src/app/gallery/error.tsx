'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { GalleryPageShell } from 'src/components/gallery/gallery-page-shell'

export type GalleryErrorProps = {
  /**
   * Next.js hands the boundary a digest instead of the message in production,
   * so it is rendered as a correlation id and never as prose.
   */
  error: Error & { digest?: string }
  /** Re-runs the segment's render, which re-fetches. */
  reset: () => void
}

/**
 * The gallery's error boundary: the page title, a `bad` `Note` saying what
 * broke and that nothing is lost, then the one Try again button beside the
 * digest. A client component because Next.js requires it: the boundary owns
 * `reset`.
 */
export default function GalleryError({
  error,
  reset,
}: GalleryErrorProps): JSX.Element {
  return (
    <GalleryPageShell>
      <h1 className="mb-4 text-h2">The gallery didn&rsquo;t load</h1>
      <Note
        icon={<Icon name="alert" />}
        lead="The download service didn’t answer."
        tone="bad"
      >
        Your library is safe — this page just couldn’t read it. Try again in a
        minute.
      </Note>
      <div className="mt-3 flex items-center gap-3">
        <Button icon="refresh" onClick={reset} size="sm" variant="outline">
          Try again
        </Button>
        {error.digest ? (
          <span className="font-mono text-mono-sm text-ink-3">
            digest {error.digest}
          </span>
        ) : null}
      </div>
    </GalleryPageShell>
  )
}
