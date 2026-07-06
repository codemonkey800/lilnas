'use client'

import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { LogRow, ROW_PX } from 'src/app/logs/log-row'
import type {
  LogLine,
  LogStream,
  LogWindowDirection,
  LogWindowResponse,
} from 'src/logging/log-view.types'

// Comfortably more than any realistic viewport + overscan (a 1080p screen at
// ROW_PX=24 shows ~45 rows; OVERSCAN adds ~24 more either side) so eviction
// never touches a row that is still visible or about to scroll into view.
// Generous rather than tight — the cost of holding a few thousand LogLine
// objects (small, flat records) is negligible next to the point of this
// unit (bounding memory against an unbounded FILE, not against a handful of
// extra in-memory rows).
export const EVICTION_CAP = 1500

// react-virtual's own recommendation for a smoothly-scrolling fixed-height
// list; also generous headroom for the edge-detection threshold below (an
// edge fetch fires before the user has scrolled INTO the overscanned rows,
// not after).
export const OVERSCAN = 12

// How close (in loaded-array index, not file position) the first/last
// visible row must be to the loaded array's own edge before fetching more.
// Deliberately less than OVERSCAN so the fetch has a chance to land before
// the user actually scrolls past the last already-rendered overscan row.
export const EDGE_FETCH_THRESHOLD = 6

export interface ReadLogWindowParams {
  stream: LogStream
  anchor: number
  direction: LogWindowDirection
  maxBytes?: number
}

export interface LogViewerProps {
  stream: LogStream
  readWindow: (params: ReadLogWindowParams) => Promise<LogWindowResponse>
  onSelectLine: (line: LogLine) => void
}

export interface WindowState {
  lines: LogLine[]
  fileSize: number
  windowStart: number
  windowEnd: number
  atStart: boolean
  atEnd: boolean
}

const INITIAL_STATE: WindowState = {
  lines: [],
  fileSize: 0,
  windowStart: 0,
  windowEnd: 0,
  atStart: false,
  atEnd: false,
}

// Bounds that describe an empty (zero-line) window — only reachable when
// evictionCap is smaller than a single fetched response (not a real
// configuration EVICTION_CAP produces, but kept total rather than assuming
// a non-empty array below).
function emptyBounds(response: LogWindowResponse): Omit<WindowState, 'lines'> {
  return {
    fileSize: response.fileSize,
    windowStart: response.windowStart,
    windowEnd: response.windowEnd,
    atStart: response.atStart,
    atEnd: response.atEnd,
  }
}

// The core windowing/eviction state machine, deliberately pure and free of
// React/DOM/virtualizer concerns (see the module-level test file for why:
// @tanstack/react-virtual's own geometry needs a real laid-out scroll
// container to test meaningfully, but the actual correctness this unit
// exists to prove — bounded memory, correct prepend/append merge, no
// duplicate byteOffsets — lives entirely in this function and is cheap to
// test exhaustively without any DOM at all).
//
// Merge + evict happen in ONE return value (never two sequential state
// updates) so a caller's single setState call can never let the virtualizer
// observe a transiently-too-large or internally-inconsistent array — e.g. a
// `count` that briefly disagrees with what `getItemKey` would produce for
// the lines actually present.
export function applyFetchedWindow(
  state: WindowState,
  response: LogWindowResponse,
  direction: LogWindowDirection,
  evictionCap: number,
): WindowState {
  const existingOffsets = new Set(state.lines.map(line => line.byteOffset))
  // Defensive de-duplication (not the common case — see this function's own
  // header comment): the server tiles sequential edge-driven windows with
  // no overlap, so this filter should normally be a no-op. It exists for
  // the cases where it ISN'T: a stale in-flight fetch resolving after a
  // newer one already changed state, or a manual refresh re-fetching
  // overlapping content. Without it, two entries could share a byteOffset,
  // which collides with the virtualizer's getItemKey.
  const incoming = response.lines.filter(
    line => !existingOffsets.has(line.byteOffset),
  )

  const merged =
    direction === 'after'
      ? [...state.lines, ...incoming]
      : [...incoming, ...state.lines]
  const overflow = merged.length - evictionCap

  // `after` adds newer content at the back, so eviction reclaims room from
  // the opposite (front/oldest) end; `before` (and, defensively, `around`)
  // is the mirror image. Either way, eviction never touches the end that
  // was just extended — only the end you'd naturally want to forget.
  const lines =
    overflow <= 0
      ? merged
      : direction === 'after'
        ? merged.slice(overflow)
        : merged.slice(0, merged.length - overflow)

  if (lines.length === 0) {
    return { lines, ...emptyBounds(response) }
  }

  const firstLine = lines[0]
  const lastLine = lines[lines.length - 1]
  const evicted = overflow > 0

  if (direction === 'after') {
    return {
      lines,
      fileSize: response.fileSize,
      // This fetch's own edge (the back) is untouched by ITS OWN eviction,
      // so the response's windowEnd/atEnd stand. windowStart/atStart, by
      // contrast, must be re-derived from whatever line now sits at index 0
      // whenever eviction trimmed the front — re-deriving from the
      // survivors is what keeps the reported bounds truthful about what is
      // ACTUALLY loaded, rather than echoing a value that described the
      // pre-eviction array.
      windowStart: evicted ? firstLine.byteOffset : state.windowStart,
      windowEnd: response.windowEnd,
      atStart: evicted ? false : state.atStart,
      atEnd: response.atEnd,
    }
  }

  // 'before' (and defensively 'around' — the live viewer itself never
  // issues an `around` fetch in Phase 1; only Phase 2's jump-to-hit does,
  // but this function treats it identically to `before` since both prepend).
  return {
    lines,
    fileSize: response.fileSize,
    windowStart: response.windowStart,
    // Symmetric to the `after` branch above: this fetch's own edge (the
    // front) stands as reported; windowEnd/atEnd must be re-derived from
    // the surviving LAST line whenever the back was trimmed, since the
    // response's own windowEnd described the array before eviction cut it
    // back.
    windowEnd: evicted
      ? lastLine.byteOffset + lastLine.byteLength
      : state.windowEnd,
    atStart: response.atStart,
    atEnd: evicted ? false : state.atEnd,
  }
}

// Seeds fresh state from the very first response (open-at-tail or a manual
// refresh) — unlike applyFetchedWindow, there is no prior state to merge
// against, so this is a plain replace, never a merge+evict.
export function seedWindowState(response: LogWindowResponse): WindowState {
  return {
    lines: response.lines,
    fileSize: response.fileSize,
    windowStart: response.windowStart,
    windowEnd: response.windowEnd,
    atStart: response.atStart,
    atEnd: response.atEnd,
  }
}

type EdgeDirection = 'before' | 'after'
type InFlight = Record<EdgeDirection, boolean>

export function LogViewer({
  stream,
  readWindow,
  onSelectLine,
}: LogViewerProps) {
  const [state, setState] = useState<WindowState>(INITIAL_STATE)
  const [initialLoad, setInitialLoad] = useState<'pending' | 'done' | 'error'>(
    'pending',
  )
  const [edgeLoading, setEdgeLoading] = useState<InFlight>({
    before: false,
    after: false,
  })

  const scrollElementRef = useRef<HTMLDivElement>(null)
  const inFlightRef = useRef<InFlight>({ before: false, after: false })
  // Mirrors `state` for synchronous reads inside fetchEdge/onChange, which
  // must never close over a stale `state` captured at the time the
  // virtualizer instance (and its onChange callback) was created — the
  // virtualizer itself is long-lived across re-renders (see useVirtualizer
  // below), so its onChange closure would otherwise see the WindowState
  // from whichever render happened to construct it.
  const stateRef = useRef(state)
  stateRef.current = state
  // True from mount until the first successful seed has both landed AND had
  // one layout pass to pin scroll to the bottom — guards the "pin to
  // bottom on open" scrollTo from re-firing on every later re-render.
  const pendingInitialScrollRef = useRef(true)

  const fetchEdge = useCallback(
    async (direction: EdgeDirection) => {
      const current = stateRef.current
      if (inFlightRef.current[direction]) return
      if (direction === 'before' && current.atStart) return
      if (direction === 'after' && current.atEnd) return

      inFlightRef.current[direction] = true
      setEdgeLoading(prev => ({ ...prev, [direction]: true }))
      try {
        const anchor =
          direction === 'before' ? current.windowStart : current.windowEnd
        const response = await readWindow({ stream, anchor, direction })
        setState(prev =>
          applyFetchedWindow(prev, response, direction, EVICTION_CAP),
        )
      } finally {
        inFlightRef.current[direction] = false
        setEdgeLoading(prev => ({ ...prev, [direction]: false }))
      }
    },
    [stream, readWindow],
  )

  // Edge detection off the virtualizer's own visible range, run from
  // `onChange` — the virtualizer's own notification hook for "the visible
  // range or scroll offset changed" (scroll, resize, or a measurement
  // change), which fires on every user scroll AND on the initial mount
  // once real measurements exist. This is deliberately NOT a side effect
  // performed during render: `onChange` is the virtualizer's designated
  // callback seam for exactly this, so reading `instance.getVirtualItems()`
  // here can never race a render that hasn't committed the DOM node this
  // instance measures against yet. The instance is read from `onChange`'s
  // own first argument (not the outer `virtualizer` closure variable) so
  // this always sees the specific instance that just recalculated, never a
  // stale one captured when the callback was constructed.
  //
  // Thresholds are relative to the LOADED ARRAY's own edges (index 0 /
  // length-1), not the file's — the file's true start/end are only known
  // once atStart/atEnd are true.
  //
  // Guarded on `!pendingInitialScrollRef.current`: the FIRST time the
  // initial (open-at-tail) fetch's lines commit to the DOM, this fires
  // with the scroll container still at its pre-pin scrollTop of 0 — the
  // scroll-pin useLayoutEffect below hasn't run yet on this same commit,
  // since useVirtualizer's own internal effect (which is what invokes
  // onChange) is wired ahead of it. Without this guard, a fresh cold-open
  // would misread "scrolled to the top" from that transient zero offset
  // and fire a spurious `before` fetch immediately on mount, before the
  // user has scrolled anywhere — a real behavior, not a test artifact,
  // since the same effect-ordering applies in a real browser too.
  const handleVirtualizerChange = useCallback(
    (instance: Virtualizer<HTMLDivElement, Element>) => {
      if (pendingInitialScrollRef.current) return

      const items = instance.getVirtualItems()
      const first = items[0]
      const last = items[items.length - 1]
      const lineCount = stateRef.current.lines.length

      if (first && first.index <= EDGE_FETCH_THRESHOLD) {
        void fetchEdge('before')
      }
      if (last && last.index >= lineCount - 1 - EDGE_FETCH_THRESHOLD) {
        void fetchEdge('after')
      }
    },
    [fetchEdge],
  )

  const virtualizer = useVirtualizer({
    count: state.lines.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => ROW_PX,
    getItemKey: i => state.lines[i]?.byteOffset ?? i,
    overscan: OVERSCAN,
    // Keeps the currently-visible row anchored (by getItemKey, not index)
    // across a prepend or an eviction at either edge. Chosen over the
    // manual scrollTop-offset fallback documented in this unit's plan
    // because virtual-core 3.17.3 — the version @tanstack/react-
    // virtual@^3.14.5 actually resolves to (confirmed via `pnpm why
    // @tanstack/virtual-core`) — ships `anchorTo` natively: it recognizes a
    // changed edge item key (exactly what a prepend or an edge-eviction
    // produces) and re-anchors scroll offset to the item that was visible
    // before the count/keys changed, using the item's OWN key rather than
    // its index — which is what makes it correct across an eviction too,
    // not just a plain prepend. No hand-rolled offset math needed.
    anchorTo: 'end',
    onChange: handleVirtualizerChange,
  })

  const loadInitial = useCallback(async () => {
    setInitialLoad('pending')
    pendingInitialScrollRef.current = true
    try {
      const response = await readWindow({
        stream,
        // The server clamps anchor to [0, fileSize] itself, so requesting
        // an absurdly large anchor with direction:'before' is how this
        // client opens at the tail without needing to know fileSize up
        // front — see log-reader.service.ts's own anchor-clamping.
        anchor: Number.MAX_SAFE_INTEGER,
        direction: 'before',
      })
      setState(seedWindowState(response))
      setInitialLoad('done')
    } catch {
      setInitialLoad('error')
    }
  }, [stream, readWindow])

  useLayoutEffect(() => {
    void loadInitial()
    // Only re-run for a genuinely new stream/readWindow identity — a manual
    // refresh re-invokes loadInitial directly (see handleRefresh below)
    // rather than depending on this effect firing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream])

  // Pins scroll to the bottom once the initial (open-at-tail) fetch has
  // landed and the virtualizer has real measurements to scroll against.
  // Layout effect (not a plain effect) so this runs before the browser
  // paints the newly-populated list — avoids a visible flash at the top
  // before jumping to the bottom.
  useLayoutEffect(() => {
    if (!pendingInitialScrollRef.current) return
    if (initialLoad !== 'done') return
    if (state.lines.length === 0) return
    const scrollElement = scrollElementRef.current
    if (!scrollElement) return
    scrollElement.scrollTop = scrollElement.scrollHeight
    pendingInitialScrollRef.current = false
  }, [initialLoad, state.lines.length])

  function handleRefresh() {
    void loadInitial()
  }

  if (initialLoad === 'error') {
    return (
      <div
        data-track-id="log-viewer-error"
        className="flex min-h-32 items-center justify-center text-sm text-red-400"
      >
        Failed to load {stream} log.{' '}
        <button
          type="button"
          data-track-id="log-viewer-retry"
          onClick={handleRefresh}
          className="ml-2 underline hover:text-red-300"
        >
          Retry
        </button>
      </div>
    )
  }

  if (initialLoad === 'pending') {
    return (
      <div
        data-track-id="log-viewer-loading"
        className="flex min-h-32 items-center justify-center text-sm text-gray-500"
      >
        Loading {stream} log…
      </div>
    )
  }

  const percentThroughFile =
    state.fileSize > 0
      ? Math.round((state.windowStart / state.fileSize) * 100)
      : 0
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div className="flex flex-col gap-2">
      <div
        data-track-id="log-viewer-snapshot-banner"
        className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-xs text-gray-500"
      >
        <span>
          Snapshot — refresh for newer entries. {percentThroughFile}% through
          file.
        </span>
        <button
          type="button"
          data-track-id="log-viewer-refresh"
          onClick={handleRefresh}
          className="shrink-0 rounded px-2 py-0.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          Refresh
        </button>
      </div>

      {state.lines.length === 0 ? (
        <div
          data-track-id="log-viewer-empty"
          className="flex min-h-32 items-center justify-center text-sm text-gray-500"
        >
          No log entries.
        </div>
      ) : (
        <div
          ref={scrollElementRef}
          data-track-id="log-viewer-scroll"
          className="h-[32rem] overflow-y-auto"
        >
          {edgeLoading.before && (
            <div
              data-track-id="log-viewer-loading-before"
              className="py-1 text-center text-xs text-gray-500"
            >
              Loading earlier entries…
            </div>
          )}
          {state.atStart && (
            <div
              data-track-id="log-viewer-top-of-file"
              className="py-1 text-center text-xs text-gray-600 italic"
            >
              Top of file
            </div>
          )}

          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualItems.map(virtualItem => {
              const line = state.lines[virtualItem.index]
              if (!line) return null
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <LogRow
                    line={line}
                    stream={stream}
                    onSelect={() => onSelectLine(line)}
                  />
                </div>
              )
            })}
          </div>

          {edgeLoading.after && (
            <div
              data-track-id="log-viewer-loading-after"
              className="py-1 text-center text-xs text-gray-500"
            >
              Loading newer entries…
            </div>
          )}
          {state.atEnd && (
            <div
              data-track-id="log-viewer-end-of-file"
              className="py-1 text-center text-xs text-gray-600 italic"
            >
              End of file
            </div>
          )}
        </div>
      )}
    </div>
  )
}
