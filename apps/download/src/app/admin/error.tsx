'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  ADMIN_TITLE,
  ADMIN_TITLE_TEXT,
  AdminPageShell,
} from 'src/components/admin/admin-page-shell'
import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const ERROR_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

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
      <h1 className={ADMIN_TITLE}>{ADMIN_TITLE_TEXT}</h1>
      <Note className={cns(ERROR_NOTE)} icon="alert">
        <p className="font-[620] text-ink">The dashboard could not be loaded</p>
        <p className="mt-1">
          The download service did not answer. Downloads themselves are
          unaffected — this page just cannot see the numbers right now.
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
    </AdminPageShell>
  )
}
