import '@testing-library/jest-dom'

import type {
  DownloadGalleryFacets,
  GalleryItem,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import { useRouter } from 'next/navigation'

import GalleryPage from 'src/app/gallery/page'
import type { GalleryView } from 'src/lib/gallery-data'
import { loadGalleryView } from 'src/lib/gallery-data'
import {
  type GallerySearchParams,
  INVALID_RANGE_MESSAGE,
} from 'src/lib/gallery-filters'

// The page's own data loading is covered in src/lib/__tests__/gallery-data.spec
// against a stubbed client; what this file is about is the rendering decision
// the page makes with whatever that returns.
jest.mock('src/lib/gallery-data', () => ({
  loadGalleryView: jest.fn(),
}))

// `GalleryResults` imports the pagination action, whose module graph reaches
// `next/headers` — unavailable outside a request scope.
jest.mock('src/app/actions/load-gallery-page', () => ({
  loadGalleryPage: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

const mockLoadView = jest.mocked(loadGalleryView)

const FACETS: DownloadGalleryFacets = {
  types: [{ count: 2, type: DownloadType.Movie }],
  uploaders: [{ count: 2, email: 'jeremy@lilnas.io' }],
}

const ITEM: GalleryItem = {
  addedAt: '2026-09-15T11:48:00.000Z',
  downloadCount: 1,
  lastDiscordRequester: null,
  lastDownloadedAt: '2026-09-15T11:48:00.000Z',
  lastRequester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  media: {
    id: 'tmdb:11660',
    title: 'Following',
    tmdbId: 11660,
    type: DownloadType.Movie,
    year: 1999,
  },
}

function view(overrides: Partial<GalleryView> = {}): GalleryView {
  return {
    facets: FACETS,
    items: [ITEM],
    nextCursor: null,
    now: Date.parse('2026-09-15T12:00:00.000Z'),
    rangeError: null,
    total: 1,
    ...overrides,
  }
}

async function renderPage(searchParams: GallerySearchParams = {}) {
  return render(
    await GalleryPage({ searchParams: Promise.resolve(searchParams) }),
  )
}

beforeEach(() => {
  jest.mocked(useRouter).mockReturnValue({
    push: jest.fn(),
  } as unknown as ReturnType<typeof useRouter>)
  mockLoadView.mockResolvedValue(view())
})

describe('GalleryPage', () => {
  it('reads the filters out of the URL rather than from client state', async () => {
    await renderPage({
      type: 'movie,show',
      requester: 'a@b.c',
      from: '2026-01-01',
    })

    expect(mockLoadView).toHaveBeenCalledWith({
      types: [DownloadType.Movie, DownloadType.Show],
      requester: 'a@b.c',
      from: '2026-01-01',
      to: null,
    })
  })

  it('renders the grid and the controls together', async () => {
    await renderPage()

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByText('Following')).not.toHaveLength(0)
  })

  it('carries a heading for a page whose design has no visible title', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Library' }),
    ).toHaveClass('sr-only')
  })

  it('shows the empty-library state for an unfiltered, empty gallery', async () => {
    mockLoadView.mockResolvedValue(view({ items: [], total: 0 }))

    await renderPage()

    expect(screen.getByText('Nothing in the library yet')).toBeInTheDocument()
  })

  it('shows the no-matches state for a filtered, empty gallery', async () => {
    mockLoadView.mockResolvedValue(view({ items: [], total: 0 }))

    await renderPage({ type: 'movie' })

    expect(
      screen.getByText('No titles match these filters'),
    ).toBeInTheDocument()
  })

  it('reports an inverted range as a validation problem, never as no results', async () => {
    mockLoadView.mockResolvedValue(
      view({ items: null, rangeError: INVALID_RANGE_MESSAGE, total: null }),
    )

    await renderPage({ from: '2026-05-01', to: '2026-01-01' })

    expect(
      screen.getByText(new RegExp(INVALID_RANGE_MESSAGE)),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No titles match these filters'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Nothing in the library yet'),
    ).not.toBeInTheDocument()
  })

  it('keeps the range chip so the filter that caused it can be removed', async () => {
    mockLoadView.mockResolvedValue(
      view({ items: null, rangeError: INVALID_RANGE_MESSAGE, total: null }),
    )

    await renderPage({ from: '2026-05-01', to: '2026-01-01' })

    expect(
      screen.getByRole('button', { name: 'Remove date added filter' }),
    ).toBeInTheDocument()
  })
})
