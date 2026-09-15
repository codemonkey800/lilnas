import '@testing-library/jest-dom'

import type { GalleryItem } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { GALLERY_HREF } from 'src/components/home/quick-access'
import {
  RECENTLY_ADDED_LIMIT,
  RecentlyAdded,
} from 'src/components/home/recently-added'

const NOW = Date.parse('2026-09-15T20:00:00.000Z')

function video(index: number): GalleryItem {
  return {
    downloadCount: 1,
    lastDownloadedAt: '2026-09-15T19:48:00.000Z',
    lastRequester: null,
    media: {
      id: `video:v${index}`,
      runtime: 178,
      sourceUrl: `https://example.invalid/${index}`,
      title: `Clip ${index}`,
      type: DownloadType.Video,
    },
  }
}

const ITEMS = Array.from({ length: RECENTLY_ADDED_LIMIT }, (_, i) => video(i))

describe('RecentlyAdded', () => {
  it('renders one card per item', () => {
    render(<RecentlyAdded items={ITEMS} now={NOW} />)

    expect(screen.getAllByRole('link', { name: /Clip/ })).toHaveLength(
      RECENTLY_ADDED_LIMIT,
    )
  })

  it('keeps the way through to the full library', () => {
    render(<RecentlyAdded items={ITEMS} now={NOW} />)

    expect(
      screen.getByRole('link', { name: 'See full library' }),
    ).toHaveAttribute('href', GALLERY_HREF)
  })

  it('says so when the library is empty, instead of drawing an empty grid', () => {
    render(<RecentlyAdded items={[]} now={NOW} />)

    expect(screen.queryByRole('link', { name: /Clip/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Nothing in the library yet/)).toBeInTheDocument()
    // Still reachable: an empty homepage is exactly when somebody wants the
    // gallery's own filters.
    expect(
      screen.getByRole('link', { name: 'See full library' }),
    ).toBeInTheDocument()
  })

  it('labels the section with its own heading', () => {
    render(<RecentlyAdded items={ITEMS} now={NOW} />)

    expect(
      screen.getByRole('region', { name: 'Recently added' }),
    ).toBeInTheDocument()
  })
})
