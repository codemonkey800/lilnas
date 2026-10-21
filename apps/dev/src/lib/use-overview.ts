import { useCallback, useEffect, useRef, useState } from 'react'

import {
  EVENTS_URL,
  fetchOverview,
  type Overview,
  parseStacksEvent,
} from 'src/lib/api'

/** The stats (CPU, memory, reap estimates) change without a Docker event. */
export const POLL_MS = 10_000

export interface UseOverview {
  /** The last good answer. Kept while a later refetch fails. */
  overview: Overview | null
  /** Why the last fetch failed; `null` after a good one. */
  error: string | null
  refetch: () => void
}

/**
 * Loads `/api/stacks`, then keeps it current: refetch on every
 * `stacks-changed` event, on a 10 s poll while the tab is visible, when the
 * tab becomes visible again and when the event stream reconnects. Fetches
 * never overlap: one that arrives while another is in flight runs right
 * after it.
 */
export function useOverview(): UseOverview {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const queued = useRef(false)
  const alive = useRef(false)

  const load = useCallback(async function run(): Promise<void> {
    if (inFlight.current) {
      queued.current = true
      return
    }

    inFlight.current = true
    try {
      const next = await fetchOverview()
      if (alive.current) {
        setOverview(next)
        setError(null)
      }
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      inFlight.current = false
      if (queued.current) {
        queued.current = false
        if (alive.current) void run()
      }
    }
  }, [])

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

  return { overview, error, refetch: useCallback(() => void load(), [load]) }
}
