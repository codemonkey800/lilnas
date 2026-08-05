import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEvent,
  isVideoDownloadJob,
  VideoDownloadJob,
} from '@lilnas/utils/download/types'
import { useEffect } from 'react'

// Fixed delay between a dropped connection and the next reconnect attempt.
// Matches the cadence of the interval-polling loop this hook replaces (1s) -
// this app has no auth/session concerns and a single lightweight backend, so
// a fixed delay (rather than exponential backoff) keeps this simple with no
// meaningful downside.
const RECONNECT_DELAY_MS = 1000

interface DownloadGatewayEnvelope {
  data?: unknown
  type: string
}

function isDownloadGatewayEnvelope(
  value: unknown,
): value is DownloadGatewayEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

function isDownloadJobEvent(value: unknown): value is DownloadJobEvent {
  return typeof value === 'object' && value !== null && 'job' in value
}

/**
 * Builds the same-origin WebSocket URL for the download gateway. Takes
 * `location` as a parameter (rather than reading `window.location` itself)
 * so it stays a pure function callable from tests without touching any
 * browser global. `next.config.js` rewrites `/ws/:path*` to the backend, so
 * this deliberately never needs a separate host/port.
 */
export function getDownloadSocketUrl(
  location: Pick<Location, 'host' | 'protocol'>,
): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws`
}

/**
 * Parses one raw WebSocket message from the download gateway and returns
 * the video job it describes, or `undefined` if the message doesn't
 * describe an update to the video job identified by `jobId` (wrong envelope
 * type, a movie/show job, malformed JSON, or some other job's event - the
 * gateway broadcasts every event to every client with no server-side
 * filtering, so this is the only place that narrows it back down).
 */
export function parseVideoJobMessage(
  rawData: unknown,
  jobId: string,
): VideoDownloadJob | undefined {
  if (typeof rawData !== 'string') return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(rawData)
  } catch {
    return undefined
  }

  if (!isDownloadGatewayEnvelope(parsed)) return undefined
  if (parsed.type !== DOWNLOAD_JOB_EVENT_TYPE) return undefined
  if (!isDownloadJobEvent(parsed.data)) return undefined
  if (!isVideoDownloadJob(parsed.data.job)) return undefined
  if (parsed.data.job.id !== jobId) return undefined

  return parsed.data.job
}

export interface StartDownloadJobSocketOptions {
  createSocket?: (url: string) => WebSocket
  jobId: string
  location?: Pick<Location, 'host' | 'protocol'>
  onJobUpdate: (job: VideoDownloadJob) => void
  reconnectDelayMs?: number
}

/**
 * Opens a WebSocket subscription for `jobId`'s events and keeps it alive.
 * Unlike `EventSource`, a native `WebSocket` never reconnects on its own
 * once closed (network blip, backend restart, etc.) - it stays closed
 * forever unless something explicitly opens a new instance. This opens a
 * fresh socket after every close, until the returned dispose function is
 * called.
 *
 * Framework-agnostic (no React) so it can be unit tested directly with a
 * fake `createSocket`/`location`, without mounting a component or touching
 * real browser globals. `useDownloadJobSocket` below is the thin React
 * wrapper production code actually calls.
 */
export function startDownloadJobSocket({
  createSocket = url => new WebSocket(url),
  jobId,
  location = window.location,
  onJobUpdate,
  reconnectDelayMs = RECONNECT_DELAY_MS,
}: StartDownloadJobSocketOptions): () => void {
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let socket: WebSocket | undefined

  function connect() {
    socket = createSocket(getDownloadSocketUrl(location))

    socket.onmessage = event => {
      if (stopped) return
      const job = parseVideoJobMessage(event.data, jobId)
      if (job) onJobUpdate(job)
    }

    // `error` is always immediately followed by `close` per the WebSocket
    // spec, so scheduling the reconnect only here (not also in `onerror`)
    // avoids double-scheduling a reconnect for the same failure.
    socket.onclose = () => {
      if (stopped) return
      reconnectTimer = setTimeout(connect, reconnectDelayMs)
    }
  }

  connect()

  return () => {
    stopped = true
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    socket?.close()
  }
}

/**
 * React wrapper around `startDownloadJobSocket`: one connection per mount
 * while `active` is true, torn down on unmount or whenever `active` becomes
 * false. Mirrors the gating of the `setInterval` polling loop this hook
 * replaces - e.g. a job that has already reached a terminal status has no
 * reason to hold a socket open.
 */
export function useDownloadJobSocket(
  jobId: string,
  active: boolean,
  onJobUpdate: (job: VideoDownloadJob) => void,
): void {
  useEffect(() => {
    if (!active) return

    return startDownloadJobSocket({ jobId, onJobUpdate })
  }, [active, jobId, onJobUpdate])
}
