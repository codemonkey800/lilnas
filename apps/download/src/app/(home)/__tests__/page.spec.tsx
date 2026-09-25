import '@testing-library/jest-dom'

import type { DownloadClient } from '@lilnas/utils/download/client'
import type {
  DownloadGalleryFacets,
  DownloadJob,
  DownloadPage,
  GalleryItem,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import HomePage from 'src/app/(home)/page'
import { RECENTLY_ADDED_LIMIT } from 'src/components/home/recently-added'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { PROFILE_HREF } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'
import { getViewer } from 'src/lib/viewer'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

jest.mock('src/lib/viewer', () => ({
  getViewer: jest.fn(),
}))

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)
const mockGetViewer = jest.mocked(getViewer)

const VIEWER: Viewer = {
  email: 'jeremy.asuncion@lilnas.io',
  isAdmin: true,
  userId: 'u_1',
}

const FACETS: DownloadGalleryFacets = {
  types: [
    { count: 318, type: DownloadType.Movie },
    { count: 203, type: DownloadType.Video },
  ],
  uploaders: [{ count: 28, email: VIEWER.email }],
}

const ITEM: GalleryItem = {
  addedAt: '2026-09-15T19:48:00.000Z',
  downloadCount: 1,
  lastDiscordRequester: null,
  lastDownloadedAt: '2026-09-15T19:48:00.000Z',
  lastRequester: { email: VIEWER.email, userId: VIEWER.userId },
  media: {
    id: 'tmdb:438631',
    title: 'Scary Movie',
    tmdbId: 438631,
    type: DownloadType.Movie,
    year: 2026,
  },
}

const GALLERY: DownloadPage<GalleryItem> = {
  items: [ITEM],
  nextCursor: null,
  total: 28,
}

/**
 * The live `GET /download/activity?limit=1` shape while work is in flight:
 * one row in `items` — that is all the caller asked for — and the size of the
 * whole in-flight set in `total`. The tile must read the second number.
 */
const ACTIVITY: DownloadPage<DownloadJob> = {
  items: [{ id: 'job_1' } as unknown as DownloadJob],
  nextCursor: 'cursor',
  total: 7,
}

type Stubs = {
  activity?: DownloadPage<DownloadJob>
  facets?: DownloadGalleryFacets
  gallery?: DownloadPage<GalleryItem>
  viewer?: Viewer | null
}

function stubClient(stubs: Stubs = {}): {
  getActivity: jest.Mock
  getGallery: jest.Mock
  getGalleryFacets: jest.Mock
} {
  const client = {
    getActivity: jest.fn().mockResolvedValue(stubs.activity ?? ACTIVITY),
    getGallery: jest.fn().mockResolvedValue(stubs.gallery ?? GALLERY),
    getGalleryFacets: jest.fn().mockResolvedValue(stubs.facets ?? FACETS),
  }

  mockGetClient.mockResolvedValue(client as unknown as DownloadClient)
  mockGetViewer.mockResolvedValue(
    stubs.viewer === undefined ? VIEWER : stubs.viewer,
  )

  return client
}

describe('HomePage', () => {
  it('asks for exactly the six cards it shows', async () => {
    const client = stubClient()

    render(await HomePage())

    expect(client.getGallery).toHaveBeenCalledWith({
      limit: RECENTLY_ADDED_LIMIT,
    })
    expect(screen.getByRole('link', { name: /Scary Movie/ })).toHaveAttribute(
      'href',
      '/movies/438631',
    )
  })

  it('counts running jobs from the activity total, not the page it fetched', async () => {
    const client = stubClient()

    render(await HomePage())

    // One row fetched, seven in flight. `items.length` would say 1.
    expect(client.getActivity).toHaveBeenCalledWith({ limit: 1 })
    expect(
      screen.getByRole('link', { name: /Downloads activity/ }),
    ).toHaveTextContent('7 running now')
  })

  it('takes the library counts from the facets, absent types included', async () => {
    stubClient()

    render(await HomePage())

    expect(
      screen.getByRole('link', { name: /Browse movies/ }),
    ).toHaveTextContent('318 in the library')
    // `show` is missing from the facets entirely.
    expect(
      screen.getByRole('link', { name: /Browse shows/ }),
    ).toHaveTextContent('0 in the library')
  })

  it('reads sensibly with nothing downloaded and nothing running', async () => {
    stubClient({
      activity: { items: [], nextCursor: null, total: 0 },
      facets: { types: [], uploaders: [] },
      gallery: { items: [], nextCursor: null, total: 0 },
    })

    render(await HomePage())

    expect(
      screen.getByRole('link', { name: /Downloads activity/ }),
    ).toHaveTextContent('Nothing running')
    expect(screen.getByText(/Nothing in the library yet/)).toBeInTheDocument()
  })

  it('hands the viewer down so their own attribution links to their profile', async () => {
    const { container } = render((stubClient(), await HomePage()))

    expect(container.querySelector(`a[href="${PROFILE_HREF}"]`)).not.toBeNull()
  })

  it('still renders when there is no viewer, with nothing linked to a profile', async () => {
    stubClient({ viewer: null })

    const { container } = render(await HomePage())

    expect(
      screen.getByRole('link', { name: /Scary Movie/ }),
    ).toBeInTheDocument()
    expect(container.querySelector(`a[href="${PROFILE_HREF}"]`)).toBeNull()
  })

  it('mounts no search field of its own — the nav bar owns that', async () => {
    stubClient()

    const { container } = render(await HomePage())

    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
  })
})
