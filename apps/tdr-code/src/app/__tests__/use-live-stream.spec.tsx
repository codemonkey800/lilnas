import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { api, queryKeys } from 'src/app/lib/api'
import { topicToQueryKey, useLiveStream } from 'src/app/lib/use-live-stream'
import { sessionTopic } from 'src/sse/sse.types'

// jsdom (jest-environment-jsdom) implements the DOM but not EventSource —
// confirmed by checking this repo's dependencies: there is no EventSource
// polyfill installed, and jsdom scopes itself to the DOM, not networking
// APIs beyond fetch-adjacent basics (same rationale jest.config.js's own
// header comment gives for why next/server's Request/Response globals are
// also absent under this project). A minimal hand-rolled mock stands in.
//
// Faithfulness matters here, not just convenience: a real EventSource
// dispatches a message with an `event: <name>` field ONLY to
// addEventListener(<name>, ...) listeners, never to the generic onmessage
// handler (onmessage fires exclusively for the default/unnamed "message"
// event type — confirmed against MDN's "Using server-sent events" guide).
// NestJS's @Sse() (sse.controller.ts) sets MessageEvent.type to the topic
// name for every real signal, so this mock must route by type via
// addEventListener/removeEventListener, matching use-live-stream.ts's own
// use of that same API — an earlier version of this mock invoked onmessage
// for every emitted event regardless of type, which passed tests against a
// hook that (incorrectly) only used onmessage, while the real browser API
// would never have delivered those events to it at all.
class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  private readonly listeners = new Map<
    string,
    Set<(event: MessageEvent<string>) => void>
  >()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  // Test helpers — not part of the real EventSource API.
  emitOpen(): void {
    this.onopen?.()
  }

  // Dispatches a NAMED event (the only kind this server ever sends) to
  // exactly the listeners registered for `type` — mirrors the real
  // dispatch-by-event-name behavior.
  emitTopic(type: string, data: unknown = { topic: type }): void {
    const event = { data: JSON.stringify(data), type } as MessageEvent<string>
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  emitError(): void {
    this.onerror?.()
  }

  // Exposed so a test can prove listener count returns to zero after
  // unmount (the mirror of use-live-stream.ts's own leak-guard cleanup).
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

function latestInstance(): MockEventSource {
  const instance = MockEventSource.instances.at(-1)
  if (!instance) throw new Error('No MockEventSource was constructed')
  return instance
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

// logToServer (browser-logger.ts) calls the raw global `fetch`, which jsdom
// under this project does NOT provide natively (confirmed by every other
// frontend spec that exercises logToServer — e.g. browser-logger.spec.tsx —
// installing this exact same stand-in). Only exercised by this file's
// malformed-payload test, but installed unconditionally so any future
// logToServer call added to the hook doesn't silently throw
// "fetch is not defined" in an unrelated test.
const mockFetch = jest.fn()

// jest.config.js's top-level clearMocks/restoreMocks do NOT apply per Jest
// PROJECT once a `projects` array is used (see config.page.spec.tsx's own
// header comment, which documents this exact gap empirically) — so a spy
// installed in one test bleeds its call history into the next test in this
// file unless explicitly torn down. jest.spyOn(...).mockRestore() in
// afterEach undoes the wrap entirely, and each test re-spies fresh via
// spyOnInvalidate() below.
function spyOnInvalidate(): jest.SpyInstance {
  return jest.spyOn(QueryClient.prototype, 'invalidateQueries')
}

beforeEach(() => {
  MockEventSource.instances = []
  global.EventSource = MockEventSource as unknown as typeof EventSource
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('useLiveStream', () => {
  it('invalidates queryKeys.live exactly once when a live-topic event arrives', () => {
    const invalidateSpy = spyOnInvalidate()
    renderHook(() => useLiveStream(['live']), { wrapper })

    latestInstance().emitTopic('live')

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: queryKeys.live },
      { cancelRefetch: false },
    )
  })

  it('registers a listener only for each subscribed topic, not for topics it was not told about', () => {
    renderHook(() => useLiveStream(['live']), { wrapper })
    const instance = latestInstance()

    expect(instance.listenerCount('live')).toBe(1)
    expect(instance.listenerCount('session:9')).toBe(0)

    // A real EventSource would never even invoke a listener that was never
    // registered — emitTopic('session:9') here is a no-op by construction
    // (the listener map has no entry for that type), which is itself the
    // proof: this hook cannot cross-invalidate an unrelated surface's query
    // key because the browser never delivers the event to it in the first
    // place, not because of any internal filtering this hook has to do.
    const invalidateSpy = spyOnInvalidate()
    latestInstance().emitTopic('session:9')
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('topicToQueryKey maps each of the three topic shapes to the correct query key', () => {
    expect(topicToQueryKey('live')).toEqual(queryKeys.live)
    expect(topicToQueryKey('bot-status')).toEqual(queryKeys.botStatus)
    expect(topicToQueryKey('session:9')).toEqual(queryKeys.session(9))
    expect(topicToQueryKey('not-a-real-topic')).toBeUndefined()
  })

  it('topicToQueryKey rejects a well-formed session: prefix carrying a malformed id, instead of trusting wire data blindly', () => {
    // These all pass isSessionTopic (the prefix is well-formed) but must be
    // rejected by the Number.isInteger/positivity guard that runs after —
    // the exact "browser must not trust wire data blindly" contract this
    // function's own header comment describes. A dropped guard here would
    // silently turn into queryKeys.session(NaN) (or a negative id) with no
    // failing test.
    expect(topicToQueryKey('session:abc')).toBeUndefined()
    expect(topicToQueryKey('session:1.5')).toBeUndefined()
    expect(topicToQueryKey('session:-5')).toBeUndefined()
  })

  it('ignores a keepalive event without invalidating anything', () => {
    const invalidateSpy = spyOnInvalidate()
    renderHook(() => useLiveStream(['live']), { wrapper })

    latestInstance().emitTopic('keepalive')

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('removes every topic and keepalive listener on unmount (leak guard)', () => {
    const { unmount } = renderHook(() => useLiveStream(['live']), { wrapper })
    const instance = latestInstance()

    expect(instance.listenerCount('live')).toBe(1)
    expect(instance.listenerCount('keepalive')).toBe(1)

    unmount()

    expect(instance.listenerCount('live')).toBe(0)
    expect(instance.listenerCount('keepalive')).toBe(0)
  })

  it('re-invalidates all subscribed keys on onopen, covering both the initial connect and a reconnect (F4/AE4)', () => {
    const invalidateSpy = spyOnInvalidate()
    renderHook(() => useLiveStream(['live']), { wrapper })
    const instance = latestInstance()

    // Initial connect.
    instance.emitOpen()
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenLastCalledWith(
      { queryKey: queryKeys.live },
      { cancelRefetch: false },
    )

    // Simulate EventSource's own auto-reconnect: the browser fires onerror
    // then, once the underlying connection re-establishes, onopen again —
    // this hook never recreates the EventSource itself for a reconnect.
    instance.emitError()
    instance.emitOpen()

    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenLastCalledWith(
      { queryKey: queryKeys.live },
      { cancelRefetch: false },
    )
  })

  it('closes the EventSource on unmount and does not invalidate for a topic event that arrives after unmount', () => {
    const { unmount } = renderHook(() => useLiveStream(['live']), { wrapper })
    const instance = latestInstance()
    const invalidateSpy = spyOnInvalidate()

    unmount()

    expect(instance.closed).toBe(true)

    // The listener was already removed by unmount's cleanup (see the leak-
    // guard test above), so this is structurally a no-op — asserting it
    // rather than assuming it, same as a stray already-in-flight callback
    // the hook's own `disposed` guard defends against.
    instance.emitTopic('live')

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  describe('session-expiry fallback', () => {
    it('fires exactly one authenticated request after the consecutive-onerror threshold, and does not re-fire on further errors', async () => {
      const getLiveSpy = jest.spyOn(api, 'getLive').mockResolvedValue({
        globalStatus: 'online',
        botOffline: false,
        items: [],
      })
      renderHook(() => useLiveStream(['live']), { wrapper })
      const instance = latestInstance()

      // Threshold is 3 consecutive onerror events with no intervening
      // onopen/topic-event (see use-live-stream.ts's
      // CONSECUTIVE_ERROR_THRESHOLD comment). Nothing else ever fires here —
      // this simulates a reconnect that never succeeds (e.g. a 401 on
      // /api/stream, which EventSource retries forever).
      instance.emitError()
      instance.emitError()
      expect(getLiveSpy).not.toHaveBeenCalled()

      instance.emitError()
      await waitFor(() => expect(getLiveSpy).toHaveBeenCalledTimes(1))

      // Further errors past the threshold must not re-fire — the fallback
      // fires once until a successful onopen/topic-event resets it.
      instance.emitError()
      instance.emitError()
      await Promise.resolve()
      expect(getLiveSpy).toHaveBeenCalledTimes(1)
    })

    it('resets the consecutive-error count on a topic event, so the threshold requires fresh consecutive errors afterward', async () => {
      const getLiveSpy = jest.spyOn(api, 'getLive').mockResolvedValue({
        globalStatus: 'online',
        botOffline: false,
        items: [],
      })
      renderHook(() => useLiveStream(['live']), { wrapper })
      const instance = latestInstance()

      instance.emitError()
      instance.emitError()
      instance.emitTopic('live')

      instance.emitError()
      instance.emitError()
      await Promise.resolve()
      expect(getLiveSpy).not.toHaveBeenCalled()

      instance.emitError()
      await waitFor(() => expect(getLiveSpy).toHaveBeenCalledTimes(1))
    })
  })
})

// U6: both bot-status poll sites (BotStatusWidget, ConfigPage) migrate to
// their own `useLiveStream(['bot-status'])` call, each opening its own
// EventSource (connection sharing/dedup across components is out of scope
// for this unit — see the U6 plan section). What matters is that a signal
// delivered to EITHER connection invalidates the SAME queryKeys.botStatus
// key, so whichever component(s) are mounted re-render with fresh data.
// This is proven most directly at the query-client level: React Query
// itself guarantees "invalidate this key" affects every observer of that
// key application-wide, so mounting two independent useLiveStream(['bot-
// status']) hooks (standing in for the widget's and the config page's own
// call sites, without needing to render either real component's markup/
// queryFn here — that would just re-test bot-status-widget.tsx/config/
// page.tsx's own unrelated rendering logic) and firing a signal on ONE of
// their connections is sufficient: if the OTHER hook's connection's
// listener also observes an invalidation of the identical key instance,
// the shared-key behavior holds regardless of which physical EventSource
// received the wire signal.
describe('useLiveStream — shared bot-status key across multiple mounts (U6)', () => {
  it('a bot-status signal delivered on one mount’s connection invalidates the same queryKeys.botStatus key that a second, independent mount also subscribes to', () => {
    const invalidateSpy = spyOnInvalidate()

    // Two independent mounts, each standing in for one of U6's two real
    // call sites (BotStatusWidget, ConfigPage) — each gets its OWN
    // EventSource per the hook's "one handle per key" rule.
    renderHook(() => useLiveStream(['bot-status']), { wrapper })
    renderHook(() => useLiveStream(['bot-status']), { wrapper })

    expect(MockEventSource.instances).toHaveLength(2)
    const [firstConnection, secondConnection] = MockEventSource.instances

    // Fire the signal on only the FIRST mount's connection — a real SSE hub
    // would push to every open connection subscribed to the topic, but this
    // isolates the assertion to "one signal, one key" rather than relying
    // on both connections happening to fire together.
    firstConnection?.emitTopic('bot-status')

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: queryKeys.botStatus },
      { cancelRefetch: false },
    )

    // The second mount's own connection independently receiving the same
    // topic invalidates the identical key instance — proving there is no
    // per-mount-scoped key, only the one shared queryKeys.botStatus that
    // both BotStatusWidget and ConfigPage read from in production.
    secondConnection?.emitTopic('bot-status')
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
    expect(invalidateSpy).toHaveBeenLastCalledWith(
      { queryKey: queryKeys.botStatus },
      { cancelRefetch: false },
    )
  })

  // Covers F2 (restart convergence appears live): today, a starting->online
  // transition is only visible once every 5s (whatever the poll happens to
  // catch). After U3/U4 (backend) + this unit (frontend), each transition
  // gets its own bot-status signal, so the indicator flips per actual
  // transition instead of being coalesced into a poll tick. There is
  // nothing to CODE for this beyond removing the poll and trusting the
  // push signal (already done above) — this test proves the payoff: a
  // sequence of distinct signals (simulating starting, then online) each
  // triggers its OWN invalidateQueries call, not one coalesced call for
  // the whole sequence.
  it('a sequence of distinct bot-status signals (simulating starting -> online) each triggers its own invalidateQueries call, not coalesced into one (F2)', () => {
    const invalidateSpy = spyOnInvalidate()
    renderHook(() => useLiveStream(['bot-status']), { wrapper })
    const instance = latestInstance()

    // Three separate signals on three separate "ticks" of the underlying
    // bot lifecycle (e.g. starting, then online, then a later heartbeat) —
    // nothing here coalesces multiple emitTopic calls the way the bot-side
    // NotifyEmitterService's ~50ms coalesce window or the server-side hub's
    // throttle would upstream of the wire; this hook has no throttleMs set
    // for bot-status (U6 callers don't pass one), so every signal that
    // reaches the browser is invalidated 1:1.
    instance.emitTopic('bot-status')
    instance.emitTopic('bot-status')
    instance.emitTopic('bot-status')

    expect(invalidateSpy).toHaveBeenCalledTimes(3)
    for (const call of invalidateSpy.mock.calls) {
      expect(call).toEqual([
        { queryKey: queryKeys.botStatus },
        { cancelRefetch: false },
      ])
    }
  })
})

// U7: session detail page — the first call site to actually turn the
// throttle knob on (session:<id> is the highest-churn topic: an active
// agent turn can emit many chunks/tool-call-updates per second). The
// scoping test below proves F1/AE1 end-to-end for the session-topic shape
// specifically (prior units only exercised live/bot-status); the throttle
// tests are the core proof of the coalescing property this unit exists to
// deliver (R7 / the plan's "Client refetch coalescing is explicit, not
// assumed" decision).
describe('useLiveStream — session topic scoping and throttle coalescing (U7)', () => {
  const THROTTLE_MS = 300 // mirrors page.tsx's SESSION_STREAM_THROTTLE_MS

  it('a session:<id> signal invalidates queryKeys.session(id); a signal for a different session id does not (F1/AE1)', () => {
    const invalidateSpy = spyOnInvalidate()
    renderHook(() => useLiveStream([sessionTopic(1)]), { wrapper })
    const instance = latestInstance()

    instance.emitTopic(sessionTopic(1))

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: queryKeys.session(1) },
      { cancelRefetch: false },
    )

    // A real EventSource would never deliver an event for a topic this
    // connection never subscribed to (no addEventListener(sessionTopic(2))
    // was ever registered) — emitTopic on an unregistered type is a no-op
    // by construction here, same as the pre-existing live/session:9 test
    // above. Asserting it end-to-end for the session-topic shape guards
    // against a future regression where session topics start sharing a
    // listener or key by accident.
    instance.emitTopic(sessionTopic(2))
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst of signals within one throttle window into exactly one invalidate', () => {
    jest.useFakeTimers()
    try {
      const invalidateSpy = spyOnInvalidate()
      renderHook(
        () => useLiveStream([sessionTopic(1)], { throttleMs: THROTTLE_MS }),
        { wrapper },
      )
      const instance = latestInstance()

      // A burst of 10 signals landing well inside one throttle window —
      // standing in for a sustained token stream driving many chunk/tool-
      // call-update writes per second.
      for (let i = 0; i < 10; i++) {
        instance.emitTopic(sessionTopic(1))
        jest.advanceTimersByTime(10)
      }
      // 10 * 10ms = 100ms elapsed, still well inside THROTTLE_MS (300ms) —
      // nothing should have flushed yet.
      expect(invalidateSpy).not.toHaveBeenCalled()

      // Let the trailing timer (started on the FIRST signal, 100ms ago)
      // fire.
      jest.advanceTimersByTime(THROTTLE_MS - 100 + 1)

      expect(invalidateSpy).toHaveBeenCalledTimes(1)
      expect(invalidateSpy).toHaveBeenCalledWith(
        { queryKey: queryKeys.session(1) },
        { cancelRefetch: false },
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('fires a trailing invalidate once the throttle window elapses with no further signals — the burst is delayed, never dropped', () => {
    jest.useFakeTimers()
    try {
      const invalidateSpy = spyOnInvalidate()
      renderHook(
        () => useLiveStream([sessionTopic(1)], { throttleMs: THROTTLE_MS }),
        { wrapper },
      )
      const instance = latestInstance()

      instance.emitTopic(sessionTopic(1))
      expect(invalidateSpy).not.toHaveBeenCalled()

      // Nothing else arrives — advance past the full window.
      jest.advanceTimersByTime(THROTTLE_MS)

      expect(invalidateSpy).toHaveBeenCalledTimes(1)
      expect(invalidateSpy).toHaveBeenCalledWith(
        { queryKey: queryKeys.session(1) },
        { cancelRefetch: false },
      )

      // And it does not fire again on its own — a fresh signal is required
      // to arm the next window.
      jest.advanceTimersByTime(THROTTLE_MS * 3)
      expect(invalidateSpy).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})
