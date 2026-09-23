import '@testing-library/jest-dom'

import { DownloadApiError } from '@lilnas/utils/download/client'
import type {
  DownloadJob,
  MediaDetailResponse,
  Video,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { notFound } from 'next/navigation'

import VideoDetailError from 'src/app/videos/[videoId]/error'
import VideoDetailPage from 'src/app/videos/[videoId]/page'
import { VIDEO_SOURCE_LABEL } from 'src/components/detail/video-detail'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

// The page hands these to `AttemptList` as callbacks; their own module graph
// reaches `next/headers` and `next/cache`, neither available outside a request
// scope. What they *do* is covered in `actions/__tests__/video-job.spec.ts`.
jest.mock('src/app/actions/video-job', () => ({
  cancelVideoJob: jest.fn(),
  deleteVideoJob: jest.fn(),
  pauseVideoJob: jest.fn(),
  resumeVideoJob: jest.fn(),
  retryVideoJob: jest.fn(),
}))

/**
 * `notFound()` signals by throwing, exactly as it does in Next, so a test can
 * assert both that it was reached *and* that nothing downstream of it ran.
 */
const NOT_FOUND = new Error('NEXT_NOT_FOUND')

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw NOT_FOUND
  }),
}))

const VIDEO_ID = 'V1StGXR8_Z5'
const MEDIA_ID = `video:${VIDEO_ID}`
const SOURCE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'

const VIDEO: Video = {
  id: MEDIA_ID,
  runtime: 842,
  sourceUrl: SOURCE_URL,
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

const JOB: DownloadJob = {
  completedAt: null,
  createdAt: '2026-09-15T11:48:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: 'job_1',
  linkedDiscord: null,
  media: VIDEO,
  requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_jeremy' },
  status: DownloadJobStatus.Downloading,
  updatedAt: '2026-09-15T11:59:00.000Z',
}

const getMedia = jest.fn<Promise<MediaDetailResponse>, [string]>()

async function renderPage(videoId = VIDEO_ID) {
  return render(await VideoDetailPage({ params: Promise.resolve({ videoId }) }))
}

beforeEach(() => {
  getMedia.mockResolvedValue({ jobs: [JOB], media: VIDEO })
  jest
    .mocked(getIdentifiedDownloadClient)
    .mockResolvedValue({ getMedia } as unknown as Awaited<
      ReturnType<typeof getIdentifiedDownloadClient>
    >)
})

describe('VideoDetailPage', () => {
  it('reattaches the `video:` prefix the route dropped', async () => {
    await renderPage()

    expect(getMedia).toHaveBeenCalledWith(MEDIA_ID)
  })

  it('renders the title and the link back to the original post', async () => {
    await renderPage()

    expect(
      screen.getByRole('heading', {
        name: 'Sourdough starter, day one to seven',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: VIDEO_SOURCE_LABEL }),
    ).toHaveAttribute('href', SOURCE_URL)
  })

  /**
   * The back affordance is `LibraryLink` in the page body — the mockups'
   * `libraryLink` mixin is an in-page control, not an app-bar one, and
   * `AppBar`'s own `back` prop is deliberately left unwired.
   */
  it('offers the library breadcrumb in the page body', async () => {
    await renderPage()

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      '/gallery',
    )
  })

  describe('an unknown key', () => {
    /**
     * ⚠️ `mediaIdFromRoute` *returns null* for a segment that is not a plain
     * nanoid rather than throwing, and that rejection is the security boundary:
     * without it `/videos/tmdb%3A438631` would concatenate into
     * `video:tmdb:438631` and aim a video-scoped route at another id space.
     */
    it('is a 404 for a segment carrying another id space, without asking the backend', async () => {
      await expect(renderPage('tmdb:438631')).rejects.toBe(NOT_FOUND)

      expect(notFound).toHaveBeenCalled()
      expect(getMedia).not.toHaveBeenCalled()
    })

    it('is a 404 for a segment with a slash-smuggled path', async () => {
      await expect(renderPage('../../gallery')).rejects.toBe(NOT_FOUND)

      expect(getMedia).not.toHaveBeenCalled()
    })

    /**
     * A well-formed id with no `videos` row is a genuine 404 from the backend
     * — a video cannot exist before somebody downloaded it, unlike a movie or
     * a show, which always resolve to something upstream.
     */
    it('is a 404, not an error, when the backend has no such video', async () => {
      getMedia.mockRejectedValue(
        new DownloadApiError(404, 'Not Found', { message: 'Media not found' }),
      )

      await expect(renderPage()).rejects.toBe(NOT_FOUND)
      expect(notFound).toHaveBeenCalled()
    })

    it('is a 404 when the key resolves to something that is not a video', async () => {
      getMedia.mockResolvedValue({
        jobs: [],
        media: {
          id: 'tmdb:438631',
          title: 'Dune',
          tmdbId: 438631,
          type: DownloadType.Movie,
        },
      })

      await expect(renderPage()).rejects.toBe(NOT_FOUND)
    })
  })

  /**
   * Everything that is not a 404 is a service failure, and belongs to the
   * error boundary rather than to this page — a `notFound()` here would tell
   * the user the video does not exist when the truth is that nobody could
   * reach the service that knows.
   */
  it('lets a service failure reach the error boundary', async () => {
    const failure = new DownloadApiError(502, 'Bad Gateway', null)
    getMedia.mockRejectedValue(failure)

    await expect(renderPage()).rejects.toBe(failure)
    expect(notFound).not.toHaveBeenCalled()
  })

  /**
   * ⚠️ This renders **at all** only because `<JobEventsProvider>` is mounted
   * here, at the page root: `VideoDetailLive` calls `useJobEvents`, which
   * throws without an ancestor rather than quietly opening a socket of its
   * own. So a successful render is the assertion — delete the provider from
   * `page.tsx` and every test in this file fails.
   *
   * The provider belongs here and not in `layout.tsx` because it owns the
   * socket, and mounting it app-wide would open a gateway connection on every
   * route including the ones that want no live data. It also sits outside
   * everything below it with no `key` in between, so nothing on this page can
   * tear the connection down and restart the reconnect backoff ladder.
   */
  it('mounts the live feed at the page root, so the panel updates itself', async () => {
    await renderPage()

    expect(screen.getByText('downloading')).toBeInTheDocument()
  })

  /**
   * ⚠️ The page's *wiring*, not the dialog's behaviour — `delete-confirm.spec`
   * owns that. `VideoDetail` withholds this control entirely when no delete
   * action was handed over, so the trigger being on screen is exactly the
   * assertion that `deleteVideoJob` reached it.
   */
  it('offers Delete once the download has a file behind it', async () => {
    getMedia.mockResolvedValue({
      jobs: [
        {
          ...JOB,
          completedAt: '2026-09-15T11:59:00.000Z',
          status: DownloadJobStatus.Completed,
        },
      ],
      media: {
        ...VIDEO,
        downloadUrls: [
          'https://storage.lilnas.io/videos/V1StGXR8_Z5/part-0.mp4',
        ],
        // The page gates Save and Delete on the video's state, not the job's.
        state: 'available',
      },
    })

    await renderPage()

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('passes every job through, newest first, so history renders too', async () => {
    getMedia.mockResolvedValue({
      jobs: [
        JOB,
        {
          ...JOB,
          createdAt: '2026-09-14T12:00:00.000Z',
          error: 'ETIMEDOUT',
          id: 'job_0',
          status: DownloadJobStatus.Failed,
        },
      ],
      media: VIDEO,
    })

    await renderPage()

    const attempts = screen.getByRole('region', { name: 'Attempts' })

    expect(
      Array.from(attempts.querySelectorAll('[data-job-id]')).map(el =>
        el.getAttribute('data-job-id'),
      ),
    ).toEqual([JOB.id, 'job_0'])
    expect(screen.getByText('failed')).toBeInTheDocument()
  })
})

/*
 * The segment-scoped not-found boundary `notFound()` above renders into has
 * its own suite now that the app has a root `not-found.tsx` to reconcile it
 * with — `src/app/videos/[videoId]/__tests__/not-found.spec.tsx`, which checks
 * both the copy that earns it its keep and its sameness with the root panel.
 */

describe('VideoDetailError', () => {
  it('re-runs the segment when asked to try again', async () => {
    const reset = jest.fn()
    render(<VideoDetailError error={new Error('boom')} reset={reset} />)

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  /**
   * ⚠️ `error.message` is never rendered: production replaces it with a
   * generic string and development puts a stack trace's first line there. The
   * `digest` is the one thing that correlates this screen with the server log.
   */
  it('renders the digest and never the message', () => {
    render(
      <VideoDetailError
        error={Object.assign(new Error('ECONNREFUSED 8081'), {
          digest: '2381947123',
        })}
        reset={jest.fn()}
      />,
    )

    expect(screen.getByText('Reference 2381947123')).toBeInTheDocument()
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument()
  })
})
