import { Button, EmptyState } from '@lilnas/ui'
import type { JSX } from 'react'

import { activityHref, EMPTY_ACTIVITY_FILTERS } from 'src/lib/activity-filters'

/**
 * The two ways the activity feed can be empty, which are not the same thing and
 * must never be told the same way.
 *
 * An unfiltered feed with nothing on it means the machine is genuinely idle —
 * good news, and the only useful thing to add is how to put something on it. A
 * *filtered* feed with nothing on it means downloads may well be running and
 * this tab is hiding them, which is the one reading that would otherwise send
 * someone looking for a fault that isn't there — so it gets a different line
 * and a way to widen the view rather than a way to start something.
 */
export type ActivityEmptyProps = {
  /** Whether a type filter is currently applied. */
  filtered: boolean
}

const EMPTY_STATES = {
  idle: {
    action: 'Search or paste a link',
    body: 'Paste a link in the search field and it’ll show up here while it runs.',
    href: '/search',
    title: 'Nothing downloading',
  },
  filtered: {
    action: 'Show all downloads',
    body: 'Downloads of other kinds may still be running. Show everything in flight to see them.',
    href: activityHref(EMPTY_ACTIVITY_FILTERS),
    title: 'Nothing of this kind downloading',
  },
} as const

export function ActivityEmpty({ filtered }: ActivityEmptyProps): JSX.Element {
  const state = EMPTY_STATES[filtered ? 'filtered' : 'idle']

  return (
    <EmptyState
      action={
        <Button render={<a href={state.href} />} size="sm" variant="outline">
          {state.action}
        </Button>
      }
      body={state.body}
      title={state.title}
    />
  )
}
