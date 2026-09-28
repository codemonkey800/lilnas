import type {
  DownloadJob,
  Episode,
  Media,
  Movie,
  Season,
  Show,
  Video,
} from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  DownloadType,
  JOBS_SYNCED_TYPE,
  SYNC_JOBS_EVENT,
} from '@lilnas/utils/download/types'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildFrame,
  buildJobFrame,
  buildMediaFrame,
  buildMovie,
  buildVideoJob,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
import {
  RESUME_RECONNECT_AFTER_MS,
  useJobEvents,
  type VisibilitySource,
} from 'src/lib/use-job-events'
import type { LiveMediaInput } from 'src/lib/use-live-media'
import { useLiveMedia } from 'src/lib/use-live-media'

/**
 * The phone-lock scenario through the provider, for every kind of
 * page: a download is moving, the tab is hidden and its socket dies without a
 * `close` (what a locked phone does), the download finishes meanwhile, and the
 * tab comes back. The page must land on the finished state from the catch-up
 * alone - no further change is ever coming to push it there.
 */

const LAST_SYNC = '2026-09-28T12:00:00.000Z'
const FINISHED_AT = '2026-09-28T12:30:00.000Z'

function job(media: Media, overrides: Partial<DownloadJob> = {}): DownloadJob {
  return buildVideoJob({
    id: `job-${media.id}`,
    media,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-28T11:00:00.000Z',
    ...overrides,
  })
}

function renderLive<T>(hook: () => T) {
  const recorder = createSocketRecorder()
  let visibilityState: DocumentVisibilityState = 'visible'
  let onVisibilityChange: (() => void) | undefined
  let clock = 0
  const visibility = {
    addEventListener: (_type: string, handler: () => void) => {
      onVisibilityChange = handler
    },
    removeEventListener: () => {
      onVisibilityChange = undefined
    },
    get visibilityState() {
      return visibilityState
    },
  } as unknown as VisibilitySource

  const wrapper = ({ children }: { children: ReactNode }) => (
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      getVisibilitySource={() => visibility}
      now={() => clock}
      random={NO_JITTER}
    >
      {children}
    </JobEventsProvider>
  )
  const view = renderHook(hook, { wrapper })

  const send = (...frames: string[]) =>
    act(() => {
      for (const frame of frames) recorder.latest().emitMessage(frame)
    })

  /** The socket opens and catches up, as on a normal page load. */
  function connect(): void {
    act(() => recorder.latest().emitOpen())
    send(buildFrame({ serverTime: LAST_SYNC }, JOBS_SYNCED_TYPE))
  }

  /** Locks the phone for a minute; the socket dies without a `close`. */
  function lockAndReturn(): void {
    act(() => {
      visibilityState = 'hidden'
      onVisibilityChange?.()
      clock += Math.max(60_000, RESUME_RECONNECT_AFTER_MS)
      visibilityState = 'visible'
      onVisibilityChange?.()
    })
    act(() => recorder.latest().emitOpen())
  }

  /** The catch-up request the fresh socket sent. */
  function syncRequest(): unknown {
    return recorder
      .latest()
      .sent.map(message => JSON.parse(message) as { event: string })
      .find(message => message.event === SYNC_JOBS_EVENT)
  }

  return { ...view, connect, lockAndReturn, recorder, send, syncRequest }
}

function renderLiveMedia<M extends Media>(input: LiveMediaInput<M>) {
  return renderLive(() => useLiveMedia(input))
}

describe('catching up after the phone was locked', () => {
  it('movie page: lands the imported movie and the completed job', () => {
    const movie = buildMovie({
      queueSnapshot: { progress: 40, status: 'downloading' },
      state: 'downloading',
    })
    const page = renderLiveMedia<Movie>({ jobs: [job(movie)], media: movie })
    page.connect()
    page.send(
      buildMediaFrame({
        ...movie,
        queueSnapshot: { progress: 45, status: 'downloading' },
      }),
    )

    page.lockAndReturn()

    expect(page.recorder.sockets).toHaveLength(2)
    expect(page.syncRequest()).toEqual({
      data: { mediaIds: [movie.id], since: LAST_SYNC },
      event: SYNC_JOBS_EVENT,
    })

    const imported: Movie = {
      ...buildMovie({ state: 'available' }),
      filePath: '/movies/A movie.mkv',
    }
    page.send(
      buildMediaFrame(imported),
      buildJobFrame(
        job(imported, {
          completedAt: FINISHED_AT,
          status: DownloadJobStatus.Completed,
          updatedAt: FINISHED_AT,
        }),
      ),
      buildFrame({ serverTime: FINISHED_AT }, JOBS_SYNCED_TYPE),
    )

    expect(page.result.current.media.state).toBe('available')
    expect(page.result.current.media.queueSnapshot).toBeUndefined()
    expect(page.result.current.jobs[0]?.status).toBe(
      DownloadJobStatus.Completed,
    )
    expect(page.result.current.connected).toBe(true)
  })

  it('show page: lands the series state and every episode', () => {
    const episode: Episode = {
      episodeNumber: 1,
      hasFile: false,
      id: 101,
      monitored: true,
      seasonNumber: 1,
      state: 'downloading',
    }
    const seasons: Season[] = [
      {
        episodeCount: 1,
        episodeFileCount: 0,
        episodes: [episode],
        monitored: true,
        seasonNumber: 1,
      },
    ]
    const show: Show = {
      id: 'tvdb:7',
      state: 'downloading',
      title: 'A show',
      tvdbId: 7,
      type: DownloadType.Show,
    }
    const page = renderLiveMedia<Show>({
      jobs: [job(show)],
      media: show,
      seasons,
    })
    page.connect()

    page.lockAndReturn()

    expect(page.syncRequest()).toEqual({
      data: { mediaIds: [show.id], since: LAST_SYNC },
      event: SYNC_JOBS_EVENT,
    })

    page.send(
      buildMediaFrame({ ...show, state: 'available' }, [
        { episodeId: 101, seasonNumber: 1, state: 'available' },
      ]),
      buildJobFrame(
        job(show, {
          status: DownloadJobStatus.Completed,
          updatedAt: FINISHED_AT,
        }),
      ),
    )

    expect(page.result.current.media.state).toBe('available')
    expect(page.result.current.seasons?.[0]?.episodes[0]?.state).toBe(
      'available',
    )
    expect(page.result.current.jobs[0]?.status).toBe(
      DownloadJobStatus.Completed,
    )
  })

  it('video page: lands the downloaded video and drops the progress bar', () => {
    const video: Video = {
      id: 'video:v1',
      sourceUrl: 'https://example.com/video',
      state: 'downloading',
      title: 'A video',
      type: DownloadType.Video,
    }
    const running = job(video, {
      progress: { downloadedBytes: 40, fileIndex: 1, percent: 40 },
    })
    const page = renderLiveMedia<Video>({ jobs: [running], media: video })
    page.connect()
    page.send(
      buildJobFrame({
        ...running,
        progress: { downloadedBytes: 45, fileIndex: 1, percent: 45 },
      }),
    )

    page.lockAndReturn()

    expect(page.syncRequest()).toEqual({
      data: { mediaIds: [video.id], since: LAST_SYNC },
      event: SYNC_JOBS_EVENT,
    })

    const downloaded: Video = {
      ...video,
      downloadUrls: ['https://storage.example/v1.mp4'],
      state: 'available',
    }
    page.send(
      buildMediaFrame(downloaded),
      buildJobFrame(
        job(downloaded, {
          status: DownloadJobStatus.Completed,
          updatedAt: FINISHED_AT,
        }),
      ),
    )

    expect(page.result.current.media.state).toBe('available')
    expect(page.result.current.media.downloadUrls).toEqual([
      'https://storage.example/v1.mp4',
    ])
    expect(page.result.current.jobs[0]?.status).toBe(
      DownloadJobStatus.Completed,
    )
    expect(page.result.current.jobs[0]?.progress).toBeUndefined()
  })

  it('activity feed: lands the finished job of every media type', () => {
    const movie = buildMovie()
    const show: Show = {
      id: 'tvdb:7',
      state: 'downloading',
      title: 'A show',
      tvdbId: 7,
      type: DownloadType.Show,
    }
    const video: Video = {
      id: 'video:v1',
      sourceUrl: 'https://example.com/video',
      title: 'A video',
      type: DownloadType.Video,
    }
    const page = renderLive(() => useJobEvents())
    page.connect()
    page.send(
      buildJobFrame(job(movie)),
      buildJobFrame(job(show)),
      buildJobFrame(job(video)),
    )

    page.lockAndReturn()

    // The feed shows no media of its own, so it asks for jobs only.
    expect(page.syncRequest()).toEqual({
      data: { since: LAST_SYNC },
      event: SYNC_JOBS_EVENT,
    })

    const done = { status: DownloadJobStatus.Completed, updatedAt: FINISHED_AT }
    page.send(
      buildJobFrame(job(movie, done)),
      buildJobFrame(job(show, done)),
      buildJobFrame(job(video, done)),
    )

    expect(
      [...page.result.current.jobs.values()].map(item => [
        item.media.type,
        item.status,
      ]),
    ).toEqual([
      [DownloadType.Movie, DownloadJobStatus.Completed],
      [DownloadType.Show, DownloadJobStatus.Completed],
      [DownloadType.Video, DownloadJobStatus.Completed],
    ])
  })
})
