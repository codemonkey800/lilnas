'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

/** `search.pug:320`'s loud override — see `search-notes.tsx` for the idiom. */
const LOUD_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

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
    <div className="mt-[22px] sm:mt-[30px]">
      <Note className={cns('reveal', LOUD_NOTE)} role="alert">
        <b className="text-ink">That search didn&apos;t come back.</b> Radarr or
        Sonarr may be restarting. Nothing is wrong with what you typed — try it
        again.
        {error.digest ? (
          <span className="mt-1.5 block font-mono text-mono-sm text-ink-4">
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
