import { env } from '@lilnas/utils/env'
import type { Options } from 'pino-http'

import { EnvKeys } from './env'

const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'

// pino-http options for the app's LoggerModule. Kept in its own module so a
// spec can run the real redact/autoLogging config.
export const pinoHttpOptions: Options = {
  level: isProduction ? 'info' : 'debug',
  // lilnas-auth is a credential-bearing service from day one: pino's
  // default req/res serializers include raw headers, and /verify (U5)
  // will receive the session Cookie on every single migrated request.
  // Redacting the credential-shaped header slots now — before any
  // route actually reads a cookie — means the hot path never needs a
  // logging change later. Per
  // docs/archive/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md,
  // retrofitting redaction after routes exist is exactly the kind of
  // hot-path churn this plan wants to avoid. U3's OAuth callback will
  // likely need to extend this with a `req.url` censor (the callback
  // URL carries a `code`/`state` query string) — see
  // apps/tdr-code/src/logger.ts's redactAuthQueryString for the
  // precedent when that lands.
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      // /strip-cookie and /verify answer with the KEPT cookies in a `cookie`
      // response header, and pino-http logs res.getHeaders().
      'res.headers.cookie',
    ],
    censor: '[Redacted]',
  },
  // Traefik calls /verify once per proxied request to EVERY
  // protected host, so once any router migrates onto lilnas-auth
  // this becomes the highest-volume route in the app by a wide
  // margin — one completion line per static asset, image, and XHR on
  // every migrated page load. Left at pino-http's default
  // (autoLogging on for every route), that buries the one signal
  // this service actually defines on this path
  // (verify-session-check-error) in routine noise and puts a stdout
  // write on the path the plan describes as "a header read plus two
  // in-memory map lookups." /health is excluded for the same reason
  // at a smaller scale — a liveness probe polling continuously.
  // /strip-cookie is called the same way by every router with no auth
  // (lilnas-cookie-strip), so it is just as high-volume.
  // /strip-cookie is called the same way by every router that has no auth
  // (lilnas-cookie-strip), so it is just as high-volume.
  // `autoLogging.ignore`, not `exclude`: this keeps pino-http's own
  // middleware running (so request-scoped context stays available to
  // that explicit error log line) and only suppresses the automatic
  // completion log, rather than skipping instrumentation entirely.
  autoLogging: {
    ignore: req =>
      req.url === '/verify' ||
      req.url === '/strip-cookie' ||
      req.url === '/health',
  },
}
