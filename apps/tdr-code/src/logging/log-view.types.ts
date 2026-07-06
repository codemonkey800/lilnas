import { LogStream } from 'src/logging/log-paths'

// Plane-neutral logs-viewer wire contract: Node stdlib + dependency-free
// local imports ONLY. No @nestjs/*, no react/next, no fs/Buffer. This file is
// imported by the main backend process (log-reader/log-sources services) and
// the browser bundle (the log viewer's window-fetch client) alike, so it must
// never pull in a framework or a Node-only API — mirrors the plane-neutrality
// rule in src/sse/sse.types.ts and src/logging/log-paths.ts.
//
// Byte-level buffer scanning (finding the previous/next '\n') is backend-only
// and lives in log-reader.service.ts, not here — this module only describes
// shapes and a pure string parse, so the browser bundle can import it without
// pulling in fs.

export type { LogStream }

export type LogWindowDirection = 'before' | 'after' | 'around'

export interface LogLine {
  byteOffset: number
  byteLength: number
  raw: string
  parsed: Record<string, unknown> | null
}

export interface LogWindowResponse {
  stream: LogStream
  fileSize: number
  windowStart: number
  windowEnd: number
  atStart: boolean
  atEnd: boolean
  lines: LogLine[]
}

export interface LogSource {
  stream: LogStream
  exists: boolean
  size: number
}

// U8 (append-delta tail push endpoint): the wire shape of one live-tail SSE
// message's `data` payload. `byteOffset` is the line's END offset (the
// position immediately after its own bytes, including the trailing '\n') —
// this is also used as the message's `id` (see log-tail.controller.ts), so a
// reconnect's `Last-Event-ID` is always "resume from right after this line",
// never re-emitting it. Kept in this plane-neutral module (not
// src/sse/sse.types.ts) per the REVIEW.md cross-plane-desync note: the tail
// is a fully separate endpoint from /api/stream and must not import from
// src/sse/* at all.
export interface LogTailMessage {
  line: string
  byteOffset: number
}

// The tail SSE event's `type` for a real append-delta message — distinct
// from the keepalive type below (mirrors sse.controller.ts's own
// data-vs-keepalive `type` split, but this is the tail's OWN constant, not
// an import from src/sse/*, since that module is intentionally never
// depended on here).
export const LOG_TAIL_EVENT_TYPE = 'log-append'

// The tail's keepalive event `type`. Deliberately the SAME string value as
// sse.controller.ts's local KEEPALIVE_EVENT_TYPE constant (both are
// 'keepalive') — a client that already knows to ignore a generic
// 'keepalive'-typed SSE event doesn't need two different constants to
// recognize the same no-op signal, and there is no risk of the two ever
// being confused for a real message since they're on entirely separate
// EventSource connections (/api/stream vs /api/logs/tail). This is a
// duplicated STRING LITERAL, not a shared runtime import, which is exactly
// what the REVIEW.md note asks to avoid for constants that variate
// independently — but a bare event-type label like this cannot desync in a
// way that would ever matter (both are simply "not real data, ignore this
// tick"), so duplication here is a deliberate, harmless exception, not an
// oversight.
export const LOG_TAIL_KEEPALIVE_EVENT_TYPE = 'keepalive'

// Guarded JSON.parse for one log line: never throws, and only a plain object
// satisfies the Record<string, unknown> contract callers rely on — a bare
// number/string/boolean/array/null JSON value is treated the same as
// malformed JSON (R14), since callers need object field access (e.g. .event,
// .msg), not an arbitrary JSON value. Used server-side to fill
// LogLine.parsed and client-side as a fallback for the same raw string.
export function parseLogLine(raw: string): Record<string, unknown> | null {
  if (raw.trim().length === 0) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}
