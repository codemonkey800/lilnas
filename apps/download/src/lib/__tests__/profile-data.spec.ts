import { DownloadApiError } from '@lilnas/utils/download/client'
import type { ProfileResponse } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { isForbiddenProfileError, loadProfileView } from 'src/lib/profile-data'
import { EMPTY_PROFILE_FILTERS } from 'src/lib/profile-filters'
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
const ADMIN: Viewer = { ...VIEWER, isAdmin: true }

const PROFILE: ProfileResponse = {
  firstDownloadAt: '2025-06-14T10:00:00.000Z',
  jobsPerDay: [{ count: 2, day: '2026-09-11', type: DownloadType.Video }],
  lastDownloadAt: '2026-09-11T11:58:00.000Z',
  totalsByStatus: [{ count: 4, status: DownloadJobStatus.Completed }],
  totalsByType: [{ count: 4, type: DownloadType.Video }],
  user: { email: 'jeremy@lilnas.io' },
  windowDays: 30,
}

type Stub = {
  getHistory: jest.Mock
  getProfile: jest.Mock
}

/**
 * Only the two methods this module calls. `DownloadClient` is a class with two
 * dozen methods and none of the others can be reached from here, so a cast is
 * honest in a way a hand-written full double would not be.
 */
function stubClient(overrides: Partial<Stub> = {}): Stub {
  const stub: Stub = {
    getHistory: jest
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null, total: 0 }),
    getProfile: jest.fn().mockResolvedValue(PROFILE),
    ...overrides,
  }

  mockGetClient.mockResolvedValue(stub as unknown as never)

  return stub
}

function forbidden(): DownloadApiError {
  return new DownloadApiError(403, 'Forbidden', {
    message: 'Only an admin may view another user’s profile',
    statusCode: 403,
  })
}

beforeEach(() => {
  mockGetViewer.mockResolvedValue(VIEWER)
})

describe('isForbiddenProfileError', () => {
  it('recognizes the backend refusing somebody else’s profile', () => {
    expect(isForbiddenProfileError(forbidden())).toBe(true)
  })

  // 401 is "who are you", which is a genuine failure and belongs to the error
  // boundary, not to the quiet not-authorized panel.
  it('does not treat a 401 as a rule being stated', () => {
    expect(
      isForbiddenProfileError(new DownloadApiError(401, 'Unauthorized', {})),
    ).toBe(false)
  })

  it('lets Next’s control-flow throws straight through', () => {
    // `redirect()`/`notFound()`/the prerender bailout all carry a `digest` and
    // are not `DownloadApiError`s. Absorbing one would turn "render this route
    // dynamically" into a permanent 403 panel.
    const bailout = Object.assign(new Error('bail'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    })

    expect(isForbiddenProfileError(bailout)).toBe(false)
    expect(isForbiddenProfileError(new Error('offline'))).toBe(false)
    expect(isForbiddenProfileError(null)).toBe(false)
  })
})

describe('loadProfileView', () => {
  it('asks for the viewer’s own profile when the URL names nobody', async () => {
    const client = stubClient()

    const view = await loadProfileView(EMPTY_PROFILE_FILTERS)

    expect(client.getProfile).toHaveBeenCalledWith({
      requester: 'jeremy@lilnas.io',
    })
    expect(view.requester).toBe('jeremy@lilnas.io')
  })

  // The single most dangerous mistake available here: `getHistory()` with no
  // requester is *everyone's* history, rendered under one person's name.
  it('never asks for history without naming a requester', async () => {
    const client = stubClient()

    await loadProfileView(EMPTY_PROFILE_FILTERS)

    expect(client.getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requester: 'jeremy@lilnas.io' }),
    )
  })

  it('asks for the URL’s subject when there is one', async () => {
    mockGetViewer.mockResolvedValue(ADMIN)
    const client = stubClient()

    await loadProfileView({ ...EMPTY_PROFILE_FILTERS, user: 'sam@lilnas.io' })

    expect(client.getProfile).toHaveBeenCalledWith({
      requester: 'sam@lilnas.io',
    })
    expect(client.getHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requester: 'sam@lilnas.io' }),
    )
  })

  it('answers `forbidden` rather than throwing when the backend says 403', async () => {
    stubClient({ getProfile: jest.fn().mockRejectedValue(forbidden()) })

    const view = await loadProfileView({
      ...EMPTY_PROFILE_FILTERS,
      user: 'sam@lilnas.io',
    })

    expect(view.forbidden).toBe(true)
    expect(view.profile).toBeNull()
    expect(view.history).toBeNull()
    expect(view.requester).toBe('sam@lilnas.io')
  })

  it('lets every other failure through to the error boundary', async () => {
    stubClient({
      getProfile: jest
        .fn()
        .mockRejectedValue(new DownloadApiError(500, 'Server Error', {})),
    })

    await expect(loadProfileView(EMPTY_PROFILE_FILTERS)).rejects.toThrow(
      DownloadApiError,
    )
  })

  it('refuses to guess a subject when there is no identity and no ?user=', async () => {
    mockGetViewer.mockResolvedValue(null)
    stubClient()

    await expect(loadProfileView(EMPTY_PROFILE_FILTERS)).rejects.toThrow(
      /signed-in viewer/,
    )
  })

  it('still works with no identity when the URL names somebody', async () => {
    mockGetViewer.mockResolvedValue(null)
    const client = stubClient()

    const view = await loadProfileView({
      ...EMPTY_PROFILE_FILTERS,
      user: 'sam@lilnas.io',
    })

    expect(view.viewer).toBeNull()
    expect(client.getProfile).toHaveBeenCalledWith({
      requester: 'sam@lilnas.io',
    })
  })

  it('pins one instant for every relative stamp on the page', async () => {
    const before = Date.now()
    stubClient()

    const view = await loadProfileView(EMPTY_PROFILE_FILTERS)

    expect(view.now).toBeGreaterThanOrEqual(before)
    expect(view.now).toBeLessThanOrEqual(Date.now())
  })
})
