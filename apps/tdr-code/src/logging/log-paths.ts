import path from 'node:path'

import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

// Every process (main server, bot child process, Next.js frontend) resolves
// log file locations through this one module so the three streams below can
// never drift into different directories/naming across processes. No Nest/
// React imports here on purpose — this file is imported from plain backend
// code, Next server code, and instrumentation.ts alike.
export const LOG_DIR = '/tmp/tdr-code'

// The one source of truth for which streams exist — both the TYPE and every
// runtime list of stream names (logs.dto.ts's query-schema allowlists,
// log-sources.service.ts's fixed tab order) derive from this single tuple,
// so a stream can never be added/renamed in one of those places without the
// others noticing at compile time.
export const LOG_STREAMS = [
  'backend',
  'frontend-server',
  'frontend-browser',
] as const

export type LogStream = (typeof LOG_STREAMS)[number]

// Same NODE_ENV check src/logger.ts already uses for its prod/dev branch —
// kept identical rather than reinvented so "which mode is this process in"
// can never answer differently between the two files.
export function logEnvSuffix(): 'dev' | 'prod' {
  return env(EnvKeys.NODE_ENV, 'development') === 'production' ? 'prod' : 'dev'
}

export function logFilePath(stream: LogStream): string {
  return path.join(LOG_DIR, `${stream}.${logEnvSuffix()}.log`)
}

// The one shared rewrite rule behind every logging/*.service.ts file's own
// test-only `resolvePath` (log-reader/log-search/log-sources/log-tail all
// need it, since each resolves paths from its OWN instance's `logDir` field
// — that per-instance override state stays in each service, R17's "never a
// client-supplied value" boundary is unaffected either way, but the REWRITE
// RULE itself lives in exactly one place instead of four, so it can't
// silently drift between services if it ever changes).
export function resolveLogPath(stream: LogStream, logDir: string): string {
  return logDir === LOG_DIR
    ? logFilePath(stream)
    : logFilePath(stream).replace(LOG_DIR, logDir)
}
