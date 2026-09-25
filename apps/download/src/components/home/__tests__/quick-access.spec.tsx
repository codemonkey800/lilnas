import '@testing-library/jest-dom'

import type { DownloadGalleryFacets } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  ACTIVITY_HREF,
  galleryHrefForType,
  galleryTypeCount,
  QuickAccess,
  runningMeta,
} from 'src/components/home/quick-access'

/**
 * The shape the live backend actually answers with. Note what is *not* here:
 * a `{ count: 0 }` entry. A type with no rows is absent from the array
 * entirely, which is the case every count on this page has to survive.
 */
const FACETS: DownloadGalleryFacets = {
  types: [
    { count: 318, type: DownloadType.Movie },
    { count: 203, type: DownloadType.Video },
  ],
  uploaders: [{ count: 28, email: 'jeremy@lilnas.io' }],
}

const EMPTY_FACETS: DownloadGalleryFacets = { types: [], uploaders: [] }

describe('galleryTypeCount', () => {
  it('reads the count of a type that is present', () => {
    expect(galleryTypeCount(FACETS, DownloadType.Movie)).toBe(318)
    expect(galleryTypeCount(FACETS, DownloadType.Video)).toBe(203)
  })

  it('answers 0 for a type the facets omit entirely', () => {
    expect(galleryTypeCount(FACETS, DownloadType.Show)).toBe(0)
    expect(galleryTypeCount(EMPTY_FACETS, DownloadType.Movie)).toBe(0)
  })
})

describe('runningMeta', () => {
  it('counts what is in flight', () => {
    expect(runningMeta(2)).toBe('2 running now')
    expect(runningMeta(1)).toBe('1 running now')
  })

  it('does not claim anything is happening at zero', () => {
    expect(runningMeta(0)).toBe('Nothing running')
  })
})

describe('QuickAccess', () => {
  it('renders the four tiles in the mockup order', () => {
    render(<QuickAccess facets={FACETS} running={2} />)
    const tiles = screen.getAllByRole('link')

    expect(tiles.map(tile => tile.getAttribute('href'))).toEqual([
      galleryHrefForType(DownloadType.Movie),
      galleryHrefForType(DownloadType.Show),
      galleryHrefForType(DownloadType.Video),
      ACTIVITY_HREF,
    ])
  })

  it('takes every library count from the facets', () => {
    render(<QuickAccess facets={FACETS} running={2} />)

    expect(
      screen.getByRole('link', { name: /Browse movies/ }),
    ).toHaveTextContent('318 in the library')
    expect(
      screen.getByRole('link', { name: /Video library/ }),
    ).toHaveTextContent('203 in the library')
  })

  it('renders 0 for a type the facets omit rather than dropping the tile', () => {
    render(<QuickAccess facets={FACETS} running={2} />)
    const shows = screen.getByRole('link', { name: /Browse shows/ })

    expect(shows).toBeInTheDocument()
    expect(shows).toHaveTextContent('0 in the library')
  })

  it('survives facets with nothing in them at all', () => {
    render(<QuickAccess facets={EMPTY_FACETS} running={0} />)

    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(
      screen.getByRole('link', { name: /Browse movies/ }),
    ).toHaveTextContent('0 in the library')
  })

  it('shows the running count with a live dot while work is in flight', () => {
    render(<QuickAccess facets={FACETS} running={2} />)
    const activity = screen.getByRole('link', { name: /Downloads activity/ })

    expect(activity).toHaveTextContent('2 running now')
    expect(activity.querySelector('.dot-live')).not.toBeNull()
  })

  it('drops the live dot when nothing is running', () => {
    render(<QuickAccess facets={FACETS} running={0} />)
    const activity = screen.getByRole('link', { name: /Downloads activity/ })

    expect(activity).toHaveTextContent('Nothing running')
    expect(activity.querySelector('.dot-live')).toBeNull()
  })

  it('labels the section with its own heading', () => {
    render(<QuickAccess facets={FACETS} running={0} />)

    expect(
      screen.getByRole('region', { name: 'Quick access' }),
    ).toBeInTheDocument()
  })
})
