'use client'

import type { JSX } from 'react'

import { DetailError } from 'src/components/detail/detail-error'
import { LibraryLink } from 'src/components/detail/library-link'
import { ShowPageShell } from 'src/components/detail/show-page-shell'

export type ShowErrorProps = {
  /** Next hands the boundary the thrown error, with a `digest` in production. */
  error: Error & { digest?: string }
  /** Re-runs the segment's render, which re-fetches. */
  reset: () => void
}

/**
 * `/shows/<tvdbId>`'s error boundary.
 *
 * ⚠️ Very little reaches here, and that is deliberate. Three things a user can
 * hit on this route are *not* errors and the page renders each of them in
 * place:
 *
 * - **A show that is not in Sonarr yet.** `listSeasons` answers 404 for one,
 *   which the page catches into an empty season list and an explanation.
 * - **A failed metadata lookup.** A `tvdb:` key always resolves - the resolver
 *   emits a placeholder rather than propagating - so that arrives as a note
 *   above a page that still works.
 * - **A grab, replace, report or delete that failed.** Every one of those is a
 *   result, not a throw, rendered next to the control that caused it, precisely
 *   so a refused episode does not replace the whole series with this card.
 *
 * What is left is the download service not answering at all, which is what this
 * says.
 *
 * ⚠️ `error.message` is deliberately not rendered. A production build replaces
 * it with a generic string anyway, and in development it is a stack trace's
 * first line - an internal detail either way. The `digest` is shown because it
 * is the one thing that correlates this screen with the server log explaining
 * it.
 */
export default function ShowError({
  error,
  reset,
}: ShowErrorProps): JSX.Element {
  return (
    <ShowPageShell>
      {/*
        The breadcrumb stays even here: whatever failed, "back to the library"
        is still a working destination, and a dead-end error card is a worse
        place to strand somebody than one with a way out.
      */}
      <LibraryLink />
      <DetailError
        detail="None of this show’s seasons or downloads could be read. Nothing has been changed — trying again is safe."
        digest={error.digest}
        lead="The download service didn’t answer."
        title="This show couldn’t be loaded"
        onReset={reset}
      />
    </ShowPageShell>
  )
}
