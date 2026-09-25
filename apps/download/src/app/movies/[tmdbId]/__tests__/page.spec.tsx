import '@testing-library/jest-dom'

import type {
  DownloadJob,
  ListBadFilesResponse,
  MediaDetailResponse,
  Movie,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { notFound } from 'next/navigation'

import {
  deleteMediaFiles,
  flagBadFile,
  grabRelease,
  replaceRelease,
  searchReleases,
  unflagBadFile,
} from 'src/app/actions/media-files'
import { cancelMovieJob, retryMovieJob } from 'src/app/actions/media-job'
import MoviePage, { generateMetadata } from 'src/app/movies/[tmdbId]/page'
import { MOVIE_WATCH_LABEL } from 'src/components/detail/movie-detail'
import { RELEASE_SEARCH_LABEL } from 'src/components/detail/release-picker'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

// A `'use server'` module: its graph reaches `next/headers` and `next/cache`,
// neither of which exists outside a request scope.
jest.mock('src/app/actions/media-files', () => ({
  deleteMediaFiles: jest.fn(),
  flagBadFile: jest.fn(),
  grabRelease: jest.fn(),
  replaceRelease: jest.fn(),
  searchReleases: jest.fn(),
  unflagBadFile: jest.fn(),
}))

// `'use server'` too, and each one a LIVE `PATCH`/request against the backend.
jest.mock('src/app/actions/media-job', () => ({
  cancelMovieJob: jest.fn(),
  retryMovieJob: jest.fn(),
}))

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  // The live wrapper refreshes the page when a download lands.
  useRouter: () => ({ refresh: jest.fn() }),
}))

const MOVIE_ID = 'tmdb:438631'
const WATCH_URL = 'https://emby.lilnas.io/web/index.html#!/item?id=41f2'

const MOVIE: Movie = {
  certification: 'PG-13',
  embyStatus: { itemId: '41f2', state: 'indexed', watchUrl: WATCH_URL },
  filePath: '/storage/media-library/movies/Salt & Ceremony (2024)/salt.mkv',
  genres: ['Drama', 'Thriller'],
  id: MOVIE_ID,
  overview: 'A quiet coastal town reckons with the tide.',
  ratingValue: 7.44,
  runtime: 7440,
  title: 'Salt & Ceremony',
  tmdbId: 438631,
  type: DownloadType.Movie,
  year: 2024,
}

const JOB: DownloadJob = {
  completedAt: '2026-09-15T11:48:00.000Z',
  createdAt: '2026-09-15T11:20:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: 'job-1',
  linkedDiscord: null,
  media: MOVIE,
  requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_jeremy' },
  status: DownloadJobStatus.Completed,
  updatedAt: '2026-09-15T11:48:00.000Z',
}

const DETAIL: MediaDetailResponse = { jobs: [JOB], media: MOVIE }

const BAD_FILES: ListBadFilesResponse = { badFiles: [] }

const getMedia = jest.fn<Promise<MediaDetailResponse>, [string]>()
const listBadFiles = jest.fn<Promise<ListBadFilesResponse>, [string]>()

async function renderPage(tmdbId = '438631') {
  return render(await MoviePage({ params: Promise.resolve({ tmdbId }) }))
}

beforeEach(() => {
  getMedia.mockResolvedValue(DETAIL)
  listBadFiles.mockResolvedValue(BAD_FILES)
  jest
    .mocked(getIdentifiedDownloadClient)
    .mockResolvedValue({ getMedia, listBadFiles } as unknown as Awaited<
      ReturnType<typeof getIdentifiedDownloadClient>
    >)
})

describe('MoviePage — the route segment', () => {
  it('reattaches the tmdb: prefix the route drops', async () => {
    await renderPage()

    expect(getMedia).toHaveBeenCalledWith(MOVIE_ID)
    expect(listBadFiles).toHaveBeenCalledWith(MOVIE_ID)
  })

  it('404s a segment that is not a plain tmdb id', async () => {
    await expect(renderPage('tmdb%3A438631')).rejects.toThrow('NEXT_NOT_FOUND')

    expect(notFound).toHaveBeenCalled()
    // The validation is the security boundary: without it the segment would
    // concatenate into `tmdb:tmdb:438631`.
    expect(getMedia).not.toHaveBeenCalled()
  })

  it('404s a leading-zero id, so one URL spells one title', async () => {
    await expect(renderPage('0438631')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404s a key that resolved to something other than a movie', async () => {
    getMedia.mockResolvedValue({
      jobs: [],
      media: {
        id: 'video:abc',
        sourceUrl: 'https://example.invalid',
        title: 'Not a movie',
        type: DownloadType.Video,
      },
    })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('does NOT 404 a movie Radarr could not resolve', async () => {
    // A `tmdb:` key always resolves — the resolver hands back a placeholder
    // and flags the source degraded. That is a metadata outage, not a
    // missing title.
    getMedia.mockResolvedValue({
      jobs: [],
      media: {
        id: MOVIE_ID,
        title: MOVIE_ID,
        tmdbId: 438631,
        type: DownloadType.Movie,
      },
    })

    await renderPage()

    expect(notFound).not.toHaveBeenCalled()
  })
})

describe('MoviePage — what it renders', () => {
  // Never `DownloadClient.localInstance`: without the forwarded identity the
  // backend persists every web-originated job unattributed.
  it('reads through the identified client', async () => {
    await renderPage()

    expect(getIdentifiedDownloadClient).toHaveBeenCalled()
  })

  it('renders the movie under a back link to the library', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Salt & Ceremony' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      '/gallery',
    )
  })

  it('hands the Emby URL straight through to the Watch link', async () => {
    await renderPage()

    expect(
      screen.getByRole('link', { name: MOVIE_WATCH_LABEL }),
    ).toHaveAttribute('href', WATCH_URL)
  })

  it('never starts a release search while rendering', async () => {
    await renderPage()

    // ⚠️ `GET /media/:id/releases` writes upstream. It is an explicit user
    // action, so the page loads into the prompt and nothing else.
    expect(searchReleases).not.toHaveBeenCalled()
    expect(
      screen.getAllByRole('button', { name: RELEASE_SEARCH_LABEL }).length,
    ).toBeGreaterThan(0)
  })

  it('fires no mutation as a side effect of rendering', async () => {
    await renderPage()

    for (const action of [
      cancelMovieJob,
      deleteMediaFiles,
      flagBadFile,
      grabRelease,
      replaceRelease,
      retryMovieJob,
      unflagBadFile,
    ]) {
      expect(action).not.toHaveBeenCalled()
    }
  })
})

describe('MoviePage — the lifecycle actions it wires', () => {
  /** Monitored in Radarr and not on disk — what makes a retry offerable. */
  const WANTED: Movie = {
    ...MOVIE,
    embyStatus: undefined,
    filePath: undefined,
    state: 'wanted',
  }

  it('wires Cancel on an in-flight attempt to the movie cancel action', async () => {
    getMedia.mockResolvedValue({
      jobs: [
        {
          ...JOB,
          completedAt: null,
          id: 'job-pending',
          status: DownloadJobStatus.Pending,
        },
      ],
      media: WANTED,
    })
    await renderPage()

    const card = document.querySelector('[data-job-id="job-pending"]')
    expect(card).toBeInstanceOf(HTMLElement)
    await userEvent.click(
      within(card as HTMLElement).getByRole('button', { name: /^cancel$/i }),
    )

    expect(cancelMovieJob).toHaveBeenCalledWith('job-pending')
  })

  it('wires Retry on a failed newest attempt to the movie retry action', async () => {
    getMedia.mockResolvedValue({
      jobs: [
        {
          ...JOB,
          error: 'Stopped responding partway through.',
          id: 'job-failed',
          status: DownloadJobStatus.Failed,
        },
      ],
      media: WANTED,
    })
    await renderPage()

    await userEvent.click(screen.getByRole('button', { name: /^retry$/i }))

    expect(retryMovieJob).toHaveBeenCalledWith('job-failed')
  })
})

describe('generateMetadata', () => {
  it('names the movie', async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ tmdbId: '438631' }) }),
    ).resolves.toEqual({ title: 'Salt & Ceremony · Download' })
  })

  it('falls back for a segment that is not an id, without asking upstream', async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ tmdbId: 'nope' }) }),
    ).resolves.toEqual({ title: 'Movie · Download' })

    expect(getMedia).not.toHaveBeenCalled()
  })

  it('falls back rather than replacing the page with its error boundary', async () => {
    getMedia.mockRejectedValue(new Error('Radarr is down'))

    await expect(
      generateMetadata({ params: Promise.resolve({ tmdbId: '438631' }) }),
    ).resolves.toEqual({ title: 'Movie · Download' })
  })

  it('re-throws a framework signal rather than swallowing it', async () => {
    // `redirect()`, `notFound()` and the dynamic-rendering bailout all
    // signal by throwing a value carrying a string `digest`.
    getMedia.mockRejectedValue(
      Object.assign(new Error('bail'), { digest: 'DYNAMIC_SERVER_USAGE' }),
    )

    await expect(
      generateMetadata({ params: Promise.resolve({ tmdbId: '438631' }) }),
    ).rejects.toThrow('bail')
  })
})
