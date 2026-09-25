import '@testing-library/jest-dom'

import type { GalleryItem, Movie } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { loadGalleryPage } from 'src/app/actions/load-gallery-page'
import { GalleryResults } from 'src/components/gallery/gallery-results'
import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildMediaFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'

// The pagination action is the component's only outside dependency. Mocked at
// the module boundary rather than through the network, because a `'use server'`
// module in a unit render is just an imported async function.
jest.mock('src/app/actions/load-gallery-page', () => ({
  loadGalleryPage: jest.fn(),
}))

const mockLoadPage = jest.mocked(loadGalleryPage)

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

function item(id: number): GalleryItem {
  return {
    addedAt: '2026-09-15T11:48:00.000Z',
    downloadCount: 1,
    lastDiscordRequester: null,
    lastDownloadedAt: '2026-09-15T11:48:00.000Z',
    lastRequester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
    media: {
      id: `tmdb:${id}`,
      title: `Title ${id}`,
      tmdbId: id,
      type: DownloadType.Movie,
      year: 2024,
    },
  }
}

function renderResults(
  props: Partial<Parameters<typeof GalleryResults>[0]> = {},
) {
  const recorder = createSocketRecorder()
  const result = render(
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      random={NO_JITTER}
    >
      <GalleryResults
        filtered={false}
        initialItems={[item(1), item(2)]}
        initialNextCursor={null}
        initialTotal={2}
        now={NOW}
        search=""
        viewer={null}
        {...props}
      />
    </JobEventsProvider>,
  )

  const send = (frame: string) =>
    act(() => recorder.latest().emitMessage(frame))

  return { ...result, send }
}

describe('GalleryResults empty states', () => {
  it('tells an empty library how to fill itself', () => {
    renderResults({ initialItems: [], initialTotal: 0 })

    expect(screen.getByText('Nothing in the library yet')).toBeInTheDocument()
    expect(screen.getByText(/Paste a link/)).toBeInTheDocument()
  })

  it('tells a filtered miss that the library is not the problem', () => {
    renderResults({ filtered: true, initialItems: [], initialTotal: 0 })

    expect(
      screen.getByText('No titles match these filters'),
    ).toBeInTheDocument()
    expect(screen.getByText(/library is not empty/)).toBeInTheDocument()
  })

  it('keeps the two apart, so filtered-to-nothing never reads as empty', () => {
    const { unmount } = renderResults({ initialItems: [], initialTotal: 0 })
    const library = screen.getByText('Nothing in the library yet')

    expect(
      screen.queryByText('No titles match these filters'),
    ).not.toBeInTheDocument()
    unmount()

    renderResults({ filtered: true, initialItems: [], initialTotal: 0 })

    expect(
      screen.queryByText(library.textContent ?? ''),
    ).not.toBeInTheDocument()
  })

  it('offers nothing to paginate when there is nothing to show', () => {
    renderResults({ initialItems: [], initialTotal: 0 })

    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
  })
})

describe('GalleryResults grid', () => {
  it('renders one card per row', () => {
    renderResults()

    // Twice each: the card's own title, plus the poster's fallback label, which
    // CSS hides the moment the artwork loads.
    expect(screen.getAllByText('Title 1')).toHaveLength(2)
    expect(screen.getAllByText('Title 2')).toHaveLength(2)
  })

  it('reports how much of the match is on screen', () => {
    renderResults({ initialTotal: 29 })

    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 2 of 29')
  })

  it('offers no Load more when the cursor is exhausted', () => {
    renderResults({ initialTotal: 29 })

    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument()
  })

  it('offers Load more while a cursor remains', () => {
    renderResults({ initialNextCursor: 'cursor-1', initialTotal: 29 })

    expect(
      screen.getByRole('button', { name: 'Load more' }),
    ).toBeInTheDocument()
  })
})

describe('GalleryResults pagination', () => {
  it('appends the next page under the current filter', async () => {
    const user = userEvent.setup()
    mockLoadPage.mockResolvedValue({
      items: [item(3)],
      nextCursor: null,
      total: 3,
    })
    renderResults({
      initialNextCursor: 'cursor-1',
      initialTotal: 3,
      search: 'type=movie',
    })

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.getAllByText('Title 3')).not.toHaveLength(0),
    )
    // The filter goes back as the query string the page is at, so the appended
    // page is filtered exactly like the first one.
    expect(mockLoadPage).toHaveBeenCalledWith('type=movie', 'cursor-1')
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 3')
  })

  it('re-reads the total from every page, because the library is live', async () => {
    const user = userEvent.setup()
    mockLoadPage.mockResolvedValue({
      items: [item(3)],
      nextCursor: 'cursor-2',
      total: 30,
    })
    renderResults({ initialNextCursor: 'cursor-1', initialTotal: 29 })

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 3 of 30'),
    )
  })

  it('retires the button once the last page has landed', async () => {
    const user = userEvent.setup()
    mockLoadPage.mockResolvedValue({
      items: [item(3)],
      nextCursor: null,
      total: 3,
    })
    renderResults({ initialNextCursor: 'cursor-1', initialTotal: 3 })

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Load more' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('says so when a page could not be fetched, and keeps the grid', async () => {
    const user = userEvent.setup()
    mockLoadPage.mockResolvedValue({ error: 'Could not load more — try again' })
    renderResults({ initialNextCursor: 'cursor-1', initialTotal: 29 })

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not load more — try again',
      ),
    )
    expect(screen.getAllByText('Title 1')).not.toHaveLength(0)
    expect(
      screen.getByRole('button', { name: 'Load more' }),
    ).toBeInTheDocument()
  })

  it('clears a previous failure once a retry succeeds', async () => {
    const user = userEvent.setup()
    mockLoadPage
      .mockResolvedValueOnce({ error: 'Could not load more — try again' })
      .mockResolvedValueOnce({ items: [item(3)], nextCursor: null, total: 3 })
    renderResults({ initialNextCursor: 'cursor-1', initialTotal: 3 })

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    )
  })

  it('stays on one page per press even when pressed twice', async () => {
    const user = userEvent.setup()
    let release: (value: {
      items: GalleryItem[]
      nextCursor: null
      total: number
    }) => void = () => {}
    mockLoadPage.mockReturnValue(
      new Promise(resolve => {
        release = resolve
      }),
    )
    renderResults({ initialNextCursor: 'cursor-1', initialTotal: 3 })

    const button = screen.getByRole('button', { name: 'Load more' })

    await user.click(button)
    // `LoadMore` marks the button `aria-disabled` rather than `disabled` so a
    // keyboard user keeps their focus; `Button` swallows the second click.
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'))
    await user.click(button)

    expect(mockLoadPage).toHaveBeenCalledTimes(1)

    release({ items: [item(3)], nextCursor: null, total: 3 })
    await waitFor(() =>
      expect(screen.getAllByText('Title 3')).not.toHaveLength(0),
    )
  })
})

/** `item(id)`'s movie as a live frame carries it - with a file or without. */
function liveMovie(id: number, filePath?: string): Movie {
  return {
    id: `tmdb:${id}`,
    title: `Title ${id}`,
    tmdbId: id,
    type: DownloadType.Movie,
    year: 2024,
    ...(filePath ? { filePath } : {}),
  }
}

describe('GalleryResults live library', () => {
  it('drops a card whose file left the library, and the count with it', () => {
    const { send } = renderResults({ initialTotal: 29 })

    // Deleted in Radarr: the same movie, now with no file.
    send(buildMediaFrame(liveMovie(1)))

    expect(screen.queryByText('Title 1')).not.toBeInTheDocument()
    expect(screen.getAllByText('Title 2')).toHaveLength(2)
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 of 28')
  })

  it('keeps a card whose frame still has its file', () => {
    const { send } = renderResults()

    send(buildMediaFrame(liveMovie(1, '/movies/1.mkv')))

    expect(screen.getAllByText('Title 1')).toHaveLength(2)
  })

  it('brings a card back when its file returns', () => {
    const { send } = renderResults()

    send(buildMediaFrame(liveMovie(1)))
    send(buildMediaFrame(liveMovie(1, '/movies/1.mkv')))

    expect(screen.getAllByText('Title 1')).toHaveLength(2)
  })

  it('reads as empty once every card has left the library', () => {
    const { send } = renderResults()

    send(buildMediaFrame(liveMovie(1)))
    send(buildMediaFrame(liveMovie(2)))

    expect(screen.getByText('Nothing in the library yet')).toBeInTheDocument()
  })

  it('does not take a removed card off the total twice after Load more', async () => {
    const user = userEvent.setup()
    // The server's fresh total already leaves the deleted title out.
    mockLoadPage.mockResolvedValue({
      items: [item(3)],
      nextCursor: 'cursor-2',
      total: 28,
    })
    const { send } = renderResults({
      initialNextCursor: 'cursor-1',
      initialTotal: 29,
    })

    send(buildMediaFrame(liveMovie(1)))
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 2 of 28'),
    )
  })
})
