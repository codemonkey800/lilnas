import { Button, EmptyState } from '@lilnas/ui'
import type { JSX } from 'react'

import { LIBRARY_HREF } from 'src/components/detail/library-link'

/**
 * The two ways a profile's history can be empty, which are not the same thing
 * and must never be told the same way.
 *
 * *No downloads yet* is a statement about the person. *Filtered to nothing* is
 * a statement about the view: the history exists and the chips above are hiding
 * all of it, which is the reading that would otherwise send someone looking for
 * a fault. So the second one says so and offers to widen the view, where the
 * first points back at the library.
 */
export type ProfileHistoryEmptyProps = {
  /** Where "Clear filters" goes: this profile with the chips removed. */
  clearHref?: string
  /** Whether a type or status chip is currently narrowing the history. */
  filtered: boolean
  /** Whether this is the viewer's own profile. */
  you: boolean
}

export function ProfileHistoryEmpty({
  clearHref = '/profile',
  filtered,
  you,
}: ProfileHistoryEmptyProps): JSX.Element {
  if (filtered) {
    return (
      <EmptyState
        action={
          <Button render={<a href={clearHref} />} size="sm" variant="outline">
            Clear filters
          </Button>
        }
        body="This person has downloads — none fit this combination. Clear a filter to widen the view."
        title="No downloads match these filters"
      />
    )
  }

  return (
    <EmptyState
      action={
        <Button render={<a href={LIBRARY_HREF} />} size="sm" variant="outline">
          Back to library
        </Button>
      }
      // `profile.pug` writes "This person's downloads" for every state, which
      // reads oddly on your own profile — the one profile everybody sees first.
      body={
        you
          ? 'Your downloads will show up here once you start one.'
          : 'This person’s downloads will show up here once they start one.'
      }
      title="No downloads yet"
    />
  )
}
