import { All, Controller, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'

import { normalizeHost } from 'src/services/normalize-host'

import { VerifyService } from './verify.service'

// Express types a repeated header as `string[]`; every header this
// controller reads except `cookie` (Node's http layer itself joins
// duplicate Cookie headers with '; ' before exposing them — @types/node's
// IncomingHttpHeaders types `cookie` as plain `string | undefined`, never
// an array) goes through this to normalize to the single value Traefik's
// own synthesized X-Forwarded-* headers are always expected to be.
function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// ──────────────────────────────────────────────────────────────────────────────
// Traefik's ForwardAuth entry point (R2, R4, R16 enforcement half, R20; F4).
// Mounted at the raw container port (8081) per the plan's "Process and
// routing topology" — Traefik's forwardauth.address points here directly,
// bypassing Next.js and the router's own :8080 listener entirely. U10
// (infra/proxy.yml's `lilnas-auth` ForwardAuth middleware, additive
// alongside the legacy `forward-auth` middleware — see that file's own
// comment) owns the actual Traefik middleware/label wiring; this file is
// only the NestJS side of that contract.
//
// @All(), not @Get() — verified, not assumed. Traefik v3's ForwardAuth
// subrequest uses a FIXED method (GET) by default: `preserveRequestMethod`
// defaults to `false` per Traefik's own documented reference
// (https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/forwardauth/),
// and neither the legacy forward-auth middleware NOR U10's own lilnas-auth
// middleware definition (infra/proxy.yml) sets that option — so today's real
// traffic to either endpoint always arrives as GET. Nothing in this file can
// guarantee that stays true forever, though: a future edit to either
// middleware definition could set preserveRequestMethod: true independently
// of anything this controller sees. @All() costs nothing — this handler
// never reads a request body (Traefik's own forwardBody defaults false,
// confirmed in the plan's research) and never branches on method — and
// stays correct under EITHER Traefik configuration. @Get()-only would
// silently start 404ing (or method-not-allowed-ing) every non-GET verify
// subrequest the day someone sets preserveRequestMethod: true, incorrectly
// blocking an already-authenticated user's POST/PUT/DELETE to a migrated
// service purely because of an unrelated infra config change this
// controller has no visibility into.
// ──────────────────────────────────────────────────────────────────────────────
@Controller('verify')
export class VerifyController {
  constructor(private readonly verifyService: VerifyService) {}

  @All()
  async verify(@Req() req: Request, @Res() res: Response): Promise<void> {
    // S4: normalized BEFORE it ever reaches decide() — Traefik's Host(`...`)
    // rule matches case-insensitively, so a client can present
    // `X-Forwarded-Host: SWOLE.lilnas.io` for the same backend as
    // `swole.lilnas.io`, but grants are always stored lowercase (see
    // normalize-host.ts's own header comment). Without this, hasGrant()'s
    // case-sensitive Set lookup would miss an existing grant and bounce an
    // already-granted user to /pending.
    const rawForwardedHost = firstHeaderValue(req.headers['x-forwarded-host'])
    const decision = await this.verifyService.decide({
      cookieHeader: req.headers.cookie,
      forwardedHost: rawForwardedHost
        ? normalizeHost(rawForwardedHost)
        : undefined,
      forwardedProto: firstHeaderValue(req.headers['x-forwarded-proto']),
      forwardedUri: firstHeaderValue(req.headers['x-forwarded-uri']),
    })

    if (decision.outcome === 'allow') {
      // Parity with the middleware being replaced — nothing in the repo
      // reads this today (confirmed repo-wide by the plan's own research),
      // so this is free and cannot break a migrating router. Traefik's own
      // (U10-owned) middleware config is what actually copies this
      // response header onto the request it forwards to the real backend,
      // via forwardauth.authResponseHeaders=X-Forwarded-User — mirroring
      // infra/proxy.yml's existing forward-auth definition.
      res.setHeader('X-Forwarded-User', decision.email)
      res.setHeader('X-Forwarded-User-Id', decision.userId)
      res.status(200).end()
      return
    }

    if (decision.outcome === 'redirect') {
      // Location is set directly rather than via res.redirect(...) —
      // decision.location is ALWAYS already an absolute
      // https://<AUTH_HOST>/... URL (VerifyService.buildRedirectUrl), and
      // setting the header explicitly sidesteps ever depending on
      // Express's own relative/absolute URL heuristics for the single
      // most safety-critical property in this unit: U1's proven finding
      // that Traefik's preserveLocationHeader defaults to false, silently
      // rewriting a RELATIVE Location into a container-internal,
      // browser-unreachable URL.
      res.status(302).setHeader('Location', decision.location).end()
      return
    }

    // fail-closed: a missing X-Forwarded-Host is a Traefik/infra
    // misconfiguration, not an anonymous user — R20 says ForwardAuth must
    // never fail open, and a loud 5xx (instead of a login redirect, which
    // would silently masquerade this as routine anonymous traffic) is what
    // makes this failure class visible to an operator.
    res.status(500).end(`lilnas-auth: ${decision.reason}`)
  }
}
