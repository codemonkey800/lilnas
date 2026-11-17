import { Button, EmptyState } from '@lilnas/ui'
import type { JSX } from 'react'

import { EMPTY_GALLERY_FILTERS, galleryHref } from 'src/lib/gallery-filters'

export type GalleryEmptyProps = {
  /**
   * Whether any filter is applied. It decides which of the two empty states
   * this is, because they are different facts with different ways out: an
   * empty library is filled by searching, an over-filtered one by clearing.
   */
  filtered: boolean
}

const EMPTY_STATES = {
  library: {
    action: { href: '/search', label: 'Search for a title' },
    body: 'Paste a link in the search field and it’ll queue up, or search for a movie or show by name.',
    title: 'Nothing in the library yet',
  },
  filtered: {
    action: {
      href: galleryHref(EMPTY_GALLERY_FILTERS),
      label: 'Clear filters',
    },
    body: 'The library isn’t empty — nothing in it matches this combination. Clear a filter to widen it.',
    title: 'No titles match these filters',
  },
} as const

/**
 * A grid with nothing in it: the mascot, one sentence on why, and the one thing
 * to press. Never a dead end — `EmptyState` takes exactly one action.
 */
export function GalleryEmpty({ filtered }: GalleryEmptyProps): JSX.Element {
  const state = EMPTY_STATES[filtered ? 'filtered' : 'library']

  return (
    <EmptyState
      action={
        <Button size="sm" render={<a href={state.action.href} />}>
          {state.action.label}
        </Button>
      }
      body={state.body}
      className="rounded-lg border border-line bg-bg-sunk py-12"
      title={state.title}
    />
  )
}
