'use client'

import { useCallback, useEffect, useRef } from 'react'

import { api, logTailUrl } from 'src/app/lib/api'
import { capMessage, logToServer } from 'src/app/lib/browser-logger'
import { LOG_EVENTS } from 'src/logging/log-events'
import {
  LOG_TAIL_EVENT_TYPE,
  LOG_TAIL_KEEPALIVE_EVENT_TYPE,
  type LogLine,
  type LogStream,
  type LogTailMessage,
  parseLogLine,
} from 'src/logging/log-view.types'

// U13: bounded threshold for the session-expiry fallback below — mirrors
// use-live-stream.ts's own CONSECUTIVE_ERROR_THRESHOLD (same value, same
// rationale: tolerate a single transient reconnect blip without false-
// triggering, while still bounding how long an idle operator with an
// expired session could be stranded watching a tail that silently retries
// forever). Kept as this file's OWN local constant rather than importing
// use-live-stream.ts's — the two hooks share no runtime state and this
// tail connection is architecturally independent of /api/stream (U8's own
// "no shared hub" decision), so importing across them would be an
// accidental coupling with no compile-time guard against it drifting.
const CONSECUTIVE_ERROR_THRESHOLD = 3

// Converts one tail wire message into a properly-shaped LogLine. This is
// the single most important piece of logic in this file: LogTailMessage's
// own `byteOffset` is the line's END offset (the position right after its
// own bytes including the trailing '\n' — see log-view.types.ts's own
// header comment on LogTailMessage, and log-tail.controller.ts's `id:
// String(event.message.byteOffset)`, which is WHY it has to be an end
// offset — it doubles as the SSE `Last-Event-ID` "resume from right after
// this line" position). Every OTHER LogLine in this app (log-reader
// .service.ts's splitAndParseLines, consumed by the windowed read) uses
// byteOffset as the line's START offset, and the virtualizer's
// getItemKey keys rows by that START offset. Handing a tail message's raw
// END offset to a LogLine verbatim would silently desync the SAME
// underlying byte position between a windowed-read line and a tail-
// appended line for identical content — breaking applyFetchedWindow's
// existingOffsets de-dup Set and the virtualizer's key stability the
// moment a windowed `after`-fetch and a tail-append ever describe
// overlapping bytes (routine — see log-viewer.tsx's own composition
// note). Converting HERE means log-viewer.tsx only ever sees correctly-
// shaped LogLines and never has to reason about this at all.
//
// byte length is computed via TextEncoder (UTF-8 byte count), not
// Buffer.byteLength: this is a 'use client' browser file, and this app's
// webpack config does NOT polyfill the Buffer global for the client
// bundle (confirmed: no other browser file in this app uses Buffer, and
// next.config.js has no such polyfill wired in) — TextEncoder is the
// standard, universally-available browser-native way to get a string's
// UTF-8 byte length with no bundler cooperation required at all.
export function tailMessageToLogLine(message: LogTailMessage): LogLine {
  const lineByteLength = new TextEncoder().encode(message.line).length + 1 // +1 for the '\n' the server's own byteOffset accounting includes (see log-tail.service.ts's drainOnce: `Buffer.byteLength(line, 'utf8') + 1`)
  const startOffset = message.byteOffset - lineByteLength
  return {
    byteOffset: startOffset,
    byteLength: lineByteLength,
    raw: message.line,
    parsed: parseLogLine(message.line),
  }
}

export interface UseLogTailResult {
  connect: (from: number) => void
  disconnect: () => void
}

// One EventSource per `connect()` call, explicitly triggered by the caller
// (log-viewer.tsx) once it has a real resume offset — this hook
// deliberately does NOT auto-connect on mount (unlike use-live-stream.ts's
// topic-driven auto-connect), because there is no safe "unknown" `from` to
// open with: the caller only knows the correct resume point (the file's
// current EOF) once its own initial windowed load has settled. Mirrors
// use-live-stream.ts's overall EventSource lifecycle conventions
// (unstable-callback-in-a-ref, leak-safe unmount teardown) but is
// single-connection-explicit rather than effect-driven-by-topics, since
// this hook has exactly one "topic" (this stream's tail) and exactly one
// deliberate reconnect trigger (a jump-to-latest re-seek), not an
// open-ended list.
export function useLogTail(
  stream: LogStream,
  onLine: (line: LogLine) => void,
): UseLogTailResult {
  const eventSourceRef = useRef<EventSource | null>(null)

  // Holds the LATEST onLine the caller passed in. log-viewer.tsx's own
  // onLine closes over `following`/other render-local state, so it is a
  // fresh closure every render — but the actual EventSource listener
  // (registered once per connect() call, potentially long-lived across
  // many renders) must always invoke the CURRENT callback, never the one
  // captured at connect-time, or a `following` flip after connect() would
  // never be observed by an already-open connection's listener. A plain
  // assignment on every render (no effect, no dependency array) is
  // sufficient and correct here: this is intentionally the cheapest
  // possible way to keep a ref in sync, mirroring the "a tiny effect with
  // no dependency array guard needed since it's cheap" allowance this
  // unit's own brief calls out.
  const onLineRef = useRef(onLine)
  onLineRef.current = onLine

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
  }, [])

  const connect = useCallback(
    (from: number) => {
      // A second connect() call is how a deliberate re-seek (jump-to-
      // latest) works — close whatever connection already exists first so
      // the OLD EventSource's listeners can never fire onLine after being
      // superseded (a real browser stops delivering events to a closed
      // EventSource; disconnect() below is what makes that true here too).
      disconnect()

      const eventSource = new EventSource(logTailUrl(stream, from))
      eventSourceRef.current = eventSource

      // U13 (R18): session-expiry fallback state, scoped to THIS specific
      // connection (a plain closure variable, not a hook-level ref) — a
      // later connect() call creates an entirely new EventSource with its
      // own fresh counter, exactly as it should, since a reconnect that
      // succeeds is proof the PRIOR connection's error streak is no longer
      // relevant. Mirrors use-live-stream.ts's own identical per-connection
      // scoping (that hook declares its equivalent counters inside the
      // effect body that owns one EventSource's lifetime, for the same
      // reason).
      let consecutiveErrors = 0
      let fallbackFired = false
      const resetErrorTracking = () => {
        consecutiveErrors = 0
        fallbackFired = false
      }

      eventSource.onopen = resetErrorTracking

      eventSource.addEventListener(LOG_TAIL_EVENT_TYPE, event => {
        resetErrorTracking()
        const message = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as LogTailMessage
        onLineRef.current(tailMessageToLogLine(message))
      })

      // A keepalive carries no line data, but receiving one is proof the
      // connection (and therefore the session cookie) is still good — same
      // rationale as use-live-stream.ts's own identical keepalive handling.
      eventSource.addEventListener(LOG_TAIL_KEEPALIVE_EVENT_TYPE, () => {
        resetErrorTracking()
      })

      // U13 (R18): removing polling removed the only guaranteed periodic
      // authenticated request that used to trigger api.ts's 401->/login
      // redirect latch — without this, an idle operator whose session
      // expires while a tail connection sits open would see EventSource
      // retry a 401 forever (only a 204 stops it) and never get redirected.
      // Mirrors use-live-stream.ts's own identical mitigation: after
      // CONSECUTIVE_ERROR_THRESHOLD onerror events with no intervening
      // onopen/onmessage/keepalive, fire ONE authenticated request so a 401
      // response can trigger the existing redirect. Fires once per bounded
      // window (fallbackFired), not once per error past the threshold.
      eventSource.onerror = () => {
        consecutiveErrors += 1
        if (consecutiveErrors < CONSECUTIVE_ERROR_THRESHOLD || fallbackFired) {
          return
        }
        fallbackFired = true
        void api.getLogSources().catch((error: unknown) => {
          // A non-401 failure here is expected/benign (e.g. a genuine
          // network blip) — request() only ever throws for non-2xx,
          // non-401 responses (the 401 case redirects and never settles).
          // Logged at warn, not rethrown: this is a best-effort background
          // probe, not a user-facing action.
          logToServer(
            'warn',
            LOG_EVENTS.logTailSessionExpiryFallback,
            capMessage(error instanceof Error ? error.message : String(error)),
          )
        })
      }
    },
    [stream, disconnect],
  )

  // Leak guard: unmounting (or `stream` changing, which never happens for
  // a real call site today since LogViewer's own `stream` prop is stable
  // for the component's lifetime, but this keeps the guarantee general)
  // closes whatever connection is open. Deliberately keyed ONLY on
  // `stream` — depending on `connect`/`disconnect` (which are stable via
  // useCallback anyway) or any other render-local value would risk
  // tearing down and recreating a live connection on an unrelated
  // re-render, exactly the "drawer-history lesson" this unit's brief
  // warns against.
  useEffect(() => {
    return disconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream])

  return { connect, disconnect }
}
