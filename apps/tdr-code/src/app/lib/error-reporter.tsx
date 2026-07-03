'use client'

import { useEffect } from 'react'

import { logToServer } from './browser-logger'

// Mounted once in layout.tsx, alongside (not inside) QueryProvider —
// providers.tsx's own job is React Query setup, so global error-listener
// wiring gets its own component rather than an unrelated side effect bolted
// onto that one. addEventListener (not assigning window.onerror directly)
// so this never clobbers any other handler already attached (e.g. a
// third-party script, or React's own dev-mode overlay).
export function ErrorReporter() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      logToServer('error', event.message, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      })
    }

    function handleRejection(event: PromiseRejectionEvent) {
      const { reason } = event
      logToServer(
        'error',
        reason instanceof Error ? reason.message : String(reason),
        { stack: reason instanceof Error ? reason.stack : undefined },
      )
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  return null
}
