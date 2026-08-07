import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import type { Request } from 'express'

import { normalizeHost } from 'src/services/normalize-host'
import { ServiceRegistryService } from 'src/services/service-registry.service'
import { AccessCacheService } from 'src/verify/access-cache.service'

import { RequestsService } from './requests.service'

// ──────────────────────────────────────────────────────────────────────────────
// U6 (R5-R8): the internal HTTP surface src/app/pending/page.tsx's Server
// Component calls (server-side, forwarding the incoming request's own
// Cookie header — never a public, Traefik-routed endpoint; this container's
// only externally-reachable ports are :8080 for the UI router and :8081 for
// /verify specifically). Not in the plan's literal U6 file list, added
// because the pending page needs SOME backend surface to call and this is
// the natural, minimal one — flagged here as the small necessary addition
// it is.
//
// Four outcomes (revised post-launch, twice — see requests.service.ts's own
// header comment for the full history). `granted`/`rejected`/`blocked` are
// all terminal-and-distinguishable now; `pending` covers every other case —
// a fresh request, or one still awaiting a decision. Blocked (R16) used to
// be folded into this same `pending` shape, deliberately indistinguishable
// from an ordinary pending request — that opacity was reversed in favor of
// a dedicated /blocked page (see verify.service.ts's own REDIRECT_PATHS.blocked
// for the ForwardAuth-side half of this same reversal). The `isBlocked`
// check below still runs BEFORE this ever reaches RequestsService — a
// blocked user still never produces a 'rejected' outcome, and no
// access_request row is ever created for one — only the RESPONSE shape for
// that branch changed, from 'pending' to its own 'blocked' outcome.
// ──────────────────────────────────────────────────────────────────────────────

export type RequestStatusResponse =
  | { outcome: 'granted' }
  | { outcome: 'pending' }
  | { outcome: 'rejected' }
  | { outcome: 'blocked' }

function parseServiceHost(redirect: unknown): string {
  if (typeof redirect !== 'string' || redirect.length === 0) {
    throw new BadRequestException('missing redirect')
  }
  try {
    // S4: routed through the SAME normalizeHost() verify.controller.ts
    // applies to X-Forwarded-Host, rather than relying on `new URL()`'s own
    // incidental lowercasing as an independently-arrived-at equivalent —
    // see normalize-host.ts's own header comment for why the two call
    // sites must share one explicit rule instead of two.
    return normalizeHost(new URL(redirect).hostname)
  } catch {
    throw new BadRequestException('malformed redirect')
  }
}

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly accessCache: AccessCacheService,
    private readonly serviceRegistry: ServiceRegistryService,
  ) {}

  // Called on pending-page load and on every SSE reconnect (see
  // src/sse/sse.controller.ts's own comment on why re-checking status on
  // open, not just reacting to a live push, is what makes the
  // dropped-connection edge case safe). This is also the ONLY place a
  // fresh/absorbed access_request row gets written — see
  // requests.service.ts's requestAccess() for why that write lives here and
  // not inline in VerifyService.decide().
  @Get('status')
  async status(
    @Req() req: Request,
    @Query('redirect') redirect: unknown,
  ): Promise<RequestStatusResponse> {
    const serviceHost = parseServiceHost(redirect)
    const session = await this.accessCache.resolveSession(req.headers.cookie)
    if (!session) {
      return { outcome: 'pending' }
    }

    // Checked before the grant lookup, mirroring VerifyService.decide()'s
    // own AE6 ordering — a blocked account must never see 'granted' even if
    // a stale grant exists, and must never have a request row created for
    // it either. Reports its own 'blocked' outcome — see this file's own
    // header comment for why that's a deliberate reversal of the opacity
    // this branch used to have, not an oversight.
    if (this.accessCache.isBlocked(session.userId)) {
      return { outcome: 'blocked' }
    }

    if (this.accessCache.hasGrant(session.userId, serviceHost)) {
      return { outcome: 'granted' }
    }

    // Checked AFTER the grant lookup (an already-granted host must keep
    // working even if it later drops out of the registry), but BEFORE ever
    // creating a request row — parseServiceHost() above accepts any
    // parseable URL with no allowlist, and this is a Server-Action-callable
    // GET whose `redirect` argument the caller fully controls. Without
    // this check, iterating hostnames mints one new access_request row per
    // iteration (dedup is per (userId, serviceHost)), unboundedly flooding
    // the one surface an operator uses to recover. Reports the same
    // 'pending' shape rather than a 400, so this never becomes a
    // distinguishing signal of its own.
    if (!(await this.isKnownServiceHost(serviceHost))) {
      return { outcome: 'pending' }
    }

    // RequestStatus ({outcome:'pending'|'rejected'}) is a strict subtype of
    // RequestStatusResponse — passed straight through rather than
    // reconstructed, so there is nowhere for the two shapes to drift apart.
    return this.requestsService.requestAccess(session.userId, serviceHost)
  }

  // Called from login-form.tsx's sign-in click when the user is returning
  // after a rejection (see that file's own comment for why this is
  // awaited BEFORE signIn.social(), not fire-and-forget) — an explicit
  // user action, never triggered automatically by a page load or SSE
  // reconnect (those both go through status() -> requestAccess() above,
  // which never creates a fresh row for an already-decided rejection).
  // Response is deliberately just `{ ok: true }` uniformly: the caller
  // navigates away immediately afterward regardless of what happened here
  // (see requests.service.ts's reRequestAccess() for why there is nothing
  // meaningful left to report — no cooldown to fail, no outcome to branch
  // on before the navigation).
  @Post('re-request')
  async reRequest(
    @Req() req: Request,
    @Query('redirect') redirect: unknown,
  ): Promise<{ ok: true }> {
    const serviceHost = parseServiceHost(redirect)
    const session = await this.accessCache.resolveSession(req.headers.cookie)
    if (!session) {
      return { ok: true }
    }
    if (this.accessCache.isBlocked(session.userId)) {
      return { ok: true }
    }
    if (this.accessCache.hasGrant(session.userId, serviceHost)) {
      return { ok: true }
    }
    // Same registry check and ordering as status() above — still required
    // even though reRequestAccess() itself has no cooldown left to guard:
    // without it, an arbitrary caller-controlled `redirect` hostname with
    // no PRIOR row at all would still mint a fresh pending row for any
    // off-registry host on every call.
    if (!(await this.isKnownServiceHost(serviceHost))) {
      return { ok: true }
    }

    this.requestsService.reRequestAccess(session.userId, serviceHost)
    return { ok: true }
  }

  // Mirrors AdminController.assertKnownServiceHost — same registry source,
  // same 30s-cached getServices() call — but returns a boolean instead of
  // throwing: the admin route's caller wants a loud 400 with a specific
  // message, while this route must report the same silent, indistinguishable
  // pending shape (R7) for an unknown host as for every other non-granted
  // outcome.
  private async isKnownServiceHost(serviceHost: string): Promise<boolean> {
    const services = await this.serviceRegistry.getServices()
    return services.some(service => service.host === serviceHost)
  }
}
