import type { JSX } from 'react'

import { Card } from 'src/components/ui/card'
import { Icon } from 'src/components/ui/icon'

/**
 * The two ways the history table can be empty, which are not the same thing and
 * must never be told the same way.
 *
 * An unfiltered history with nothing in it means nobody has ever downloaded
 * anything — a fresh install, and a statement about the service. A *filtered*
 * one means there is plenty of history and this view is hiding all of it, which
 * is the reading that would otherwise send an admin looking for a fault.
 */
export type AdminHistoryEmptyProps = {
  /** Whether any of requester/type/status is currently applied. */
  filtered: boolean
}

const EMPTY_STATES = {
  filtered: {
    body: 'Other downloads exist — this combination of requester, type and status just has no rows. Clear a filter above to widen the view.',
    icon: 'filter',
    title: 'Nothing matches these filters',
  },
  none: {
    body: 'No download has ever been recorded. Once anyone downloads something, every job they run — finished, failed or cancelled — appears here.',
    icon: 'layers',
    title: 'No downloads yet',
  },
} as const

export function AdminHistoryEmpty({
  filtered,
}: AdminHistoryEmptyProps): JSX.Element {
  const state = EMPTY_STATES[filtered ? 'filtered' : 'none']

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
