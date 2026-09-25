import { DownloadApiError } from '@lilnas/utils/download/client'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import { loadProfileHistory } from 'src/app/actions/load-profile-history'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { FOREIGN_PROFILE_ERROR } from 'src/lib/profile-data'
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
  email: 'jeremy@lilnas.io',
  isAdmin: false,
  userId: 'u_1',
}

const PAGE = { items: [], nextCursor: 'cursor-2', total: 40 }

function stubClient(getHistory = jest.fn().mockResolvedValue(PAGE)) {
  mockGetClient.mockResolvedValue({ getHistory } as unknown as never)

  return getHistory
}

beforeEach(() => {
  mockGetViewer.mockResolvedValue(VIEWER)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('loadProfileHistory', () => {
  it('appends a page with the same filter the URL describes', async () => {
    const getHistory = stubClient()

    const result = await loadProfileHistory(
      'type=movie&status=failed',
      'cursor-1',
    )

    expect(getHistory).toHaveBeenCalledWith({
      cursor: 'cursor-1',
      requester: 'jeremy@lilnas.io',
      status: [DownloadJobStatus.Failed],
      type: [DownloadType.Movie],
    })
    expect(result).toEqual(PAGE)
  })

  // A server action is a real public endpoint. Re-parsing means a crafted call
  // can only describe a filter the address bar could have described anyway.
  it('re-parses the query string rather than trusting it', async () => {
    const getHistory = stubClient()

    await loadProfileHistory('type=podcast&status=queued&limit=9999', 'c')

    expect(getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined, type: undefined }),
    )
    expect(getHistory.mock.calls[0]?.[0]).not.toHaveProperty('limit')
  })

  // The one thing that would turn this action into "read anyone's history":
  // the target is re-derived server-side and never taken as an argument.
  it('scopes to the viewer’s own email when the URL names nobody', async () => {
    const getHistory = stubClient()

    await loadProfileHistory('', 'cursor-1')

    expect(getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requester: 'jeremy@lilnas.io' }),
    )
  })

  it('scopes to the URL’s subject when it names one', async () => {
    const getHistory = stubClient()

    await loadProfileHistory('user=sam%40lilnas.io', 'cursor-1')

    expect(getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requester: 'sam@lilnas.io' }),
    )
  })

  it('refuses to fetch anything with no identity and no subject', async () => {
    mockGetViewer.mockResolvedValue(null)
    const getHistory = stubClient()

    const result = await loadProfileHistory('', 'cursor-1')

    expect(getHistory).not.toHaveBeenCalled()
    expect(result).toEqual({ error: expect.stringContaining('sign in') })
  })

  it('reports the backend’s refusal in its own words', async () => {
    stubClient(
      jest.fn().mockRejectedValue(new DownloadApiError(403, 'Forbidden', {})),
    )

    expect(await loadProfileHistory('user=sam%40lilnas.io', 'c')).toEqual({
      error: FOREIGN_PROFILE_ERROR,
    })
  })

  it('reports any other failure in place rather than throwing at the boundary', async () => {
    stubClient(jest.fn().mockRejectedValue(new Error('offline')))

    const result = await loadProfileHistory('', 'cursor-1')

    expect(result).toEqual({ error: expect.stringContaining('try again') })
    expect(console.error).toHaveBeenCalled()
  })
})
