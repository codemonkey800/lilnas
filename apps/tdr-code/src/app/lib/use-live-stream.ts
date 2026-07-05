import { type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { LOG_EVENTS } from 'src/logging/log-events'
import {
  isSessionTopic,
  parseSessionTopic,
  type Topic,
} from 'src/sse/sse.types'

import { api, queryKeys, streamUrl } from './api'
import { capMessage, logToServer } from './browser-logger'

// KEEPALIVE_EVENT_TYPE mirrors sse.controller.ts's own constant of the same
// name — duplicated rather than imported because that file lives in the
// backend-only src/sse/ tree (this file is browser code); only the string
// value is shared, not a runtime dependency.
const KEEPALIVE_EVENT_TYPE = 'keepalive'

// The one client seam every migrated surface (dashboard now, bot-status
// widget/config and session detail in later units) reuses: one EventSource
// per mount, mapped to React Query invalidations. See the SSE push plan
// (docs/plans/2026-07-05-002-feat-tdr-code-sse-push-plan.md, U5) for the
// full design — in particular the "Client refetch coalescing is explicit,
// not assumed" decision (cancelRefetch: false below) and the
// "API surface parity / session-expiry" system-wide-impact note (the
// consecutive-onerror fallback below).

// Maps a wire topic to the React Query key it invalidates. Exported so a
// future caller (or a test) can assert the mapping directly without
// mounting the hook. Returns undefined for anything that isn't a
// recognized topic shape — the browser must not trust wire data blindly
// even though the server-side isTopic() already gates what can be sent.
export function topicToQueryKey(topic: string): QueryKey | undefined {
  if (topic === 'live') return queryKeys.live
  if (topic === 'bot-status') return queryKeys.botStatus
  if (isSessionTopic(topic)) {
    const id = parseSessionTopic(topic)
    if (id === null) return undefined
    const sessionId = Number(id)
    if (!Number.isInteger(sessionId)) return undefined
    return queryKeys.session(sessionId)
  }
  return undefined
}

// Bounded threshold for the session-expiry fallback (see this file's own
// header comment on the system-wide-impact note): after this many
// consecutive `onerror` events with no intervening `onopen`/`onmessage`,
// fire one authenticated request so api.ts's existing 401->/login latch can
// trigger. A local const, not an EnvKey — the plan calls this out as
// something to make "easy to find/tune", not something that needs runtime
// configurability. 3 is chosen to tolerate a single transient reconnect
// blip (a real network hiccup) without false-triggering, while still
// bounding how long an idle operator with an expired session could be
// stranded on a stale page (EventSource retries roughly every few seconds
// by default, so 3 consecutive failures is on the order of seconds, not
// minutes).
const CONSECUTIVE_ERROR_THRESHOLD = 3

export interface UseLiveStreamOptions {
  // Trailing-throttle window in ms for invalidate-on-message. Unset/0
  // (the default) means "invalidate immediately on every message" — the
  // correct behavior for this unit's low-volume live/bot-status topics.
  // U7 will pass a nonzero value for the high-churn session topic.
  throttleMs?: number
}

// One EventSource per mount, scoped to `topics` (the "one handle per key"
// resource rule from docs/research/2026-06-28-tdr-code-web-ui-feature-
// landscape.md — created once, torn down once, never leaked or
// duplicated). `topics` is expected to be referentially stable across
// renders for this unit's callers (a literal array passed at each call
// site); if it genuinely changes, the effect below tears down the old
// connection and opens a new one — topic-diffing is explicitly out of
// scope for this unit.
export function useLiveStream(
  topics: Topic[],
  opts?: UseLiveStreamOptions,
): void {
  const queryClient = useQueryClient()
  // topics.join(',') gives the effect a stable primitive dependency so an
  // inline array literal at the call site (a fresh reference every render)
  // doesn't force a reconnect every render.
  const topicsKey = topics.join(',')
  const throttleMs = opts?.throttleMs ?? 0

  useEffect(() => {
    if (topics.length === 0) return

    // Set true only inside the cleanup function below. Checked at the top
    // of every EventSource handler so a handler invoked after unmount (a
    // stray already-in-flight callback — see the "one handle per key"
    // release rule) is a guaranteed no-op, independent of whatever the
    // real/mock EventSource.close() itself does or doesn't guarantee about
    // suppressing further callbacks.
    let disposed = false

    const invalidate = (queryKey: QueryKey) =>
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false })

    // Per-key trailing throttle state. Only exercised when throttleMs > 0;
    // for this unit's callers (throttleMs unset) invalidate() above is
    // called directly and immediately, with none of this machinery
    // touched — see this file's header comment on the throttle knob.
    const pendingKeys = new Map<string, QueryKey>()
    let throttleTimer: ReturnType<typeof setTimeout> | undefined

    const flushThrottled = () => {
      throttleTimer = undefined
      for (const queryKey of pendingKeys.values()) invalidate(queryKey)
      pendingKeys.clear()
    }

    const invalidateForTopic = (queryKey: QueryKey) => {
      if (throttleMs <= 0) {
        invalidate(queryKey)
        return
      }
      pendingKeys.set(JSON.stringify(queryKey), queryKey)
      if (throttleTimer === undefined) {
        throttleTimer = setTimeout(flushThrottled, throttleMs)
      }
    }

    const invalidateAllSubscribed = () => {
      for (const topic of topics) {
        const queryKey = topicToQueryKey(topic)
        if (queryKey !== undefined) invalidate(queryKey)
      }
    }

    // Session-expiry fallback state (see CONSECUTIVE_ERROR_THRESHOLD's own
    // comment). Reset on any onopen/onmessage; a successful open or
    // message is proof the connection (and therefore the session cookie)
    // is still good, so there is nothing to fall back for.
    let consecutiveErrors = 0
    let fallbackFired = false

    const resetErrorTracking = () => {
      consecutiveErrors = 0
      fallbackFired = false
    }

    const eventSource = new EventSource(streamUrl(topics))

    eventSource.onopen = () => {
      if (disposed) return
      resetErrorTracking()
      // Covers F4/AE4: both the initial connection AND every reconnect
      // (a fresh onopen fires again after EventSource auto-reconnects)
      // re-invalidate every subscribed key, so a reconnect always resyncs
      // to the current snapshot with no gap. Intentionally NOT throttled —
      // a resync should never be delayed or coalesced away.
      invalidateAllSubscribed()
    }

    // NestJS's @Sse() maps MessageEvent.type to the wire `event:` field
    // (see sse.controller.ts), so every real signal arrives as a NAMED SSE
    // event — the browser dispatches it to addEventListener(topic, ...)
    // listeners ONLY, never to the generic onmessage handler (onmessage
    // fires exclusively for the default/unnamed "message" event type, per
    // the SSE spec — confirmed against MDN's "Using server-sent events"
    // guide). One listener is registered per subscribed topic below; the
    // topic is therefore already known from which listener fired, so
    // there's nothing to extract or validate from event.data — the wire
    // payload is a bare wake-up signal by design (sse.types.ts's own
    // NotifySignal comment), never data the client acts on.
    const topicListeners = topics.map(topic => {
      const handler = () => {
        if (disposed) return
        resetErrorTracking()
        const queryKey = topicToQueryKey(topic)
        if (queryKey === undefined) return
        invalidateForTopic(queryKey)
      }
      eventSource.addEventListener(topic, handler)
      return { topic, handler }
    })

    // The keepalive is its own named event for the same reason — receiving
    // one is proof the connection (and therefore the session cookie) is
    // still good, so it resets the error-tracking state below just like a
    // real signal would, without invalidating anything.
    const handleKeepalive = () => {
      if (disposed) return
      resetErrorTracking()
    }
    eventSource.addEventListener(KEEPALIVE_EVENT_TYPE, handleKeepalive)

    eventSource.onerror = () => {
      if (disposed) return
      consecutiveErrors += 1
      if (consecutiveErrors < CONSECUTIVE_ERROR_THRESHOLD || fallbackFired) {
        return
      }
      // Fires once per bounded window (until a successful onopen/onmessage
      // resets the counter) — not once per error past the threshold. See
      // this file's header comment: removing refetchInterval removed the
      // only guaranteed periodic request() that used to trigger api.ts's
      // 401->/login redirect latch. A 401 on /api/stream itself makes
      // EventSource retry forever (only a 204 stops it), so without this
      // fallback an operator whose session expires while idle would never
      // get redirected. Any lightweight authenticated endpoint works here;
      // getLive() is cheap and already an existing call.
      fallbackFired = true
      void api.getLive().catch((error: unknown) => {
        // A non-401 failure here is expected/benign (e.g. a genuine
        // network blip) — request() only ever throws for non-2xx,
        // non-401 responses (the 401 case redirects and never settles).
        // Logged at warn, not rethrown: this is a best-effort background
        // probe, not a user-facing action.
        logToServer(
          'warn',
          LOG_EVENTS.sseSessionExpiryFallback,
          capMessage(error instanceof Error ? error.message : String(error)),
        )
      })
    }

    return () => {
      disposed = true
      if (throttleTimer !== undefined) clearTimeout(throttleTimer)
      for (const { topic, handler } of topicListeners) {
        eventSource.removeEventListener(topic, handler)
      }
      eventSource.removeEventListener(KEEPALIVE_EVENT_TYPE, handleKeepalive)
      eventSource.close()
    }
    // topicsKey (not topics/queryClient) is the deliberate dependency: it's
    // a stable primitive stand-in for `topics` (see topicsKey's own
    // definition above), and queryClient is stable for the app's lifetime
    // (providers.tsx's useState(createQueryClient)) — including either
    // directly would defeat that stability and reconnect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicsKey, throttleMs])
}
