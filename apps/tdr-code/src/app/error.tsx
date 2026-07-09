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
    <div className="mx-auto max-w-xl space-y-4 py-10">
      <ErrorState message={error.message} />
      <button
        type="button"
        onClick={reset}
        data-track-id="error-boundary-retry"
        className="rounded bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
      >
        Try again
      </button>
    </div>
  )
}
