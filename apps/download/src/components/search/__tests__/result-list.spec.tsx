import type { Media } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'

import { ResultList } from 'src/components/search/result-list'
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

function renderList(items: Media[] = [MOVIE, SHOW]) {
  return render(<ResultList items={items} />)
}

/** The row for a title: the one link its heading sits in. */
function row(title: string): HTMLElement {
  return screen.getByText(title, { selector: 'p' }).closest('a') as HTMLElement
}

describe('ResultList', () => {
  it('links every row to its detail page, downloaded or not', () => {
    renderList()

    expect(row('Star Wars')).toHaveAttribute('href', '/movies/11')
    expect(row('Star')).toHaveAttribute('href', '/shows/311810')
  })

  it('is one link per result, with nothing nested inside it', () => {
    renderList()

    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('names the title, then the kind and runtime under it', () => {
    renderList()

    const movie = row('Star Wars')

    expect(within(movie).getByText('Star Wars')).toHaveClass('truncate')
    expect(within(movie).getByText('movie · 2h 01m')).toBeInTheDocument()
  })

  it('leaves the runtime off the kind line when it is unknown', () => {
    renderList()

    expect(within(row('Star')).queryByText(/·/)).toBeNull()
  })

  it('type-tags each row with a badge', () => {
    renderList()

    // The kind line reads `movie · 2h 01m`, so the bare word is the badge.
    expect(within(row('Star Wars')).getAllByText('movie')).toHaveLength(1)
    // With no runtime the kind line is the bare word too: line and badge.
    expect(within(row('Star')).getAllByText('show')).toHaveLength(2)
  })

  it('shows the year, and a dash when there is none', () => {
    renderList([MOVIE, { ...SHOW, year: undefined }])

    expect(within(row('Star Wars')).getByText('1977')).toBeInTheDocument()
    // The year and the genre are both unknown on this row.
    expect(within(row('Star')).getAllByText(UNKNOWN_VALUE)).toHaveLength(2)
  })

  it('joins a genre list, and renders an absent one as an em dash', () => {
    renderList()

    expect(screen.getByText('Adventure, Action')).toBeInTheDocument()
    expect(
      within(row('Star')).getAllByText(UNKNOWN_VALUE).length,
    ).toBeGreaterThan(0)
  })

  it('preserves the order the API returned, interleaved', () => {
    renderList()

    expect(
      screen
        .getAllByRole('link')
        .map(link => link.querySelector('p')?.textContent),
    ).toEqual(['Star Wars', 'Star'])
  })

  // Ordering is the toolbar's Sort menu, which writes the API's own `sort`
  // enum: reordering the rows already fetched would disagree with the next
  // cursor page the moment it arrived. So the list has no sortable headers.
  it('has no sort controls of its own', () => {
    renderList()

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('columnheader')).toBeNull()
  })
})
