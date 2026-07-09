import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import { api } from 'src/app/lib/api'
import { LogSearchBar } from 'src/app/logs/log-search-bar'
import type { LogSearchResponse } from 'src/logging/log-view.types'

// Mirrors log-viewer.spec.tsx's own render() wrapper — a FRESH QueryClient
// per render call (this codebase's established convention; see e.g.
// page.spec.tsx/config.page.spec.tsx), `retry: false` so a rejected mock
// never retries/times out a test.
function renderSearchBar(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

function makeResponse(
  overrides: Partial<LogSearchResponse> = {},
): LogSearchResponse {
  return { total: 0, matches: [], nextCursor: null, ...overrides }
}

// U12 extended LogSearchResponse.matches with a `raw` field (the matched
// line's own text) — this file's own tests never inspect `.raw` (LogSearchBar
// only ever reads `.byteOffset` off a match, per that component's own header
// comment on why the U12 response-shape extension didn't require any change
// to this component), so a synthetic-but-valid placeholder per offset is
// sufficient to satisfy the type without affecting any existing assertion.
function offsets(...values: number[]): { byteOffset: number; raw: string }[] {
  return values.map(byteOffset => ({ byteOffset, raw: `raw-${byteOffset}` }))
}

beforeEach(() => {
  jest.spyOn(api, 'searchLog').mockReset()
})

afterEach(() => {
  jest.restoreAllMocks()
})

async function typeQuery(text: string) {
  const user = userEvent.setup()
  const input = screen.getByPlaceholderText(/search this file/i)
  await user.type(input, text)
  return user
}

describe('LogSearchBar — AE2 (R9, R10): a single hit near the top of a huge file', () => {
  it('shows "hit 1 of 1" and fires onHitSelected with the correct byte offset, without waiting for any separately-loaded content', async () => {
    jest
      .spyOn(api, 'searchLog')
      .mockResolvedValue(
        makeResponse({ total: 1, matches: offsets(4096), nextCursor: null }),
      )
    const onHitSelected = jest.fn()
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={200_000_000}
        onHitSelected={onHitSelected}
        onSearchActiveChange={jest.fn()}
      />,
    )

    await typeQuery('needle')

    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 1/i)).toBeInTheDocument(),
    )
    expect(onHitSelected).toHaveBeenCalledWith(4096, 'needle')
    // Not "0 of 0" or any placeholder — the count is the real, exact one
    // from the response, not something derived from what the client
    // separately has loaded (there is nothing else loaded at all here).
    expect(screen.queryByText(/hit 0 of 0/i)).not.toBeInTheDocument()
  })
})

describe('LogSearchBar — happy path: 5 hits, single page', () => {
  function setupFiveHits() {
    jest.spyOn(api, 'searchLog').mockResolvedValue(
      makeResponse({
        total: 5,
        matches: offsets(10, 20, 30, 40, 50),
        nextCursor: null,
      }),
    )
    const onHitSelected = jest.fn()
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={onHitSelected}
        onSearchActiveChange={jest.fn()}
      />,
    )
    return { onHitSelected }
  }

  it('shows "5" as the total and auto-selects hit 1 (offset 10) immediately', async () => {
    const { onHitSelected } = setupFiveHits()
    await typeQuery('x')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 5/i)).toBeInTheDocument(),
    )
    expect(onHitSelected).toHaveBeenCalledWith(10, 'x')
  })

  it('next() cycles 1→2→3→4→5→1 (wrapping), re-firing onHitSelected with the correct offset at every step', async () => {
    const { onHitSelected } = setupFiveHits()
    const user = await typeQuery('x')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 5/i)).toBeInTheDocument(),
    )

    const nextButton = screen.getByRole('button', { name: /^next$/i })
    const expectedOffsets = [20, 30, 40, 50, 10] // steps 2..5, then wraps to 1
    for (const [i, offset] of expectedOffsets.entries()) {
      await user.click(nextButton)
      await waitFor(() =>
        expect(
          screen.getByText(
            new RegExp(`hit ${(i % 5) + 2 > 5 ? 1 : (i % 5) + 2}`, 'i'),
          ),
        ).toBeInTheDocument(),
      )
      expect(onHitSelected).toHaveBeenLastCalledWith(offset, 'x')
    }
  })

  it('prev() from hit 1 wraps to hit 5 (offset 50)', async () => {
    const { onHitSelected } = setupFiveHits()
    const user = await typeQuery('x')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 5/i)).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /^prev$/i }))
    await waitFor(() =>
      expect(screen.getByText(/hit 5 of 5/i)).toBeInTheDocument(),
    )
    expect(onHitSelected).toHaveBeenLastCalledWith(50, 'x')
  })
})

describe('LogSearchBar — pagination: total exceeds one page', () => {
  it('stepping next() past the loaded page fetches the SAME server-issued nextCursor (not a re-scan from the top), appends, and selects the new hit', async () => {
    const searchLogSpy = jest
      .spyOn(api, 'searchLog')
      .mockResolvedValueOnce(
        makeResponse({
          total: 3,
          matches: offsets(100),
          nextCursor: 'cursor-abc',
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          total: 3,
          matches: offsets(200),
          nextCursor: null,
        }),
      )
    const onHitSelected = jest.fn()
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={onHitSelected}
        onSearchActiveChange={jest.fn()}
      />,
    )
    const user = await typeQuery('term')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 3/i)).toBeInTheDocument(),
    )
    expect(onHitSelected).toHaveBeenLastCalledWith(100, 'term')

    await user.click(screen.getByRole('button', { name: /^next$/i }))

    await waitFor(() =>
      expect(screen.getByText(/hit 2 of 3/i)).toBeInTheDocument(),
    )
    expect(onHitSelected).toHaveBeenLastCalledWith(200, 'term')

    // The critical assertion: the SECOND call must carry the server's own
    // nextCursor verbatim, never `undefined` (which would mean "re-scan
    // from the top" — exactly the bug this pagination design exists to
    // prevent).
    expect(searchLogSpy).toHaveBeenCalledTimes(2)
    expect(searchLogSpy.mock.calls[1]?.[0]).toMatchObject({
      cursor: 'cursor-abc',
    })
    expect(searchLogSpy.mock.calls[0]?.[0]).toMatchObject({
      cursor: undefined,
    })
  })

  it('a next()-triggered page fetch that resolves AFTER the query text has since changed does not splice its stale results onto the new query (searchGenerationRef guard)', async () => {
    // next()'s own page-2+ fetch bypasses useQuery entirely (see
    // fetchNextPageDirectly's own header comment for why), so it gets none
    // of react-query's built-in "ignore a response for a superseded query
    // key" protection the debounce+abort tests above rely on — this test
    // exists to prove the SEPARATE searchGenerationRef guard next() itself
    // carries covers the identical race. The first page's fetch resolves
    // immediately (auto-selecting hit 1 of 'first'); clicking Next kicks
    // off a page-2 fetch that is deliberately left pending until AFTER the
    // query text has already changed to 'second' and ITS OWN first page
    // has already landed and replaced the accumulator — only then does the
    // stale page-2 response resolve.
    let resolveStalePage: ((response: LogSearchResponse) => void) | undefined
    const searchLogSpy = jest
      .spyOn(api, 'searchLog')
      .mockImplementationOnce(() =>
        Promise.resolve(
          makeResponse({
            total: 3,
            matches: offsets(100),
            nextCursor: 'cursor-abc',
          }),
        ),
      )
      .mockImplementationOnce(
        () =>
          new Promise<LogSearchResponse>(resolve => {
            resolveStalePage = resolve
          }),
      )
      .mockResolvedValueOnce(
        makeResponse({ total: 1, matches: offsets(999), nextCursor: null }),
      )

    const onHitSelected = jest.fn()
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={onHitSelected}
        onSearchActiveChange={jest.fn()}
      />,
    )
    const user = await typeQuery('first')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 3/i)).toBeInTheDocument(),
    )

    // Kick off the (deliberately never-resolving-yet) page-2 fetch.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() => expect(searchLogSpy).toHaveBeenCalledTimes(2))
    onHitSelected.mockClear()

    // Change the query entirely — a genuinely new logical search, whose own
    // first page resolves and replaces the accumulator BEFORE the stale
    // page-2 fetch above ever settles.
    const input = screen.getByPlaceholderText(/search this file/i)
    await user.clear(input)
    await user.type(input, 'second')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 1/i)).toBeInTheDocument(),
    )
    expect(onHitSelected).toHaveBeenCalledWith(999, 'second')
    onHitSelected.mockClear()

    // NOW let the stale 'first'-query page-2 fetch resolve. Without the
    // searchGenerationRef guard, this would splice offset 200 onto the
    // 'second' query's accumulator and re-fire onHitSelected with a byte
    // offset that belongs to a search the user no longer has typed.
    await act(async () => {
      resolveStalePage?.(
        makeResponse({ total: 3, matches: offsets(200), nextCursor: null }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onHitSelected).not.toHaveBeenCalled()
    expect(screen.getByText(/hit 1 of 1/i)).toBeInTheDocument()
    expect(screen.queryByText(/of 3/i)).not.toBeInTheDocument()
  })
})

describe('LogSearchBar — debounce + abort', () => {
  it('a burst of rapid keystrokes that settle on a final value fires exactly ONE fetch (the debounce timer is cancelled and restarted on every change)', async () => {
    jest
      .spyOn(api, 'searchLog')
      .mockResolvedValue(makeResponse({ total: 0, matches: [] }))
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={jest.fn()}
        onSearchActiveChange={jest.fn()}
      />,
    )

    // userEvent.type() dispatches one keystroke at a time with no delay by
    // default — exactly the "rapid burst" this debounce must collapse.
    await typeQuery('needle')

    // A generous settle window comfortably past SEARCH_DEBOUNCE_MS (300ms)
    // — using waitFor rather than a raw timer advance since this file
    // does not use jest.useFakeTimers() (see the next test's own comment
    // on why fake timers are used THERE instead, where the exact abort
    // signal identity across a timer-driven settle needs to be provable).
    await waitFor(() => expect(api.searchLog).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    })
    expect(api.searchLog).toHaveBeenCalledWith(
      expect.objectContaining({ stream: 'backend', text: 'needle' }),
      expect.anything(),
    )
  })

  it('changing the query text mid-debounce aborts the in-flight request for the OLD text once the new text settles', async () => {
    // The first request is deliberately left PENDING (never resolved) —
    // proving an abort actually cancels something genuinely in-flight,
    // not a request that had already settled by the time the second one
    // fired. react-query has nothing to cancel against an already-
    // resolved fetch's signal, so a version of this test whose mock
    // resolves synchronously would pass even with the abort wiring
    // completely removed — this is the version that actually proves it.
    let capturedFirstSignal: AbortSignal | undefined
    const searchLogSpy = jest
      .spyOn(api, 'searchLog')
      .mockImplementationOnce((_params, signal) => {
        capturedFirstSignal = signal
        return new Promise<LogSearchResponse>(() => {}) // never resolves
      })
      .mockResolvedValueOnce(makeResponse({ total: 1, matches: offsets(1) }))

    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={jest.fn()}
        onSearchActiveChange={jest.fn()}
      />,
    )
    const user = userEvent.setup()
    const input = screen.getByPlaceholderText(/search this file/i)

    // Settle on "first" and let its debounce fire — its request goes out
    // and stays pending (per the mock above).
    await user.type(input, 'first')
    await waitFor(() => expect(searchLogSpy).toHaveBeenCalledTimes(1))
    expect(capturedFirstSignal?.aborted).toBe(false)

    // Change the text — a new debounced value produces a new queryKey
    // (different `text`), which is what makes react-query cancel the
    // now-superseded FIRST query's own in-flight fetch once the SECOND
    // one's debounce settles and actually fires.
    await user.clear(input)
    await user.type(input, 'second')
    await waitFor(() => expect(searchLogSpy).toHaveBeenCalledTimes(2))

    // The FIRST request's signal is now aborted — proving react-query
    // itself cancelled the stale in-flight query once the key changed,
    // which is the entire point of forwarding queryFn's signal into
    // api.searchLog (see that function's own header comment in api.ts)
    // rather than hand-rolling an AbortController.
    await waitFor(() => expect(capturedFirstSignal?.aborted).toBe(true))
  })
})

describe('LogSearchBar — clearing the query', () => {
  it('calls onSearchActiveChange(false) and fires no search request', async () => {
    jest.spyOn(api, 'searchLog').mockResolvedValue(makeResponse())
    const onSearchActiveChange = jest.fn()
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={jest.fn()}
        onSearchActiveChange={onSearchActiveChange}
      />,
    )

    // Never typed anything at all — the empty-query path must be reached
    // without any user action, since this is also literally the mount
    // state of a freshly-opened search bar.
    await waitFor(() =>
      expect(onSearchActiveChange).toHaveBeenCalledWith(false),
    )
    expect(api.searchLog).not.toHaveBeenCalled()
  })

  it('clearing a previously non-empty query back to empty also calls onSearchActiveChange(false) and stops fetching', async () => {
    jest
      .spyOn(api, 'searchLog')
      .mockResolvedValue(makeResponse({ total: 2, matches: offsets(1, 2) }))
    const onSearchActiveChange = jest.fn()
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={jest.fn()}
        onSearchActiveChange={onSearchActiveChange}
      />,
    )
    const user = await typeQuery('term')
    await waitFor(() => expect(onSearchActiveChange).toHaveBeenCalledWith(true))

    const input = screen.getByPlaceholderText(/search this file/i)
    await user.clear(input)

    await waitFor(() =>
      expect(onSearchActiveChange).toHaveBeenLastCalledWith(false),
    )
    // The prior 2-hit result is gone from the display, too — clearing the
    // query resets state.searchEnabled to false, which hides the count
    // entirely (see the component's own conditional render).
    expect(screen.queryByText(/hit \d+ of \d+/i)).not.toBeInTheDocument()
  })
})

describe('LogSearchBar — zero matches', () => {
  it('shows an honest "No results" state, not an error and not a stale previous count', async () => {
    jest
      .spyOn(api, 'searchLog')
      .mockResolvedValue(makeResponse({ total: 0, matches: [] }))
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={jest.fn()}
        onSearchActiveChange={jest.fn()}
      />,
    )
    await typeQuery('nonexistent')

    await waitFor(() =>
      expect(screen.getByText(/no results/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/hit \d+ of \d+/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^next$/i }),
    ).not.toBeInTheDocument()
  })
})

describe('LogSearchBar — "file grew — re-run" affordance', () => {
  it('appears once currentFileSize increases past the value it had when the current search started, and clicking it re-runs the search fresh', async () => {
    const searchLogSpy = jest
      .spyOn(api, 'searchLog')
      .mockResolvedValueOnce(
        makeResponse({ total: 1, matches: offsets(10), nextCursor: null }),
      )
    let currentSize = 1000
    const { rerender } = renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={currentSize}
        onHitSelected={jest.fn()}
        onSearchActiveChange={jest.fn()}
      />,
    )
    await typeQuery('term')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 1/i)).toBeInTheDocument(),
    )
    // No affordance yet — the file hasn't grown past what it was when this
    // search started.
    expect(
      screen.queryByRole('button', { name: /file grew/i }),
    ).not.toBeInTheDocument()

    currentSize = 5000
    searchLogSpy.mockResolvedValueOnce(
      makeResponse({ total: 4, matches: offsets(10, 20, 30, 40) }),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <LogSearchBar
          stream="backend"
          currentFileSize={currentSize}
          onHitSelected={jest.fn()}
          onSearchActiveChange={jest.fn()}
        />
      </QueryClientProvider>,
    )

    const rerunButton = await screen.findByRole('button', {
      name: /file grew/i,
    })
    const user = userEvent.setup()
    await user.click(rerunButton)

    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 4/i)).toBeInTheDocument(),
    )
    expect(searchLogSpy).toHaveBeenCalledTimes(2)
  })

  it('re-running AFTER having already paged forward (cursor is non-undefined at rerun time) re-scans from page 1, not from the stale cursor', async () => {
    // This is the scenario a naive `searchQuery.refetch()` implementation
    // gets wrong: refetch() re-invokes queryFn for whichever query THIS
    // RENDER's closure is bound to — if cursor was already something
    // other than undefined at rerun time, a refetch()-based
    // implementation would re-fetch THAT stale cursor's page, not a fresh
    // page 1, even after the component's OWN state has been reset to
    // cursor: undefined. Proven here by paging forward first (making
    // cursor genuinely non-undefined) before ever clicking rerun.
    const searchLogSpy = jest
      .spyOn(api, 'searchLog')
      .mockResolvedValueOnce(
        makeResponse({
          total: 3,
          matches: offsets(10),
          nextCursor: 'page-2-cursor',
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({ total: 3, matches: offsets(20), nextCursor: null }),
      )
    let currentSize = 1000
    const { rerender } = renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={currentSize}
        onHitSelected={jest.fn()}
        onSearchActiveChange={jest.fn()}
      />,
    )
    const user = await typeQuery('term')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 3/i)).toBeInTheDocument(),
    )

    // Page forward once — this is what makes the component's OWN
    // `cursor` state genuinely non-undefined ('page-2-cursor') at the
    // moment rerun is later clicked.
    await user.click(screen.getByRole('button', { name: /^next$/i }))
    await waitFor(() =>
      expect(screen.getByText(/hit 2 of 3/i)).toBeInTheDocument(),
    )
    expect(searchLogSpy).toHaveBeenCalledTimes(2)

    // File grows — the affordance appears.
    currentSize = 5000
    searchLogSpy.mockResolvedValueOnce(
      makeResponse({
        total: 1,
        matches: offsets(99),
        nextCursor: null,
      }),
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <LogSearchBar
          stream="backend"
          currentFileSize={currentSize}
          onHitSelected={jest.fn()}
          onSearchActiveChange={jest.fn()}
        />
      </QueryClientProvider>,
    )
    const rerunButton = await screen.findByRole('button', {
      name: /file grew/i,
    })
    await user.click(rerunButton)

    // The THIRD call is a fresh page-1 scan: cursor must be undefined,
    // never the stale 'page-2-cursor' the component was still holding the
    // instant before this click. Settling for a beat AFTER reaching 3
    // (rather than resolving the instant the count first reaches 3, which
    // a buggy two-fetch implementation — one for the stale cursor via a
    // naive refetch() call, a second automatic one once the key genuinely
    // changes — would ALSO eventually satisfy) is what actually
    // distinguishes "exactly one fetch, correctly keyed" from "the right
    // fetch eventually happened, alongside an earlier wrong one."
    await waitFor(() => expect(searchLogSpy).toHaveBeenCalledTimes(3))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(searchLogSpy).toHaveBeenCalledTimes(3)
    expect(searchLogSpy.mock.calls[2]?.[0]).toMatchObject({
      cursor: undefined,
    })
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 1/i)).toBeInTheDocument(),
    )
  })
})

describe('LogSearchBar — loading treatment: no flash to empty', () => {
  it('keeps showing the PREVIOUS hit count/selection while a new query is in flight, only replacing it once the new results land', async () => {
    let resolveSecond: ((value: LogSearchResponse) => void) | undefined
    const onHitSelected = jest.fn()
    jest
      .spyOn(api, 'searchLog')
      .mockResolvedValueOnce(
        makeResponse({ total: 2, matches: offsets(10, 20), nextCursor: null }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<LogSearchResponse>(resolve => {
            resolveSecond = resolve
          }),
      )
    renderSearchBar(
      <LogSearchBar
        stream="backend"
        currentFileSize={1000}
        onHitSelected={onHitSelected}
        onSearchActiveChange={jest.fn()}
      />,
    )
    const user = await typeQuery('first')
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 2/i)).toBeInTheDocument(),
    )

    const input = screen.getByPlaceholderText(/search this file/i)
    await user.clear(input)
    await user.type(input, 'second')

    // Wait for the SECOND request to have actually gone out (not merely
    // for the debounce-pending "Searching…" indicator, which appears
    // instantly on keystroke — well before the debounce interval elapses
    // — and would let this assertion pass vacuously before resolveSecond
    // is even assigned) — this is what proves the in-flight request is
    // genuinely unresolved at the moment the "still showing the OLD
    // result" assertion below runs.
    await waitFor(() => expect(api.searchLog).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/searching/i)).toBeInTheDocument()
    expect(screen.getByText(/hit 1 of 2/i)).toBeInTheDocument()

    resolveSecond?.(makeResponse({ total: 1, matches: offsets(99) }))
    await waitFor(() =>
      expect(screen.getByText(/hit 1 of 1/i)).toBeInTheDocument(),
    )
    expect(onHitSelected).toHaveBeenLastCalledWith(99, 'second')
  })
})
