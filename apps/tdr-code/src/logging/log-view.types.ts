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
