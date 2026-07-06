'use client'

import { useCallback, useEffect, useRef } from 'react'

import { logTailUrl } from 'src/app/lib/api'
import {
  LOG_TAIL_EVENT_TYPE,
  LOG_TAIL_KEEPALIVE_EVENT_TYPE,
  type LogLine,
  type LogStream,
  type LogTailMessage,
  parseLogLine,
} from 'src/logging/log-view.types'

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

      eventSource.addEventListener(LOG_TAIL_EVENT_TYPE, event => {
        const message = JSON.parse(
          (event as MessageEvent<string>).data,
        ) as LogTailMessage
        onLineRef.current(tailMessageToLogLine(message))
      })

      // No-op: a keepalive carries no line data and needs no handling
      // beyond "don't let it throw or do anything visible." U13 adds the
      // 401-fallback consecutive-error counting on top of this hook later
      // (this unit's brief explicitly defers that) — this listener exists
      // only so a keepalive event is a harmless, silently-ignored tick.
      eventSource.addEventListener(LOG_TAIL_KEEPALIVE_EVENT_TYPE, () => {})

      // Deliberately a no-op for now (see this file's own module comment
      // above) — U13's job, not this unit's. Must not throw.
      eventSource.onerror = () => {}
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
