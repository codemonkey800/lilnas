import type {
  DownloadJob,
  WatchMediaMessage,
} from '@lilnas/utils/download/types'
import {
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
  WATCH_MEDIA_EVENT,
} from '@lilnas/utils/download/types'
import { act, renderHook } from '@testing-library/react'
import type { JSX, ReactNode } from 'react'

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
import type { JobEventsInterest, JobEventsStore } from 'src/lib/use-job-events'
import {
  createJobEventsStore,
  DEFAULT_RECONNECT_DELAYS_MS,
  getJobEventsSocketUrl,
  JobEventsContext,
  useJobEvents,
  useMediaEvents,
} from 'src/lib/use-job-events'

/** Subscribes with the given interest and returns the store, ready to ingest. */
function subscribedStore(interest: JobEventsInterest): JobEventsStore {
  const store = createJobEventsStore()
  store.subscribe(() => {}, interest)
  return store
}

describe('getJobEventsSocketUrl', () => {
  it('uses wss when the page is served over https', () => {
    expect(
      getJobEventsSocketUrl({ host: 'download.lilnas.io', protocol: 'https:' }),
    ).toBe('wss://download.lilnas.io/ws')
  })

  it('uses ws when the page is not served over https', () => {
    expect(
      getJobEventsSocketUrl({ host: 'localhost:8090', protocol: 'http:' }),
    ).toBe('ws://localhost:8090/ws')
  })
})

describe('createJobEventsStore', () => {
  describe('ingest', () => {
    it('upserts by job id rather than accumulating duplicates', () => {
      const store = subscribedStore({ allJobs: true })

      store.ingest(
        buildJobFrame(
          buildVideoJob({ status: DownloadJobStatus.Pending }),
          DownloadJobEventType.Created,
        ),
      )
      store.ingest(
        buildJobFrame(buildVideoJob({ status: DownloadJobStatus.Downloading })),
      )

      const { jobs } = store.getSnapshot()
      expect(jobs.size).toBe(1)
      expect(jobs.get('video-1')?.status).toBe(DownloadJobStatus.Downloading)
    })

    it('replaces the snapshot and its map rather than mutating them', () => {
      const store = subscribedStore({ allJobs: true })
      const before = store.getSnapshot()

      store.ingest(buildJobFrame(buildVideoJob()))

      const after = store.getSnapshot()
      expect(after).not.toBe(before)
      expect(after.jobs).not.toBe(before.jobs)
      expect(before.jobs.size).toBe(0)
    })

    it('drops a malformed frame without throwing or notifying', () => {
      const store = subscribedStore({ allJobs: true })
      const listener = jest.fn()
      store.subscribe(listener, { allJobs: true })

      expect(() => {
        store.ingest('{not json')
        store.ingest({ not: 'a string' })
        store.ingest(buildFrame({ job: { id: 'video-1' } }))
      }).not.toThrow()

      expect(store.getSnapshot().jobs.size).toBe(0)
      expect(listener).not.toHaveBeenCalled()
    })

    it('notifies every listener when a frame lands', () => {
      const store = createJobEventsStore()
      const first = jest.fn()
      const second = jest.fn()
      store.subscribe(first, { allJobs: true })
      store.subscribe(second, { allJobs: true })

      store.ingest(buildJobFrame(buildVideoJob()))

      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(1)
    })
  })

  describe('interest', () => {
    it('ignores a job no subscriber asked for instead of accumulating it', () => {
      const store = subscribedStore({ jobIds: new Set(['video-1']) })

      store.ingest(buildJobFrame(buildVideoJob({ id: 'video-1' })))
      store.ingest(buildJobFrame(buildVideoJob({ id: 'some-other-job' })))

      expect([...store.getSnapshot().jobs.keys()]).toEqual(['video-1'])
    })

    it('drops every job while no subscriber is registered at all', () => {
      const store = createJobEventsStore()

      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(0)
    })

    it('keeps an id alive while another subscriber still wants it', () => {
      const store = createJobEventsStore()
      const unsubscribe = store.subscribe(() => {}, {
        jobIds: new Set(['video-1']),
      })
      store.subscribe(() => {}, { jobIds: new Set(['video-1']) })

      unsubscribe()
      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(1)
    })

    it('stops accepting an id once the last interested subscriber leaves', () => {
      const store = createJobEventsStore()
      const unsubscribe = store.subscribe(() => {}, {
        jobIds: new Set(['video-1']),
      })

      unsubscribe()
      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(0)
    })

    it('accepts everything again once an unfiltered subscriber joins', () => {
      const store = createJobEventsStore()
      store.subscribe(() => {}, { jobIds: new Set(['video-1']) })
      store.subscribe(() => {}, { allJobs: true })

      store.ingest(buildJobFrame(buildVideoJob({ id: 'some-other-job' })))

      expect(store.getSnapshot().jobs.size).toBe(1)
    })

    // What makes a download started from Discord (or another tab) appear on
    // a media page that never knew its job id.
    it('keeps a job whose media id is wanted even when its job id is not', () => {
      const store = subscribedStore({ jobMediaIds: new Set(['video:v1']) })

      store.ingest(buildJobFrame(buildVideoJob({ id: 'unknown-job' })))
      store.ingest(
        buildJobFrame(
          buildVideoJob({
            id: 'other-media-job',
            media: { ...buildVideoJob().media, id: 'video:v2' },
          }),
        ),
      )

      expect([...store.getSnapshot().jobs.keys()]).toEqual(['unknown-job'])
    })

    it('does not keep a job just because a media subscriber watches its media', () => {
      const store = subscribedStore({ mediaIds: new Set(['video:v1']) })

      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(0)
    })

    it('keeps a media id alive for job frames while another subscriber wants it', () => {
      const store = createJobEventsStore()
      const unsubscribe = store.subscribe(() => {}, {
        jobMediaIds: new Set(['video:v1']),
      })
      store.subscribe(() => {}, { jobMediaIds: new Set(['video:v1']) })

      unsubscribe()
      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(1)
    })
  })

  describe('media frames', () => {
    it('upserts the media map and leaves the job map untouched', () => {
      const store = subscribedStore({ mediaIds: new Set(['tmdb:1']) })
      const before = store.getSnapshot()

      store.ingest(buildMediaFrame(buildMovie()))

      const after = store.getSnapshot()
      expect(after).not.toBe(before)
      expect(after.media).not.toBe(before.media)
      expect(after.jobs).toBe(before.jobs)
      expect(after.media.get('tmdb:1')).toEqual({ media: buildMovie() })
      expect(before.media.size).toBe(0)
    })

    it('leaves the media map untouched when a job frame lands', () => {
      const store = subscribedStore({ allJobs: true })
      const before = store.getSnapshot()

      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().media).toBe(before.media)
    })

    it('keeps the episode states a show frame carries', () => {
      const store = subscribedStore({ mediaIds: new Set(['tvdb:9']) })
      const show = {
        id: 'tvdb:9',
        state: 'downloading',
        title: 'A show',
        tvdbId: 9,
        type: DownloadType.Show,
      } as const
      const episodes = [
        { episodeId: 3, seasonNumber: 1, state: 'downloading' },
      ] as const

      store.ingest(buildMediaFrame(show, [...episodes]))

      expect(store.getSnapshot().media.get('tvdb:9')?.episodes).toEqual(
        episodes,
      )
    })

    it('replaces an earlier frame for the same media id', () => {
      const store = subscribedStore({ mediaIds: new Set(['tmdb:1']) })

      store.ingest(buildMediaFrame(buildMovie({ state: 'downloading' })))
      store.ingest(buildMediaFrame(buildMovie({ state: 'available' })))

      const { media } = store.getSnapshot()
      expect(media.size).toBe(1)
      expect(media.get('tmdb:1')?.media.state).toBe('available')
    })

    it('drops a frame for a media id nobody asked for, without notifying', () => {
      const store = createJobEventsStore()
      const listener = jest.fn()
      store.subscribe(listener, { mediaIds: new Set(['tmdb:1']) })

      store.ingest(buildMediaFrame(buildMovie({ id: 'tmdb:2', tmdbId: 2 })))

      expect(store.getSnapshot().media.size).toBe(0)
      expect(listener).not.toHaveBeenCalled()
    })

    it('drops media frames that only job interest covers', () => {
      const store = createJobEventsStore()
      store.subscribe(() => {}, { allJobs: true })
      store.subscribe(() => {}, { jobMediaIds: new Set(['tmdb:1']) })

      store.ingest(buildMediaFrame(buildMovie()))

      expect(store.getSnapshot().media.size).toBe(0)
    })

    it('drops a malformed media frame without throwing', () => {
      const store = subscribedStore({ mediaIds: new Set(['tmdb:1']) })

      expect(() =>
        store.ingest(buildFrame({ media: { id: 'tmdb:1' } }, 'media')),
      ).not.toThrow()

      expect(store.getSnapshot().media.size).toBe(0)
    })

    it('keeps a media id alive while another subscriber still wants it', () => {
      const store = createJobEventsStore()
      const unsubscribe = store.subscribe(() => {}, {
        mediaIds: new Set(['tmdb:1']),
      })
      store.subscribe(() => {}, { mediaIds: new Set(['tmdb:1']) })

      unsubscribe()
      store.ingest(buildMediaFrame(buildMovie()))

      expect(store.getSnapshot().media.size).toBe(1)
    })

    it('stops accepting a media id once the last interested subscriber leaves', () => {
      const store = createJobEventsStore()
      const unsubscribe = store.subscribe(() => {}, {
        mediaIds: new Set(['tmdb:1']),
      })

      unsubscribe()
      store.ingest(buildMediaFrame(buildMovie()))

      expect(store.getSnapshot().media.size).toBe(0)
    })
  })

  describe('connect', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    function connectedStore() {
      const recorder = createSocketRecorder()
      const store = createJobEventsStore({
        createSocket: recorder.createSocket,
        getLocation: () => TEST_LOCATION,
        random: NO_JITTER,
      })
      store.subscribe(() => {}, { allJobs: true })
      return { dispose: store.connect(), recorder, store }
    }

    it('opens a socket at the same-origin /ws url', () => {
      const { dispose, recorder } = connectedStore()

      expect(recorder.sockets).toHaveLength(1)
      expect(recorder.latest().url).toBe('wss://download.lilnas.io/ws')

      dispose()
    })

    it('reports connected only between open and close', () => {
      const { dispose, recorder, store } = connectedStore()

      expect(store.getSnapshot().connected).toBe(false)

      act(() => recorder.latest().emitOpen())
      expect(store.getSnapshot().connected).toBe(true)

      act(() => recorder.latest().emitClose())
      expect(store.getSnapshot().connected).toBe(false)

      dispose()
    })

    it('routes socket messages into the job map', () => {
      const { dispose, recorder, store } = connectedStore()

      act(() => recorder.latest().emitMessage(buildJobFrame(buildVideoJob())))

      expect(store.getSnapshot().jobs.get('video-1')).toBeDefined()

      dispose()
    })

    it('reconnects after a close, climbing the backoff ladder', () => {
      const { dispose, recorder } = connectedStore()
      const [first = 0, second = 0] = DEFAULT_RECONNECT_DELAYS_MS

      recorder.latest().emitClose()
      expect(recorder.sockets).toHaveLength(1) // delayed, not immediate

      jest.advanceTimersByTime(first - 1)
      expect(recorder.sockets).toHaveLength(1)
      jest.advanceTimersByTime(1)
      expect(recorder.sockets).toHaveLength(2)

      recorder.latest().emitClose()
      jest.advanceTimersByTime(second - 1)
      expect(recorder.sockets).toHaveLength(2)
      jest.advanceTimersByTime(1)
      expect(recorder.sockets).toHaveLength(3)

      dispose()
    })

    it('resets the backoff ladder once a socket actually opens', () => {
      const { dispose, recorder } = connectedStore()
      const [first = 0, second = 0] = DEFAULT_RECONNECT_DELAYS_MS

      recorder.latest().emitClose()
      jest.advanceTimersByTime(first)
      expect(recorder.sockets).toHaveLength(2)

      act(() => recorder.latest().emitOpen())
      recorder.latest().emitClose()

      // Back to the first rung, not the second one it had climbed to.
      jest.advanceTimersByTime(first)
      expect(recorder.sockets).toHaveLength(3)
      expect(first).toBeLessThan(second)

      dispose()
    })

    it('jitters each delay around its base', () => {
      const recorder = createSocketRecorder()
      const store = createJobEventsStore({
        createSocket: recorder.createSocket,
        getLocation: () => TEST_LOCATION,
        random: () => 0,
        reconnectDelaysMs: [1_000],
      })
      const dispose = store.connect()

      recorder.latest().emitClose()

      jest.advanceTimersByTime(799)
      expect(recorder.sockets).toHaveLength(1)
      jest.advanceTimersByTime(1)
      expect(recorder.sockets).toHaveLength(2)

      dispose()
    })

    it('retries rather than throwing when a socket cannot be created', () => {
      const recorder = createSocketRecorder()
      let failNext = true
      const store = createJobEventsStore({
        createSocket: url => {
          if (failNext) {
            failNext = false
            throw new Error('WebSocket is not defined')
          }
          return recorder.createSocket(url)
        },
        getLocation: () => TEST_LOCATION,
        random: NO_JITTER,
      })

      const dispose = store.connect()
      expect(recorder.sockets).toHaveLength(0)

      jest.advanceTimersByTime(DEFAULT_RECONNECT_DELAYS_MS[0])
      expect(recorder.sockets).toHaveLength(1)

      dispose()
    })

    it('closes the socket and stops reconnecting once disposed', () => {
      const { dispose, recorder } = connectedStore()

      recorder.latest().emitClose()
      dispose()

      jest.advanceTimersByTime(60_000)
      expect(recorder.sockets).toHaveLength(1)
      expect(recorder.latest().closeCount).toBe(1)
    })

    it('ignores frames that arrive from a socket closed by dispose', () => {
      const { dispose, recorder, store } = connectedStore()
      const socket = recorder.latest()

      dispose()
      socket.emitMessage(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(0)
    })
  })
})

describe('useJobEvents', () => {
  function renderWithStore(store: JobEventsStore) {
    function Wrapper({ children }: { children: ReactNode }): JSX.Element {
      return (
        <JobEventsContext.Provider value={store}>
          {children}
        </JobEventsContext.Provider>
      )
    }
    return Wrapper
  }

  it('throws when there is no provider above it', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderHook(() => useJobEvents())).toThrow(
      '<JobEventsProvider>',
    )
  })

  it('accumulates every job when no filter is given', () => {
    const store = createJobEventsStore()
    const { result } = renderHook(() => useJobEvents(), {
      wrapper: renderWithStore(store),
    })

    act(() => {
      store.ingest(buildJobFrame(buildVideoJob({ id: 'a' })))
      store.ingest(buildJobFrame(buildVideoJob({ id: 'b' })))
    })

    expect([...result.current.jobs.keys()].sort()).toEqual(['a', 'b'])
  })

  it('returns only the filtered jobs, and never stores the rest', () => {
    const store = createJobEventsStore()
    const { result } = renderHook(() => useJobEvents({ jobIds: ['a'] }), {
      wrapper: renderWithStore(store),
    })

    act(() => {
      store.ingest(buildJobFrame(buildVideoJob({ id: 'a' })))
      store.ingest(buildJobFrame(buildVideoJob({ id: 'b' })))
    })

    expect([...result.current.jobs.keys()]).toEqual(['a'])
    expect(store.getSnapshot().jobs.has('b')).toBe(false)
  })

  it('treats an empty jobIds array as a filter matching nothing', () => {
    const store = createJobEventsStore()
    const { result } = renderHook(() => useJobEvents({ jobIds: [] }), {
      wrapper: renderWithStore(store),
    })

    act(() => store.ingest(buildJobFrame(buildVideoJob({ id: 'a' }))))

    expect(result.current.jobs.size).toBe(0)
  })

  describe('filter combinations', () => {
    const onV1 = (id: string) => buildVideoJob({ id })
    const onV2 = (id: string) =>
      buildVideoJob({ id, media: { ...buildVideoJob().media, id: 'video:v2' } })

    function ingestAll(store: JobEventsStore): void {
      act(() => {
        store.ingest(buildJobFrame(onV1('a')))
        store.ingest(buildJobFrame(onV1('b')))
        store.ingest(buildJobFrame(onV2('c')))
        store.ingest(buildJobFrame(onV2('d')))
      })
    }

    it.each<[string, Parameters<typeof useJobEvents>[0], string[]]>([
      ['no filter at all', undefined, ['a', 'b', 'c', 'd']],
      ['an empty filter object', {}, ['a', 'b', 'c', 'd']],
      ['jobIds only', { jobIds: ['a', 'c'] }, ['a', 'c']],
      ['mediaIds only', { mediaIds: ['video:v2'] }, ['c', 'd']],
      [
        'both, as a union',
        { jobIds: ['a'], mediaIds: ['video:v2'] },
        ['a', 'c', 'd'],
      ],
      ['empty mediaIds', { mediaIds: [] }, []],
      ['both empty', { jobIds: [], mediaIds: [] }, []],
      [
        'empty jobIds with mediaIds',
        { jobIds: [], mediaIds: ['video:v1'] },
        ['a', 'b'],
      ],
    ])('keeps the right jobs given %s', (_, filter, expected) => {
      const store = createJobEventsStore()
      const { result } = renderHook(() => useJobEvents(filter), {
        wrapper: renderWithStore(store),
      })

      ingestAll(store)

      expect([...result.current.jobs.keys()].sort()).toEqual(expected)
      expect([...store.getSnapshot().jobs.keys()].sort()).toEqual(expected)
    })

    it('narrows to its own filter when the store holds more', () => {
      const store = createJobEventsStore()
      renderHook(() => useJobEvents({ mediaIds: ['video:v2'] }), {
        wrapper: renderWithStore(store),
      })
      const { result } = renderHook(
        () => useJobEvents({ mediaIds: ['video:v1'] }),
        { wrapper: renderWithStore(store) },
      )

      ingestAll(store)

      expect([...result.current.jobs.keys()].sort()).toEqual(['a', 'b'])
    })
  })

  it('keeps the jobs map identity when a media frame lands', () => {
    const store = createJobEventsStore()
    store.subscribe(() => {}, { mediaIds: new Set(['tmdb:1']) })
    const { result } = renderHook(() => useJobEvents({ jobIds: ['a'] }), {
      wrapper: renderWithStore(store),
    })
    act(() => store.ingest(buildJobFrame(buildVideoJob({ id: 'a' }))))
    const before = result.current.jobs

    act(() => store.ingest(buildMediaFrame(buildMovie())))

    expect(result.current.jobs).toBe(before)
  })

  it('does not resubscribe when an inline mediaIds array is re-allocated', () => {
    const store = createJobEventsStore()
    const subscribe = jest.fn(store.subscribe)
    const { rerender } = renderHook(
      ({ mediaIds }: { mediaIds: string[] }) => useJobEvents({ mediaIds }),
      {
        initialProps: { mediaIds: ['x', 'y'] },
        wrapper: renderWithStore({ ...store, subscribe }),
      },
    )

    rerender({ mediaIds: ['y', 'x'] })

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('surfaces the store connection state', () => {
    const recorder = createSocketRecorder()
    const store = createJobEventsStore({
      createSocket: recorder.createSocket,
      getLocation: () => TEST_LOCATION,
    })
    const { result } = renderHook(() => useJobEvents(), {
      wrapper: renderWithStore(store),
    })
    const dispose = store.connect()

    expect(result.current.connected).toBe(false)

    act(() => recorder.latest().emitOpen())
    expect(result.current.connected).toBe(true)

    act(() => recorder.latest().emitClose())
    expect(result.current.connected).toBe(false)

    dispose()
  })

  // A call site writing `useJobEvents({ jobIds: [a, b] })` inline allocates a
  // new array every render. The interest is keyed on the ids, so that must
  // not re-run the subscription.
  it('does not resubscribe when an inline jobIds array is re-allocated', () => {
    const store = createJobEventsStore()
    const subscribe = jest.fn(store.subscribe)
    const { rerender } = renderHook(
      () => useJobEvents({ jobIds: ['a', 'b'] }),
      { wrapper: renderWithStore({ ...store, subscribe }) },
    )

    expect(subscribe).toHaveBeenCalledTimes(1)

    rerender()
    rerender()

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('does not resubscribe when only the order of jobIds changes', () => {
    const store = createJobEventsStore()
    const subscribe = jest.fn(store.subscribe)
    const { rerender } = renderHook(
      ({ jobIds }: { jobIds: string[] }) => useJobEvents({ jobIds }),
      {
        initialProps: { jobIds: ['a', 'b'] },
        wrapper: renderWithStore({ ...store, subscribe }),
      },
    )

    rerender({ jobIds: ['b', 'a'] })

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('resubscribes when the set of jobIds actually changes', () => {
    const store = createJobEventsStore()
    const subscribe = jest.fn(store.subscribe)
    const { rerender, result } = renderHook(
      ({ jobIds }: { jobIds: string[] }) => useJobEvents({ jobIds }),
      {
        initialProps: { jobIds: ['a'] },
        wrapper: renderWithStore({ ...store, subscribe }),
      },
    )

    rerender({ jobIds: ['a', 'b'] })

    expect(subscribe).toHaveBeenCalledTimes(2)

    act(() => store.ingest(buildJobFrame(buildVideoJob({ id: 'b' }))))

    expect(result.current.jobs.has('b')).toBe(true)
  })

  it('unsubscribes on unmount so the store stops accepting its jobs', () => {
    const store = createJobEventsStore()
    const { unmount } = renderHook(() => useJobEvents({ jobIds: ['a'] }), {
      wrapper: renderWithStore(store),
    })

    unmount()
    store.ingest(buildJobFrame(buildVideoJob({ id: 'a' })))

    expect(store.getSnapshot().jobs.size).toBe(0)
  })

  it('keeps the requester exactly as the gateway masked it', () => {
    const store = createJobEventsStore()
    const masked: DownloadJob = buildVideoJob({
      hiddenAttribution: true,
      requester: null,
    })
    const { result } = renderHook(() => useJobEvents(), {
      wrapper: renderWithStore(store),
    })

    act(() => store.ingest(buildJobFrame(masked)))

    expect(result.current.jobs.get('video-1')).toEqual(masked)
  })
})

describe('useMediaEvents', () => {
  function wrapperFor(store: JobEventsStore) {
    function Wrapper({ children }: { children: ReactNode }): JSX.Element {
      return (
        <JobEventsContext.Provider value={store}>
          {children}
        </JobEventsContext.Provider>
      )
    }
    return Wrapper
  }

  /** Renders the hook and counts how often it renders. */
  function renderCounted(store: JobEventsStore, mediaIds: string[]) {
    const counter = { renders: 0 }
    const hook = renderHook(
      () => {
        counter.renders += 1
        return useMediaEvents({ mediaIds })
      },
      { wrapper: wrapperFor(store) },
    )
    return { ...hook, counter }
  }

  const movie1 = buildMovie()
  const movie2 = buildMovie({ id: 'tmdb:2', tmdbId: 2 })

  it('throws when there is no provider above it', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      renderHook(() => useMediaEvents({ mediaIds: ['tmdb:1'] })),
    ).toThrow('useMediaEvents() must be called inside a <JobEventsProvider>')
  })

  it('returns the latest frame for each requested media id', () => {
    const store = createJobEventsStore()
    const { result } = renderCounted(store, ['tmdb:1'])

    act(() => store.ingest(buildMediaFrame(movie1)))
    act(() => store.ingest(buildMediaFrame(buildMovie({ state: 'importing' }))))

    expect(result.current.media.get('tmdb:1')?.media.state).toBe('importing')
  })

  it('never stores a frame for an id it did not ask for', () => {
    const store = createJobEventsStore()
    const { result } = renderCounted(store, ['tmdb:1'])

    act(() => store.ingest(buildMediaFrame(movie2)))

    expect(result.current.media.size).toBe(0)
    expect(store.getSnapshot().media.size).toBe(0)
  })

  it('treats an empty mediaIds array as a filter matching nothing', () => {
    const store = createJobEventsStore()
    const { result } = renderCounted(store, [])

    act(() => store.ingest(buildMediaFrame(movie1)))

    expect(result.current.media.size).toBe(0)
    expect(store.getSnapshot().media.size).toBe(0)
  })

  it('re-renders on a matching frame', () => {
    const store = createJobEventsStore()
    const { counter, result } = renderCounted(store, ['tmdb:1'])
    const before = { renders: counter.renders, snapshot: result.current }

    act(() => store.ingest(buildMediaFrame(movie1)))

    expect(counter.renders).toBe(before.renders + 1)
    expect(result.current).not.toBe(before.snapshot)
  })

  it("does not re-render on a frame for another subscriber's media", () => {
    const store = createJobEventsStore()
    store.subscribe(() => {}, { mediaIds: new Set(['tmdb:2']) })
    const { counter, result } = renderCounted(store, ['tmdb:1'])
    act(() => store.ingest(buildMediaFrame(movie1)))
    const before = { renders: counter.renders, snapshot: result.current }

    act(() => store.ingest(buildMediaFrame(movie2)))

    expect(store.getSnapshot().media.has('tmdb:2')).toBe(true)
    expect(counter.renders).toBe(before.renders)
    expect(result.current).toBe(before.snapshot)
  })

  it('does not re-render on a job frame', () => {
    const store = createJobEventsStore()
    store.subscribe(() => {}, { allJobs: true })
    const { counter, result } = renderCounted(store, ['tmdb:1'])
    const before = { renders: counter.renders, snapshot: result.current }

    act(() => store.ingest(buildJobFrame(buildVideoJob())))

    expect(store.getSnapshot().jobs.size).toBe(1)
    expect(counter.renders).toBe(before.renders)
    expect(result.current).toBe(before.snapshot)
  })

  it('keeps the media map identity when only the connection flips', () => {
    const recorder = createSocketRecorder()
    const store = createJobEventsStore({
      createSocket: recorder.createSocket,
      getLocation: () => TEST_LOCATION,
    })
    const { result } = renderCounted(store, ['tmdb:1'])
    const dispose = store.connect()
    const before = result.current

    act(() => recorder.latest().emitOpen())

    expect(result.current.connected).toBe(true)
    expect(result.current.media).toBe(before.media)

    dispose()
  })

  it('keeps receiving while a second subscriber to the same id unmounts', () => {
    const store = createJobEventsStore()
    const first = renderCounted(store, ['tmdb:1'])
    const second = renderCounted(store, ['tmdb:1'])

    second.unmount()
    act(() => store.ingest(buildMediaFrame(movie1)))

    expect(first.result.current.media.has('tmdb:1')).toBe(true)
  })

  it('stops the store accepting its media once the last subscriber unmounts', () => {
    const store = createJobEventsStore()
    const { unmount } = renderCounted(store, ['tmdb:1'])

    unmount()
    store.ingest(buildMediaFrame(movie1))

    expect(store.getSnapshot().media.size).toBe(0)
  })

  it('does not resubscribe when an inline mediaIds array is re-allocated', () => {
    const store = createJobEventsStore()
    const subscribe = jest.fn(store.subscribe)
    const { rerender } = renderHook(
      ({ mediaIds }: { mediaIds: string[] }) => useMediaEvents({ mediaIds }),
      {
        initialProps: { mediaIds: ['tmdb:1', 'tmdb:2'] },
        wrapper: wrapperFor({ ...store, subscribe }),
      },
    )

    rerender({ mediaIds: ['tmdb:2', 'tmdb:1'] })

    expect(subscribe).toHaveBeenCalledTimes(1)
  })
})

describe('watch list', () => {
  function openStore() {
    const recorder = createSocketRecorder()
    const store = createJobEventsStore({
      createSocket: recorder.createSocket,
      getLocation: () => TEST_LOCATION,
      random: NO_JITTER,
    })
    const dispose = store.connect()
    const sent = () =>
      recorder
        .latest()
        .sent.map(message => JSON.parse(message) as WatchMediaMessage)
    return { dispose, recorder, sent, store }
  }

  it('sends nothing until a subscriber asks to watch', () => {
    const { dispose, recorder, sent, store } = openStore()
    recorder.latest().emitOpen()

    store.subscribe(() => {}, { mediaIds: new Set(['tmdb:1']) })

    expect(sent()).toEqual([])
    dispose()
  })

  it('sends the watched ids once the socket opens', () => {
    const { dispose, recorder, sent, store } = openStore()
    store.subscribe(() => {}, {
      mediaIds: new Set(['tmdb:1']),
      watchMediaIds: new Set(['tmdb:1']),
    })

    expect(sent()).toEqual([])
    recorder.latest().emitOpen()

    expect(sent()).toEqual([
      { data: { mediaIds: ['tmdb:1'] }, event: WATCH_MEDIA_EVENT },
    ])
    dispose()
  })

  it('re-sends when the list changes, and only then', () => {
    const { dispose, recorder, sent, store } = openStore()
    recorder.latest().emitOpen()

    const first = store.subscribe(() => {}, {
      watchMediaIds: new Set(['tmdb:1']),
    })
    // A second subscriber to the same id doesn't move the list.
    const second = store.subscribe(() => {}, {
      watchMediaIds: new Set(['tmdb:1']),
    })
    first()
    second()

    expect(sent().map(message => message.data.mediaIds)).toEqual([
      ['tmdb:1'],
      [],
    ])
    dispose()
  })

  it('re-sends the whole list on a reconnect', () => {
    jest.useFakeTimers()
    const { dispose, recorder, sent, store } = openStore()
    store.subscribe(() => {}, { watchMediaIds: new Set(['tvdb:7']) })
    recorder.latest().emitOpen()

    recorder.latest().emitClose()
    jest.runOnlyPendingTimers()
    recorder.latest().emitOpen()

    expect(recorder.sockets).toHaveLength(2)
    expect(sent()).toEqual([
      { data: { mediaIds: ['tvdb:7'] }, event: WATCH_MEDIA_EVENT },
    ])
    dispose()
    jest.useRealTimers()
  })
})

describe('dropMedia', () => {
  it('forgets the frame for one media and notifies', () => {
    const store = subscribedStore({ mediaIds: new Set(['tmdb:1', 'tmdb:2']) })
    const listener = jest.fn()
    store.subscribe(listener, {})
    store.ingest(buildMediaFrame(buildMovie()))
    store.ingest(buildMediaFrame(buildMovie({ id: 'tmdb:2', tmdbId: 2 })))
    listener.mockClear()

    store.dropMedia('tmdb:1')

    expect([...store.getSnapshot().media.keys()]).toEqual(['tmdb:2'])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a media with no frame', () => {
    const store = subscribedStore({ mediaIds: new Set(['tmdb:1']) })
    const before = store.getSnapshot()

    store.dropMedia('tmdb:1')

    expect(store.getSnapshot()).toBe(before)
  })
})
