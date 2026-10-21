import { useCallback, useEffect, useRef, useState } from 'react'

import { API_BASE } from 'src/lib/api'

/** The viewer keeps this many lines; older ones are dropped as new arrive. */
export const BUFFER_CAP = 5000

/** Wait this long before reopening a dropped stream. */
export const RECONNECT_MS = 2000

/** Lines arriving within this window are applied in one render. */
export const FLUSH_MS = 50

export type TailChoice = 100 | 500 | 2000

export const TAIL_CHOICES: readonly TailChoice[] = [100, 500, 2000]

export interface LogEntry {
  id: number
  stream: 'stdout' | 'stderr'
  text: string
  /** ISO time from Docker; only present when timestamps were asked for. */
  ts?: string
}

export type LogStatus = 'connecting' | 'live' | 'reconnecting' | 'ended'

export interface UseContainerLogs {
  lines: LogEntry[]
  status: LogStatus
  clear: () => void
}

/** `/api/containers/:name/logs?tail=&timestamps=`, the SSE endpoint. */
export function logsUrl(
  container: string,
  tail: number,
  timestamps: boolean,
): string {
  const query = new URLSearchParams({
    tail: String(tail),
    timestamps: timestamps ? '1' : '0',
  })
  return `${API_BASE}/containers/${encodeURIComponent(container)}/logs?${query}`
}

function parseLine(data: unknown): Omit<LogEntry, 'id'> | null {
  if (typeof data !== 'string') return null
  try {
    const raw = JSON.parse(data) as Partial<Omit<LogEntry, 'id'>>
    if (typeof raw.text !== 'string') return null
    return {
      stream: raw.stream === 'stderr' ? 'stderr' : 'stdout',
      text: raw.text,
      ts: typeof raw.ts === 'string' ? raw.ts : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Follows one container's logs. Changing `container`, `tail` or `timestamps`
 * closes the stream and opens a new one with an empty buffer.
 *
 * `EventSource` would reconnect by itself, but the endpoint replays the tail
 * on every connection, so that would print the same lines twice. Instead an
 * error closes the stream, flags `reconnecting`, and reopens it after
 * `RECONNECT_MS`; the first line of the new connection replaces the buffer,
 * which the replayed tail then refills.
 *
 * A container that isn't `running` has nothing to follow: Docker closes the
 * stream once the tail is sent. That end is final (`ended`), not a drop, so
 * it doesn't reconnect; it reopens if `running` turns true.
 */
export function useContainerLogs(
  container: string | undefined,
  tail: number,
  timestamps: boolean,
  running = true,
): UseContainerLogs {
  const [lines, setLines] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<LogStatus>('connecting')
  const pending = useRef<LogEntry[]>([])
  const replace = useRef(false)

  const clear = useCallback(() => {
    pending.current = []
    replace.current = false
    setLines([])
  }, [])

  useEffect(() => {
    pending.current = []
    replace.current = false
    // A new stream starts from an empty buffer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines([])
    setStatus('connecting')
    if (!container) return

    let source: EventSource | null = null
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let flush: ReturnType<typeof setTimeout> | undefined
    let nextId = 0
    let fresh = true

    const apply = () => {
      flush = undefined
      const batch = pending.current
      if (batch.length === 0) return
      pending.current = []
      const replacing = replace.current
      replace.current = false
      setLines(prev => {
        const next = replacing ? batch : prev.concat(batch)
        return next.length > BUFFER_CAP ? next.slice(-BUFFER_CAP) : next
      })
    }

    const open = () => {
      const stream = new EventSource(logsUrl(container, tail, timestamps))
      source = stream
      // A reconnect's first line replaces whatever is still on screen.
      let first = !fresh
      fresh = false

      stream.onopen = () => setStatus('live')
      stream.onmessage = event => {
        const line = parseLine(event.data)
        if (!line) return
        if (first) {
          first = false
          pending.current = []
          replace.current = true
        }
        pending.current.push({ id: nextId++, ...line })
        flush ??= setTimeout(apply, FLUSH_MS)
      }
      stream.onerror = () => {
        stream.close()
        if (!running) {
          setStatus('ended')
          return
        }
        setStatus('reconnecting')
        reconnect = setTimeout(open, RECONNECT_MS)
      }
    }

    open()

    return () => {
      source?.close()
      clearTimeout(reconnect)
      clearTimeout(flush)
    }
  }, [container, tail, timestamps, running])

  return { lines, status, clear }
}
