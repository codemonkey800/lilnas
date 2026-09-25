import type {
  DownloadJob,
  Movie,
  Show,
  ShowScope,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { revalidatePath } from 'next/cache'

import {
  cancelMovieJob,
  cancelShowJob,
  retryMovieJob,
  retryShowJob,
} from 'src/app/actions/media-job'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)
const mockRevalidate = jest.mocked(revalidatePath)

const JOB_ID = 'job_1'
const TMDB_ID = 438631
const TVDB_ID = 79126
const MOVIE_PATH = `/movies/${TMDB_ID}`
const SHOW_PATH = `/shows/${TVDB_ID}`

const MOVIE: Movie = {
  id: `tmdb:${TMDB_ID}`,
  title: 'Dune',
  tmdbId: TMDB_ID,
  type: DownloadType.Movie,
}

const SHOW: Show = {
  id: `tvdb:${TVDB_ID}`,
  title: 'The Wire',
  tvdbId: TVDB_ID,
  type: DownloadType.Show,
}

const MOVIE_JOB: DownloadJob = {
  completedAt: null,
  createdAt: '2026-09-15T12:00:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: JOB_ID,
  linkedDiscord: null,
  media: MOVIE,
  requester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  status: DownloadJobStatus.Downloading,
  updatedAt: '2026-09-15T12:00:00.000Z',
}

const SHOW_JOB: DownloadJob = { ...MOVIE_JOB, media: SHOW }

/**
 * Every client method this module can reach, all as spies, so a test can
 * assert on the one it expects *and* on the ones it must not have touched.
 * That second half is what proves a movie cancel never reaches Sonarr's
 * endpoint and a cancel is never a retry.
 */
function stubClient(overrides: Record<string, jest.Mock> = {}) {
  const client = {
    cancelMovieJob: jest.fn().mockResolvedValue(MOVIE_JOB),
    cancelShowJob: jest.fn().mockResolvedValue(SHOW_JOB),
    getMovieJob: jest.fn().mockResolvedValue(MOVIE_JOB),
    getShowJob: jest.fn().mockResolvedValue(SHOW_JOB),
    requestMovie: jest.fn().mockResolvedValue(MOVIE_JOB),
    requestShow: jest.fn().mockResolvedValue(SHOW_JOB),
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

describe('the cancel actions', () => {
  // ⚠️ `getIdentifiedDownloadClient`, never `DownloadClient.localInstance`: a
  // plain local call drops `X-Forwarded-User` and persists the mutation
  // unattributed.
  it.each([
    ['cancelMovieJob', cancelMovieJob, 'cancelMovieJob', 'cancelShowJob'],
    ['cancelShowJob', cancelShowJob, 'cancelShowJob', 'cancelMovieJob'],
  ] as const)(
    '%s calls the identified client with the job id',
    async (_name, action, method, other) => {
      const client = stubClient()

      await action(JOB_ID)

      expect(mockGetClient).toHaveBeenCalledTimes(1)
      expect(client[method]).toHaveBeenCalledWith(JOB_ID)
      expect(client[method]).toHaveBeenCalledTimes(1)
      expect(client[other]).not.toHaveBeenCalled()
      expect(client.requestMovie).not.toHaveBeenCalled()
      expect(client.requestShow).not.toHaveBeenCalled()
    },
  )

  // Derived from the returned job's own media, because the action is handed a
  // job id and nothing else.
  it.each([
    ['cancelMovieJob', cancelMovieJob, MOVIE_PATH],
    ['cancelShowJob', cancelShowJob, SHOW_PATH],
  ] as const)(
    '%s revalidates the detail page the mutation changed',
    async (_name, action, path) => {
      stubClient()

      await action(JOB_ID)

      expect(mockRevalidate).toHaveBeenCalledWith(path)
    },
  )

  /**
   * `JobAction` returns `Promise<void>`, so there is no channel to report a
   * failure on, and throwing would unmount the detail page into its error
   * boundary. The failure is logged and the page is left alone.
   */
  it('logs and swallows a failure rather than taking the page down', async () => {
    stubClient({
      cancelShowJob: jest.fn().mockRejectedValue(new Error('404')),
    })

    await expect(cancelShowJob(JOB_ID)).resolves.toBeUndefined()

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
    stubClient({ cancelMovieJob: jest.fn().mockRejectedValue(signal) })

    await expect(cancelMovieJob(JOB_ID)).rejects.toBe(signal)
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('retryMovieJob', () => {
  /**
   * There is no retry endpoint — a retry is a fresh `POST /download/movies`
   * for the same title, and a new job row; the attempt keeps its outcome.
   */
  it('asks for the same movie again', async () => {
    const client = stubClient()

    await retryMovieJob(JOB_ID)

    expect(client.getMovieJob).toHaveBeenCalledWith(JOB_ID)
    expect(client.requestMovie).toHaveBeenCalledWith({ tmdbId: TMDB_ID })
    expect(mockRevalidate).toHaveBeenCalledWith(MOVIE_PATH)
  })

  it('refuses a job that is not a movie, without requesting anything', async () => {
    const client = stubClient({
      getMovieJob: jest.fn().mockResolvedValue(SHOW_JOB),
    })

    await expect(retryMovieJob(JOB_ID)).resolves.toBeUndefined()

    expect(client.requestMovie).not.toHaveBeenCalled()
    expect(client.requestShow).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('logs and swallows a failed request', async () => {
    stubClient({
      requestMovie: jest.fn().mockRejectedValue(new Error('500')),
    })

    await expect(retryMovieJob(JOB_ID)).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('re-throws a framework signal', async () => {
    const signal = Object.assign(new Error('bailout'), {
      digest: 'NEXT_REDIRECT',
    })
    stubClient({ getMovieJob: jest.fn().mockRejectedValue(signal) })

    await expect(retryMovieJob(JOB_ID)).rejects.toBe(signal)
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('retryShowJob', () => {
  /**
   * The scope is carried across so a retry asks for exactly what the attempt
   * did. `episodeNumber` is display-only and `RequestShowInputSchema` does not
   * accept it, so it never crosses over. Season 0 is Sonarr's specials, a
   * real season — it must not widen to the whole series.
   */
  it.each<[string, ShowScope | undefined, Record<string, number>]>([
    ['the whole series for an absent scope', undefined, {}],
    ['the whole series for an empty scope', {}, {}],
    ['one season', { seasonNumber: 3 }, { seasonNumber: 3 }],
    ['season 0 (specials)', { seasonNumber: 0 }, { seasonNumber: 0 }],
    [
      'one episode, without its display-only episodeNumber',
      { episodeId: 4012, episodeNumber: 5, seasonNumber: 3 },
      { episodeId: 4012, seasonNumber: 3 },
    ],
  ])('asks for %s', async (_name, scope, expectedScope) => {
    const client = stubClient({
      getShowJob: jest.fn().mockResolvedValue({ ...SHOW_JOB, scope }),
    })

    await retryShowJob(JOB_ID)

    expect(client.getShowJob).toHaveBeenCalledWith(JOB_ID)
    expect(client.requestShow).toHaveBeenCalledTimes(1)

    const [input] = client.requestShow.mock.calls[0]

    // `toStrictEqual` rather than `toHaveBeenCalledWith`, so an
    // `episodeNumber` or an `undefined`-valued key sneaking in still fails.
    expect(input).toStrictEqual({ tvdbId: TVDB_ID, ...expectedScope })
    expect(mockRevalidate).toHaveBeenCalledWith(SHOW_PATH)
  })

  it('refuses a job that is not a show, without requesting anything', async () => {
    const client = stubClient({
      getShowJob: jest.fn().mockResolvedValue(MOVIE_JOB),
    })

    await expect(retryShowJob(JOB_ID)).resolves.toBeUndefined()

    expect(client.requestShow).not.toHaveBeenCalled()
    expect(client.requestMovie).not.toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('logs and swallows a failed request', async () => {
    stubClient({
      requestShow: jest.fn().mockRejectedValue(new Error('500')),
    })

    await expect(retryShowJob(JOB_ID)).resolves.toBeUndefined()

    expect(console.error).toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('re-throws a framework signal', async () => {
    const signal = Object.assign(new Error('bailout'), {
      digest: 'NEXT_NOT_FOUND',
    })
    stubClient({ getShowJob: jest.fn().mockRejectedValue(signal) })

    await expect(retryShowJob(JOB_ID)).rejects.toBe(signal)
    expect(console.error).not.toHaveBeenCalled()
  })
})
