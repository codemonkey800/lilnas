import { env } from '@lilnas/utils/env'
import type { Options } from 'pino-http'

import { EnvKeys } from './env'

const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'

// Keys that can carry an Apple password, a verification code or an API key.
// Pino's `*` wildcard matches exactly one level, so each key is listed at the
// top level and at every depth up to MAX_DEPTH.
const SECRET_KEYS = ['password', 'code', 'apiKey'] as const
const MAX_DEPTH = 4

function secretKeyPaths(): string[] {
  const paths: string[] = []
  for (const key of SECRET_KEYS) {
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      paths.push([...Array<string>(depth).fill('*'), key].join('.'))
    }
  }
  return paths
}

export const REDACT_PATHS: string[] = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'req.body',
  ...secretKeyPaths(),
]

// pino-http options for the app's LoggerModule. Kept in its own module so a
// spec can run the real redact config.
export const pinoHttpOptions: Options = {
  level: isProduction ? 'info' : 'debug',
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  autoLogging: { ignore: req => req.url === '/health' },
}
