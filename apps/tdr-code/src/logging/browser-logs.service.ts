import { Injectable } from '@nestjs/common'
// pino ships `export =` merged with a same-named namespace — the
// import/no-named-as-default(-member) warnings are known false positives for
// this pattern (see auth-mount.spec.ts's identical precedent).
// eslint-disable-next-line import/no-named-as-default
import pino from 'pino'

import { redactionCensor } from 'src/logger'

import type { BrowserLogEntryDto } from './browser-logs.dto'
import { logFilePath } from './log-paths'

// src/logger.ts's REDACT_PATHS is shaped for the backend's pino-http log
// objects, where req/res sit at the object ROOT — pino's redact paths are
// literal, root-anchored dot-paths (confirmed against the installed
// @pinojs/redact: 'req.headers.cookie' matches only at the true root, never
// e.g. 'context.req.headers.cookie'), so reusing that exact list here would
// be a no-op: write() below nests every DTO field except level/message under
// `context`. This list is shaped for THIS object instead, reusing the same
// redactionCensor (still the one source of truth for what a masked value
// looks like, and for the auth-path query-string handling):
//   - 'url': BrowserLogEntryDto.url is the reported page's path + query
//     (never the full href — see that field's own comment in
//     browser-logs.dto.ts for why). A client-side error firing while a user
//     is mid-OAuth redirect (e.g. /auth/callback/discord?code=...&state=...)
//     would otherwise ship the raw code/state into this file — the one leak
//     path the backend's redaction work was specifically built to close, now
//     open again via a different door. redactionCensor already knows to
//     leave every non-auth URL alone.
//   - 'context.privateKey' / 'context.*.privateKey': mirrors REDACT_PATHS'
//     own *.privateKey wildcard, shifted one level to account for the
//     context nesting. Deliberately not chasing every possible depth below
//     that — the real private key never reaches the browser in normal
//     operation (git-identity.dto.ts's privateKey field is write-only,
//     never echoed back), so this is defense-in-depth for an
//     already-narrow residual risk, not the primary guarantee.
const BROWSER_LOG_REDACT_PATHS = [
  'url',
  'context.privateKey',
  'context.*.privateKey',
]

@Injectable()
export class BrowserLogsService {
  // Built once per process (Nest singleton by default) rather than per
  // request — a fresh pino.destination() per call would mean a fresh fd per
  // request, defeating sonic-boom's buffering and risking fd exhaustion
  // under load. `sync: true` is deliberate: this destination sees low,
  // bursty volume (client-side errors, not a request-per-line hot path), so
  // the durability of "the line is on disk before write() returns" is worth
  // more here than async-write throughput.
  private readonly logger = pino(
    {
      redact: { paths: BROWSER_LOG_REDACT_PATHS, censor: redactionCensor },
    },
    // Same false positive as the import above, for pino's own destination() static.
    // eslint-disable-next-line import/no-named-as-default-member
    pino.destination({
      dest: logFilePath('frontend-browser'),
      mkdir: true,
      sync: true,
    }),
  )

  write(entry: BrowserLogEntryDto): void {
    // Named `rest`, not `context` — the DTO already has its own `context`
    // field, so a rest-spread variable named `context` would shadow it and
    // silently double-nest ({ context: { context: {...}, url, userAgent } })
    // instead of producing one flat { context, url, userAgent } log object.
    const { level, message, ...rest } = entry
    this.logger[level](rest, message)
  }
}
