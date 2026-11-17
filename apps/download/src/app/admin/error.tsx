'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { AdminPageShell } from 'src/components/admin/admin-page-shell'

export type AdminErrorProps = {
  /** Next hands the boundary the thrown error, with a `digest` in production. */
  error: Error & { digest?: string }
  /** Re-renders the segment from scratch. */
  reset: () => void
}

/**
 * The admin dashboard's error boundary.
 *
 * Only genuinely unexpected failures reach here. A viewer who is not an admin
 * is **not** one of them: the page renders `NotAuthorized` in place, quietly,
 * because the app answered the question it was asked. An empty history and an
 * empty audit log are empty states for the same reason.
 *
 * ⚠️ `error.message` is deliberately not rendered — in a production build Next
 * replaces it with a generic string anyway, and in development it is a stack
 * trace's first line. The `digest` is shown because it is the one thing that
 * correlates this screen with the server log that explains it.
 */
export default function AdminError({
  error,
  reset,
}: AdminErrorProps): JSX.Element {
  return (
    <AdminPageShell>
      <h1 className="mb-4 text-h2">The dashboard didn’t load</h1>
      <Note
        icon={<Icon name="alert" />}
        lead="The download service didn’t answer."
        tone="bad"
      >
        Nothing was lost — the numbers just couldn’t be read. Try again in a
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
    </AdminPageShell>
  )
}
