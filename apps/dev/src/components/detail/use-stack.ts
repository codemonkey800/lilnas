import { useCallback, useEffect, useRef, useState } from 'react'

import {
  ApiError,
  EVENTS_URL,
  parseStacksEvent,
  stackUrl,
  type StackView,
} from 'src/lib/api'
import { POLL_MS } from 'src/lib/use-overview'

export interface UseStack {
  /** The last good answer. Kept while a later refetch fails. */
  stack: StackView | null
  /** The API says there is no such stack (404). */
  notFound: boolean
  /** Why the last fetch failed; `null` after a good one. */
  error: string | null
  refetch: () => void
}

async function fetchStack(id: string): Promise<StackView> {
  const res = await fetch(stackUrl(id), { cache: 'no-store' })
  if (!res.ok) {
    let message = `GET /stacks/:id answered ${res.status}`
    try {
      const body = (await res.json()) as { message?: unknown }
      if (typeof body.message === 'string' && body.message) {
        message = body.message
      }
    } catch {
      // keep the status line
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as StackView
}

/**
 * Loads `/api/stacks/:id` and keeps it current: refetch on every
 * `stacks-changed` event, every 10 s while the tab is visible, when the tab
 * becomes visible again and when the event stream reconnects. Fetches never
 * overlap; one that arrives mid-flight runs right after it.
 */
export function useStack(id: string): UseStack {
  const [stack, setStack] = useState<StackView | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const queued = useRef(false)
  const alive = useRef(false)

  const load = useCallback(
    async function run(): Promise<void> {
      if (inFlight.current) {
        queued.current = true
        return
      }

      inFlight.current = true
      try {
        const next = await fetchStack(id)
        if (alive.current) {
          setStack(next)
          setNotFound(false)
          setError(null)
        }
      } catch (err) {
        if (alive.current) {
          if (err instanceof ApiError && err.status === 404) {
            setStack(null)
            setNotFound(true)
            setError(null)
          } else {
            setError(err instanceof Error ? err.message : String(err))
          }
        }
      } finally {
        inFlight.current = false
        if (queued.current) {
          queued.current = false
          if (alive.current) void run()
        }
      }
    },
    [id],
  )

  useEffect(() => {
    alive.current = true
    // Fetch-on-mount: `load` sets state only after its await resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()

    const visible = () => document.visibilityState === 'visible'
    const source = new EventSource(EVENTS_URL)
    let opened = false

    // The first open is the connection we just made; later ones are
    // reconnects, and anything that happened in between was missed.
    source.onopen = () => {
      if (opened) void load()
      opened = true
    }
    source.onmessage = event => {
      if (parseStacksEvent(event.data)?.type === 'stacks-changed') void load()
    }

    const timer = setInterval(() => {
      if (visible()) void load()
    }, POLL_MS)
    const onVisibility = () => {
      if (visible()) void load()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      alive.current = false
      source.close()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  return {
    stack,
    notFound,
    error,
    refetch: useCallback(() => void load(), [load]),
  }
}
