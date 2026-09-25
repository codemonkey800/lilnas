import { DownloadApiError } from '@lilnas/utils/download/client'
import type {
  DownloadGalleryFacets,
  GalleryItem,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { isInvertedRangeError, loadGalleryView } from 'src/lib/gallery-data'
import {
  EMPTY_GALLERY_FILTERS,
  INVALID_RANGE_MESSAGE,
} from 'src/lib/gallery-filters'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)

const FACETS: DownloadGalleryFacets = {
  types: [
    { count: 1, type: DownloadType.Movie },
    { count: 40, type: DownloadType.Video },
  ],
  uploaders: [{ count: 28, email: 'jeremy@lilnas.io' }],
}

const ITEM: GalleryItem = {
  addedAt: '2026-09-01T00:00:00.000Z',
  downloadCount: 1,
  lastDiscordRequester: null,
  lastDownloadedAt: '2026-09-01T00:00:00.000Z',
  lastRequester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  media: {
    id: 'tmdb:11660',
    title: 'Following',
    tmdbId: 11660,
    type: DownloadType.Movie,
  },
}

type Stub = {
  getGallery: jest.Mock
  getGalleryFacets: jest.Mock
}

/**
 * Only the two methods the gallery calls. `DownloadClient` is a class with two
 * dozen methods and none of the others can be reached from this module, so a
 * cast is honest here in a way a hand-written full double would not be.
 */
function stubClient(overrides: Partial<Stub> = {}): Stub {
  const stub: Stub = {
    getGallery: jest
      .fn()
      .mockResolvedValue({ items: [ITEM], nextCursor: null, total: 1 }),
    getGalleryFacets: jest.fn().mockResolvedValue(FACETS),
    ...overrides,
  }

  mockGetClient.mockResolvedValue(
    stub as unknown as Awaited<ReturnType<typeof getIdentifiedDownloadClient>>,
  )

  return stub
}

function rangeRejection(): DownloadApiError {
  return new DownloadApiError(400, 'Bad Request', {
    statusCode: 400,
    message: 'Validation failed',
    errors: [
      {
        code: 'custom',
        path: ['from'],
        message: '`from` must not be after `to`',
      },
    ],
  })
}

describe('isInvertedRangeError', () => {
  it('recognizes the API rejecting the range', () => {
    expect(isInvertedRangeError(rangeRejection())).toBe(true)
  })

  it('ignores a 400 about something other than the dates', () => {
    const error = new DownloadApiError(400, 'Bad Request', {
      errors: [{ code: 'custom', path: ['cursor'], message: 'bad cursor' }],
    })

    expect(isInvertedRangeError(error)).toBe(false)
  })

  it('ignores a 400 with no validation detail at all', () => {
    expect(
      isInvertedRangeError(new DownloadApiError(400, 'Bad Request', undefined)),
    ).toBe(false)
  })

  it('ignores a 500', () => {
    expect(
      isInvertedRangeError(
        new DownloadApiError(500, 'Server Error', {
          errors: [{ path: ['from'] }],
        }),
      ),
    ).toBe(false)
  })

  it('ignores anything that is not a DownloadApiError', () => {
    expect(isInvertedRangeError(new Error('offline'))).toBe(false)
    expect(isInvertedRangeError(null)).toBe(false)
  })
})

describe('loadGalleryView', () => {
  it('returns the first page and the facets', async () => {
    stubClient()

    const view = await loadGalleryView(EMPTY_GALLERY_FILTERS)

    expect(view.items).toEqual([ITEM])
    expect(view.total).toBe(1)
    expect(view.facets).toEqual(FACETS)
    expect(view.rangeError).toBeNull()
  })

  it('computes facets over the date range only, never the other facets', async () => {
    const client = stubClient()

    await loadGalleryView({
      types: [DownloadType.Movie],
      requester: 'someone@else.io',
      from: '2026-01-01',
      to: '2026-03-31',
    })

    expect(client.getGalleryFacets).toHaveBeenCalledWith({
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-03-31T00:00:00.000Z'),
    })
  })

  it('pins one instant for every relative stamp on the page', async () => {
    stubClient()

    const before = Date.now()
    const view = await loadGalleryView(EMPTY_GALLERY_FILTERS)

    expect(view.now).toBeGreaterThanOrEqual(before)
    expect(view.now).toBeLessThanOrEqual(Date.now())
  })

  it('reports an inverted range as a validation message, not as no results', async () => {
    stubClient({ getGallery: jest.fn().mockRejectedValue(rangeRejection()) })

    const view = await loadGalleryView({
      ...EMPTY_GALLERY_FILTERS,
      from: '2026-05-01',
      to: '2026-01-01',
    })

    expect(view.rangeError).toBe(INVALID_RANGE_MESSAGE)
    // `null`, not `[]` — an empty array downstream is the "no matches" empty
    // state, which is precisely the thing an inverted range is not.
    expect(view.items).toBeNull()
    expect(view.total).toBeNull()
  })

  it('refetches the facet vocabulary unwindowed when the range is rejected', async () => {
    const client = stubClient({
      getGallery: jest.fn().mockRejectedValue(rangeRejection()),
      getGalleryFacets: jest
        .fn()
        .mockRejectedValueOnce(rangeRejection())
        .mockResolvedValue(FACETS),
    })

    const view = await loadGalleryView({
      ...EMPTY_GALLERY_FILTERS,
      from: '2026-05-01',
      to: '2026-01-01',
    })

    expect(view.facets).toEqual(FACETS)
    expect(client.getGalleryFacets).toHaveBeenLastCalledWith()
  })

  it('lets any other failure reach the error boundary', async () => {
    stubClient({
      getGallery: jest.fn().mockRejectedValue(new Error('backend is down')),
    })

    await expect(loadGalleryView(EMPTY_GALLERY_FILTERS)).rejects.toThrow(
      'backend is down',
    )
  })
})
