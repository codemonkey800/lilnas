import type { JSX } from 'react'

import { Card } from 'src/components/ui/card'
import { Icon } from 'src/components/ui/icon'

/**
 * The two ways the activity feed can be empty, which are not the same thing and
 * must never be told the same way.
 *
 * An unfiltered feed with nothing on it means the machine is genuinely idle —
 * good news, and the only useful thing to add is how to put something on it. A
 * *filtered* feed with nothing on it means downloads may well be running and
 * this tab is hiding them, which is the one reading that would otherwise send
 * someone looking for a fault that isn't there.
 */
export type ActivityEmptyProps = {
  /** Whether a type filter is currently applied. */
  filtered: boolean
}

const EMPTY_STATES = {
  idle: {
    body: 'Nothing is downloading. Paste a link in the search field at the top of the page, or search for a movie or show by name — anything in flight, yours or anyone else’s, appears here the moment it starts.',
    icon: 'activity',
    title: 'Nothing in flight',
  },
  filtered: {
    body: 'Downloads of other kinds may still be running. Choose All above to see everything that is in flight.',
    icon: 'filter',
    title: 'Nothing of this kind is downloading',
  },
} as const

export function ActivityEmpty({ filtered }: ActivityEmptyProps): JSX.Element {
  const state = EMPTY_STATES[filtered ? 'filtered' : 'idle']

  return (
    <Card
      sunk
      className="flex flex-col items-center gap-2.5 px-6 py-12 text-center"
    >
      <Icon className="h-6 w-6 text-ink-4" name={state.icon} />
      <p className="text-h3">{state.title}</p>
      <p className="max-w-[52ch] text-sm text-ink-3">{state.body}</p>
    </Card>
  )
}
