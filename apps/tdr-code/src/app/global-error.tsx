'use client'

import { useEffect } from 'react'

import { logBoundaryError } from './lib/error-boundary-logging'

// Required companion to error.tsx for errors escaping the ROOT layout
// itself — must define its own <html>/<body> per Next's convention, since
// the root layout that would normally provide them (and its globals.css) may
// be exactly what's broken. Inline styles only — cannot safely depend on
// Tailwind's compiled output or ErrorState/NavShell, all of which live
// inside the layout tree this boundary exists to catch failures in.
export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          background: '#030712',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
        }}
      >
        <p>Something went wrong.</p>
        <button
          type="button"
          onClick={reset}
          data-track-id="global-error-retry"
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            background: '#1f2937',
            color: '#d1d5db',
            border: 'none',
            borderRadius: '0.25rem',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
