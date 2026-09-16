'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  ACTIVITY_TITLE,
  ActivityPageShell,
} from 'src/components/activity/activity-page-shell'
import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const ERROR_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

export type ActivityErrorProps = {
  /** Next hands the boundary the thrown error, with a `digest` in production. */
  error: Error & { digest?: string }
  /** Re-renders the segment from scratch. */
  reset: () => void
}

/**
 * The activity feed's error boundary.
 *
 * Only genuinely unexpected failures reach here. An idle machine is an empty
 * state and a type filter that matches nothing is a different empty state —
 * neither is an error, and showing either here would tell someone the service is
 * broken when the only thing that happened is that nothing is downloading.
 *
 * A live socket that cannot connect never reaches here either: it is reported in
 * place, by the feed's own reconnecting marker, because the rows the server
 * already rendered are still worth looking at.
 *
 * ⚠️ `error.message` is deliberately not rendered — in a production build Next
 * replaces it with a generic string anyway, and in development it is a stack
 * trace's first line. The `digest` is shown because it is the one thing that
 * correlates this screen with the server log that explains it.
 */
export default function ActivityError({
  error,
  reset,
}: ActivityErrorProps): JSX.Element {
  return (
    <ActivityPageShell>
      <h1 className={ACTIVITY_TITLE}>Downloads activity</h1>
      <Note className={cns(ERROR_NOTE)} icon="alert">
        <p className="font-[620] text-ink">Activity could not be loaded</p>
        <p className="mt-1">
          The download service did not answer. Anything already downloading is
          still downloading — this page just cannot see it right now.
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
    </ActivityPageShell>
  )
}
