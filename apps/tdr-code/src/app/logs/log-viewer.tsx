'use client'

import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { api } from 'src/app/lib/api'
import { LogFilters, type LogFiltersValue } from 'src/app/logs/log-filters'
import { LogRow, ROW_PX } from 'src/app/logs/log-row'
import { LogSearchBar } from 'src/app/logs/log-search-bar'
import { useLogTail } from 'src/app/logs/use-log-tail'
import {
  type LogLine,
  type LogStream,
  type LogWindowDirection,
  type LogWindowResponse,
  parseLogLine,
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
  // U10 (isActive wiring): whether THIS stream's tab is the one currently
  // visible. Defaults to true so every Phase 1 call site/test that never
  // passes this prop keeps behaving exactly as before — page.tsx's own
  // "mount every stream, CSS-hide the inactive ones" architecture (see
  // that file's own header comment) means an inactive tab's LogViewer
  // instance stays mounted indefinitely, so without this prop its live
  // tail connection would otherwise ALSO stay open forever. See this
  // file's isActive effect below for the connect/disconnect wiring.
  isActive?: boolean
  // U12: structured filter state for THIS stream, lifted to page.tsx (see
  // that file's own header comment on why) — this component does NOT hold
  // its own copy of filter state; it receives it as a prop, passes it
  // straight through to LogFilters (a controlled-component pass-through),
  // and ALSO reads it itself to decide whether to enter filtered-projection
  // mode and to build the composed scan query. Defaulting to {} rather than
  // making this prop itself optional keeps every derived computation below
  // (isFilteredProjection, the composed predicate) total with no extra
  // undefined-guarding — page.tsx always provides a real (possibly empty)
  // slice for every mounted stream, so a default here is purely defensive.
  filters?: LogFiltersValue
  onFiltersChange?: (patch: Partial<LogFiltersValue>) => void
  onClearFilters?: () => void
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

// U10: the tail-append counterpart to applyFetchedWindow above — appends
// exactly ONE live-tail LogLine (immutably, never mutating state.lines in
// place, per the SAME "guards against react-virtual streaming-drift bug
// #1218" convention applyFetchedWindow's own test file documents) and
// evicts from the front if that push would exceed evictionCap. Kept as
// its own pure, DOM-free function — testable exhaustively without any
// virtualizer/DOM involvement, matching this file's established "Part 1:
// pure state machine" convention — rather than routing a single append
// through the whole-response-shaped applyFetchedWindow, which expects a
// LogWindowResponse (fileSize/windowStart/windowEnd/atStart/atEnd all
// echoed from a server fetch), not a single wire-pushed line.
//
// De-dup is intentionally narrower than applyFetchedWindow's full
// `existingOffsets` Set scan: tail lines arrive strictly in increasing
// byteOffset order over ONE connection, so a redundant/duplicate delivery
// (e.g. a stale resume overlap) can only ever repeat the line THIS
// function most recently appended — checking against just the current
// last line's byteOffset is therefore sufficient to guarantee "never a
// duplicate byteOffset in state.lines" for this function's actual calling
// pattern, at a fraction of the cost of a full Set rebuild on every single
// line (this function's caller invokes it once per wire message, unlike
// applyFetchedWindow's once-per-batch-response cadence).
export function appendTailLine(
  state: WindowState,
  line: LogLine,
  evictionCap: number,
): WindowState {
  const lastLine = state.lines[state.lines.length - 1]
  if (lastLine && lastLine.byteOffset === line.byteOffset) {
    return state
  }

  const merged = [...state.lines, line]
  const overflow = merged.length - evictionCap
  // Appending always trims from the FRONT (oldest) when over cap — the
  // mirror of applyFetchedWindow's own 'after' eviction direction, since a
  // tail append is definitionally an 'after' (newest-end) extension.
  const lines = overflow <= 0 ? merged : merged.slice(overflow)
  const firstLine = lines[0]
  const evicted = overflow > 0

  return {
    lines,
    // The just-appended line's own end IS the file's new known size, as
    // far as this client can tell — mirrors applyFetchedWindow's 'after'
    // branch adopting response.fileSize verbatim for the edge a fetch
    // just extended.
    fileSize: line.byteOffset + line.byteLength,
    windowStart:
      evicted && firstLine ? firstLine.byteOffset : state.windowStart,
    windowEnd: line.byteOffset + line.byteLength,
    atStart: evicted ? false : state.atStart,
    // A tail append, by construction, only ever happens while genuinely
    // following the live end of the file (see LogViewer's own onLine
    // callback below) — so the window's back edge is now truthfully AT
    // the current EOF, regardless of what atEnd was before this call.
    atEnd: true,
  }
}

// U12: the filtered-projection's own state, deliberately SEPARATE from
// WindowState above rather than shoehorned into it — the two modes have
// genuinely different shapes and invariants (WindowState tiles a
// contiguous byte range in both directions with eviction at either edge;
// FilteredState is a forward-only, server-scan-paginated LIST of matching
// lines with no "before" direction at all — see the fetch effect below for
// why). Keeping them as two independent pieces of state, swapped at RENDER
// time by isFilteredProjection, is what lets clearing filters fall back to
// whatever `state`/raw-mode already holds with NO special reset logic
// needed beyond the boolean recomputing to false (per this unit's own
// brief) — there's nothing to reconcile between them because neither one
// is ever derived from or mutates the other.
//
// `matches` holds full LogLine objects (converted ONCE, via
// filteredMatchToLogLine below, at the moment a page response lands or a
// live tail match is appended) rather than the raw wire shape
// { byteOffset, raw } LogSearchResponse actually carries — this is what
// lets the row-render loop below share ONE code path with raw mode's own
// state.lines (both are LogLine[]), and avoids re-running parseLogLine on
// every render for whichever rows happen to be visible (state.lines never
// does this either — its own LogLine.parsed is likewise computed once,
// server-side, not on every render).
export interface FilteredState {
  matches: LogLine[]
  nextCursor: string | null
  total: number
}

const EMPTY_FILTERED_STATE: FilteredState = {
  matches: [],
  nextCursor: null,
  total: 0,
}

// U12: mirrors log-search.service.ts's own matchesPredicate EXACTLY —
// same field semantics, same short-circuit-to-true-when-absent shape for
// every field, same case-insensitive substring for `text`, same >=
// threshold for `level`, same 'both'/absent-imposes-no-constraint for
// `process`, same exact-slug-equals for `event`. This is deliberately NOT
// a "close enough" reimplementation: AE6 depends on the client's live
// tail-matching and the server's whole-file scan agreeing on what counts
// as a match, or a filtered projection could show a tail line the server's
// own next fresh scan would disagree was ever a match (or vice versa) —
// see this function's own test coverage in log-viewer.spec.tsx for the
// exact same predicate-composition scenarios log-search.service.spec.ts
// already proves server-side.
export interface FilterPredicate {
  text?: string
  level?: number
  process?: 'main' | 'bot' | 'both'
  event?: string
}

export function matchesFilterPredicate(
  line: LogLine,
  predicate: FilterPredicate,
): boolean {
  if (predicate.text !== undefined) {
    if (!line.raw.toLowerCase().includes(predicate.text.toLowerCase())) {
      return false
    }
  }

  if (predicate.level !== undefined) {
    // A malformed line's `parsed` is null and therefore has no numeric
    // `level` field at all — excluded here exactly as the server's own
    // check excludes it (R14), with no separate null-check branch needed.
    const level = line.parsed?.level
    if (typeof level !== 'number' || level < predicate.level) {
      return false
    }
  }

  if (predicate.process !== undefined && predicate.process !== 'both') {
    if (line.parsed?.process !== predicate.process) {
      return false
    }
  }

  if (predicate.event !== undefined) {
    if (line.parsed?.event !== predicate.event) {
      return false
    }
  }

  return true
}

// U12: converts one filtered-match entry (byteOffset + raw text, per the
// LogSearchResponse shape this unit extended) into a full LogLine for
// LogRow to render — the SAME "byteLength via TextEncoder, parsed via
// parseLogLine" approach use-log-tail.ts's own tailMessageToLogLine already
// establishes for constructing a LogLine from wire text rather than from a
// windowed-read response (reused verbatim, not reinvented, per this unit's
// own brief). Unlike tailMessageToLogLine, there is no END-offset-to-START-
// offset conversion needed here: a search match's byteOffset is ALREADY the
// line's own START (U9's own contract — see LogSearchResponse's header
// comment in log-view.types.ts), so this is a much simpler construction.
// Exported so a future consumer (or a test targeting this exact conversion
// in isolation) can reuse it without re-deriving the byteLength math.
export function filteredMatchToLogLine(match: {
  byteOffset: number
  raw: string
}): LogLine {
  return {
    byteOffset: match.byteOffset,
    byteLength: new TextEncoder().encode(match.raw).length + 1, // +1 for the '\n' the server's own byte accounting includes
    raw: match.raw,
    parsed: parseLogLine(match.raw),
  }
}

// U12: the filtered-projection counterpart to appendTailLine — appends one
// live-tail LogLine that has ALREADY been confirmed (by the caller, via
// matchesFilterPredicate) to satisfy the current composed predicate.
// Mirrors appendTailLine's own immutable-append + bounded-eviction-from-
// the-front shape (never mutating state.matches in place, evicting the
// OLDEST entries once EVICTION_CAP is exceeded) applied to FilteredState
// instead of WindowState — kept as its own small pure function for the
// identical reason appendTailLine is its own function rather than inlined:
// cheap to test exhaustively with no DOM/virtualizer involved.
export function appendFilteredMatch(
  state: FilteredState,
  line: LogLine,
  evictionCap: number,
): FilteredState {
  const lastMatch = state.matches[state.matches.length - 1]
  if (lastMatch && lastMatch.byteOffset === line.byteOffset) {
    return state
  }

  const merged = [...state.matches, line]
  const overflow = merged.length - evictionCap
  const matches = overflow <= 0 ? merged : merged.slice(overflow)

  return {
    matches,
    // A live-matched append is, by construction, always the NEWEST entry
    // this projection has ever seen — total grows by exactly one for every
    // genuinely new match, mirroring how a fresh server-side re-scan would
    // count it once it becomes part of the file's own matching set.
    total: state.total + 1,
    nextCursor: state.nextCursor,
  }
}

type EdgeDirection = 'before' | 'after'
type InFlight = Record<EdgeDirection, boolean>

// U12: the default empty slice every pre-U12 call site (and every test that
// doesn't care about filters) effectively gets when `filters` itself is
// omitted — a stable module-level constant (not a fresh `{}` literal per
// render) so it never appears to "change" from one render to the next by
// object identity alone, which matters for the composed-predicate/
// isFilteredProjection derivations below and the fetch effect keyed on
// their primitive fields (not on this object's own reference).
const DEFAULT_FILTERS: LogFiltersValue = {}

export function LogViewer({
  stream,
  readWindow,
  onSelectLine,
  isActive = true,
  filters = DEFAULT_FILTERS,
  onFiltersChange,
  onClearFilters,
}: LogViewerProps) {
  const [state, setState] = useState<WindowState>(INITIAL_STATE)
  const [initialLoad, setInitialLoad] = useState<'pending' | 'done' | 'error'>(
    'pending',
  )
  const [edgeLoading, setEdgeLoading] = useState<InFlight>({
    before: false,
    after: false,
  })
  // U10: follow-on-by-default (R3). true = live tail lines are appended
  // into state.lines and the viewport auto-scrolls (via followOnAppend
  // below); false = paused, live lines only bump newLineCount (R4). The
  // ONLY path back to true is "jump to latest" (handleJumpToLatest) —
  // scrolling back down on the user's own does NOT resume follow, per
  // this unit's own brief.
  const [following, setFollowing] = useState(true)
  // Bounded "N new" badge counter (R4) — reset to 0 on jump-to-latest and
  // whenever `following` transitions back to true. Never backs an
  // unbounded pending-line buffer; while paused, incoming tail lines are
  // counted here and NOWHERE else (see handleTailLine below).
  const [newLineCount, setNewLineCount] = useState(0)
  // U11: the CURRENTLY-selected search hit's matched text, or null when no
  // search hit is selected — passed straight through to every LogRow as
  // `highlightText`. Set alongside a hit selection (handleHitSelected
  // below) and cleared ONLY when search becomes inactive (see
  // handleSearchActiveChange) — a deliberate choice, not an oversight: the
  // user stays wherever they currently are when clearing the query; the
  // window itself is never auto-navigated away from a selected hit just
  // because the search box emptied.
  const [highlightText, setHighlightText] = useState<string | null>(null)

  // U12: the current free-text term, reported by LogSearchBar's own
  // onQueryTextChange the instant ITS debounce settles (see that
  // component's own header comment) — this is how a lone text term
  // composes into the filtered-projection predicate (AE6) without this
  // component needing its own separate debounce for the text side; the
  // ALREADY-debounced value from LogSearchBar covers it.
  const [queryText, setQueryText] = useState('')
  // U12: the filtered-projection's own state (see FilteredState's own
  // header comment for why this is a SEPARATE piece of state from `state`
  // above, never merged into it).
  const [filteredState, setFilteredState] =
    useState<FilteredState>(EMPTY_FILTERED_STATE)
  // Distinguishes "no filters active" / "scan in flight" / "scan resolved"
  // for the filtered-projection's own empty-state gating (per this unit's
  // brief: never flash "No lines match these filters" while a fetch for
  // the CURRENT predicate is still in flight — the identical "no flash to
  // empty" discipline U11's own LogSearchBar already applies to its
  // "No results" state).
  const [filteredLoad, setFilteredLoad] = useState<'idle' | 'pending' | 'done'>(
    'idle',
  )

  // U12 (AE6): true the instant any STRUCTURED filter is genuinely
  // restrictive — an explicit `process: 'both'` is equivalent to "no
  // process constraint at all" (matching U9's own matchesPredicate
  // semantics exactly; see log-search.service.ts), so it must NOT count as
  // an active filter here, or LogFilters' own "Any process" default
  // selection would spuriously flip the viewer into filtered-projection
  // mode with an empty result the instant `stream === 'backend'` renders
  // its process <select> at its default value. Free text alone (queryText
  // non-empty, no structured filter) is deliberately EXCLUDED from this
  // check — that combination stays in search-navigator mode (full-file
  // context + jump-to-hit), per the Phase 2 plan's own resolved decision;
  // only a genuinely active structured filter switches the view mode.
  const isFilteredProjection =
    filters.level !== undefined ||
    (filters.process !== undefined && filters.process !== 'both') ||
    filters.event !== undefined

  // U12: the ONE predicate composing every active input — the structured
  // filters from the `filters` prop plus the free-text term LogSearchBar
  // reported (AE6: text AND structured filters together, never either
  // alone dropped from the request). Used for BOTH the server-side fetch
  // effect below (as the actual api.searchLog params) and the client-side
  // live-tail predicate check (matchesFilterPredicate) — sharing this one
  // object between both call sites is what guarantees they can never drift
  // out of sync with each other, even though log-search.service.ts's own
  // server-side matchesPredicate is the ultimate source of truth this
  // client-side mirror must independently agree with.
  const composedPredicate: FilterPredicate = {
    text: queryText.trim().length > 0 ? queryText.trim() : undefined,
    level: filters.level,
    process: filters.process,
    event: filters.event,
  }

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
  // Mirrors `following` for the SAME reason stateRef exists above:
  // handleVirtualizerChange (this component's onChange callback) is
  // memoized via useCallback on [fetchEdge], which never itself changes
  // identity across renders — a direct closure over the `following` STATE
  // VARIABLE inside that callback would therefore see whatever value was
  // true the FIRST time handleVirtualizerChange was constructed, forever,
  // and never observe a later flip (e.g. a jump-to-latest resuming
  // follow). Read via this ref inside that callback instead.
  const followingRef = useRef(following)
  followingRef.current = following
  // U12: mirrors `isFilteredProjection` for the identical reason
  // followingRef exists above — handleVirtualizerChange (memoized via
  // useCallback on [fetchEdge]) must read the CURRENT mode, not whatever
  // was true the first time that callback was constructed, or switching
  // into/out of filtered-projection mode after mount would leave the edge-
  // detection logic permanently stuck reacting to the WRONG list.
  const isFilteredProjectionRef = useRef(isFilteredProjection)
  isFilteredProjectionRef.current = isFilteredProjection
  // U12: mirrors `filteredState` for the SAME reason stateRef mirrors
  // `state` above — the filtered-projection pagination fetch triggered from
  // handleVirtualizerChange needs a synchronous read of the CURRENT
  // nextCursor/matches, never a value captured when that memoized callback
  // was first constructed.
  const filteredStateRef = useRef(filteredState)
  filteredStateRef.current = filteredState
  // U12: mirrors `composedPredicate` for the reasons explained on
  // fetchFilteredNextPage's own header comment below — read by that
  // memoized callback, never closed over directly.
  const composedPredicateRef = useRef(composedPredicate)
  composedPredicateRef.current = composedPredicate
  // True from mount until the first successful seed has both landed AND had
  // one layout pass to pin scroll to the bottom — guards the "pin to
  // bottom on open" scrollTo from re-firing on every later re-render.
  const pendingInitialScrollRef = useRef(true)
  // Mirrors pendingInitialScrollRef's one-shot-guard pattern for
  // handleJumpToLatest's own explicit re-scroll (see that handler and its
  // paired useLayoutEffect below) — kept as its OWN ref rather than
  // reusing pendingInitialScrollRef, since that ref is also gated on
  // `initialLoad === 'done'` in its paired effect, a condition that
  // doesn't apply (and shouldn't be re-checked) for a jump that happens
  // well after the initial load already completed.
  const pendingJumpScrollRef = useRef(false)
  // U11: the SAME one-shot-guard pattern as pendingJumpScrollRef, applied
  // to jump-to-HIT instead of jump-to-LATEST — kept as its own ref rather
  // than reusing pendingJumpScrollRef because the two guard genuinely
  // different scroll DESTINATIONS (scrollToEnd() vs. scrollToIndex at a
  // specific row) that could, in principle, ever be pending simultaneously
  // (e.g. a hit selection landing in the same render pass as an unrelated
  // jump-to-latest click) — collapsing them into one flag would make the
  // paired layout effect below unable to tell which behavior it owes.
  const pendingHitScrollRef = useRef(false)
  // The byte offset the jump-to-hit layout effect below should scroll to
  // once state.lines actually contains it — set immediately before the
  // seedWindowState call in handleHitSelected, read (and only read) by
  // that effect. A ref rather than a second piece of derived state: this
  // value is pure "instructions for the NEXT layout effect run," never
  // rendered anywhere itself.
  const pendingHitByteOffsetRef = useRef<number | null>(null)
  // Tracks state.lines.length as of the LAST handleVirtualizerChange
  // invocation — used ONLY to detect "this invocation is itself a
  // reaction to state.lines having just grown" (an append or an edge-
  // fetch), as opposed to a genuine user scroll. This matters because of
  // a real virtual-core timing quirk, not a test artifact: `onChange` can
  // fire SYNCHRONOUSLY during render (getVirtualItems() -> internally
  // calculateRange()/maybeNotify()), which happens BEFORE that SAME
  // render's `_willUpdate` layout effect has had a chance to run
  // followOnAppend's compensating scrollToEnd() — so at the moment THIS
  // invocation runs, isAtEnd() would transiently compare the OLD (pre-
  // growth) scroll offset against the NEW (post-growth) total size,
  // reporting "not at end" even though the user never scrolled and
  // followOnAppend is about to correct it later in this SAME commit's
  // layout pass. Skipping the pause-check specifically on a growth-
  // triggered invocation avoids that false positive; the FOLLOWING
  // onChange invocation — triggered by the actual scroll EVENT
  // followOnAppend's own scrollToEnd() produces once it runs — then
  // correctly observes the settled, at-end offset. A genuine scroll-away
  // that happens to land on the exact same commit as a growth is only
  // delayed by one onChange tick, never missed: that scroll's own
  // subsequent scroll event still fires its own (ungrown, unskipped)
  // onChange invocation.
  const lastObservedLineCountRef = useRef(0)

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

  // U12: filtered-projection's own pagination — forward-only, by
  // construction (the scan has no "before" direction: matches are
  // discovered walking the file from byte 0 on every FRESH query, so the
  // very first page already IS the start; there is nothing earlier to
  // page backward INTO the way raw mode's `before` edge-fetch can always
  // walk further toward byte 0). Guarded on `filteredFetchInFlightRef`
  // (the SAME single-in-flight-request idiom `inFlightRef` already
  // provides for raw mode's edge fetches) and on `nextCursor` actually
  // being non-null — appends the resolved page's matches (converted via
  // filteredMatchToLogLine) onto whatever is already loaded, mirroring
  // fetchEdge's own 'after' append shape. Reads the composed predicate via
  // `composedPredicateRef` (not the outer `composedPredicate` closure
  // variable) for the SAME reason every other memoized callback in this
  // file reads render-local values via a ref — this function is memoized
  // via useCallback on [stream] alone, so a direct closure over
  // `composedPredicate` would only ever see whatever text/filters were
  // active the FIRST time this function was constructed.
  const filteredFetchInFlightRef = useRef(false)
  const [filteredPageLoading, setFilteredPageLoading] = useState(false)
  const fetchFilteredNextPage = useCallback(async () => {
    const current = filteredStateRef.current
    if (filteredFetchInFlightRef.current || !current.nextCursor) return

    filteredFetchInFlightRef.current = true
    setFilteredPageLoading(true)
    try {
      const predicate = composedPredicateRef.current
      const response = await api.searchLog({
        stream,
        text: predicate.text,
        level: predicate.level,
        process: predicate.process,
        event: predicate.event,
        cursor: current.nextCursor,
      })
      setFilteredState(prev => ({
        matches: [
          ...prev.matches,
          ...response.matches.map(filteredMatchToLogLine),
        ],
        nextCursor: response.nextCursor,
        total: response.total,
      }))
    } finally {
      filteredFetchInFlightRef.current = false
      setFilteredPageLoading(false)
    }
  }, [stream])

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
      // U12: filtered-projection mode is a COMPLETELY different scroll
      // surface than raw mode's byte-tiled window (see FilteredState's own
      // header comment) — it has no "before" direction, no atStart/atEnd
      // concept, and its own liveness (handleTailLine below) is
      // unconditional rather than gated on `following`/pause. Branching
      // HERE, BEFORE the pendingInitialScrollRef check below (not after
      // it), is deliberate: that flag's entire meaning is specific to RAW
      // MODE's own "pin scroll to bottom on open" timing (see the paired
      // useLayoutEffect's own header comment) — filtered-projection has no
      // equivalent pin-on-open behavior of its own to guard a transient
      // pre-pin scrollTop misread against, and that SAME effect correctly
      // SKIPS consuming the flag while filtered-projection is active (see
      // its own U12 comment) — meaning if this filtered branch were placed
      // AFTER the pendingInitialScrollRef check instead, the flag would
      // never get consumed at all whenever filtered-projection is active
      // from this component's very first render, permanently disabling
      // EVERY onChange invocation (including this filtered branch's own
      // pagination) for the rest of that mode's lifetime — a real
      // regression an earlier draft of this ordering had. See
      // isFilteredProjectionRef's own header comment for why this reads a
      // ref, not the outer `isFilteredProjection` closure variable.
      if (isFilteredProjectionRef.current) {
        const items = instance.getVirtualItems()
        const last = items[items.length - 1]
        const matchCount = filteredStateRef.current.matches.length
        if (
          last &&
          last.index >= matchCount - 1 - EDGE_FETCH_THRESHOLD &&
          filteredStateRef.current.nextCursor
        ) {
          void fetchFilteredNextPage()
        }
        return
      }

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

      // See lastObservedLineCountRef's own header comment for the FULL
      // rationale — in short: an invocation triggered by state.lines
      // having just grown (an append or an edge-fetch) can transiently
      // observe a STALE scroll offset (isAtEnd() would wrongly read
      // false) before followOnAppend's own compensating scroll has had a
      // chance to run later in this SAME commit — so THIS SPECIFIC
      // invocation's pause-check is skipped, and the settled offset gets
      // correctly re-checked on the NEXT invocation instead (the one
      // followOnAppend's own corrective scroll event itself triggers).
      const grewSinceLastCheck = lineCount > lastObservedLineCountRef.current
      lastObservedLineCountRef.current = lineCount

      // U10 auto-pause (R4): the FIRST time the virtualizer reports the
      // viewport has scrolled away from the bottom while follow is
      // currently on, flip to paused. instance.isAtEnd() (no threshold
      // argument -> the library's own default scrollEndThreshold, the
      // same value followOnAppend's internal auto-scroll check uses
      // below) is the same "is the user currently pinned to the visual
      // bottom" signal the library computes for its own follow-scroll
      // decision — reusing it here keeps this hook's pause detection and
      // the library's own auto-scroll trigger in agreement about what
      // "at the bottom" means. Only ever transitions true -> false here;
      // per this unit's brief, the ONLY path back to true is "jump to
      // latest" (handleJumpToLatest below), never scrolling back down on
      // the user's own.
      //
      // Also guarded on `!pendingJumpScrollRef.current`, the SAME kind of
      // "don't trust the offset until the pin has had a chance to apply"
      // guard `pendingInitialScrollRef` already provides for the initial
      // load: a jump-to-latest replaces state.lines wholesale with a
      // DIFFERENT set of byteOffset keys (even when the count is
      // unchanged, so grewSinceLastCheck alone would not catch it),
      // which can ALSO trigger an onChange invocation before this SAME
      // commit's explicit virtualizer.scrollToEnd() (in the paired
      // useLayoutEffect below) has actually run — observing the still-
      // stale, pre-jump (paused) offset and immediately UNDOING the
      // setFollowing(true) handleJumpToLatest just set. This closes that
      // race the same way the initial-load one is already closed.
      if (
        !grewSinceLastCheck &&
        !pendingJumpScrollRef.current &&
        followingRef.current &&
        !instance.isAtEnd()
      ) {
        followingRef.current = false
        setFollowing(false)
      }
    },
    [fetchEdge, fetchFilteredNextPage],
  )

  // U12: the SAME useVirtualizer instance drives whichever list is
  // currently active — filtered-projection's own matches when a structured
  // filter is active, state.lines (raw/search-navigator mode, unchanged
  // from Phase 1/U11) otherwise. `activeLines` is recomputed fresh every
  // render (cheap: it's just picking one of two already-computed arrays,
  // never copying), which is what lets count/getItemKey/the row-render
  // loop below share ONE code path instead of duplicating the virtualizer
  // wiring per mode.
  const activeLines = isFilteredProjection ? filteredState.matches : state.lines

  const virtualizer = useVirtualizer({
    count: activeLines.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => ROW_PX,
    getItemKey: i => activeLines[i]?.byteOffset ?? i,
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
    // U10 (R3/AE1): auto-calls scrollToEnd() internally whenever
    // state.lines grows AND the viewport was already isAtEnd() at the
    // moment of that growth (checked against the PREVIOUS render's scroll
    // position, before the new item is measured — see virtual-core's own
    // setOptions implementation) — exactly "auto-scroll on append only if
    // already pinned." This is genuinely a REAL, confirmed-present option
    // on the installed @tanstack/virtual-core@3.17.3 (resolved via
    // @tanstack/react-virtual@^3.14.5 — confirmed via `pnpm why
    // @tanstack/virtual-core`), so no manual scrollToEnd() call is needed
    // for the normal live-append case; handleJumpToLatest below calls it
    // explicitly for its OWN distinct case (jumping while NOT already
    // pinned, which followOnAppend's own isAtEnd gate would never fire
    // for). Safe to leave unconditionally enabled regardless of
    // `following`/pause state: while paused, state.lines is never mutated
    // by a tail line at all (handleTailLine below only increments
    // newLineCount), so `count` never grows from a tail event while
    // paused, and this option's own internal isAtEnd check independently
    // guards against a coincidental unrelated edge-fetch growth
    // (Phase 1's existing after-fetch) auto-scrolling a paused, scrolled-
    // away viewport — since a paused viewport is, by this same
    // isAtEnd-based definition, never "already pinned" in the first
    // place.
    followOnAppend: true,
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
  //
  // U12: guarded on `!isFilteredProjection` — this is RAW MODE's own
  // "open at tail" behavior specifically, and `state.lines`/`initialLoad`
  // update in the background regardless of which mode is CURRENTLY
  // rendered (the raw windowed read always runs, per this file's own
  // "runs alongside filtered-projection, never instead of it" design).
  // Without this guard, a `state.lines.length` transition landing WHILE
  // filtered-projection is already the active/rendered mode would still
  // read `scrollElementRef.current` — which, in that mode, points at the
  // FILTERED branch's own scroll container (the only one actually mounted
  // right now), never a raw-mode container at all — and pin THAT
  // container to ITS OWN bottom as an unintended side effect of a raw-
  // mode background fetch that has nothing to do with what's on screen. A
  // skip here (rather than consuming the flag) leaves
  // pendingInitialScrollRef.current untouched, so raw mode still gets its
  // one-time pin whenever ITS OWN content is what next triggers this
  // effect while genuinely being the rendered branch.
  useLayoutEffect(() => {
    if (isFilteredProjection) return
    if (!pendingInitialScrollRef.current) return
    if (initialLoad !== 'done') return
    if (state.lines.length === 0) return
    const scrollElement = scrollElementRef.current
    if (!scrollElement) return
    scrollElement.scrollTop = scrollElement.scrollHeight
    pendingInitialScrollRef.current = false
  }, [initialLoad, state.lines.length, isFilteredProjection])

  // U10: handed to useLogTail as `onLine` — deliberately NOT wrapped in
  // useCallback. This is the "unstable callback" the hook's own header
  // comment expects: a fresh closure every render that closes over
  // whatever `following` this SPECIFIC render saw. useLogTail holds the
  // LATEST one in its own ref and always invokes that ref's current
  // value from the actual EventSource listener (which is itself only
  // created once per connect() call) — so a `following` flip on a LATER
  // render is picked up automatically here with no extra plumbing on this
  // side, unlike handleVirtualizerChange above (which DOES need
  // followingRef, because THAT callback is long-lived/memoized instead of
  // freshly re-created every render).
  function handleTailLine(line: LogLine) {
    if (following) {
      setState(prev => appendTailLine(prev, line, EVICTION_CAP))
    } else {
      // Paused (R4): never touch state.lines — only the bounded counter
      // grows. This is what keeps memory bounded while paused (the plan's
      // own "never an unbounded pending-line buffer" requirement) and is
      // also why followOnAppend above can stay unconditionally enabled:
      // there is no append for it to react to while paused in the first
      // place.
      setNewLineCount(prev => prev + 1)
    }

    // U12 (chosen liveness behavior — see this unit's own report for why
    // live-append was chosen over the "N new matches — refresh" fallback):
    // filtered-projection's own liveness is UNCONDITIONAL, independent of
    // `following`/pause above — those describe the RAW window, which
    // isn't even the view currently on screen while a structured filter is
    // active. A newly-arrived tail line is checked against the SAME
    // composedPredicate the fetch effect below sends to the server, via
    // matchesFilterPredicate (which must mirror log-search.service.ts's
    // own matchesPredicate exactly — see that function's own header
    // comment), and appended in real time if it matches. This runs
    // ALONGSIDE the raw-mode branch above, never instead of it: both
    // `state` and `filteredState` stay independently up to date on every
    // tail line regardless of which one is currently rendered, so
    // clearing filters later needs no catch-up fetch to reflect what
    // arrived while filtered-projection was active.
    if (
      isFilteredProjection &&
      matchesFilterPredicate(line, composedPredicate)
    ) {
      setFilteredState(prev => appendFilteredMatch(prev, line, EVICTION_CAP))
    }
  }

  const { connect, disconnect } = useLogTail(stream, handleTailLine)

  // U10 tail connection lifecycle, driven by (initialLoad, isActive):
  // connects exactly once the FIRST time the initial windowed load
  // reaches 'done' while this tab is active (mirrors the
  // pendingInitialScrollRef one-shot-guard pattern above, applied to
  // "should a tail connection be open" instead of "should scroll be
  // pinned"), disconnects the instant isActive goes false (an inactive
  // tab must hold no live watcher — page.tsx mounts every stream's
  // LogViewer simultaneously and only CSS-hides the inactive ones, so
  // this is the ONLY thing that actually closes an idle tab's
  // connection), and reconnects if isActive comes back true afterward.
  // Deliberately does NOT depend on `state` / `stream` / `connect` /
  // `disconnect` changing identity to decide whether to act — those are
  // either stable (connect/disconnect are useCallback-memoized in
  // useLogTail) or irrelevant to this specific transition (stream is
  // fixed for this component's lifetime) — only a genuine
  // (initialLoad, isActive) transition should ever open/close a
  // connection, never an unrelated re-render (e.g. selecting a row).
  const wasConnectedRef = useRef(false)
  useEffect(() => {
    const shouldBeConnected = initialLoad === 'done' && isActive
    if (shouldBeConnected && !wasConnectedRef.current) {
      // Resume point: state.fileSize as currently held. Chosen over
      // re-fetching a fresh window here because it needs no extra
      // round-trip and is always safe — the server's own tail resume
      // semantics (log-tail.controller.ts's resolveFromOffset / U8) treat
      // `from` as "emit the backlog from this offset forward, then keep
      // watching," so even a STALE state.fileSize (e.g. after a long
      // isActive:false stretch during which the real file grew well
      // past what this client last observed) is corrected for free: the
      // reconnect's own backlog read emits every line between the stale
      // offset and the current true EOF as ordinary append-delta
      // messages, which flow through this SAME handleTailLine path (and
      // therefore respect `following`/newLineCount exactly as any other
      // tail line would) — never a gap, never a special case.
      connect(stateRef.current.fileSize)
      wasConnectedRef.current = true
    } else if (!shouldBeConnected && wasConnectedRef.current) {
      disconnect()
      wasConnectedRef.current = false
    }
  }, [initialLoad, isActive, connect, disconnect])

  // U12: fetches a FRESH page 1 of the filtered projection whenever any
  // input to the composed predicate changes — every structured-filter
  // change (level/process/event, driven by LogFilters' own <select>/
  // <input> controls) fires this immediately with no debounce of its own
  // needed (a <select> change is a discrete, deliberate action, unlike
  // free-text keystrokes), while the free-text side is covered for free
  // because `queryText` itself only ever updates once LogSearchBar's OWN
  // debounce has already settled (see that component's onQueryTextChange
  // contract) — so this effect never fires once per keystroke even though
  // it has no debounce logic of its own.
  //
  // Keyed on the PRIMITIVE fields (filters.level/.process/.event,
  // queryText, stream), never on `composedPredicate` or `filters`
  // themselves — those are fresh object literals every render (see
  // composedPredicate's own construction above), so keying on their
  // reference would re-run this effect on every single render regardless
  // of whether any actual VALUE changed.
  //
  // A `generation` guard (the same pattern log-search-bar.tsx's own
  // searchGenerationRef establishes for its accumulator) is what keeps a
  // slow, superseded fetch from ever applying its response after a NEWER
  // filter/text change has already landed and moved this component on —
  // without it, a stale page-1 response for an OLD predicate could
  // overwrite the CURRENT predicate's already-correct filteredState.
  const filteredGenerationRef = useRef(0)
  useEffect(() => {
    if (!isFilteredProjection) {
      // Not in filtered-projection mode — nothing to fetch. filteredState
      // is deliberately left exactly as it is (not reset) per this unit's
      // own brief: "clearing filters ... no special reset needed beyond
      // [isFilteredProjection] recomputing" — the next time a structured
      // filter goes active again (even with a stale filteredState still
      // sitting there from before), THIS effect fires again anyway
      // (because at least one of its own dependencies necessarily changed
      // to make isFilteredProjection true again) and replaces it wholesale
      // below, so no reader ever observes the stale interim value.
      return
    }

    const generation = ++filteredGenerationRef.current
    setFilteredLoad('pending')
    const predicate = composedPredicateRef.current

    void api
      .searchLog({
        stream,
        text: predicate.text,
        level: predicate.level,
        process: predicate.process,
        event: predicate.event,
        cursor: undefined,
      })
      .then(response => {
        if (filteredGenerationRef.current !== generation) return // superseded
        setFilteredState({
          matches: response.matches.map(filteredMatchToLogLine),
          nextCursor: response.nextCursor,
          total: response.total,
        })
        setFilteredLoad('done')
      })
      .catch(() => {
        if (filteredGenerationRef.current !== generation) return
        // A failed filtered-projection fetch is treated the same way
        // log-search-bar.tsx's own react-query-backed fetch treats a
        // rejection at this layer: the previous (possibly empty)
        // filteredState is left as-is rather than crashing this
        // component — there is no dedicated error affordance for THIS
        // specific fetch beyond falling back to "no matches yet," since
        // an outright network failure here is rare enough (this is a
        // local admin console, not a public-internet surface) not to
        // warrant its own distinct error UI on top of the existing raw-
        // mode error state this component already has for the windowed
        // read.
        setFilteredLoad('done')
      })
  }, [
    isFilteredProjection,
    stream,
    filters.level,
    filters.process,
    filters.event,
    queryText,
  ])

  function handleRefresh() {
    void loadInitial()
  }

  // "Jump to latest" (R4): re-anchors the loaded window to the file's
  // CURRENT true tail (distinct from handleRefresh's own open-at-tail
  // reseed only in that this one ALSO resets the badge, re-seeds the
  // tail connection from the fresh offset, and resumes follow — the
  // three things that make this a genuine "un-pause" rather than just a
  // content refresh). Uses the SAME open-at-tail fetch shape loadInitial
  // itself performs (anchor: MAX_SAFE_INTEGER, direction: 'before') —
  // the server clamps this to the real EOF regardless of what this
  // client currently believes fileSize to be, so this is correct even
  // after an arbitrarily long paused stretch.
  const jumpInFlightRef = useRef(false)
  async function handleJumpToLatest() {
    if (jumpInFlightRef.current) return
    jumpInFlightRef.current = true
    try {
      const response = await readWindow({
        stream,
        anchor: Number.MAX_SAFE_INTEGER,
        direction: 'before',
      })
      // Set BEFORE setState, not after: the paired useLayoutEffect below
      // reads this flag on the render this setState schedules, so it
      // must already be true by the time that render's layout effects
      // run — setting it after would risk (depending on exact scheduling)
      // missing that same commit.
      pendingJumpScrollRef.current = true
      setState(seedWindowState(response))
      setNewLineCount(0)
      // Re-seeds the tail from the FRESH offset this response just
      // reported — the plan's own "manual close-and-reopen with a fresh
      // ?from=... used only for a deliberate re-seek" case. connect()
      // itself closes whatever connection is already open before
      // opening the new one (see use-log-tail.ts), so this is safe to
      // call unconditionally regardless of whether a connection was
      // already live.
      connect(response.fileSize)
      setFollowing(true)
    } finally {
      jumpInFlightRef.current = false
    }
  }

  // Explicit scrollToEnd() for handleJumpToLatest, deferred to a layout
  // effect so it runs AFTER the seedWindowState replace above has
  // actually committed and the virtualizer has fresh measurements for
  // the NEW window — calling virtualizer.scrollToEnd() synchronously
  // inside handleJumpToLatest itself would still be observing the OLD
  // (pre-jump) measurements, since setState's effect on `count` is only
  // visible starting from the NEXT render. Deliberately NOT relying on
  // followOnAppend for this case (see that option's own comment above):
  // followOnAppend only auto-scrolls when the viewport was ALREADY
  // pinned at the moment count grew, which is never true here (jump-to-
  // latest's whole reason to exist is that the viewport is currently
  // NOT pinned — that's what "paused" means).
  useLayoutEffect(() => {
    if (!pendingJumpScrollRef.current) return
    pendingJumpScrollRef.current = false
    virtualizer.scrollToEnd()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.lines.length])

  // U11: search-hit selection (F3/R10). Reuses `following`/newLineCount
  // exactly as U10's OWN "pause and look at a specific point" affordances
  // already do — selecting a hit is conceptually identical to scrolling up
  // (both mean "stop auto-following, I'm looking at something specific"),
  // so this deliberately calls setFollowing(false) rather than inventing a
  // parallel pause mechanism. Crucially, this does NOT call disconnect():
  // the tail connection stays open and keeps running in the background
  // (handleTailLine below still fires for every incoming tail line — it
  // just takes the `!following` branch, bumping newLineCount exactly like
  // a scroll-up pause does), so the "N new" badge keeps incrementing while
  // a hit is selected, and jump-to-latest remains the one documented path
  // back to a live, EOF-anchored window (per this unit's own brief).
  const hitInFlightRef = useRef(false)
  async function handleHitSelected(byteOffset: number, matchText: string) {
    if (hitInFlightRef.current) return
    hitInFlightRef.current = true
    try {
      setFollowing(false)
      const response = await readWindow({
        stream,
        anchor: byteOffset,
        direction: 'around',
      })
      // Set BEFORE setState, for the identical reason
      // handleJumpToLatest's own pendingJumpScrollRef assignment precedes
      // ITS setState call — the paired layout effect below reads these
      // refs on the very render this setState schedules.
      pendingHitScrollRef.current = true
      pendingHitByteOffsetRef.current = byteOffset
      setState(seedWindowState(response))
      setHighlightText(matchText)
    } finally {
      hitInFlightRef.current = false
    }
  }

  // U11: fires when LogSearchBar reports its OWN active/inactive
  // transition (see that component's `onSearchActiveChange` prop
  // contract). Only ever CLEARS highlightText on a hard `false` (the
  // query was emptied back out) — a zero-result search or a search still
  // resolving never touches highlightText at all, so a PRIOR hit's
  // highlight/window stays exactly as the user left it rather than being
  // yanked away by an unrelated in-flight query. Deliberately does NOT
  // move the viewport or resume `following` here — the user stays
  // wherever they currently are; resuming live-follow remains an
  // explicit, separate "jump to latest" action (U10). This is a
  // deliberate judgment call: emptying the search box reads as "I'm done
  // searching," not "take me back to live," and the two existing U10
  // affordances (Refresh / Jump to latest) already cover "get back to
  // live" without this handler needing to guess at that intent too.
  function handleSearchActiveChange(active: boolean) {
    if (!active) {
      setHighlightText(null)
    }
  }

  // Explicit scrollToIndex() for handleHitSelected, deferred to a layout
  // effect for the SAME reason handleJumpToLatest's own paired effect
  // above is deferred: calling virtualizer.scrollToIndex synchronously
  // inside handleHitSelected would still observe the OLD (pre-jump)
  // measurements, since setState's effect on `count`/`getItemKey` is only
  // visible starting from the NEXT render. Keyed on
  // state.windowStart/state.windowEnd (which BOTH change the instant a
  // NEW window — whether from a jump-to-hit, jump-to-latest, refresh, or
  // ordinary edge-fetch — actually lands), rather than state.lines.length
  // alone: an edge-fetch prepend/append also changes length, but this
  // effect must fire ONLY for a genuine jump-to-hit reseed, which
  // pendingHitScrollRef's own guard already narrows to — the broader key
  // just guarantees this effect re-evaluates on every window change so it
  // never MISSES the one that actually matters.
  useLayoutEffect(() => {
    if (!pendingHitScrollRef.current) return
    pendingHitScrollRef.current = false
    const targetOffset = pendingHitByteOffsetRef.current
    pendingHitByteOffsetRef.current = null
    if (targetOffset === null) return
    // The target line is only found by RANGE, not by exact byteOffset
    // equality: log-reader.service.ts's own 'around' snapWindow guarantee
    // is that the LINE CONTAINING the anchor is whole and present in the
    // response (see that file's own header comment on snapWindow), not
    // that the response echoes the raw anchor value verbatim as some
    // line's own byteOffset — a search hit's byteOffset points at a
    // line's START (U9's own contract), so in practice this almost always
    // resolves via the direct `line.byteOffset === targetOffset` check
    // below, but the range check is what keeps this correct even if a
    // future caller ever passes a mid-line anchor instead.
    const index = state.lines.findIndex(
      line =>
        targetOffset >= line.byteOffset &&
        targetOffset < line.byteOffset + line.byteLength,
    )
    // A missing target is a silent no-op scroll, never a thrown error —
    // per this unit's own brief: the 'around' read guarantees the anchor's
    // own line is present, but this guards defensively against any future
    // inconsistency rather than crashing the whole viewer over a scroll
    // that simply doesn't happen.
    if (index === -1) return
    virtualizer.scrollToIndex(index, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.windowStart, state.windowEnd])

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

  // U12: the shared row-render block both view modes use — factored out
  // once (rather than duplicated per branch below) since it is otherwise
  // byte-for-byte identical between raw/search-navigator mode and filtered-
  // projection mode: both read from `activeLines` (already picked above)
  // and the SAME `virtualizer`/`virtualItems`, differing only in the
  // surrounding loading/edge-marker chrome each mode renders around it.
  const virtualRowList = (
    <div
      style={{
        height: virtualizer.getTotalSize(),
        position: 'relative',
        width: '100%',
      }}
    >
      {virtualItems.map(virtualItem => {
        const line = activeLines[virtualItem.index]
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
              highlightText={highlightText ?? undefined}
            />
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      {/*
        U12: rendered above LogSearchBar (functional placement only — U14
        is the dedicated visual-refinement pass over this component's
        overall layout). `onFiltersChange`/`onClearFilters` fall back to
        no-ops when the caller doesn't provide them (a pre-U12 test/call
        site that never passes filter props at all) — filters is likewise
        defaulted to DEFAULT_FILTERS above, so LogFilters always receives a
        real (possibly empty) value regardless of what page.tsx does.
      */}
      <LogFilters
        stream={stream}
        filters={filters}
        onFiltersChange={onFiltersChange ?? (() => {})}
        onClearFilters={onClearFilters ?? (() => {})}
      />

      {/*
        U11/U12: functional placement only (near the top, above the live-
        status banner) — U14 is the dedicated visual-refinement pass over
        this component's overall layout, same as the banner below it.
        hideNavigation suppresses the hit-count/prev/next UI + auto-select
        while isFilteredProjection is true (see that prop's own header
        comment in log-search-bar.tsx) — the input itself and
        onQueryTextChange keep firing regardless, which is how a lone free-
        text term still composes into the filtered predicate (AE6) even
        though this component's own hit-navigator UI is hidden.
      */}
      <LogSearchBar
        stream={stream}
        currentFileSize={state.fileSize}
        onHitSelected={handleHitSelected}
        onSearchActiveChange={handleSearchActiveChange}
        onQueryTextChange={setQueryText}
        hideNavigation={isFilteredProjection}
      />

      {isFilteredProjection ? (
        // U12: a DELIBERATELY distinct, simpler banner from raw mode's own
        // following/paused/percent-through-file status below — none of
        // that raw-window state describes what's currently on screen while
        // a structured filter is active (state.windowStart/fileSize belong
        // to a byte range that isn't even being rendered right now), so
        // showing it here would be actively misleading rather than merely
        // unpolished. The one thing genuinely worth surfacing is the
        // filtered count itself.
        <div
          data-track-id="log-viewer-filtered-banner"
          className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-xs text-gray-500"
        >
          <span data-track-id="log-viewer-filtered-count">
            {filteredState.total} matching line
            {filteredState.total === 1 ? '' : 's'}.
          </span>
        </div>
      ) : (
        // U10: reflects live follow/pause state instead of Phase 1's static
        // "Snapshot — refresh for newer entries" framing, now that the tail
        // is actually wired in. Kept functional-but-plain here (data-
        // track-ids + minimal layout, no motion/visual polish) — U14 is the
        // dedicated visual-refinement pass over this exact banner.
        <div
          data-track-id="log-viewer-snapshot-banner"
          className="flex items-center justify-between gap-3 rounded border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-xs text-gray-500"
        >
          <span className="flex items-center gap-2">
            {following ? (
              <span data-track-id="log-viewer-following-indicator">
                Following live.
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span data-track-id="log-viewer-paused-indicator">Paused</span>
                <span
                  data-track-id="log-viewer-new-line-badge"
                  className="rounded bg-gray-800 px-1.5 py-0.5 text-gray-300"
                >
                  {newLineCount} new
                </span>
                <button
                  type="button"
                  data-track-id="log-viewer-jump-to-latest"
                  onClick={() => void handleJumpToLatest()}
                  className="rounded px-2 py-0.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
                >
                  Jump to latest
                </button>
              </span>
            )}
            <span>{percentThroughFile}% through file.</span>
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
      )}

      {isFilteredProjection ? (
        filteredLoad === 'pending' ? (
          // U12: held here (never the empty state below) until the scan
          // has genuinely resolved — the identical "no flash to empty"
          // discipline U11's own LogSearchBar already applies to its "No
          // results" state, applied here to "No lines match these
          // filters" for the same reason: a fetch simply hasn't landed yet
          // is not the same fact as "the file genuinely contains zero
          // matching lines," and conflating the two would flash a false
          // negative on every filter change.
          <div
            data-track-id="log-viewer-filtered-loading"
            className="flex min-h-32 items-center justify-center text-sm text-gray-500"
          >
            Scanning for matches…
          </div>
        ) : filteredState.matches.length === 0 ? (
          // U12: a DISTINCT empty state from raw mode's own per-tab
          // bootstrap empty state (log-viewer-empty, Phase 1) and from
          // LogSearchBar's own "No results" (a different, text-only-search
          // concept covering the search-navigator mode this component is
          // NOT in right now) — deliberately different copy/track-id so a
          // test (or an operator glancing at the DOM) can never confuse
          // "this file is empty" with "these filters matched nothing."
          <div
            data-track-id="log-viewer-filtered-empty"
            className="flex min-h-32 items-center justify-center text-sm text-gray-500"
          >
            No lines match these filters.
          </div>
        ) : (
          <div
            ref={scrollElementRef}
            data-track-id="log-viewer-scroll"
            className="h-[32rem] overflow-y-auto"
          >
            {virtualRowList}
            {filteredPageLoading && (
              <div
                data-track-id="log-viewer-loading-after"
                className="py-1 text-center text-xs text-gray-500"
              >
                Loading more matches…
              </div>
            )}
          </div>
        )
      ) : state.lines.length === 0 ? (
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

          {virtualRowList}

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
