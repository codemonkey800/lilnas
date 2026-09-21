import type {
  DownloadJob,
  DownloadJobEvent,
} from '@lilnas/utils/download/types'
import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'

/**
 * Shared harness for the live-job-events specs — the fake socket, the socket
 * recorder and the job/frame builders. Lives under `__tests__/helpers/` so
 * neither Jest project collects it as a (zero-test) suite: the node project
 * excludes `**\/__tests__/helpers/**` explicitly, and the jsdom project only
 * matches `.tsx`.
 */

export const NOW_ISO = '2026-08-20T12:00:00.000Z'

export function buildVideoJob(
  overrides: Partial<DownloadJob> = {},
): DownloadJob {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    discordRequester: null,
    hiddenAttribution: false,
    id: 'video-1',
    linkedDiscord: null,
    media: {
      id: 'video:v1',
      sourceUrl: 'https://example.com/video',
      title: 'A video',
      type: DownloadType.Video,
    },
    requester: null,
    status: DownloadJobStatus.Pending,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

/** A well-formed gateway frame carrying `event`, as a JSON string. */
export function buildFrame(
  data: unknown,
  type: string = DOWNLOAD_JOB_EVENT_TYPE,
): string {
  return JSON.stringify({ data, type })
}

/** The common case: a frame announcing `job` with the given event type. */
export function buildJobFrame(
  job: DownloadJob,
  type: DownloadJobEventType = DownloadJobEventType.Updated,
): string {
  const event: DownloadJobEvent = { job, type }
  return buildFrame(event)
}

/**
 * Minimal in-memory stand-in for the browser's `WebSocket` — jsdom provides
 * none worth relying on. `emitOpen`/`emitMessage`/`emitClose` drive the
 * handlers the store registers, and `close()` mimics the real class's
 * behavior of eventually firing its own `close` event.
 */
export class FakeWebSocket {
  onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onopen: (() => void) | null = null

  closeCount = 0

  constructor(readonly url: string) {}

  close(): void {
    this.closeCount += 1
    this.emitClose()
  }

  emitClose(): void {
    this.onclose?.()
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data })
  }

  emitOpen(): void {
    this.onopen?.()
  }
}

export interface SocketRecorder {
  createSocket: (url: string) => WebSocket
  /**
   * The most recently created socket. Throws rather than returning
   * `undefined` (which `noUncheckedIndexedAccess` would otherwise force
   * every call site to narrow) so a spec asserting on a socket that was
   * never opened fails loudly.
   */
  latest: () => FakeWebSocket
  sockets: FakeWebSocket[]
}

export function createSocketRecorder(): SocketRecorder {
  const sockets: FakeWebSocket[] = []

  return {
    createSocket: url => {
      const socket = new FakeWebSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
    latest: () => {
      const socket = sockets.at(-1)
      if (!socket) throw new Error('Expected at least one socket to be created')
      return socket
    },
    sockets,
  }
}

/** Jitter source that leaves every backoff delay at its base value. */
export const NO_JITTER = (): number => 0.5

export const TEST_LOCATION = {
  host: 'download.lilnas.io',
  protocol: 'https:',
} as const
