import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
  MovieDownloadJob,
  VideoDownloadJob,
} from '@lilnas/utils/download/types'

import {
  getDownloadSocketUrl,
  parseVideoJobMessage,
  startDownloadJobSocket,
} from 'src/components/use-download-job-socket'

function buildVideoJob(
  overrides: Partial<VideoDownloadJob> = {},
): VideoDownloadJob {
  return {
    id: 'video-1',
    status: DownloadJobStatus.Pending,
    type: DownloadType.Video,
    url: 'https://example.com/video',
    ...overrides,
  }
}

function buildEnvelope(data: unknown, type = DOWNLOAD_JOB_EVENT_TYPE) {
  return JSON.stringify({ data, type })
}

/**
 * Minimal in-memory stand-in for the browser's `WebSocket`, controllable
 * from tests: `emitMessage`/`emitClose` let a test drive the handlers that
 * `startDownloadJobSocket` registers, and `close()` mimics the real
 * class's behavior of eventually firing its own `close` event.
 */
class FakeWebSocket {
  onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(readonly url: string) {}

  close() {
    this.emitClose()
  }

  emitClose() {
    this.onclose?.()
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data })
  }
}

/**
 * `noUncheckedIndexedAccess` makes `sockets[n]` a possibly-`undefined` type,
 * which is technically correct but adds noise to every assertion below -
 * this narrows once, failing loudly (rather than with a TS error) if a test
 * asserts on a socket that was never created.
 */
function mostRecentSocket(sockets: FakeWebSocket[]): FakeWebSocket {
  const socket = sockets.at(-1)
  if (!socket) throw new Error('Expected at least one socket to be created')
  return socket
}

describe('getDownloadSocketUrl', () => {
  it('uses wss when the page is served over https', () => {
    expect(
      getDownloadSocketUrl({ host: 'download.lilnas.io', protocol: 'https:' }),
    ).toBe('wss://download.lilnas.io/ws')
  })

  it('uses ws when the page is not served over https', () => {
    expect(
      getDownloadSocketUrl({ host: 'localhost:8080', protocol: 'http:' }),
    ).toBe('ws://localhost:8080/ws')
  })
})

describe('parseVideoJobMessage', () => {
  it('returns the job for a matching video job event', () => {
    const job = buildVideoJob({ status: DownloadJobStatus.Downloading })
    const event: DownloadJobEvent = { job, type: DownloadJobEventType.Updated }

    expect(parseVideoJobMessage(buildEnvelope(event), 'video-1')).toEqual(job)
  })

  it('returns undefined when the outer envelope type does not match', () => {
    const event: DownloadJobEvent = {
      job: buildVideoJob(),
      type: DownloadJobEventType.Updated,
    }

    expect(
      parseVideoJobMessage(buildEnvelope(event, 'some-other-type'), 'video-1'),
    ).toBeUndefined()
  })

  it('returns undefined for a movie job event', () => {
    const movieJob: MovieDownloadJob = {
      id: 'video-1',
      status: DownloadJobStatus.Pending,
      type: DownloadType.Movie,
      url: 'https://example.com/movie',
    }
    const event = { job: movieJob, type: DownloadJobEventType.Updated }

    expect(
      parseVideoJobMessage(buildEnvelope(event), 'video-1'),
    ).toBeUndefined()
  })

  it("returns undefined for a different job's event", () => {
    const event: DownloadJobEvent = {
      job: buildVideoJob({ id: 'some-other-job' }),
      type: DownloadJobEventType.Updated,
    }

    expect(
      parseVideoJobMessage(buildEnvelope(event), 'video-1'),
    ).toBeUndefined()
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseVideoJobMessage('{not json', 'video-1')).toBeUndefined()
  })

  it('returns undefined when the envelope has no data', () => {
    expect(
      parseVideoJobMessage(
        JSON.stringify({ type: DOWNLOAD_JOB_EVENT_TYPE }),
        'video-1',
      ),
    ).toBeUndefined()
  })

  it('returns undefined for non-string message data', () => {
    expect(parseVideoJobMessage({ not: 'a string' }, 'video-1')).toBeUndefined()
  })
})

describe('startDownloadJobSocket', () => {
  const location = { host: 'download.lilnas.io', protocol: 'https:' }

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('opens a socket at the same-origin /ws URL', () => {
    const sockets: FakeWebSocket[] = []

    const stop = startDownloadJobSocket({
      createSocket: url => {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      jobId: 'video-1',
      location,
      onJobUpdate: jest.fn(),
    })

    expect(sockets).toHaveLength(1)
    expect(mostRecentSocket(sockets).url).toBe('wss://download.lilnas.io/ws')

    stop()
  })

  it('invokes onJobUpdate only for a matching video job message', () => {
    const sockets: FakeWebSocket[] = []
    const onJobUpdate = jest.fn()

    const stop = startDownloadJobSocket({
      createSocket: url => {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      jobId: 'video-1',
      location,
      onJobUpdate,
    })

    const job = buildVideoJob({ status: DownloadJobStatus.Completed })
    const event: DownloadJobEvent = { job, type: DownloadJobEventType.Updated }
    mostRecentSocket(sockets).emitMessage(buildEnvelope(event))

    expect(onJobUpdate).toHaveBeenCalledTimes(1)
    expect(onJobUpdate).toHaveBeenCalledWith(job)

    const otherJobEvent: DownloadJobEvent = {
      job: buildVideoJob({ id: 'some-other-job' }),
      type: DownloadJobEventType.Updated,
    }
    mostRecentSocket(sockets).emitMessage(buildEnvelope(otherJobEvent))

    expect(onJobUpdate).toHaveBeenCalledTimes(1)

    stop()
  })

  it('reconnects with a fresh socket after the current one closes', () => {
    const sockets: FakeWebSocket[] = []

    const stop = startDownloadJobSocket({
      createSocket: url => {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      jobId: 'video-1',
      location,
      onJobUpdate: jest.fn(),
      reconnectDelayMs: 1000,
    })

    expect(sockets).toHaveLength(1)

    mostRecentSocket(sockets).emitClose()
    expect(sockets).toHaveLength(1) // not yet - reconnect is delayed

    jest.advanceTimersByTime(999)
    expect(sockets).toHaveLength(1)

    jest.advanceTimersByTime(1)
    expect(sockets).toHaveLength(2)

    stop()
  })

  it('stops reconnecting once disposed', () => {
    const sockets: FakeWebSocket[] = []

    const stop = startDownloadJobSocket({
      createSocket: url => {
        const socket = new FakeWebSocket(url)
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      jobId: 'video-1',
      location,
      onJobUpdate: jest.fn(),
      reconnectDelayMs: 1000,
    })

    mostRecentSocket(sockets).emitClose()
    stop()

    jest.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(1)
  })

  it('disposing closes the current socket', () => {
    const sockets: FakeWebSocket[] = []
    const closeSpy = jest.fn()

    const stop = startDownloadJobSocket({
      createSocket: url => {
        const socket = new FakeWebSocket(url)
        socket.close = closeSpy
        sockets.push(socket)
        return socket as unknown as WebSocket
      },
      jobId: 'video-1',
      location,
      onJobUpdate: jest.fn(),
    })

    stop()

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})
