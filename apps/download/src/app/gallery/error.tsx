'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { GalleryPageShell } from 'src/components/gallery/gallery-page-shell'
import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const ERROR_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

export type GalleryErrorProps = {
  /** Next hands the boundary the thrown error, with a `digest` in production. */
  error: Error & { digest?: string }
  /** Re-renders the segment from scratch. */
  reset: () => void
}

/**
 * The gallery's error boundary.
 *
 * Only genuinely unexpected failures reach here. An inverted date range is a
 * 400 the page catches and renders as a validation message on the filter panel,
 * and an empty result is an empty state — neither is an error, and showing
 * either of them here would be telling a user something is broken when the only
 * thing that happened is that they filtered something out.
 *
 * ⚠️ `error.message` is deliberately not rendered. In a production build Next
 * replaces it with a generic string anyway, and in development it is a stack
 * trace's first line — an internal detail either way. The `digest` is shown
 * because it is the one thing that correlates this screen with the server log
 * that explains it.
 */
export default function GalleryError({
  error,
  reset,
}: GalleryErrorProps): JSX.Element {
  return (
    <GalleryPageShell>
      <Note className={cns(ERROR_NOTE)} icon="alert">
        <p className="font-[620] text-ink">The library could not be loaded</p>
        <p className="mt-1">
          The download service did not answer. Nothing has been lost — trying
          again is safe.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-mono-sm text-ink-4">
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
    </GalleryPageShell>
  )
}
