import type { JSX } from 'react'

import { Card } from 'src/components/ui/card'
import { Icon } from 'src/components/ui/icon'

/**
 * The two ways a gallery can be empty, which are not the same thing and must
 * never be told the same way.
 *
 * An unfiltered gallery with nothing in it is a library that has never been
 * used, and the only useful thing to say is how to put something in it. A
 * *filtered* gallery with nothing in it is a full library plus a query that
 * happens to match none of it, and the only useful thing to say is that the
 * filters are why. Collapsing the two into one "No results" is how a user
 * concludes their downloads are gone.
 */
export type GalleryEmptyProps = {
  /** Whether any filter is currently applied. */
  filtered: boolean
}

const EMPTY_STATES = {
  library: {
    body: 'Paste a link in the search field at the top of the page to download your first video, or search for a movie or show by name.',
    icon: 'grid',
    title: 'Nothing in the library yet',
  },
  filtered: {
    body: 'The library is not empty — nothing in it matches this combination. Clear a filter above to widen the search.',
    icon: 'filter',
    title: 'No titles match these filters',
  },
} as const

export function GalleryEmpty({ filtered }: GalleryEmptyProps): JSX.Element {
  const state = EMPTY_STATES[filtered ? 'filtered' : 'library']

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
