import path from 'node:path'

import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

// Every process (main server, bot child process, Next.js frontend) resolves
// log file locations through this one module so the three streams below can
// never drift into different directories/naming across processes. No Nest/
// React imports here on purpose — this file is imported from plain backend
// code, Next server code, and instrumentation.ts alike.
export const LOG_DIR = '/tmp/tdr-code'

export type LogStream = 'backend' | 'frontend-server' | 'frontend-browser'

// Same NODE_ENV check src/logger.ts already uses for its prod/dev branch —
// kept identical rather than reinvented so "which mode is this process in"
// can never answer differently between the two files.
export function logEnvSuffix(): 'dev' | 'prod' {
  return env(EnvKeys.NODE_ENV, 'development') === 'production' ? 'prod' : 'dev'
}

export function logFilePath(stream: LogStream): string {
  return path.join(LOG_DIR, `${stream}.${logEnvSuffix()}.log`)
}
