import { DownloadApiError } from '@lilnas/utils/download/client'
import {
  type DownloadJob,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { redirect } from 'next/navigation'

import { startVideoDownload } from 'src/app/actions/start-video-download'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

// The real `redirect()` signals a navigation by throwing a value carrying a
// `digest`. The stub throws too, on purpose: an implementation that wrapped the
// redirect in the same `try` as the client call would swallow it and answer
// with the generic failure message, and only a throwing stub can catch that.
const REDIRECT_SENTINEL = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/videos/abc;307;',
})

jest.mock('next/navigation', () => ({
  redirect: jest.fn(() => {
    throw REDIRECT_SENTINEL
  }),
}))

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)
const mockRedirect = jest.mocked(redirect)

const JOB: DownloadJob = {
  completedAt: null,
  createdAt: '2026-09-15T12:00:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: 'job_1',
  linkedDiscord: null,
  media: {
    id: 'video:V1StGXR8Z5',
    sourceUrl: 'https://youtube.com/watch?v=7f2k9dQ',
    title: 'A clip',
    type: DownloadType.Video,
  },
  requester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  status: DownloadJobStatus.Downloading,
  updatedAt: '2026-09-15T12:00:00.000Z',
}

function stubClient(createJob: jest.Mock) {
  mockGetClient.mockResolvedValue({
    createJob,
  } as unknown as Awaited<ReturnType<typeof getIdentifiedDownloadClient>>)

  return createJob
}

describe('startVideoDownload', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('creates the job through the identified client and redirects to the media-derived path', async () => {
    const createJob = stubClient(jest.fn().mockResolvedValue(JOB))

    await expect(
      startVideoDownload('https://youtube.com/watch?v=7f2k9dQ'),
    ).rejects.toBe(REDIRECT_SENTINEL)

    // The whole point of `getIdentifiedDownloadClient()`: a plain
    // `DownloadClient.localInstance` drops the forwarded identity and the job
    // persists unattributed.
    expect(mockGetClient).toHaveBeenCalledTimes(1)
    expect(createJob).toHaveBeenCalledWith({
      url: 'https://youtube.com/watch?v=7f2k9dQ',
    })
    // `video:V1StGXR8Z5` -> `/videos/V1StGXR8Z5`, via `mediaHref`.
    expect(mockRedirect).toHaveBeenCalledWith('/videos/V1StGXR8Z5')
  })

  it('normalizes a scheme-less link before posting it', async () => {
    // `CreateDownloadJobInputSchema.url` is `z.string().url()` and would 400 on
    // the bare form the user actually typed.
    const createJob = stubClient(jest.fn().mockResolvedValue(JOB))

    await expect(
      startVideoDownload('youtube.com/watch?v=7f2k9dQ'),
    ).rejects.toBe(REDIRECT_SENTINEL)

    expect(createJob).toHaveBeenCalledWith({
      url: 'https://youtube.com/watch?v=7f2k9dQ',
    })
  })

  it('refuses anything that is not a link, without touching the backend', async () => {
    const createJob = stubClient(jest.fn())

    await expect(startVideoDownload('the office')).resolves.toEqual({
      error: expect.stringContaining('not a link'),
    })
    expect(createJob).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('refuses a non-http scheme', async () => {
    const createJob = stubClient(jest.fn())

    await expect(
      startVideoDownload('javascript:alert(1)'),
    ).resolves.toMatchObject({ error: expect.any(String) })
    expect(createJob).not.toHaveBeenCalled()
  })

  it('surfaces a 400 from the backend as a bad-link message', async () => {
    stubClient(
      jest.fn().mockRejectedValue(new DownloadApiError(400, 'Bad Request', {})),
    )

    await expect(
      startVideoDownload('https://youtube.com/watch?v=x'),
    ).resolves.toEqual({ error: expect.stringContaining('not a link') })
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('surfaces any other failure as a retryable message', async () => {
    stubClient(jest.fn().mockRejectedValue(new TypeError('fetch failed')))

    await expect(
      startVideoDownload('https://youtube.com/watch?v=x'),
    ).resolves.toEqual({ error: expect.stringContaining('try again') })
    expect(mockRedirect).not.toHaveBeenCalled()
  })

  it('does not swallow the redirect when the create succeeded', async () => {
    stubClient(jest.fn().mockResolvedValue(JOB))

    // Rejecting with the sentinel — rather than resolving with an error object
    // — is the assertion: `redirect()` has to escape the action untouched or
    // Next never performs the navigation.
    await expect(
      startVideoDownload('https://youtube.com/watch?v=x'),
    ).rejects.toBe(REDIRECT_SENTINEL)
  })
})
