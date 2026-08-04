'use client'

import { useEffect } from 'react'

import { Brandmark } from 'src/app/components/brandmark'
import { Icon } from 'src/app/components/icons'

type AdminErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

// ──────────────────────────────────────────────────────────────────────────────
// #17 (from REVIEW.md): a backstop for whatever the merged admin
// dashboard's own runAction()-style try/catch doesn't catch — an error
// thrown during RENDER rather than inside a Server Action's own async
// callback, or a bug that forgets that pattern entirely. Before this file
// existed, ANY unhandled error anywhere under /admin fell through to
// Next's generic, unstyled default error screen, wiping the queue/user
// list and any in-progress selection with no way back except a full
// reload.
//
// Scoped to src/app/admin/ specifically (a segment-level error.tsx, not a
// root/global one) — an error here should not take down /login or
// /pending, which have no relationship to whatever went wrong in the admin
// section.
// ──────────────────────────────────────────────────────────────────────────────
export default function AdminError({ error, reset }: AdminErrorProps) {
  useEffect(() => {
    // No structured logger reaches the browser bundle — console.error is
    // this component's only way to surface the failure for local
    // debugging; the admin viewing their own session is the only audience.
    console.error(error)
  }, [error])

  return (
    <div className="wrap">
      <div className="panel">
        <Brandmark />
        <h1 className="h1">Something went wrong</h1>
        <div className="notice" role="alert">
          <Icon name="x" />
          <span>{error.message || 'An unexpected error occurred.'}</span>
        </div>
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
      </div>
    </div>
  )
}
