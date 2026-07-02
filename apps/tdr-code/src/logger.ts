import { env } from '@lilnas/utils/env'

import { EnvKeys } from './env'

// True for the Better Auth mount's INTERNAL path — what pino-http sees on
// req.url after Next's rewrite strips '/api' (see auth.ts's basePath note).
// Matches '/auth' and '/auth/...' but not e.g. '/authoring' (segment
// boundary check).
function isAuthPath(pathOnly: string): boolean {
  return pathOnly === '/auth' || pathOnly.startsWith('/auth/')
}

// Strips the query string from a URL when — and only when — its path is
// under the Better Auth mount, so a captured req.url never carries the
// OAuth `code`/`state` even as raw query text (not just as structured
// fields.query.* entries, which additionally depend on Express having
// already parsed req.query by serialization time — this censor works on
// the literal req.url string regardless of that timing). Every other
// route's URL (including its query string) passes through unredacted.
function redactAuthQueryString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const queryStart = value.indexOf('?')
  const pathOnly = queryStart === -1 ? value : value.slice(0, queryStart)
  if (!isAuthPath(pathOnly)) return value
  return queryStart === -1 ? value : pathOnly
}

// Single censor shared by every redact path below: 'url' entries get the
// query-stripping treatment (above); every other matched path (cookies,
// auth headers, the SSH private key, OAuth query params) gets a flat mask.
// Dispatch is by the final path SEGMENT, not path length, so it applies
// uniformly regardless of nesting depth (req.url vs a differently-shaped
// future caller).
function redactionCensor(value: unknown, path: string[]): unknown {
  if (path[path.length - 1] === 'url') return redactAuthQueryString(value)
  return '[Redacted]'
}

// No secret may reach the pino/Loki sink (auth + the Phase C SSH-key intake
// make this server's HTTP logger a real leak path otherwise). Paths cover:
//   - cookies + auth headers (request and response side — Set-Cookie is a
//     session token, not just a request credential)
//   - the git-identity SSH private key field (git-identity.dto.ts's
//     `privateKey`); the `*.privateKey` wildcard catches it regardless of
//     nesting (e.g. under req.body if some future call path ever logs the
//     raw body) without needing to enumerate every possible parent path
//   - OAuth query params (code/state/access_token) as STRUCTURED fields —
//     defense-in-depth for whenever Express has already parsed req.query
//     by log time — layered on top of the req.url string-level stripping,
//     which is the primary guarantee and doesn't depend on that timing
const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.privateKey',
  'req.body.privateKey',
  'req.url',
  'req.query.code',
  'req.query.state',
  'req.query.access_token',
]

export function buildLoggerOptions() {
  const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'
  if (isProduction) {
    return {
      pinoHttp: {
        level: 'info',
        redact: { paths: REDACT_PATHS, censor: redactionCensor },
      },
    }
  }
  return {
    pinoHttp: {
      transport: { target: 'pino-pretty' },
      level: 'debug',
      // Confirmed (auth-mount.spec.ts): pino redacts during its core JSON
      // serialization step, before handing the line to ANY transport — the
      // pino-pretty worker thread here receives already-redacted bytes, so
      // redaction is not bypassed by using a pretty-print transport instead
      // of a plain destination stream.
      redact: { paths: REDACT_PATHS, censor: redactionCensor },
    },
  }
}
