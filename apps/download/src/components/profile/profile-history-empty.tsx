import type { JSX } from 'react'

import { Note } from 'src/components/ui/card'

export type ProfileHistoryEmptyProps = {
  /**
   * Whether a type or status chip is currently applied, which decides *which*
   * empty state this is. The two must never share copy: zero rows because the
   * chips matched nothing is a thing the reader just did and can undo, where
   * zero rows because this person has never downloaded anything is a fact about
   * them.
   */
  filtered: boolean
  /** Whether this profile is the viewer's own — only changes who the copy is about. */
  you: boolean
}

/**
 * The two ways a profile's history can be empty.
 *
 * A `Note` rather than the sunk panel `/gallery` and `/activity` use for the
 * same job, following `profile.pug`: the rest of the profile is still on screen
 * above it — the totals, the trend — so this is an aside about one section
 * rather than the page having nothing to show.
 */
export function ProfileHistoryEmpty({
  filtered,
  you,
}: ProfileHistoryEmptyProps): JSX.Element {
  if (filtered) {
    return (
      <Note icon="filter">
        <b className="font-[620] text-ink">No downloads match these filters.</b>{' '}
        Try clearing or changing the type/status chips above.
      </Note>
    )
  }

  return (
    <Note icon="activity">
      <b className="font-[620] text-ink">No downloads yet.</b>{' '}
      {/*
        `profile.pug` writes "This person's downloads" for every state, which
        reads oddly on your own profile — the one profile everybody sees first.
      */}
      {you
        ? 'Your downloads will show up here once you start one.'
        : 'This person’s downloads will show up here once they start one.'}
    </Note>
  )
}
