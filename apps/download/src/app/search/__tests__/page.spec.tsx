import type { DiscoveryPage, Media } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import SearchPage from 'src/app/search/page'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// The page resolves its client through `headers()`, which is unavailable
// outside a request. What the test needs from it is the one call it makes.
jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

const getDiscover = jest.fn<Promise<DiscoveryPage>, [unknown]>()

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)

const MOVIE: Media = {
  genres: ['Adventure'],
  id: 'tmdb:11',
  runtime: 7260,
  title: 'Star Wars',
  tmdbId: 11,
  type: DownloadType.Movie,
  year: 1977,
}

function page(overrides: Partial<DiscoveryPage> = {}): DiscoveryPage {
  return {
    degradedSources: [],
    facets: { genres: [{ count: 1, genre: 'Adventure' }] },
    items: [MOVIE],
    nextCursor: null,
    total: 1,
    ...overrides,
  }
}

async function renderPage(
  searchParams: Record<string, string | string[] | undefined>,
) {
  return render(
    await SearchPage({ searchParams: Promise.resolve(searchParams) }),
  )
}

describe('SearchPage', () => {
  beforeEach(() => {
    getDiscover.mockResolvedValue(page())
    mockGetClient.mockResolvedValue({
      getDiscover,
    } as unknown as Awaited<ReturnType<typeof getIdentifiedDownloadClient>>)
  })

  describe('the two-character floor', () => {
    // ⚠️ `DiscoverQuerySchema` requires `query: z.string().min(2)` and answers
    // `400 too_small` below it. The page does not ask.
    it.each([
      ['nothing typed', {}],
      ['an empty query', { q: '' }],
      ['one character', { q: 's' }],
      ['one character and whitespace', { q: ' s ' }],
    ])('makes no call for %s', async (_label, params) => {
      await renderPage(params)

      expect(getDiscover).not.toHaveBeenCalled()
    })

    it('says nothing at all when nothing has been typed', async () => {
      const { container } = await renderPage({})

      expect(container).toBeEmptyDOMElement()
    })

    it('explains the floor once the field looks like it should be working', async () => {
      await renderPage({ q: 's' })

      expect(screen.getByRole('status')).toHaveTextContent(
        /at least two characters/,
      )
    })

    it('calls at exactly two characters', async () => {
      await renderPage({ q: 'st' })

      expect(getDiscover).toHaveBeenCalledTimes(1)
    })
  })

  describe('the request it makes', () => {
    // ⚠️ The page's parameter is `q`; the API's is `query`. `?q=` on the API
    // answers `400 invalid_type`.
    it('sends the query under the API’s own name', async () => {
      await renderPage({ q: 'star' })

      expect(getDiscover).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'star', sort: 'relevance' }),
      )
      expect(getDiscover.mock.calls[0]?.[0]).not.toHaveProperty('q')
    })

    it('carries the filters and the sort through', async () => {
      await renderPage({
        genre: ['Comedy', 'Drama'],
        q: 'star',
        sort: 'title',
        yearFrom: '1999',
        yearTo: '2012',
      })

      expect(getDiscover).toHaveBeenCalledWith(
        expect.objectContaining({
          genre: ['Comedy', 'Drama'],
          query: 'star',
          sort: 'title',
          yearFrom: 1999,
          yearTo: 2012,
        }),
      )
    })

    // The API refines `yearFrom <= yearTo` and 400s. Only reachable by hand,
    // since the filter panel disables its own confirm on an inverted range.
    it('refuses an inverted year range before spending the request', async () => {
      await renderPage({ q: 'star', yearFrom: '2012', yearTo: '1999' })

      expect(getDiscover).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toHaveTextContent(
        'Start year must be before end year',
      )
    })

    // The boundary in `error.tsx` is what renders this; the page's job is to
    // let it through rather than swallow it into a "no matches" that is a lie.
    it('lets a failed search reach the error boundary', async () => {
      getDiscover.mockRejectedValue(new Error('Sonarr is down'))

      await expect(renderPage({ q: 'star' })).rejects.toThrow('Sonarr is down')
    })
  })

  describe('degraded sources', () => {
    // ⚠️ An empty array is the explicit all-good signal, not an absence.
    it('says nothing when both upstreams answered', async () => {
      await renderPage({ q: 'star' })

      expect(screen.queryByRole('status')).toBeNull()
    })

    it('renders the note when one upstream failed', async () => {
      getDiscover.mockResolvedValue(page({ degradedSources: ['shows'] }))

      await renderPage({ q: 'star' })

      expect(screen.getByRole('status')).toHaveTextContent(
        'Showing movies only.',
      )
    })

    // The note qualifies the count, so it has to be read before it.
    it('puts the note above the count', async () => {
      getDiscover.mockResolvedValue(page({ degradedSources: ['shows'] }))

      await renderPage({ q: 'star' })

      const note = screen.getByRole('status')
      const count = screen.getByText(/1 result/)

      expect(
        note.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    // Degradation and emptiness are different facts and can be true at once.
    it('renders alongside the no-matches state', async () => {
      getDiscover.mockResolvedValue(
        page({ degradedSources: ['movies'], items: [], total: 0 }),
      )

      await renderPage({ q: 'star' })

      const notes = screen.getAllByRole('status')

      expect(notes[0]).toHaveTextContent('Showing shows only.')
      expect(notes[1]).toHaveTextContent('No matches for “star.”')
    })
  })

  describe('no matches', () => {
    beforeEach(() => {
      getDiscover.mockResolvedValue(page({ items: [], total: 0 }))
    })

    it('is a plain state rather than an error', async () => {
      await renderPage({ q: 'xyzzyqqq' })

      const note = screen.getByRole('status')

      expect(note).toHaveTextContent('No matches for “xyzzyqqq.”')
      // `role="alert"` would announce this as something going wrong. The
      // search worked; the answer was zero.
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('still reports the count, and drops the view switch', async () => {
      await renderPage({ q: 'xyzzyqqq' })

      expect(screen.getByText(/0 results/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Grid view' })).toBeNull()
    })
  })

  describe('results', () => {
    it('renders the grid by default', async () => {
      await renderPage({ q: 'star' })

      expect(screen.getByRole('link', { name: /Star Wars/ })).toHaveAttribute(
        'href',
        '/movies/11',
      )
    })

    it('renders the table when the URL asks for the list view', async () => {
      await renderPage({ q: 'star', view: 'list' })

      expect(screen.getByRole('table')).toBeInTheDocument()
    })

    it('keeps the filter controls available', async () => {
      await renderPage({ q: 'star' })

      expect(screen.getByRole('button', { name: /^Filters/ })).toBeVisible()
      expect(screen.getByRole('button', { name: /^Sort by/ })).toBeVisible()
    })
  })
})
