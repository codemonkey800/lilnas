import { env } from '@lilnas/utils/env'
// pino ships `export =` merged with a same-named namespace — the
// import/no-named-as-default warning is a known false positive for this
// pattern (see auth-mount.spec.ts's identical precedent).
// eslint-disable-next-line import/no-named-as-default
import pino from 'pino'

import { EnvKeys } from 'src/env'
import { REDACT_PATHS, redactionCensor } from 'src/logger'

import { logFilePath } from './log-paths'

// For Next.js server-side code (Server Components, Route Handlers,
// instrumentation.ts) that wants structured logging with the same secret
// hygiene as the backend — mirrors buildLoggerOptions()'s dev/prod dual-
// target shape (console + backend.<env>.log's sibling file here), minus the
// pino-http-specific fields this isn't an HTTP-middleware logger.
//
// REDACT_PATHS/redactionCensor are reused as-is (see src/logger.ts) rather
// than redesigned for this file's own log shapes — unlike
// browser-logs.service.ts, this logger has no concrete call sites yet (see
// its own header comment), so there's no real shape to validate redaction
// against. Those paths are root-anchored (e.g. 'req.headers.cookie' only
// matches an object with req at the TRUE root, not nested under a wrapper
// key), so whoever adds the first real call site should log a matching
// root-level shape or extend this list for whatever shape they actually use
// — don't assume reuse alone makes an arbitrarily-shaped log object safe.
const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'
const level = isProduction ? 'info' : 'debug'
const redact = { paths: REDACT_PATHS, censor: redactionCensor }
const fileTarget = {
  target: 'pino/file',
  options: { destination: logFilePath('frontend-server'), mkdir: true },
  level,
}

export const frontendServerLogger = pino({
  level,
  redact,
  transport: isProduction
    ? { targets: [fileTarget] }
    : { targets: [{ target: 'pino-pretty', level }, fileTarget] },
})
