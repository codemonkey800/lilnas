import type { DownloadJob } from '@lilnas/utils/download/types'
import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { act, renderHook } from '@testing-library/react'
import type { JSX, ReactNode } from 'react'

import {
  buildFrame,
  buildJobFrame,
  buildVideoJob,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
import type { JobEventsStore } from 'src/lib/use-job-events'
import {
  createJobEventsStore,
  DEFAULT_RECONNECT_DELAYS_MS,
  getJobEventsSocketUrl,
  JobEventsContext,
  parseJobEventFrame,
  useJobEvents,
} from 'src/lib/use-job-events'

/** Subscribes with the given interest and returns the store, ready to ingest. */
function subscribedStore(interest: ReadonlySet<string> | null): JobEventsStore {
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

describe('parseJobEventFrame', () => {
  it('returns the job and event type for a well-formed created frame', () => {
    const job = buildVideoJob({ status: DownloadJobStatus.Downloading })

    expect(
      parseJobEventFrame(buildJobFrame(job, DownloadJobEventType.Created)),
    ).toEqual({ job, type: DownloadJobEventType.Created })
  })

  it('returns the job and event type for a well-formed updated frame', () => {
    const job = buildVideoJob({ status: DownloadJobStatus.Completed })

    expect(
      parseJobEventFrame(buildJobFrame(job, DownloadJobEventType.Updated)),
    ).toEqual({ job, type: DownloadJobEventType.Updated })
  })

  // The gateway broadcasts a full snapshot on every event, so an event type
  // nobody has taught this file about yet should still move the UI forward.
  it('normalizes an unrecognized event type to updated', () => {
    const job = buildVideoJob()

    expect(
      parseJobEventFrame(buildFrame({ job, type: 'resurrected' })),
    ).toEqual({ job, type: DownloadJobEventType.Updated })
  })

  it('parses a movie job frame, not just a video one', () => {
    const job = buildVideoJob({
      media: {
        id: 'tmdb:1',
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      },
    })

    expect(parseJobEventFrame(buildJobFrame(job))?.job).toEqual(job)
  })

  it('returns undefined when the envelope type is not the job-event type', () => {
    expect(
      parseJobEventFrame(
        buildFrame(
          { job: buildVideoJob(), type: DownloadJobEventType.Updated },
          'some-other-type',
        ),
      ),
    ).toBeUndefined()
  })

  // The duck-type this replaced accepted anything with a `job` key; the
  // schema is the one the backend's wire type is inferred from, so the two
  // cannot drift.
  it('returns undefined when the payload does not parse as a DownloadJob', () => {
    expect(
      parseJobEventFrame(
        buildFrame({
          job: { id: 'video-1', status: 'not-a-real-status' },
          type: DownloadJobEventType.Updated,
        }),
      ),
    ).toBeUndefined()
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseJobEventFrame('{not json')).toBeUndefined()
  })

  it('returns undefined when the envelope carries no data', () => {
    expect(
      parseJobEventFrame(JSON.stringify({ type: DOWNLOAD_JOB_EVENT_TYPE })),
    ).toBeUndefined()
  })

  it('returns undefined when the data has no job', () => {
    expect(
      parseJobEventFrame(buildFrame({ type: DownloadJobEventType.Updated })),
    ).toBeUndefined()
  })

  it('returns undefined for non-string message data', () => {
    expect(parseJobEventFrame({ not: 'a string' })).toBeUndefined()
  })
})

describe('createJobEventsStore', () => {
  describe('ingest', () => {
    it('upserts by job id rather than accumulating duplicates', () => {
      const store = subscribedStore(null)

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
      const store = subscribedStore(null)
      const before = store.getSnapshot()

      store.ingest(buildJobFrame(buildVideoJob()))

      const after = store.getSnapshot()
      expect(after).not.toBe(before)
      expect(after.jobs).not.toBe(before.jobs)
      expect(before.jobs.size).toBe(0)
    })

    it('drops a malformed frame without throwing or notifying', () => {
      const store = subscribedStore(null)
      const listener = jest.fn()
      store.subscribe(listener, null)

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
      store.subscribe(first, null)
      store.subscribe(second, null)

      store.ingest(buildJobFrame(buildVideoJob()))

      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(1)
    })
  })

  describe('interest', () => {
    it('ignores a job no subscriber asked for instead of accumulating it', () => {
      const store = subscribedStore(new Set(['video-1']))

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
      const unsubscribe = store.subscribe(() => {}, new Set(['video-1']))
      store.subscribe(() => {}, new Set(['video-1']))

      unsubscribe()
      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(1)
    })

    it('stops accepting an id once the last interested subscriber leaves', () => {
      const store = createJobEventsStore()
      const unsubscribe = store.subscribe(() => {}, new Set(['video-1']))

      unsubscribe()
      store.ingest(buildJobFrame(buildVideoJob()))

      expect(store.getSnapshot().jobs.size).toBe(0)
    })

    it('accepts everything again once an unfiltered subscriber joins', () => {
      const store = createJobEventsStore()
      store.subscribe(() => {}, new Set(['video-1']))
      store.subscribe(() => {}, null)

      store.ingest(buildJobFrame(buildVideoJob({ id: 'some-other-job' })))

      expect(store.getSnapshot().jobs.size).toBe(1)
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
      store.subscribe(() => {}, null)
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
