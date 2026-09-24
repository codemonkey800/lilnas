import '@testing-library/jest-dom'

import type { GalleryItem, Movie } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { act, render as baseRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { GALLERY_HREF } from 'src/components/home/quick-access'
import {
  RECENTLY_ADDED_LIMIT,
  RecentlyAdded,
} from 'src/components/home/recently-added'
import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildMediaFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'

/** Renders under the live feed the cards read, as the homepage does. */
function render(ui: ReactElement) {
  const recorder = createSocketRecorder()
  return baseRender(
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      random={NO_JITTER}
    >
      {ui}
    </JobEventsProvider>,
  )
}

const NOW = Date.parse('2026-09-15T20:00:00.000Z')

function video(index: number): GalleryItem {
  return {
    addedAt: '2026-09-15T19:48:00.000Z',
    downloadCount: 1,
    lastDiscordRequester: null,
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
    render(<RecentlyAdded items={ITEMS} now={NOW} viewer={null} />)

    expect(screen.getAllByRole('link', { name: /Clip/ })).toHaveLength(
      RECENTLY_ADDED_LIMIT,
    )
  })

  it('keeps the way through to the full library', () => {
    render(<RecentlyAdded items={ITEMS} now={NOW} viewer={null} />)

    expect(
      screen.getByRole('link', { name: 'See full library' }),
    ).toHaveAttribute('href', GALLERY_HREF)
  })

  it('says so when the library is empty, instead of drawing an empty grid', () => {
    render(<RecentlyAdded items={[]} now={NOW} viewer={null} />)

    expect(screen.queryByRole('link', { name: /Clip/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Nothing in the library yet/)).toBeInTheDocument()
    // Still reachable: an empty homepage is exactly when somebody wants the
    // gallery's own filters.
    expect(
      screen.getByRole('link', { name: 'See full library' }),
    ).toBeInTheDocument()
  })

  it('labels the section with its own heading', () => {
    render(<RecentlyAdded items={ITEMS} now={NOW} viewer={null} />)

    expect(
      screen.getByRole('region', { name: 'Recently added' }),
    ).toBeInTheDocument()
  })
})

describe('RecentlyAdded live library', () => {
  it('drops a card whose file left the library', () => {
    const recorder = createSocketRecorder()
    const media: Movie = {
      filePath: '/movies/1.mkv',
      id: 'tmdb:1',
      title: 'End of Watch',
      tmdbId: 1,
      type: DownloadType.Movie,
    }
    const movie: GalleryItem = { ...video(0), media }
    baseRender(
      <JobEventsProvider
        createSocket={recorder.createSocket}
        getLocation={() => TEST_LOCATION}
        random={NO_JITTER}
      >
        <RecentlyAdded items={[movie, video(1)]} now={NOW} viewer={null} />
      </JobEventsProvider>,
    )

    act(() =>
      recorder
        .latest()
        .emitMessage(buildMediaFrame({ ...media, filePath: undefined })),
    )

    expect(screen.queryByText('End of Watch')).not.toBeInTheDocument()
    expect(screen.getAllByText('Clip 1')).not.toHaveLength(0)
  })
})
