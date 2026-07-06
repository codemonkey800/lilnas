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

// U9 (whole-file streaming scan engine): the composed match predicate a
// GET /api/logs/search request evaluates against every complete line in the
// file. Every field is independently optional and the fields AND together —
// an absent field means "this dimension imposes no constraint," so an
// entirely empty predicate ({}) matches every line, which is exactly the
// "no filters, no text" raw-scan case (see matchesPredicate's own comment
// for why this needs no special-casing). Kept in this plane-neutral module
// (not log-search.service.ts) per the same REVIEW.md cross-plane-desync
// rationale as LogTailMessage above: the browser's future search-UI client
// (U11) constructs one of these to send as query params, and the backend
// scan service evaluates it — both planes need the identical shape.
export interface LogScanPredicate {
  // Case-insensitive substring match against the line's RAW text (not the
  // parsed JSON) — this is deliberate, not a shortcut: matching against raw
  // text is what makes `text` findable on a malformed/non-JSON line too
  // (R14), since a malformed line has no `parsed` fields to search at all.
  text?: string
  // A MINIMUM threshold, inclusive — pino's own numeric level scale (30
  // info, 40 warn, 50 error, 60 fatal), matching the structured-logging
  // convention doc. A line matches if its parsed `level` is a number >=
  // this value; a line with no numeric `level` (including every malformed
  // line) never matches once this field is set (R14).
  level?: number
  // 'both' (or the field being entirely absent) imposes no process
  // constraint at all — this is NOT the same as "match a literal field
  // named both," which no real log line has; see matchesPredicate.
  process?: 'main' | 'bot' | 'both'
  // Exact slug match against parsed.event (never a substring match, unlike
  // `text` above) — an absent `event` field on a valid `debug`-level line is
  // a normal, non-malformed state (per the structured-logging convention:
  // only info+ lines are required to carry one), so `event` filtering
  // simply excludes those lines rather than treating them as broken.
  event?: string
}

// The wire shape of one GET /api/logs/search response page. `total` is
// pinned to the scan's start-of-scan EOF snapshot for the entire lifetime of
// one logical multi-page search (see log-search.service.ts's own cursor
// design comment) — it is NOT recomputed on later pages, so it stays
// identical across a growing file exactly because it is echoed through the
// cursor, never re-derived from a fresh stat(). `matches` carries only the
// byte offset of each matching line's START (not its content) — the client
// re-fetches the actual line text via the existing windowed read
// (GET /logs/window, `direction: 'around'`), matching U9's "never
// materialize all offsets, never load the file into memory" contract: this
// response is bounded to at most one page's worth of offsets regardless of
// how large `total` is.
export interface LogSearchResponse {
  total: number
  matches: { byteOffset: number }[]
  nextCursor: string | null
}

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
