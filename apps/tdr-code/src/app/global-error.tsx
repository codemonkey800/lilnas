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
          margin: 0,
          background: '#0e0c14',
          color: '#ebe8f2',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
        }}
      >
        <p style={{ margin: 0 }}>Something went wrong.</p>
        <button
          type="button"
          onClick={reset}
          data-track-id="global-error-retry"
          style={{
            marginTop: '1rem',
            padding: '0.5rem 1rem',
            background: '#9b7bf5',
            color: '#120a2a',
            border: 'none',
            borderRadius: '6px',
            font: 'inherit',
            fontWeight: 500,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
