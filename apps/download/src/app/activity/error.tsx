'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { ActivityPageShell } from 'src/components/activity/activity-page-shell'

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
      <h1 className="mb-4 text-h2">The feed didn’t load</h1>
      <Note
        icon={<Icon name="alert" />}
        lead="The download service didn’t answer."
        tone="bad"
      >
        Running downloads aren’t affected — this page just couldn’t read them.
        Try again in a minute.
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
    </ActivityPageShell>
  )
}
