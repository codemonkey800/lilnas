'use client'

import { useEffect } from 'react'

import { ErrorState } from './components/error-state'
import { logBoundaryError } from './lib/error-boundary-logging'

// Next's per-segment error boundary — renders INSIDE the root layout (nav
// shell/header stay visible), unlike global-error.tsx which only catches
// failures escaping the layout itself. Catches render-time throws that
// error-reporter.tsx's window.onerror/unhandledrejection listeners don't
// reliably see.
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logBoundaryError(error)
  }, [error])

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <ErrorState
        code={
          error.digest
            ? `${error.message} · digest ${error.digest}`
            : error.message
        }
        lead="This page hit an error."
        message="The nav still works. Try again, or open another page."
        onRetry={reset}
        retryLabel="Try again"
        retryTrackId="error-boundary-retry"
      />
    </div>
  )
}
