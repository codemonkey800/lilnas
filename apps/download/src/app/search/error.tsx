'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import type { JSX } from 'react'

export type SearchErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * `/search`'s error boundary — the search itself failed, as opposed to
 * succeeding and finding nothing.
 *
 * That distinction is the whole reason this is loud and `NoMatchesNote` is
 * not. A zero-result search is a true answer; this is the absence of one, and
 * the only thing the user can do about it is ask again.
 *
 * Deliberately below the boundary the hero sits above: whatever is in the
 * field stays in the field, so `reset()` re-runs the same query rather than
 * making the user retype it. `error.digest` is rendered for a report — the
 * message itself is not, since Next replaces it with a generic string in
 * production anyway and the raw one can carry backend internals.
 */
export default function SearchError({
  error,
  reset,
}: SearchErrorProps): JSX.Element {
  return (
    <div>
      <Note
        className="animate-rise"
        icon={<Icon name="alert" />}
        lead="That search didn't come back."
        tone="bad"
      >
        Radarr or Sonarr may be restarting. Nothing is wrong with what you typed
        — try it again.
        {error.digest ? (
          <span className="mt-1.5 block font-mono text-mono-sm text-ink-3">
            {error.digest}
          </span>
        ) : null}
      </Note>
      <div className="mt-4 flex">
        <Button icon="activity" onClick={reset} variant="outline">
          Try again
        </Button>
      </div>
    </div>
  )
}
