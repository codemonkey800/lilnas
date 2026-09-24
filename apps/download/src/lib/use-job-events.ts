'use client'

import {
  DEFAULT_RECONNECT_DELAYS_MS,
  isDownloadGatewayMessage,
  jobEventsSocketUrl,
  parseJobEventFrame,
  parseMediaEventFrame,
  RECONNECT_JITTER_RATIO,
  reconnectDelayMs,
} from '@lilnas/utils/download/job-events'
import {
  type DownloadJob,
  MAX_WATCHED_MEDIA_IDS,
  type MediaEvent,
  WATCH_MEDIA_EVENT,
  type WatchMediaMessage,
} from '@lilnas/utils/download/types'
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
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
 * What `useMediaEvents` hands back: the latest media frame for each media id
 * it asked about, keyed by `media.id`, plus the same `connected` flag as
 * {@link JobEventsSnapshot}.
 */
export interface MediaEventsSnapshot {
  connected: boolean
  media: ReadonlyMap<string, MediaEvent>
}

/**
 * The store's own snapshot — both maps off the one socket. Consumers never
 * see it whole: `useJobEvents` and `useMediaEvents` each project their half.
 */
export interface JobEventsStoreSnapshot extends JobEventsSnapshot {
  /** The latest `MediaEvent` per `media.id`, replaced wholesale per frame. */
  media: ReadonlyMap<string, MediaEvent>
}

/**
 * Which jobs a subscriber cares about.
 *
 * - **Both keys omitted** — every job the gateway broadcasts is accumulated.
 *   This is the activity feed's mode, and the only unfiltered consumer.
 * - **Either key provided** — a job is kept if its `job.id` is in `jobIds`
 *   **or** its `job.media.id` is in `mediaIds`; anything else is dropped on
 *   arrival, never stored. This is the detail page's mode: one media's jobs,
 *   including one this tab never knew about (a download started from
 *   Discord or another tab reaches the page by its media id).
 *
 * An empty array is a real filter meaning "nothing", not the same as
 * omitting the key — and once either key is given, the omitted one means
 * "nothing" too.
 */
export interface JobEventsFilter {
  jobIds?: readonly string[]
  mediaIds?: readonly string[]
}

/** Which media a `useMediaEvents` subscriber cares about. Empty is "nothing". */
export interface MediaEventsFilter {
  mediaIds: readonly string[]
  /**
   * Also asks the gateway to re-read these titles' library entries every
   * second rather than every minute (see `WATCH_MEDIA_EVENT`) - for a detail
   * page, where the title is the whole screen. A page listing many titles
   * leaves it off: each watched id costs an upstream call a second.
   */
  watch?: boolean
}

/**
 * A subscriber's registered interest. The store keeps the union of every
 * live interest and drops uninteresting frames at ingest, so a filtered page
 * never accumulates the broadcast traffic it is going to hide anyway. An
 * omitted set means "nothing".
 *
 * Media ids are tracked as **two** interests, not one shared set: a job
 * filter's `mediaIds` (`jobMediaIds` here) only ever admit *job* frames, and
 * a `useMediaEvents` subscriber's `mediaIds` only ever admit *media* frames.
 * One shared set would make a job-only page quietly store every media frame
 * for its title (and a media-only one every job frame), which no subscriber
 * would ever read.
 */
export interface JobEventsInterest {
  /** Every job frame, whatever its ids — the activity feed. */
  allJobs?: boolean
  /** Job frames kept by `job.id`. */
  jobIds?: ReadonlySet<string>
  /** Job frames kept by `job.media.id`. */
  jobMediaIds?: ReadonlySet<string>
  /** Media frames kept by `media.id`. */
  mediaIds?: ReadonlySet<string>
  /**
   * Media ids the gateway is asked to watch closely - see
   * {@link MediaEventsFilter.watch}. Admits no frames of its own.
   */
  watchMediaIds?: ReadonlySet<string>
}

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
  getSnapshot: () => JobEventsStoreSnapshot
  /**
   * Forgets the media frame held for `mediaId`, so a subscriber falls back to
   * its served copy. See {@link useServedMedia}.
   */
  dropMedia: (mediaId: string) => void
  /**
   * The raw message sink. Public so a test can drive the store without
   * standing up a socket at all; production only ever reaches it through
   * `connect()`'s `onmessage`.
   */
  ingest: (rawData: unknown) => void
  subscribe: (listener: () => void, interest: JobEventsInterest) => () => void
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

/** Adds one reference per id — see the interest bookkeeping below. */
function retain(counts: Map<string, number>, ids?: ReadonlySet<string>): void {
  if (!ids) return
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
}

/** Drops one reference per id, forgetting an id at zero. */
function release(counts: Map<string, number>, ids?: ReadonlySet<string>): void {
  if (!ids) return
  for (const id of ids) {
    const next = (counts.get(id) ?? 1) - 1
    if (next > 0) counts.set(id, next)
    else counts.delete(id)
  }
}

/**
 * The live feed for one page: one socket, two maps (jobs by `job.id`, media
 * frames by `media.id`), many subscribers.
 *
 * Deliberately framework-agnostic (no React) so the wire handling, the
 * interest bookkeeping and the backoff ladder are all unit-testable without
 * mounting anything. `JobEventsProvider` is the thin React wrapper that owns
 * one of these, and `useJobEvents`/`useMediaEvents` are how a component reads
 * it.
 *
 * Snapshots are immutable: every change replaces the snapshot object and the
 * one map that changed — a job frame replaces `jobs` and leaves `media`'s
 * identity alone, and vice versa — which is what lets a subscriber memoize
 * on identity. The store never evicts — its size is bounded by the ids its
 * subscribers asked about, or, with an unfiltered subscriber, by what the
 * gateway broadcast while the page was open, which is the activity feed's
 * whole point.
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
  // unmounting) — one count per kind of interest, see `JobEventsInterest`
  // for why media ids get two. `unfilteredCount` is the same bookkeeping for
  // the "every job" subscribers, which no id-level count could express.
  const jobIdCounts = new Map<string, number>()
  const jobMediaIdCounts = new Map<string, number>()
  const mediaIdCounts = new Map<string, number>()
  const watchIdCounts = new Map<string, number>()
  let unfilteredCount = 0

  // The open socket, and the watch list the gateway last heard from it, so a
  // subscription change sends only when the list actually moved.
  let openSocket: WebSocket | undefined
  let sentWatchKey = '[]'

  let snapshot: JobEventsStoreSnapshot = {
    connected: false,
    jobs: new Map(),
    media: new Map(),
  }

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function isJobInteresting(job: DownloadJob): boolean {
    return (
      unfilteredCount > 0 ||
      jobIdCounts.has(job.id) ||
      jobMediaIdCounts.has(job.media.id)
    )
  }

  /**
   * Tells the gateway which titles to watch closely, when that list changed
   * since it last heard. A closed socket sends nothing: the gateway forgets a
   * socket's list with it, and `onopen` re-sends the whole list.
   */
  function syncWatch(): void {
    if (!openSocket) return

    const mediaIds = [...watchIdCounts.keys()]
      .sort()
      .slice(0, MAX_WATCHED_MEDIA_IDS)
    const key = JSON.stringify(mediaIds)
    if (key === sentWatchKey) return

    const message: WatchMediaMessage = {
      data: { mediaIds },
      event: WATCH_MEDIA_EVENT,
    }
    openSocket.send(JSON.stringify(message))
    sentWatchKey = key
  }

  function dropMedia(mediaId: string): void {
    if (!snapshot.media.has(mediaId)) return

    const media = new Map(snapshot.media)
    media.delete(mediaId)
    snapshot = { ...snapshot, media }
    emit()
  }

  function setConnected(connected: boolean): void {
    if (snapshot.connected === connected) return
    snapshot = { ...snapshot, connected }
    emit()
  }

  function ingest(rawData: unknown): void {
    const jobEvent = parseJobEventFrame(rawData)
    if (jobEvent) {
      if (!isJobInteresting(jobEvent.job)) return

      const jobs = new Map(snapshot.jobs)
      jobs.set(jobEvent.job.id, jobEvent.job)
      snapshot = { ...snapshot, jobs }
      emit()
      return
    }

    const mediaEvent = parseMediaEventFrame(rawData)
    if (!mediaEvent) return
    if (!mediaIdCounts.has(mediaEvent.media.id)) return

    const media = new Map(snapshot.media)
    media.set(mediaEvent.media.id, mediaEvent)
    snapshot = { ...snapshot, media }
    emit()
  }

  function subscribe(
    listener: () => void,
    interest: JobEventsInterest,
  ): () => void {
    listeners.add(listener)

    if (interest.allJobs) unfilteredCount += 1
    retain(jobIdCounts, interest.jobIds)
    retain(jobMediaIdCounts, interest.jobMediaIds)
    retain(mediaIdCounts, interest.mediaIds)
    retain(watchIdCounts, interest.watchMediaIds)
    syncWatch()

    return () => {
      listeners.delete(listener)

      if (interest.allJobs) unfilteredCount -= 1
      release(jobIdCounts, interest.jobIds)
      release(jobMediaIdCounts, interest.jobMediaIds)
      release(mediaIdCounts, interest.mediaIds)
      release(watchIdCounts, interest.watchMediaIds)
      syncWatch()
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
        // A new connection starts with an empty watch list on the gateway.
        openSocket = next
        sentWatchKey = '[]'
        syncWatch()
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
        if (openSocket === next) openSocket = undefined
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
      openSocket = undefined
      setConnected(false)
    }
  }

  return {
    connect,
    dropMedia,
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

function useJobEventsStore(hookName: string): JobEventsStore {
  const store = useContext(JobEventsContext)

  if (!store) {
    throw new Error(`${hookName}() must be called inside a <JobEventsProvider>`)
  }

  return store
}

/**
 * Keys an id list on its *contents*. A call site writing
 * `useJobEvents({ jobIds: [a, b] })` allocates a fresh array on every render;
 * keying the interest on the sorted ids (so reordering is not a change
 * either) is what stops that from re-running the subscription effect on
 * every render — and, because the socket lives in the provider rather than
 * in these hooks, no amount of interest churn can tear the connection down
 * regardless.
 */
function idsKey(ids: readonly string[] | undefined): string[] {
  return ids === undefined ? [] : [...ids].sort()
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
 * // Detail page — this media's jobs, known or not; everything else is
 * // dropped on arrival. The inline arrays are safe: the interest is keyed on
 * // the ids they contain, not on the arrays' identity.
 * const { connected, jobs } = useJobEvents({
 *   jobIds: media.jobs.map(j => j.id),
 *   mediaIds: [media.id],
 * })
 * ```
 */
export function useJobEvents(filter?: JobEventsFilter): JobEventsSnapshot {
  const store = useJobEventsStore('useJobEvents')
  const unfiltered =
    filter?.jobIds === undefined && filter?.mediaIds === undefined

  const interestKey = unfiltered
    ? null
    : JSON.stringify([idsKey(filter?.jobIds), idsKey(filter?.mediaIds)])

  const interest = useMemo<JobEventsInterest>(() => {
    if (interestKey === null) return { allJobs: true }

    const [jobIds, mediaIds] = JSON.parse(interestKey) as [string[], string[]]
    return { jobIds: new Set(jobIds), jobMediaIds: new Set(mediaIds) }
  }, [interestKey])

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

  // Keyed on `snapshot.jobs`, not the whole snapshot: a media frame replaces
  // the snapshot but not its `jobs`, and must not hand callers a new map.
  const allJobs = snapshot.jobs
  const jobs = useMemo<ReadonlyMap<string, DownloadJob>>(() => {
    if (interest.allJobs) return allJobs

    const filtered = new Map<string, DownloadJob>()
    for (const [id, job] of allJobs) {
      if (interest.jobIds?.has(id) || interest.jobMediaIds?.has(job.media.id)) {
        filtered.set(id, job)
      }
    }
    return filtered
  }, [allJobs, interest])

  return { connected: snapshot.connected, jobs }
}

/**
 * A `getSnapshot` for `useSyncExternalStore` that projects the store down to
 * `mediaIds` and returns the **previous object** whenever that projection is
 * unchanged — a job frame, or a media frame for some other subscriber's id,
 * leaves the result identical, so React skips the re-render outright.
 * Identity is compared per entry: the store replaces a `MediaEvent` only
 * when a frame for it lands.
 */
function createMediaSelector(
  store: JobEventsStore,
  mediaIds: ReadonlySet<string>,
): () => MediaEventsSnapshot {
  let source: JobEventsStoreSnapshot | undefined
  let selected: MediaEventsSnapshot | undefined

  return () => {
    const next = store.getSnapshot()
    if (selected && next === source) return selected
    source = next

    const media = new Map<string, MediaEvent>()
    for (const id of mediaIds) {
      const event = next.media.get(id)
      if (event) media.set(id, event)
    }

    const previous = selected?.media
    const mediaUnchanged =
      previous !== undefined &&
      previous.size === media.size &&
      [...media].every(([id, event]) => previous.get(id) === event)

    if (selected && mediaUnchanged && selected.connected === next.connected) {
      return selected
    }

    selected = {
      connected: next.connected,
      media: mediaUnchanged && previous ? previous : media,
    }
    return selected
  }
}

/**
 * Subscribes to live media frames — each media's derived state, pushed by
 * the poller and alongside every video job event — for the given media ids.
 * The same socket and provider as {@link useJobEvents}, and the same
 * requirement to sit under a `<JobEventsProvider>`.
 *
 * `media` holds the latest `MediaEvent` per requested id that has arrived
 * since mount; an id with no frame yet is simply absent, and the caller
 * falls back to its server-rendered media. Frames for any other id are never
 * stored, and the returned object keeps its identity until one of *these*
 * ids gets a frame (or `connected` flips).
 *
 * ```tsx
 * const { connected, media } = useMediaEvents({ mediaIds: [movie.id] })
 * const live = media.get(movie.id)?.media ?? movie
 * ```
 */
export function useMediaEvents(filter: MediaEventsFilter): MediaEventsSnapshot {
  const store = useJobEventsStore('useMediaEvents')
  const interestKey = JSON.stringify(idsKey(filter.mediaIds))
  const watch = filter.watch ?? false

  const mediaIds = useMemo<ReadonlySet<string>>(
    () => new Set(JSON.parse(interestKey) as string[]),
    [interestKey],
  )

  const subscribe = useCallback(
    (listener: () => void) =>
      store.subscribe(listener, {
        mediaIds,
        ...(watch ? { watchMediaIds: mediaIds } : {}),
      }),
    [mediaIds, store, watch],
  )

  // Memoized per id set so the selector's cache survives re-renders; were
  // React to drop it, the cost is one extra render, never a loop.
  const getSnapshot = useMemo(
    () => createMediaSelector(store, mediaIds),
    [mediaIds, store],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Drops the live frame held for `mediaId` whenever the server hands over a
 * new copy of it (`served` changes identity - a `router.refresh()`, or a
 * server action's `revalidatePath` after a delete). Without this the older
 * frame keeps winning over the fresher server copy until the next frame
 * lands: a page that just deleted its movie would still read "in library".
 *
 * A layout effect, so the drop - and the re-render back to `served` - lands
 * before the browser paints the stale frame over the new copy. Nothing on the
 * wire can arrive between the render and this effect.
 */
export function useServedMedia(mediaId: string, served: unknown): void {
  const store = useJobEventsStore('useServedMedia')

  useLayoutEffect(() => {
    store.dropMedia(mediaId)
  }, [mediaId, served, store])
}
