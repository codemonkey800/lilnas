import { Button, EmptyState } from '@lilnas/ui'
import type { JSX } from 'react'

/**
 * The two ways the history can be empty, which are not the same thing and must
 * never be told the same way.
 *
 * An unfiltered history with nothing in it means nobody has ever downloaded
 * anything — a fresh install, and a statement about the service. A *filtered*
 * one means there is plenty of history and this view is hiding all of it, which
 * is the reading that would otherwise send an admin looking for a fault — so it
 * gets a way to widen the view instead of a way to start a download.
 */
export type AdminHistoryEmptyProps = {
  /** Where "Clear filters" goes: this page with the filters removed. */
  clearHref?: string
  /** Whether any of requester/type/status is currently applied. */
  filtered: boolean
}

const EMPTY_STATES = {
  filtered: {
    action: 'Clear filters',
    body: 'Other downloads exist — this combination just has no rows. Clear a filter to widen the view.',
    title: 'Nothing matches these filters',
  },
  none: {
    action: 'Search or paste a link',
    body: 'Once anyone downloads something, every job they run — finished, failed or cancelled — appears here.',
    title: 'No downloads yet',
  },
} as const

export function AdminHistoryEmpty({
  clearHref = '/admin',
  filtered,
}: AdminHistoryEmptyProps): JSX.Element {
  const state = EMPTY_STATES[filtered ? 'filtered' : 'none']

  return (
    <EmptyState
      action={
        <Button
          render={<a href={filtered ? clearHref : '/search'} />}
          size="sm"
          variant="outline"
        >
          {state.action}
        </Button>
      }
      body={state.body}
      title={state.title}
    />
  )
}
