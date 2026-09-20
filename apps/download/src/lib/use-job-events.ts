'use client'

import {
  DEFAULT_RECONNECT_DELAYS_MS,
  isDownloadGatewayMessage,
  jobEventsSocketUrl,
  parseJobEventFrame,
  RECONNECT_JITTER_RATIO,
  reconnectDelayMs,
} from '@lilnas/utils/download/job-events'
import type { DownloadJob } from '@lilnas/utils/download/types'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'

// Re-exported so every existing import site (this file used to define these
// itself) keeps working unchanged. The implementations now live in
// `@lilnas/utils/download/job-events`, shared with the websocket-job-waiting
// work — see that module for the reconnect-ladder, jitter and silent-frame-
// rejection rationale.
export {
  DEFAULT_RECONNECT_DELAYS_MS,
  isDownloadGatewayMessage,
  parseJobEventFrame,
  RECONNECT_JITTER_RATIO,
  reconnectDelayMs,
}

/**
 * What every consumer of the gateway sees: the jobs it asked about, keyed by
 * `job.id`, plus whether the live feed is actually live right now.
 *
 * `jobs` is a `ReadonlyMap` rather than a `Map` because the unfiltered mode
 * hands back the store's own snapshot map without copying it — mutating it
 * would corrupt every other subscriber's view. A `ReadonlyMap` is what a
 * `Map` is assignable *to*, so this is a strictly wider contract than
 * returning a `Map` would be.
 */
export interface JobEventsSnapshot {
  /**
   * `true` only while a socket is in the OPEN state. `false` during the very
   * first connect, for the whole of every backoff window, and after an
   * unmount. A page renders a "stale" marker off this rather than silently
   * showing figures that stopped updating minutes ago.
   */
  connected: boolean
  jobs: ReadonlyMap<string, DownloadJob>
}

/**
 * Which jobs a subscriber cares about.
 *
 * - `jobIds` **omitted** — every job the gateway broadcasts is accumulated.
 *   This is the activity feed's mode, and the only unfiltered consumer.
 * - `jobIds` **provided** — anything outside the list is dropped on arrival,
 *   never stored. This is the detail page's mode: one media's jobs.
 *
 * An empty `jobIds` array is a real filter meaning "nothing", not the same
 * as omitting the key.
 */
export interface JobEventsFilter {
  jobIds?: readonly string[]
}

/**
 * A subscriber's registered interest: the set of ids it wants, or `null` for
 * "everything". The store keeps the union of every live interest and drops
 * uninteresting frames at ingest, so a filtered page never accumulates the
 * broadcast traffic it is going to hide anyway.
 */
type JobInterest = ReadonlySet<string> | null

export interface CreateJobEventsStoreOptions {
  /**
   * Opens the underlying socket. Overridden in tests with an in-memory fake;
   * jsdom has no usable `WebSocket`.
   */
  createSocket?: (url: string) => WebSocket
  /** Backoff ladder override — see {@link DEFAULT_RECONNECT_DELAYS_MS}. */
  reconnectDelaysMs?: readonly number[]
  /** Source of the page origin. Defaults to `window.location`. */
  getLocation?: () => Pick<Location, 'host' | 'protocol'>
  /** Jitter source. Injected so a test gets a deterministic schedule. */
  random?: () => number
}

export interface JobEventsStore {
  /** Opens the socket and keeps it open; the returned function tears it down. */
  connect: () => () => void
  getSnapshot: () => JobEventsSnapshot
  /**
   * The raw message sink. Public so a test can drive the store without
   * standing up a socket at all; production only ever reaches it through
   * `connect()`'s `onmessage`.
   */
  ingest: (rawData: unknown) => void
  subscribe: (listener: () => void, interest: JobInterest) => () => void
}

/**
 * Builds the same-origin WebSocket URL for the download gateway.
 *
 * Takes `location` as a parameter rather than reading `window.location`
 * itself, so it stays a pure function callable from a test without touching
 * a browser global. `next.config.js` rewrites `/ws/:path*` to the backend, so
 * this deliberately never needs a separate host or port — behind Traefik the
 * page is HTTPS and this yields `wss:`, and in local dev over plain HTTP it
 * yields `ws:`.
 */
export function getJobEventsSocketUrl(
  location: Pick<Location, 'host' | 'protocol'>,
): string {
  return jobEventsSocketUrl('/api', location)
}

/**
 * The live job feed for one page: one socket, one job map, many subscribers.
 *
 * Deliberately framework-agnostic (no React) so the wire handling, the
 * interest bookkeeping and the backoff ladder are all unit-testable without
 * mounting anything. `JobEventsProvider` is the thin React wrapper that owns
 * one of these, and `useJobEvents` is how a component reads it.
 *
 * Snapshots are immutable: every change replaces both the snapshot object
 * and its `jobs` map, which is what lets a subscriber memoize on identity.
 * The store never evicts — its size is bounded by the jobs its subscribers
 * asked about, or, with an unfiltered subscriber, by what the gateway
 * broadcast while the page was open, which is the activity feed's whole
 * point.
 */
export function createJobEventsStore({
  createSocket = url => new WebSocket(url),
  getLocation = () => window.location,
  random = Math.random,
  reconnectDelaysMs = DEFAULT_RECONNECT_DELAYS_MS,
}: CreateJobEventsStoreOptions = {}): JobEventsStore {
  const listeners = new Set<() => void>()

  // The union of every live subscriber's interest, as a reference count per
  // id (an id two components both watch must survive one of them
  // unmounting). `unfilteredCount` is the same bookkeeping for the "give me
  // everything" subscribers, which no id-level count could express.
  const interestCounts = new Map<string, number>()
  let unfilteredCount = 0

  let snapshot: JobEventsSnapshot = { connected: false, jobs: new Map() }

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function isInteresting(jobId: string): boolean {
    return unfilteredCount > 0 || interestCounts.has(jobId)
  }

  function setConnected(connected: boolean): void {
    if (snapshot.connected === connected) return
    snapshot = { ...snapshot, connected }
    emit()
  }

  function ingest(rawData: unknown): void {
    const event = parseJobEventFrame(rawData)
    if (!event) return
    if (!isInteresting(event.job.id)) return

    const jobs = new Map(snapshot.jobs)
    jobs.set(event.job.id, event.job)
    snapshot = { ...snapshot, jobs }
    emit()
  }

  function subscribe(listener: () => void, interest: JobInterest): () => void {
    listeners.add(listener)

    if (interest === null) {
      unfilteredCount += 1
    } else {
      for (const id of interest) {
        interestCounts.set(id, (interestCounts.get(id) ?? 0) + 1)
      }
    }

    return () => {
      listeners.delete(listener)

      if (interest === null) {
        unfilteredCount -= 1
        return
      }

      for (const id of interest) {
        const next = (interestCounts.get(id) ?? 1) - 1
        if (next > 0) interestCounts.set(id, next)
        else interestCounts.delete(id)
      }
    }
  }

  function connect(): () => void {
    let disposed = false
    let attempt = 0
    let socket: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    function scheduleReconnect(): void {
      if (disposed) return
      const delay = reconnectDelayMs(attempt, reconnectDelaysMs, random)
      attempt += 1
      reconnectTimer = setTimeout(open, delay)
    }

    function open(): void {
      if (disposed) return

      let next: WebSocket
      try {
        next = createSocket(getJobEventsSocketUrl(getLocation()))
      } catch {
        // No `WebSocket` global, a URL the runtime refuses — treat it as a
        // failed attempt rather than letting it escape into the effect that
        // called `connect()`.
        scheduleReconnect()
        return
      }

      socket = next

      next.onopen = () => {
        if (disposed) return
        attempt = 0
        setConnected(true)
      }

      next.onmessage = event => {
        if (disposed) return
        ingest(event.data)
      }

      // Per the WebSocket spec an `error` is always followed by a `close`,
      // so scheduling the reconnect only here (and not also in `onerror`)
      // cannot double-schedule for a single failure. A native socket never
      // reopens itself — once closed it stays closed forever unless
      // something explicitly builds a new one, which is this.
      next.onclose = () => {
        if (disposed) return
        setConnected(false)
        scheduleReconnect()
      }
    }

    open()

    return () => {
      disposed = true
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      socket?.close()
      socket = undefined
      setConnected(false)
    }
  }

  return {
    connect,
    getSnapshot: () => snapshot,
    ingest,
    subscribe,
  }
}

/**
 * The store for the current subtree. `undefined` means no
 * `<JobEventsProvider>` above us — see `useJobEvents` for why that throws
 * rather than quietly opening a socket of its own.
 */
export const JobEventsContext = createContext<JobEventsStore | undefined>(
  undefined,
)

function useJobEventsStore(): JobEventsStore {
  const store = useContext(JobEventsContext)

  if (!store) {
    throw new Error(
      'useJobEvents() must be called inside a <JobEventsProvider>',
    )
  }

  return store
}

/**
 * Subscribes to live job events for the current page.
 *
 * Requires a `<JobEventsProvider>` ancestor and throws without one, matching
 * `Tabs`/`Tab`, `Menu`/`MenuItem` and `ReasonGroup`/`Reason`. The provider is
 * what owns the socket, so a silent fallback would mean every extra call site
 * quietly opened another connection — a defect that looks like nothing at all
 * in dev and doubles the gateway's client count in production. Making the
 * provider structural also keeps a page that wants no live updates from
 * opening a socket by accident.
 *
 * ```tsx
 * // Activity feed — unfiltered: every job the gateway broadcasts.
 * const { connected, jobs } = useJobEvents()
 *
 * // Detail page — only this media's jobs; everything else is dropped on
 * // arrival. The inline array is safe: the interest is keyed on the ids it
 * // contains, not on the array's identity.
 * const { connected, jobs } = useJobEvents({ jobIds: media.jobs.map(j => j.id) })
 * ```
 */
export function useJobEvents(filter?: JobEventsFilter): JobEventsSnapshot {
  const store = useJobEventsStore()
  const jobIds = filter?.jobIds

  // A call site writing `useJobEvents({ jobIds: [a, b] })` allocates a fresh
  // array on every render. Keying the interest on the *contents* (sorted, so
  // reordering is not a change either) is what stops that from re-running
  // the subscription effect on every render — and, because the socket lives
  // in the provider rather than in this hook, no amount of interest churn
  // can tear the connection down regardless.
  const interestKey =
    jobIds === undefined ? null : JSON.stringify([...jobIds].sort())

  const interest = useMemo<JobInterest>(
    () =>
      interestKey === null
        ? null
        : new Set(JSON.parse(interestKey) as string[]),
    [interestKey],
  )

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener, interest),
    [interest, store],
  )

  // `useSyncExternalStore` rather than `useState` + `useEffect`: this repo's
  // lint rejects a synchronous `setState` in an effect, and an external
  // mutable source is exactly what this hook is for. The server snapshot is
  // the same initial (empty, disconnected) one the client starts from, so a
  // server render and the hydrating render agree.
  const snapshot = useSyncExternalStore(
    subscribe,
    store.getSnapshot,
    store.getSnapshot,
  )

  const jobs = useMemo<ReadonlyMap<string, DownloadJob>>(() => {
    if (interest === null) return snapshot.jobs

    const filtered = new Map<string, DownloadJob>()
    for (const id of interest) {
      const job = snapshot.jobs.get(id)
      if (job) filtered.set(id, job)
    }
    return filtered
  }, [interest, snapshot])

  return { connected: snapshot.connected, jobs }
}
