import { DownloadType } from '@lilnas/utils/download/types'

import { loadGalleryPage } from 'src/app/actions/load-gallery-page'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)

const PAGE = { items: [], nextCursor: 'next', total: 29 }

function stubClient(getGallery = jest.fn().mockResolvedValue(PAGE)) {
  mockGetClient.mockResolvedValue({ getGallery } as unknown as Awaited<
    ReturnType<typeof getIdentifiedDownloadClient>
  >)

  return getGallery
}

describe('loadGalleryPage', () => {
  it('appends the page the cursor names', async () => {
    const getGallery = stubClient()

    await expect(loadGalleryPage('', 'cursor-1')).resolves.toEqual(PAGE)
    expect(getGallery).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'cursor-1' }),
    )
  })

  it('re-parses the filters server-side rather than trusting the caller', async () => {
    const getGallery = stubClient()

    // A server action is a real public endpoint. Anything unrecognized in the
    // query string is dropped here exactly as the page drops it, so a crafted
    // call can only describe a filter the URL could have described anyway.
    await loadGalleryPage('type=movie,sculpture&junk=1', 'cursor-1')

    expect(getGallery).toHaveBeenCalledWith({
      type: [DownloadType.Movie],
      requester: undefined,
      from: undefined,
      to: undefined,
      cursor: 'cursor-1',
    })
  })

  it('carries the date window through to the appended page', async () => {
    const getGallery = stubClient()

    await loadGalleryPage('from=2026-01-01&to=2026-03-31', 'cursor-1')

    expect(getGallery).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-03-31T00:00:00.000Z'),
      }),
    )
  })

  it('answers with a message rather than throwing at the grid', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    stubClient(jest.fn().mockRejectedValue(new Error('backend is down')))

    await expect(loadGalleryPage('', 'cursor-1')).resolves.toEqual({
      error: 'Could not load more — try again',
    })
  })
})
