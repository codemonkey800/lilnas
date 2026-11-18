import { All, Controller, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { stripAuthCookies } from './strip-auth-cookies'
import { VERIFY_SANITIZED_HEADERS } from './verify.controller'

// ──────────────────────────────────────────────────────────────────────────────
// ForwardAuth target for Traefik routers that have NO auth: it allows every
// request and only removes lilnas-auth's own cookies from what the backend
// receives, the same way /verify does on an allow. Routers without the
// lilnas-auth middleware never call /verify, so without this their backends
// would still get the lilnas-auth session cookie.
//
// Deliberately no session lookup, no database, and no GatedHostsService /
// HostActivityService: these hosts are not gated, and recording them would
// list them as gated in /admin. Reachable on the backend port (8081) only —
// there is no next.config.js rewrite for it.
//
// @All() for the same reason as VerifyController: Traefik's ForwardAuth
// subrequest is a GET unless preserveRequestMethod is set, and nothing here
// reads a body or branches on method, so @All() stays correct under either
// configuration.
// ──────────────────────────────────────────────────────────────────────────────
@Controller('strip-cookie')
export class StripCookieController {
  constructor(private readonly logger: PinoLogger) {}

  @All()
  strip(@Req() req: Request, @Res() res: Response): void {
    // If this throws, no Cookie header is sent, so the backend gets no
    // cookies — the safe direction — and the request is still allowed.
    try {
      const [cookieHeaderName] = VERIFY_SANITIZED_HEADERS
      const sanitizedCookies = stripAuthCookies(req.headers.cookie)
      if (sanitizedCookies !== undefined) {
        res.setHeader(cookieHeaderName, sanitizedCookies)
      }
    } catch (err) {
      // Never log the cookie header or the error message (which may quote it).
      this.logger.warn(
        {
          event: 'strip-cookie-sanitize-failed',
          errName: err instanceof Error ? err.name : undefined,
        },
        'strip-cookie: could not sanitize the Cookie header; sending none',
      )
    }
    res.status(200).end()
  }
}
