'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api, queryKeys } from 'src/app/lib/api'
import type { LogStream } from 'src/logging/log-view.types'

// U11: debounces a rapidly-changing value, settling on `value` only once it
// has stopped changing for `delayMs`. Deliberately a tiny standalone hook
// rather than a shared package/util — this codebase has NO existing
// client-side debounce utility (confirmed: no other page needs one; even
// events/page.tsx's own filter inputs, the closest idiom, fire a query on
// every keystroke with no debounce at all — see that file), and a
// whole-file server-side scan is expensive enough on a large file that
// firing one per keystroke would be wasteful in a way a DB-backed list
// query is not. Kept local to this module rather than promoted to
// packages/utils since nothing else in the app needs it yet.
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    // Clearing the PRIOR timer on every value change is what makes a burst
    // of rapid keystrokes settle into exactly ONE eventual update — each
    // keystroke schedules a new timer and cancels whatever the previous
    // keystroke had scheduled, so only the LAST keystroke's timer ever
    // actually fires (this is the whole debounce contract; see this
    // module's own test scenarios for the "only one fetch for a burst"
    // assertion this directly produces).
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

const SEARCH_DEBOUNCE_MS = 300

export interface LogSearchBarProps {
  stream: LogStream
  currentFileSize: number
  onHitSelected: (byteOffset: number, matchText: string) => void
  // true once a non-empty query produces a session with total > 0 handling
  // underway; false when the query is cleared back to empty. NOT toggled
  // for a genuinely empty (0-match) result — that is still an "active"
  // search session with an honest zero-results state, just never one that
  // has a hit to select; see the "zero matches" test scenario for why this
  // distinction matters to the caller (log-viewer.tsx clears
  // `highlightText` only on a hard `false`, not on every render where
  // `total` happens to be 0).
  onSearchActiveChange: (active: boolean) => void
}

// One accumulated page of hit offsets for the CURRENT logical search,
// plus the cursor to resume from for the next page. Reset to empty
// whenever debouncedQuery (the TEXT) changes — see the effect below —
// since a new query starts an entirely new logical search with its own
// independent page sequence; `nextCursor` from a PRIOR query's pages must
// never be round-tripped into a request for a different query's text.
interface Accumulator {
  matches: { byteOffset: number }[]
  nextCursor: string | null
  total: number
}

const EMPTY_ACCUMULATOR: Accumulator = {
  matches: [],
  nextCursor: null,
  total: 0,
}

export function LogSearchBar({
  stream,
  currentFileSize,
  onHitSelected,
  onSearchActiveChange,
}: LogSearchBarProps) {
  const [inputValue, setInputValue] = useState('')
  const debouncedQuery = useDebouncedValue(inputValue, SEARCH_DEBOUNCE_MS)

  // The page useQuery below fetches — always undefined in this
  // component's actual usage (page 1 of the current debouncedQuery is the
  // ONLY page ever driven through useQuery's own reactivity). Deviation
  // from this unit's brief, disclosed explicitly: the brief's design
  // decision #3 describes next() triggering a subsequent page fetch "via
  // the same cursor-keyed useQuery mechanism," but this implementation
  // instead has BOTH next()'s single-page-forward step and prev()'s
  // backward-wrap sequential loop fetch directly via
  // fetchNextPageDirectly (a plain async api.searchLog call, bypassing
  // useQuery/this state entirely) — see that function's own comment for
  // why. Kept `cursor` as real (not removed) state anyway because it is
  // still genuinely load-bearing for two OTHER real paths: it is what the
  // query key below actually reads (so a debounced-query change or a
  // rerun forces useQuery to fetch page 1 fresh, never accidentally
  // resuming some prior page), and setCursor(undefined) alongside
  // rerunNonce's own increment is what handleRerun uses to force that
  // fresh page-1 fetch. If a future unit reintroduces reactive
  // useQuery-driven forward paging, this is the field it would need to
  // start setting to something other than undefined.
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  // Accumulates every page's matches for the search identified by
  // debouncedQuery — see Accumulator's own header comment. `total` here is
  // always the latest response's total (U9 guarantees it is frozen/stable
  // across every page of ONE logical search — see log-search.service.ts's
  // own cursor-design header comment — so overwriting it on every page
  // response is safe and never regresses to a stale smaller value).
  const [accumulator, setAccumulator] = useState<Accumulator>(EMPTY_ACCUMULATOR)
  // 0-based index into the CONCEPTUAL full ordered set of `total` hits.
  // null exactly when there is no active selection yet (before the first
  // page of a fresh search has landed, or the query is empty).
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)

  // The file size AT THE MOMENT the current logical search's page-1 scan
  // was kicked off — snapshotted fresh every time debouncedQuery changes to
  // a non-empty value (see the effect below). Compared against the LIVE
  // currentFileSize prop (continuously updated by U10's tail) to drive the
  // "file grew — re-run" affordance: U9's LogSearchResponse deliberately
  // does NOT expose the scan's own frozen ceiling to the client (it's
  // opaque inside nextCursor, never meant to be decoded here — see this
  // component's own brief), so this is the one signal available for
  // detecting staleness from data this component already has for free.
  const [scanStartFileSize, setScanStartFileSize] = useState(0)

  // Set while a backward-wrap (prev() from hit 0) is fetching every
  // remaining page in a sequential loop — distinct from useQuery's own
  // isFetching, which only covers ONE page at a time and would flicker
  // through several intermediate "not fetching" gaps mid-loop.
  const [wrapLoading, setWrapLoading] = useState(false)

  // Folded into the query key below SOLELY so handleRerun's "file grew —
  // re-run" click can force a genuinely NEW page-1 fetch even when
  // `cursor` is ALREADY undefined (the common case: re-running before
  // ever paging forward at all) — without this, resetting cursor to a
  // value it already holds would leave the queryKey byte-for-byte
  // unchanged, and useQuery would have no reason to ever re-invoke
  // queryFn. Deliberately NOT used for the ordinary debouncedQuery-change
  // path above (that path already changes the key via `text` itself) —
  // this exists for exactly one caller.
  const [rerunNonce, setRerunNonce] = useState(0)

  // Sequences every state-mutating effect below against a STALE debounced
  // query having its async work land after a newer one has already
  // superseded it. React Query's own AbortSignal handles cancelling the
  // underlying fetch for the `useQuery`-driven page-1/next-page fetches
  // (see the query below), but the backward-wrap loop in prev() below
  // issues its OWN sequential api.searchLog calls outside of useQuery
  // entirely (see that function's own comment on why), so it needs its
  // own guard against applying results after debouncedQuery has since
  // changed out from under it.
  const searchGenerationRef = useRef(0)

  // Kicks off a brand-new logical search the moment debouncedQuery settles
  // on a new value: always resets `cursor` to undefined (so the useQuery
  // below fetches PAGE 1 of the new query, never resuming some OLD query's
  // cursor) and clears wrapLoading (a stale backward-wrap loop from the
  // PRIOR query must never keep spinning against this new one — see
  // searchGenerationRef's own guard in prev() below, which this
  // increment is what actually invalidates).
  //
  // Deliberately does NOT clear `accumulator`/`currentIndex` here for a
  // non-empty new query — see Resolved design decision #5 ("no flash to
  // empty"): the PREVIOUS query's results must stay exactly as displayed
  // until the NEW query's first page actually lands, which is handled by
  // the query-settle effect below via its own `isFreshFirstPage ? replace
  // : append` branch (cursor being reset to undefined here is exactly
  // what makes that branch take the REPLACE path once the new data
  // arrives). An EMPTY (post-trimmed) query is the one case that DOES
  // clear the display immediately — there is no future response coming
  // that would ever replace it (no scan request is made for an empty
  // query at all), so leaving stale hits on screen after the user
  // explicitly cleared the box would be actively wrong, not merely a
  // premature flash.
  useEffect(() => {
    searchGenerationRef.current += 1
    const trimmed = debouncedQuery.trim()
    setCursor(undefined)
    setWrapLoading(false)
    if (trimmed.length === 0) {
      setAccumulator(EMPTY_ACCUMULATOR)
      setCurrentIndex(null)
      onSearchActiveChange(false)
      return
    }
    setScanStartFileSize(currentFileSize)
    // onSearchActiveChange(true) is NOT fired here — it fires once the
    // first page actually lands with total > 0 (see the query-settle
    // effect below), matching this prop's own documented "a session with
    // total > 0 handling underway" contract rather than firing the instant
    // a non-empty character is typed, before any result is even known.
    //
    // Deliberately NOT keyed on currentFileSize/onSearchActiveChange: this
    // effect's job is "a NEW query started," which only ever happens on a
    // debouncedQuery change. Adding currentFileSize here would re-run this
    // reset on every single live-tail byte the file grows by, which is
    // exactly the opposite of the "file grew — re-run" AFFORDANCE this
    // unit calls for (an explicit user action), not an automatic reset).
    // onSearchActiveChange is a caller-supplied callback invoked, never a
    // reactive input this effect's OWN logic depends on re-running for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  const trimmedQuery = debouncedQuery.trim()
  const searchEnabled = trimmedQuery.length > 0

  // U9/U11: this is the ACTUAL debounce+abort mechanism, not a hand-rolled
  // one — see this file's own module header and the unit brief's own
  // "Resolved design decisions" #1 for the full rationale. useQuery's
  // queryFn receives an AbortSignal that fires the instant this query's
  // OWN key changes (a new `cursor` or a new `stream`/text combination) or
  // the component unmounts; forwarding it into api.searchLog's own
  // `signal` param is what makes "changing the query text aborts the
  // stale in-flight request" true for free, without a manually-managed
  // AbortController ref anywhere in this file.
  const searchQuery = useQuery({
    // `rerunNonce` is appended as an EXTRA key element (never folded into
    // queryKeys.logSearch itself — see that state's own header comment):
    // this is the one thing that lets handleRerun force a genuinely new
    // fetch even when stream/text/cursor are all byte-for-byte identical
    // to the currently-cached query.
    queryKey: [
      ...queryKeys.logSearch({ stream, text: trimmedQuery, cursor }),
      rerunNonce,
    ],
    queryFn: ({ signal }) =>
      api.searchLog({ stream, text: trimmedQuery, cursor }, signal),
    enabled: searchEnabled,
    retry: false,
    // Never garbage-collect a page this search's own accumulator might
    // still reference while paging — matches this component's own
    // lifetime rather than react-query's default 5-minute window, which is
    // irrelevant either way since the accumulator (not the cache) is what
    // this component actually reads from for hit content.
    staleTime: Infinity,
  })

  // Applies a newly-landed page's response into the accumulator +
  // auto-selects hit 0 the moment a FRESH search's first page lands with
  // total > 0 (browser-find-in-page UX, per this unit's brief — no extra
  // click required). Keyed on the raw query `data` reference (react-query
  // only produces a NEW object on an actual successful resolution, never
  // on a re-render with unchanged data) rather than re-running on every
  // render, so a page is appended into the accumulator EXACTLY once per
  // response, regardless of how many times this component re-renders
  // while that response sits in the react-query cache.
  const appliedDataRef = useRef<typeof searchQuery.data>(undefined)
  useEffect(() => {
    if (!searchQuery.data || searchQuery.data === appliedDataRef.current) {
      return
    }
    appliedDataRef.current = searchQuery.data
    const response = searchQuery.data
    const isFreshFirstPage = cursor === undefined

    setAccumulator(prev => ({
      // A resumed (cursor !== undefined) page appends onto whatever this
      // logical search has already accumulated; a fresh first page
      // (cursor === undefined) REPLACES rather than appends — this is the
      // only path that can run right after the reset effect above cleared
      // the accumulator for a brand-new query, and also the path the
      // "file grew — re-run" re-fetch takes (see handleRerun below, which
      // resets cursor to undefined to force exactly this branch).
      matches: isFreshFirstPage
        ? response.matches
        : [...prev.matches, ...response.matches],
      nextCursor: response.nextCursor,
      total: response.total,
    }))

    if (response.total > 0) {
      onSearchActiveChange(true)
      if (isFreshFirstPage) {
        // Auto-select hit 0 the instant a fresh search's first page lands
        // — this is what makes AE2 hold even when the only match is deep
        // in a huge file and was never separately "loaded" by the client:
        // the hit's offset comes straight from THIS response, not from
        // anything the windowed view happened to already have on screen.
        setCurrentIndex(0)
        onHitSelected(response.matches[0]!.byteOffset, trimmedQuery)
      }
    } else if (isFreshFirstPage) {
      // An honest zero-match result for a genuinely NEW query — no
      // selection exists to make. searchActive stays whatever it already
      // is (true from a PRIOR non-empty search, or false if this is the
      // very first query typed) per onSearchActiveChange's own documented
      // contract: it only flips to false on an EMPTY query, never on a
      // zero-result one.
      setCurrentIndex(null)
    }
    // Deliberately NOT keyed on trimmedQuery/cursor/onHitSelected/
    // onSearchActiveChange: this effect's whole job is "react to
    // searchQuery.data having resolved to a NEW value," which the
    // appliedDataRef guard above already handles precisely; re-running it
    // for any of those other reasons would either double-apply the same
    // response or apply it against inputs that have since moved on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery.data])

  // Fetches ONE page directly via api.searchLog (bypassing useQuery/the
  // cache entirely) and appends it into the accumulator — the building
  // block both next()'s "fetch the next page before advancing" path and
  // prev()'s backward-wrap sequential-fetch loop share. Deliberately NOT
  // routed through setCursor+useQuery for these two callers: next() needs
  // the fetch to have ALREADY landed before it can compute the hit to
  // select (a setCursor call only schedules a future render; it cannot be
  // awaited), and prev()'s wrap needs a tight sequential loop of possibly
  // several pages before this component ever re-renders once — neither
  // shape fits "set state and let useQuery react to it."
  //
  // `expectedGeneration` gates the setAccumulator call itself, not just
  // what the CALLER does with the returned response — this is load-bearing,
  // not redundant with next()/prev()'s own post-await generation checks.
  // Both callers already re-check searchGenerationRef before acting on the
  // response (selecting a hit, continuing prev()'s loop), but a check
  // placed only in the caller cannot stop THIS function's own
  // setAccumulator call from running first: without gating it here too, a
  // stale page response would still merge its (wrong-query) matches/total/
  // nextCursor into whatever the accumulator holds by the time this
  // resolves — corrupting a NEW query's already-landed, already-correct
  // accumulator even though the caller correctly declined to select a hit
  // from it. Skipping the state update entirely when the generation has
  // moved on is what makes a stale response a true no-op, not merely a
  // no-op for hit-selection purposes.
  async function fetchNextPageDirectly(
    afterCursor: string,
    expectedGeneration: number,
  ) {
    const response = await api.searchLog({
      stream,
      text: trimmedQuery,
      cursor: afterCursor,
    })
    if (searchGenerationRef.current === expectedGeneration) {
      setAccumulator(prev => ({
        matches: [...prev.matches, ...response.matches],
        nextCursor: response.nextCursor,
        total: response.total,
      }))
    }
    return response
  }

  function selectIndex(index: number, matches: { byteOffset: number }[]) {
    const match = matches[index]
    if (!match) return
    setCurrentIndex(index)
    onHitSelected(match.byteOffset, trimmedQuery)
  }

  // next(): advances to the following hit, wrapping 1-past-the-end back to
  // hit 0 (matches[0] is always already loaded — it's in page 1, which by
  // this point has necessarily already landed for currentIndex to be
  // non-null at all). If the next hit isn't loaded yet but a further page
  // exists (nextCursor non-null), fetch it first and append, THEN advance
  // — this is what makes "stepping past the loaded page's last entry
  // triggers a fetch using nextCursor, not a re-scan from the top" true
  // (this unit's own explicit test requirement).
  //
  // Guarded by searchGenerationRef exactly like prev()'s backward-wrap loop
  // below: fetchNextPageDirectly bypasses useQuery entirely (see that
  // function's own comment on why), so it gets none of react-query's
  // built-in "ignore a response for a query key the user has since moved
  // away from" protection. Without this guard, clicking Next and then
  // retyping the search box before the network round-trip completes would
  // splice the OLD query's next page onto whatever the NEW query's
  // accumulator holds by the time this resolves (or onto the old one, if
  // the new query's first page hasn't landed yet — see the reset effect's
  // own "no flash to empty" comment on why the accumulator isn't cleared
  // immediately), and navigate the viewer to a byte offset that belongs to
  // a search the user no longer has typed.
  async function next() {
    if (currentIndex === null || accumulator.total === 0) return
    const desired = currentIndex + 1
    if (desired >= accumulator.total) {
      selectIndex(0, accumulator.matches)
      return
    }
    if (desired < accumulator.matches.length) {
      selectIndex(desired, accumulator.matches)
      return
    }
    if (!accumulator.nextCursor) return // defensive: total says more exist but no cursor was issued
    const generation = searchGenerationRef.current
    const response = await fetchNextPageDirectly(
      accumulator.nextCursor,
      generation,
    )
    if (searchGenerationRef.current !== generation) return // superseded
    const merged = [...accumulator.matches, ...response.matches]
    selectIndex(desired, merged)
  }

  // prev(): steps back one hit, which is ALWAYS already loaded except for
  // the one wrap-backward-from-hit-0 case — every other backward step only
  // ever revisits a hit this component already fetched on some earlier
  // forward step. Wrapping from hit 0 to the LAST hit (total - 1) is the
  // one path that can require fetching every remaining page first: a user
  // who has only ever pressed "prev" from a fresh search (never "next")
  // may have nothing loaded past page 1 yet, so the last hit could sit
  // several pages beyond what's currently accumulated. This is a bounded
  // sequential loop — `total` and MAX_MATCHES_PER_PAGE-shaped pages mean
  // the loop runs at most a small, predictable number of iterations, never
  // an unbounded/open-ended fetch.
  async function prev() {
    if (currentIndex === null || accumulator.total === 0) return
    if (currentIndex > 0) {
      selectIndex(currentIndex - 1, accumulator.matches)
      return
    }
    const targetIndex = accumulator.total - 1
    if (targetIndex < accumulator.matches.length) {
      selectIndex(targetIndex, accumulator.matches)
      return
    }
    // Fetch every remaining page in sequence — a straightforward loop
    // rather than anything fancier, per this unit's own brief ("a real but
    // secondary case ... don't over-engineer beyond a straightforward
    // sequential-fetch loop"). Guarded by searchGenerationRef so a stale
    // loop from a query the user has since changed away from can never
    // apply its results against the WRONG (newer) logical search.
    const generation = searchGenerationRef.current
    setWrapLoading(true)
    try {
      let cursorToFetch = accumulator.nextCursor
      let merged = accumulator.matches
      while (cursorToFetch && merged.length < accumulator.total) {
        if (searchGenerationRef.current !== generation) return // superseded
        const response = await fetchNextPageDirectly(cursorToFetch, generation)
        merged = [...merged, ...response.matches]
        cursorToFetch = response.nextCursor
      }
      if (searchGenerationRef.current !== generation) return
      selectIndex(targetIndex, merged)
    } finally {
      if (searchGenerationRef.current === generation) setWrapLoading(false)
    }
  }

  // "File grew — re-run" (Resolved design decision #4): a real comparison
  // against the LIVE currentFileSize prop, never a fabricated/synthetic
  // signal. Only shown while a search is genuinely active (a total > 0
  // result exists to potentially be stale) and the file has GENUINELY
  // grown past the size it had when the CURRENT search started — not
  // merely "greater than 0," which would show the affordance permanently
  // on any nonempty file.
  const fileGrew =
    searchEnabled &&
    accumulator.total > 0 &&
    currentFileSize > scanStartFileSize

  function handleRerun() {
    searchGenerationRef.current += 1
    setAccumulator(EMPTY_ACCUMULATOR)
    setCurrentIndex(null)
    setWrapLoading(false)
    setScanStartFileSize(currentFileSize)
    appliedDataRef.current = undefined
    setCursor(undefined)
    // Incrementing rerunNonce (not calling searchQuery.refetch()) is what
    // FORCES a genuinely new fetch here: `cursor` may already BE undefined
    // at the moment this runs (re-running before ever paging forward is
    // the common case), in which case resetting it to undefined again
    // would leave the queryKey completely unchanged — and `refetch()`
    // re-invokes queryFn for whichever query THIS RENDER's closure over
    // `searchQuery` was bound to, which is the OLD (pre-reset) cursor's
    // query if cursor genuinely was something else, not a new page-1
    // fetch. rerunNonce sidesteps both problems: it changes the query key
    // on every click, unconditionally, so useQuery always sees a brand
    // new key and fetches it itself — no refetch() call needed at all.
    setRerunNonce(n => n + 1)
  }

  function handleInputChange(value: string) {
    setInputValue(value)
  }

  // Loading treatment (Resolved design decision #5): while a NEW query is
  // debouncing (inputValue !== debouncedQuery) or its first page is still
  // in flight (searchQuery.isFetching && cursor === undefined, i.e. a
  // page-1 fetch specifically — a page-2+ fetch mid-navigation should NOT
  // blank out the currently-displayed hit either, but that path already
  // shows its own result via selectIndex only once resolved, so this flag
  // only needs to cover the "haven't shown ANYTHING for this query yet"
  // window), the PREVIOUS accumulator/selection stay exactly as they were
  // — this component simply renders a "searching…" indicator alongside
  // whatever is still displayed, never flashing to empty.
  const isDebouncing = inputValue !== debouncedQuery
  const isFirstPageLoading = searchQuery.isFetching && cursor === undefined
  const showSearchingIndicator =
    searchEnabled && (isDebouncing || isFirstPageLoading || wrapLoading)

  const hasHit = currentIndex !== null && accumulator.total > 0

  return (
    <div
      data-track-id="log-search-bar"
      className="flex flex-wrap items-center gap-2 rounded border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-xs"
    >
      <input
        type="text"
        data-track-id="log-search-input"
        value={inputValue}
        onChange={e => handleInputChange(e.target.value)}
        placeholder="Search this file…"
        className="w-56 rounded bg-gray-800 px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none"
      />

      {searchEnabled && (
        <span
          data-track-id="log-search-count"
          className={cns(
            'text-gray-400',
            accumulator.total === 0 && 'italic text-gray-600',
          )}
        >
          {accumulator.total === 0
            ? 'No results'
            : `Hit ${(currentIndex ?? 0) + 1} of ${accumulator.total}`}
        </span>
      )}

      {searchEnabled && accumulator.total > 0 && (
        <span className="flex items-center gap-1">
          <button
            type="button"
            data-track-id="log-search-prev"
            disabled={!hasHit}
            onClick={() => void prev()}
            className="rounded px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            type="button"
            data-track-id="log-search-next"
            disabled={!hasHit}
            onClick={() => void next()}
            className="rounded px-1.5 py-0.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200 disabled:opacity-50"
          >
            Next
          </button>
        </span>
      )}

      {showSearchingIndicator && (
        <span data-track-id="log-search-loading" className="text-gray-500">
          Searching…
        </span>
      )}

      {fileGrew && (
        <button
          type="button"
          data-track-id="log-search-rerun"
          onClick={handleRerun}
          className="rounded px-1.5 py-0.5 text-gray-400 underline transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          File grew — re-run
        </button>
      )}
    </div>
  )
}
