import type {
  DownloadJob,
  DownloadQueueSnapshot,
  Episode,
  Media,
  Movie,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  buildMediaFrame,
  buildMovie,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
import type { LiveMediaInput } from 'src/lib/use-live-media'
import { useLiveMedia } from 'src/lib/use-live-media'

const MOVIE_ID = 'tmdb:1'

function movieJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:40:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media: {
      id: MOVIE_ID,
      title: 'A movie',
      tmdbId: 1,
      type: DownloadType.Movie,
    },
    requester: null,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:40:00.000Z',
    ...overrides,
  }
}

function snapshot(pct: number): DownloadQueueSnapshot {
  return { progress: pct, status: 'downloading', timeLeft: '00:10:00' }
}

function episode(overrides: Partial<Episode> = {}): Episode {
  return {
    episodeNumber: 1,
    hasFile: false,
    id: 101,
    monitored: true,
    seasonNumber: 1,
    state: 'wanted',
    ...overrides,
  }
}

function buildShow(overrides: Partial<Show> = {}): Show {
  return {
    id: 'tvdb:7',
    state: 'downloading',
    title: 'A show',
    tvdbId: 7,
    type: DownloadType.Show,
    ...overrides,
  }
}

function season(seasonNumber: number, episodes: Episode[]): Season {
  return {
    episodeCount: episodes.length,
    episodeFileCount: 0,
    episodes,
    monitored: true,
    seasonNumber,
  }
}

function setup<M extends Media>(initial: LiveMediaInput<M>) {
  const recorder = createSocketRecorder()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      random={NO_JITTER}
    >
      {children}
    </JobEventsProvider>
  )

  const view = renderHook((input: LiveMediaInput<M>) => useLiveMedia(input), {
    initialProps: initial,
    wrapper,
  })

  const send = (frame: string) =>
    act(() => recorder.latest().emitMessage(frame))

  return { ...view, recorder, send }
}

describe('useLiveMedia', () => {
  it('passes the server props through when no frame has arrived', () => {
    const media = buildMovie({ id: MOVIE_ID })
    const jobs = [movieJob()]
    const { result } = setup<Movie>({ jobs, media })

    expect(result.current.media).toBe(media)
    expect(result.current.jobs).toEqual(jobs)
    expect(result.current.seasons).toBeUndefined()
    expect(result.current.connected).toBe(false)
  })

  it('reports the socket as connected once it opens', () => {
    const { recorder, result } = setup<Movie>({
      jobs: [],
      media: buildMovie({ id: MOVIE_ID }),
    })

    act(() => recorder.latest().emitOpen())

    expect(result.current.connected).toBe(true)
  })

  it('replaces the media with a live frame for it', () => {
    const { result, send } = setup<Movie>({
      jobs: [],
      media: buildMovie({ id: MOVIE_ID }),
    })

    send(buildMediaFrame(buildMovie({ id: MOVIE_ID, state: 'importing' })))

    expect(result.current.media.state).toBe('importing')
  })

  it('shows a fresh file path from a media frame without a refresh', () => {
    const { result, send } = setup<Movie>({
      jobs: [],
      media: buildMovie({ id: MOVIE_ID }),
    })

    send(
      buildMediaFrame(
        buildMovie({
          filePath: '/movies/A Movie (2026)/a-movie.mkv',
          id: MOVIE_ID,
          state: 'available',
        }),
      ),
    )

    expect(result.current.media.state).toBe('available')
    expect(result.current.media.filePath).toBe(
      '/movies/A Movie (2026)/a-movie.mkv',
    )
  })

  it('ignores a media frame of another type for the same id', () => {
    const media = buildMovie({ id: MOVIE_ID })
    const { result, send } = setup<Movie>({ jobs: [], media })

    send(buildMediaFrame(buildShow({ id: MOVIE_ID, state: 'available' })))

    expect(result.current.media).toBe(media)
  })

  it('ignores a media frame for another media', () => {
    const media = buildMovie({ id: MOVIE_ID })
    const { result, send } = setup<Movie>({ jobs: [], media })

    send(buildMediaFrame(buildMovie({ id: 'tmdb:2', state: 'available' })))

    expect(result.current.media).toBe(media)
  })

  describe('seasons', () => {
    const untouched = episode({ episodeNumber: 1, id: 101, state: 'available' })
    const queued = episode({
      episodeNumber: 2,
      id: 102,
      queueSnapshot: snapshot(40),
      state: 'downloading',
    })
    const wanted = episode({ episodeNumber: 3, id: 103, state: 'wanted' })
    const later = season(2, [episode({ id: 201, seasonNumber: 2 })])
    const seasons = [season(1, [untouched, queued, wanted]), later]

    it('passes served seasons through when a frame has no episodes', () => {
      const show = buildShow()
      const { result, send } = setup<Show>({ jobs: [], media: show, seasons })

      send(buildMediaFrame(buildShow({ state: 'importing' })))

      expect(result.current.media.state).toBe('importing')
      expect(result.current.seasons).toEqual(seasons)
      expect(result.current.seasons?.[0]).toBe(seasons[0])
    })

    it('patches episodes by id and leaves the others as served', () => {
      const { result, send } = setup<Show>({
        jobs: [],
        media: buildShow(),
        seasons,
      })

      send(
        buildMediaFrame(buildShow(), [
          { episodeId: 102, seasonNumber: 1, state: 'importing' },
          {
            episodeId: 103,
            queueSnapshot: snapshot(10),
            seasonNumber: 1,
            state: 'downloading',
          },
        ]),
      )

      const [first, second] = result.current.seasons ?? []
      expect(first?.episodes[0]).toBe(untouched)

      // No `queueSnapshot` on the entry clears the served one.
      expect(first?.episodes[1]).toEqual({
        ...episode({ episodeNumber: 2, id: 102 }),
        state: 'importing',
      })
      expect(first?.episodes[1]).not.toHaveProperty('queueSnapshot')

      expect(first?.episodes[2]).toEqual({
        ...wanted,
        queueSnapshot: snapshot(10),
        state: 'downloading',
      })

      // A season none of whose episodes moved keeps its identity.
      expect(second).toBe(later)
    })

    it('ignores a show frame of another type, episodes and all', () => {
      const show = buildShow({ id: MOVIE_ID })
      const { result, send } = setup<Show>({ jobs: [], media: show, seasons })

      send(
        buildMediaFrame(buildMovie({ id: MOVIE_ID, state: 'available' }), [
          { episodeId: 101, seasonNumber: 1, state: 'wanted' },
        ]),
      )

      expect(result.current.media).toBe(show)
      expect(result.current.seasons?.[0]).toBe(seasons[0])
    })

    it('keeps its identity across renders when nothing changed', () => {
      const input = { jobs: [movieJob()], media: buildShow(), seasons }
      const { rerender, result } = setup<Show>(input)
      const first = result.current

      rerender({ ...input })

      expect(result.current).toBe(first)
    })
  })

  describe('jobs', () => {
    it('adds a live job for this media that the server did not render', () => {
      const served = movieJob({ createdAt: '2026-09-15T10:00:00.000Z' })
      const { result, send } = setup<Movie>({
        jobs: [served],
        media: buildMovie({ id: MOVIE_ID }),
      })

      const fromDiscord = movieJob({
        createdAt: '2026-09-15T12:00:00.000Z',
        id: 'job-discord',
        status: DownloadJobStatus.Searching,
      })
      send(buildJobFrame(fromDiscord))

      expect(result.current.jobs).toEqual([fromDiscord, served])
    })

    it('replaces the server copy of a job with the live one', () => {
      const { result, send } = setup<Movie>({
        jobs: [movieJob()],
        media: buildMovie({ id: MOVIE_ID }),
      })

      const done = movieJob({ status: DownloadJobStatus.Completed })
      send(buildJobFrame(done))

      // Landed means landed — no importing hold any more.
      expect(result.current.jobs).toEqual([done])
    })

    it('ignores a job for another media', () => {
      const served = [movieJob()]
      const { result, send } = setup<Movie>({
        jobs: served,
        media: buildMovie({ id: MOVIE_ID }),
      })

      send(
        buildJobFrame(
          movieJob({
            id: 'job-other',
            media: {
              id: 'tmdb:2',
              title: 'Another movie',
              tmdbId: 2,
              type: DownloadType.Movie,
            },
          }),
        ),
      )

      expect(result.current.jobs).toEqual(served)
    })

    it('orders jobs newest first by createdAt', () => {
      const oldest = movieJob({
        createdAt: '2026-09-15T08:00:00.000Z',
        id: 'job-oldest',
      })
      const middle = movieJob({
        createdAt: '2026-09-15T09:00:00.000Z',
        id: 'job-middle',
      })
      const { result, send } = setup<Movie>({
        jobs: [middle, oldest],
        media: buildMovie({ id: MOVIE_ID }),
      })

      // A live update to an old job must not float it to the top.
      const retried = { ...oldest, status: DownloadJobStatus.Failed }
      const newest = movieJob({
        createdAt: '2026-09-15T10:00:00.000Z',
        id: 'job-newest',
      })
      send(buildJobFrame(retried))
      send(buildJobFrame(newest))

      expect(result.current.jobs.map(job => job.id)).toEqual([
        'job-newest',
        'job-middle',
        'job-oldest',
      ])
      expect(result.current.jobs[2]?.status).toBe(DownloadJobStatus.Failed)
    })
  })
})

describe('useLiveMedia watch and served copies', () => {
  it('asks the gateway to watch a movie closely', () => {
    const { recorder } = setup<Movie>({
      jobs: [],
      media: buildMovie({ id: MOVIE_ID }),
    })

    act(() => recorder.latest().emitOpen())

    expect(recorder.latest().sent.map(m => JSON.parse(m))).toEqual([
      { data: { mediaIds: [MOVIE_ID] }, event: 'watch-media' },
    ])
  })

  it('does not ask the gateway to watch a video', () => {
    const { recorder } = setup({
      jobs: [],
      media: {
        id: 'video:1',
        sourceUrl: 'https://example.invalid/1',
        title: 'A clip',
        type: DownloadType.Video,
      },
    })

    act(() => recorder.latest().emitOpen())

    expect(recorder.latest().sent).toEqual([])
  })

  it('lets a new server copy outrank an older frame', () => {
    const { rerender, result, send } = setup<Movie>({
      jobs: [],
      media: buildMovie({ id: MOVIE_ID, state: 'downloading' }),
    })
    send(buildMediaFrame(buildMovie({ id: MOVIE_ID, state: 'available' })))
    expect(result.current.media.state).toBe('available')

    // A delete's revalidatePath hands the page a fresh copy.
    const fresh = buildMovie({ id: MOVIE_ID, state: 'absent' })
    rerender({ jobs: [], media: fresh })

    expect(result.current.media).toBe(fresh)
  })

  it('still takes a frame that lands after the new server copy', () => {
    const { rerender, result, send } = setup<Movie>({
      jobs: [],
      media: buildMovie({ id: MOVIE_ID }),
    })
    rerender({ jobs: [], media: buildMovie({ id: MOVIE_ID, state: 'absent' }) })

    send(buildMediaFrame(buildMovie({ id: MOVIE_ID, state: 'available' })))

    expect(result.current.media.state).toBe('available')
  })

  it('keeps a frame across a re-render with the same server copy', () => {
    const media = buildMovie({ id: MOVIE_ID, state: 'downloading' })
    const { rerender, result, send } = setup<Movie>({ jobs: [], media })
    send(buildMediaFrame(buildMovie({ id: MOVIE_ID, state: 'available' })))

    rerender({ jobs: [], media })

    expect(result.current.media.state).toBe('available')
  })
})
