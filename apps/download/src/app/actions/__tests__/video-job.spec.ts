import type { DownloadJob, Video } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { revalidatePath } from 'next/cache'

import {
  cancelVideoJob,
  deleteVideoJob,
  pauseVideoJob,
  resumeVideoJob,
  retryVideoJob,
} from 'src/app/actions/video-job'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)
const mockRevalidate = jest.mocked(revalidatePath)

const MEDIA_ID = 'video:V1StGXR8_Z5'
const DETAIL_PATH = '/videos/V1StGXR8_Z5'
const JOB_ID = 'job_1'
const SOURCE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

const VIDEO: Video = {
  id: MEDIA_ID,
  sourceUrl: SOURCE_URL,
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

const JOB: DownloadJob = {
  completedAt: null,
  createdAt: '2026-09-15T12:00:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: JOB_ID,
  linkedDiscord: null,
  media: VIDEO,
  requester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  status: DownloadJobStatus.Downloading,
  updatedAt: '2026-09-15T12:00:00.000Z',
}

/**
 * Every client method this module can reach, all as spies, so a test can
 * assert on the one it expects *and* on the ones it must not have touched.
 * That second half is what proves a pause is a pause and not a cancel.
 */
function stubClient(overrides: Record<string, jest.Mock> = {}) {
  const client = {
    cancelJob: jest.fn().mockResolvedValue(JOB),
    createJob: jest.fn().mockResolvedValue(JOB),
    deleteJob: jest.fn().mockResolvedValue(JOB),
    getJob: jest.fn().mockResolvedValue(JOB),
    pauseJob: jest.fn().mockResolvedValue(JOB),
    resumeJob: jest.fn().mockResolvedValue(JOB),
    ...overrides,
  }

  mockGetClient.mockResolvedValue(
    client as unknown as Awaited<
      ReturnType<typeof getIdentifiedDownloadClient>
    >,
  )

  return client
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the lifecycle actions', () => {
  // ⚠️ `getIdentifiedDownloadClient`, never `DownloadClient.localInstance`: a
  // plain local call drops `X-Forwarded-User` and persists the mutation
  // unattributed.
  it.each([
    ['cancelVideoJob', cancelVideoJob, 'cancelJob'],
    ['pauseVideoJob', pauseVideoJob, 'pauseJob'],
    ['resumeVideoJob', resumeVideoJob, 'resumeJob'],
  ] as const)(
    '%s calls the identified client with the job id',
    async (_name, action, method) => {
      const client = stubClient()

      await action(JOB_ID)

      expect(mockGetClient).toHaveBeenCalledTimes(1)
      expect(client[method]).toHaveBeenCalledWith(JOB_ID)
      expect(client[method]).toHaveBeenCalledTimes(1)
    },
  )

  it('never confuses one verb for another', async () => {
    const client = stubClient()

    await pauseVideoJob(JOB_ID)

    expect(client.cancelJob).not.toHaveBeenCalled()
    expect(client.resumeJob).not.toHaveBeenCalled()
    expect(client.deleteJob).not.toHaveBeenCalled()
  })

  // Derived from the returned job's own media, because the action is handed a
  // job id and nothing else.
  it('revalidates the detail page the mutation changed', async () => {
    stubClient()

    await cancelVideoJob(JOB_ID)

    expect(mockRevalidate).toHaveBeenCalledWith(DETAIL_PATH)
  })

  /**
   * `JobAction` returns `Promise<void>`, so there is no channel to report a
   * failure on, and throwing would unmount the detail page into its error
   * boundary — losing the panel that would have shown the job's unchanged
   * status. The failure is logged and the page is left alone.
   */
  it('logs and swallows a failure rather than taking the page down', async () => {
    stubClient({ pauseJob: jest.fn().mockRejectedValue(new Error('409')) })

    await expect(pauseVideoJob(JOB_ID)).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  /**
   * ⚠️ Next signals a static-generation bailout, `redirect()` and
   * `notFound()` by throwing a value carrying a string `digest`. Swallowing
   * one would break the build's dynamic-rendering detection.
   */
  it('re-throws a framework signal instead of logging it', async () => {
    const signal = Object.assign(new Error('bailout'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    })
    stubClient({ cancelJob: jest.fn().mockRejectedValue(signal) })

    await expect(cancelVideoJob(JOB_ID)).rejects.toBe(signal)
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('retryVideoJob', () => {
  /**
   * There is no retry endpoint — a retry is a new `POST /download/videos` for
   * the same source, which `upsertVideoByNaturalKey()` collapses back onto the
   * same `videos` row. Carrying `timeRange` across is what keeps it collapsing:
   * a dropped range mints a different natural key and a second page.
   */
  it('asks for the same source again, range and attribution intact', async () => {
    const clip: Video = {
      ...VIDEO,
      timeRange: { end: '00:02:00', start: '00:01:00' },
    }
    const client = stubClient({
      getJob: jest
        .fn()
        .mockResolvedValue({ ...JOB, hiddenAttribution: true, media: clip }),
    })

    await retryVideoJob(JOB_ID)

    expect(client.getJob).toHaveBeenCalledWith(JOB_ID)
    expect(client.createJob).toHaveBeenCalledWith({
      hiddenAttribution: true,
      timeRange: { end: '00:02:00', start: '00:01:00' },
      url: SOURCE_URL,
    })
    expect(mockRevalidate).toHaveBeenCalledWith(DETAIL_PATH)
  })

  it('refuses a job that is not a video, without creating anything', async () => {
    const client = stubClient({
      getJob: jest.fn().mockResolvedValue({
        ...JOB,
        media: {
          id: 'tmdb:438631',
          title: 'Dune',
          tmdbId: 438631,
          type: 'movie',
        },
      }),
    })

    await retryVideoJob(JOB_ID)

    expect(client.createJob).not.toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})

describe('deleteVideoJob', () => {
  it('deletes by job id and answers with the job the backend returned', async () => {
    const client = stubClient()

    await expect(deleteVideoJob(JOB_ID)).resolves.toEqual({ job: JOB })

    expect(client.deleteJob).toHaveBeenCalledWith(JOB_ID)
    expect(mockRevalidate).toHaveBeenCalledWith(DETAIL_PATH)
  })

  /**
   * A discriminated result rather than a throw: the delete is offered from the
   * detail page itself, and a thrown server action would replace the whole
   * page with "video unavailable" when one button failed.
   */
  it('answers with copy rather than throwing when the delete fails', async () => {
    stubClient({ deleteJob: jest.fn().mockRejectedValue(new Error('500')) })

    await expect(deleteVideoJob(JOB_ID)).resolves.toEqual({
      error: expect.stringContaining('Could not delete'),
    })
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('re-throws a framework signal', async () => {
    const signal = Object.assign(new Error('bailout'), {
      digest: 'NEXT_REDIRECT',
    })
    stubClient({ deleteJob: jest.fn().mockRejectedValue(signal) })

    await expect(deleteVideoJob(JOB_ID)).rejects.toBe(signal)
  })
})
