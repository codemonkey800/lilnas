import type { Media } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ResultTable } from 'src/components/search/result-table'
import type { SearchSort } from 'src/components/search/search-params'
import { UNKNOWN_VALUE } from 'src/lib/format'

const MOVIE: Media = {
  genres: ['Adventure', 'Action'],
  id: 'tmdb:11',
  // 2h 01m.
  runtime: 7260,
  title: 'Star Wars',
  tmdbId: 11,
  type: DownloadType.Movie,
  year: 1977,
}

const SHOW: Media = {
  id: 'tvdb:311810',
  title: 'Star',
  tvdbId: 311810,
  type: DownloadType.Show,
  year: 2016,
}

function renderTable(sort: SearchSort = 'relevance') {
  const onSortChange = jest.fn<void, [SearchSort]>()

  render(
    <ResultTable
      items={[MOVIE, SHOW]}
      onSortChange={onSortChange}
      sort={sort}
    />,
  )

  return { onSortChange }
}

function header(name: string): HTMLElement {
  return screen
    .getAllByRole('columnheader')
    .find(cell => cell.textContent?.trim().startsWith(name)) as HTMLElement
}

describe('ResultTable sort headers', () => {
  // ⚠️ The headers map onto `DiscoverQuerySchema`'s `sort` enum, not onto a
  // client-side sort. The result set is cursor-paginated: reordering the rows
  // already fetched would disagree with the next page the moment it arrived.
  it.each<[string, SearchSort]>([
    ['title', 'title'],
    ['year', 'releaseDate'],
  ])('maps the %p header to the %p enum value', async (label, expected) => {
    const user = userEvent.setup()
    const { onSortChange } = renderTable()

    await user.click(
      screen.getByRole('button', { name: new RegExp(`^${label}`) }),
    )

    expect(onSortChange).toHaveBeenCalledWith(expected)
  })

  // The other three columns have no ordering in the enum, so they get no
  // control at all rather than one that could only lie.
  it.each(['type', 'genre', 'runtime'])(
    'gives the %p column no sort control',
    label => {
      renderTable()

      expect(within(header(label)).queryByRole('button')).toBeNull()
    },
  )

  it('reports no column as sorted while the ordering is relevance', () => {
    renderTable('relevance')

    expect(header('title')).toHaveAttribute('aria-sort', 'none')
    expect(header('year')).toHaveAttribute('aria-sort', 'none')
  })

  // Directions are the API's own, read off `sortDiscoveryResults()`:
  // `title` is localeCompare ascending, `releaseDate` is newest-first.
  it('reports the title column ascending when sorted by title', () => {
    renderTable('title')

    expect(header('title')).toHaveAttribute('aria-sort', 'ascending')
    expect(header('year')).toHaveAttribute('aria-sort', 'none')
  })

  it('reports the year column descending when sorted by release date', () => {
    renderTable('releaseDate')

    expect(header('year')).toHaveAttribute('aria-sort', 'descending')
    expect(header('title')).toHaveAttribute('aria-sort', 'none')
  })

  it('flips the chevron only for an ascending column', () => {
    const { unmount } = render(
      <ResultTable items={[MOVIE]} onSortChange={jest.fn()} sort="title" />,
    )

    const ascending = within(header('title')).getByRole('button')

    expect(ascending.querySelector('svg')?.getAttribute('class')).toContain(
      'rotate-180',
    )

    unmount()
    render(
      <ResultTable
        items={[MOVIE]}
        onSortChange={jest.fn()}
        sort="releaseDate"
      />,
    )

    const descending = within(header('year')).getByRole('button')

    expect(
      descending.querySelector('svg')?.getAttribute('class'),
    ).not.toContain('rotate-180')
  })
})

describe('ResultTable rows', () => {
  it('links every row to its detail page, downloaded or not', () => {
    renderTable()

    expect(screen.getByRole('link', { name: 'Star Wars' })).toHaveAttribute(
      'href',
      '/movies/11',
    )
    expect(screen.getByRole('link', { name: 'Star' })).toHaveAttribute(
      'href',
      '/shows/311810',
    )
  })

  it('type-tags each row', () => {
    renderTable()

    expect(screen.getByText('movie')).toBeInTheDocument()
    expect(screen.getByText('show')).toBeInTheDocument()
  })

  it('renders runtime in the hours format, from seconds', () => {
    renderTable()

    expect(screen.getByText('2h 01m')).toBeInTheDocument()
  })

  // `search.pug` dims an empty cell to `ink-4` — the licensed use of a colour
  // that is below AA for body text.
  it('dims an unknown runtime to an em dash', () => {
    renderTable()

    // The show carries no runtime. Scoped to the last cell of its row: the
    // genre cell in the same row is also an em dash, and only the runtime one
    // is dimmed.
    const showRow = screen.getByRole('link', { name: 'Star' }).closest('tr')
    const runtime = showRow?.querySelector('td:last-child')

    expect(runtime).toHaveTextContent(UNKNOWN_VALUE)
    expect(runtime?.getAttribute('class')).toContain('text-ink-4')
  })

  it('joins a genre list, and renders an absent one as an em dash', () => {
    renderTable()

    expect(screen.getByText('Adventure, Action')).toBeInTheDocument()
    expect(screen.getAllByText(UNKNOWN_VALUE, { selector: 'td' })).toHaveLength(
      2,
    )
  })

  it('preserves the order the API returned, interleaved', () => {
    renderTable()

    const titles = screen
      .getAllByRole('row')
      .slice(1)
      .map(row => row.querySelector('a')?.textContent)

    expect(titles).toEqual(['Star Wars', 'Star'])
  })
})
