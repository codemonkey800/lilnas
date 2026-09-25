import type { DiscoveryPage, Media } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { loadMoreDiscoverResults } from 'src/app/search/actions'
import { parseSearchState } from 'src/components/search/search-params'
import { SearchResults } from 'src/components/search/search-results'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => ({ push }),
}))

jest.mock('src/app/search/actions', () => ({
  loadMoreDiscoverResults: jest.fn(),
}))

const mockLoadMore = jest.mocked(loadMoreDiscoverResults)

function movie(n: number): Media {
  return {
    id: `tmdb:${n}`,
    title: `Star ${n}`,
    tmdbId: n,
    type: DownloadType.Movie,
    year: 2000 + n,
  }
}

function page(
  items: Media[],
  nextCursor: string | null,
  total: number,
): DiscoveryPage {
  return {
    degradedSources: [],
    facets: { genres: [] },
    items,
    nextCursor,
    total,
  }
}

/**
 * The ids currently on screen, read off the links rather than off the text: a
 * `Poster` keeps its fallback label in the DOM (hidden behind
 * `group-has-[img]:hidden`) so every card title appears twice.
 */
function shownIds(): string[] {
  return [...document.querySelectorAll('a[href^="/movies/"]')].map(
    a => a.getAttribute('href') ?? '',
  )
}

function renderResults(
  initial: DiscoveryPage,
  search = 'q=star',
): ReturnType<typeof render> {
  return render(
    <SearchResults
      initialPage={initial}
      state={parseSearchState(new URLSearchParams(search))}
    />,
  )
}

describe('SearchResults', () => {
  it('renders the grid by default and the table on request', () => {
    const { unmount } = renderResults(page([movie(1)], null, 1))

    expect(screen.queryByRole('table')).toBeNull()

    unmount()
    renderResults(page([movie(1)], null, 1), 'q=star&view=list')

    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  describe('paging', () => {
    // ⚠️ The cursor decides, never `loaded < total` — `total` is the filtered
    // set as of the moment the page was computed and the two can disagree.
    it('offers no control when there is no next cursor', () => {
      renderResults(page([movie(1)], null, 99))

      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      expect(screen.getByText(/Showing 1 of 99/)).toBeInTheDocument()
    })

    it('appends the next page and updates the count', async () => {
      const user = userEvent.setup()
      mockLoadMore.mockResolvedValue(page([movie(2)], null, 2))
      renderResults(page([movie(1)], 'cursor-2', 2))

      await user.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() =>
        expect(screen.getByText(/Showing 2 of 2/)).toBeInTheDocument(),
      )
      expect(shownIds()).toEqual(['/movies/1', '/movies/2'])
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })

    it('asks the action for the query currently in the URL, plus the cursor', async () => {
      const user = userEvent.setup()
      mockLoadMore.mockResolvedValue(page([movie(2)], null, 2))
      renderResults(page([movie(1)], 'cursor-2', 2), 'q=star&sort=title')

      await user.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() =>
        expect(mockLoadMore).toHaveBeenCalledWith(
          '?q=star&sort=title',
          'cursor-2',
        ),
      )
    })

    it('reports a failed page without losing the rows already on screen', async () => {
      const user = userEvent.setup()
      const error = jest.spyOn(console, 'error').mockImplementation(() => {})
      mockLoadMore.mockRejectedValue(new Error('backend down'))
      renderResults(page([movie(1)], 'cursor-2', 2))

      await user.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Could not load more results',
        ),
      )
      expect(shownIds()).toEqual(['/movies/1'])
      expect(screen.getByRole('button', { name: 'Load more' })).toBeVisible()

      error.mockRestore()
    })
  })

  describe('resetting the merged pages', () => {
    // The page keys this component on `searchStateKey(state)`. A new result
    // set therefore remounts it rather than being reconciled into stale rows —
    // which is the whole reason there is no effect here syncing `initialPage`.
    it('starts fresh when the key changes', async () => {
      const user = userEvent.setup()
      mockLoadMore.mockResolvedValue(page([movie(2)], null, 2))

      const { rerender } = render(
        <SearchResults
          initialPage={page([movie(1)], 'cursor-2', 2)}
          key="q=star"
          state={parseSearchState(new URLSearchParams('q=star'))}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Load more' }))
      await waitFor(() => expect(shownIds()).toHaveLength(2))

      rerender(
        <SearchResults
          initialPage={page([movie(9)], null, 1)}
          key="q=trek"
          state={parseSearchState(new URLSearchParams('q=trek'))}
        />,
      )

      expect(shownIds()).toEqual(['/movies/9'])
    })

    // ...and `view` is deliberately not in that key, so switching how you look
    // at the rows keeps the pages you loaded to get them.
    it('keeps the appended pages across a view switch', async () => {
      const user = userEvent.setup()
      mockLoadMore.mockResolvedValue(page([movie(2)], null, 2))
      const initial = page([movie(1)], 'cursor-2', 2)

      const { rerender } = render(
        <SearchResults
          initialPage={initial}
          key="q=star"
          state={parseSearchState(new URLSearchParams('q=star'))}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Load more' }))
      await waitFor(() => expect(shownIds()).toHaveLength(2))

      rerender(
        <SearchResults
          initialPage={initial}
          key="q=star"
          state={parseSearchState(new URLSearchParams('q=star&view=list'))}
        />,
      )

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByText(/Showing 2 of 2/)).toBeInTheDocument()
    })
  })

  it('sends a table header sort to the URL', async () => {
    const user = userEvent.setup()
    renderResults(page([movie(1)], null, 1), 'q=star&view=list')

    await user.click(screen.getByRole('button', { name: /^title/ }))

    expect(push).toHaveBeenCalledWith('/search?q=star&sort=title&view=list', {
      scroll: false,
    })
  })
})
