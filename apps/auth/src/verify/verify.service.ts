import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'

import { normalizeEmail } from 'src/admin/normalize-email'
import { EnvKeys } from 'src/env'

import { AccessCacheService } from './access-cache.service'

// ──────────────────────────────────────────────────────────────────────────────
// The /verify decision itself. Pure orchestration over AccessCacheService's
// zero-I/O lookups — this class calls no repo function directly and
// performs no I/O of its own. One narrow exception: on the no-grant
// branch, it asks AccessCacheService to bind a pending pre-authorization,
// which — only in the rare case one actually exists for this email —
// performs a one-time DB write entirely inside that service. See
// AccessCacheService.bindPreAuthorizedGrant()'s own header comment for why
// that write lives there and not here.
//
// The decision order is LOAD-BEARING: session -> blocked -> admin bypass
// -> grant. Blocked is checked BEFORE the admin bypass AND before the
// grant lookup — a blocked ADMIN_EMAILS address is denied here exactly
// like any other blocked account, and a blocked account with an existing,
// valid grant still reaches nothing (checking grant first would let a
// stale grant paper over a block).
//
// This is a deliberate ASYMMETRY with admin.guard.ts, not an oversight.
// AdminGuard's isAdminEmail() check stays completely independent of
// blocked/grant state — an admin's OWN access to /admin must survive an
// empty or corrupted grants table, and must not become revocable by
// anything an admin action itself writes to it, including its own block
// action — so a blocked admin still reaches /admin and can unblock
// themselves there. If AdminGuard also denied a blocked admin, blocking
// your own admin account would be a self-inflicted, unrecoverable lockout
// with no path back in — there is deliberately no separate "unlock"
// mechanism beyond /admin itself. See admin.guard.ts's own header comment
// for the matching rationale on the /admin side.
//
// Request creation (turning "no grant" into a written access_request row)
// is explicitly NOT this service's job — requests.service.ts owns that.
// The no-grant branch here only redirects to the pending URL after the
// pre-authorization check above finds nothing to bind; it never writes
// directly itself.
// ──────────────────────────────────────────────────────────────────────────────

export type VerifyInput = {
  cookieHeader: string | undefined
  forwardedHost: string | undefined
  forwardedProto: string | undefined
  forwardedUri: string | undefined
}

export type VerifyDecision =
  | { outcome: 'allow'; email: string; userId: string }
  | { outcome: 'redirect'; location: string }
  | { outcome: 'fail-closed'; reason: string }

const REDIRECT_PATHS = {
  login: '/login',
  pending: '/pending',
  // A destination dedicated to a blocked account, distinct from /pending —
  // see requests.controller.ts's own header comment for the matching
  // ordinary-HTTP-status-check on that side. This never touches
  // RequestsService — see decide()'s own isBlocked branch below.
  blocked: '/blocked',
} as const

@Injectable()
export class VerifyService {
  private readonly authHost: string
  private readonly adminEmailsEnv: string

  constructor(private readonly accessCache: AccessCacheService) {
    // AUTH_HOST is trusted deployment config (same env key src/auth/auth.ts
    // and src/auth/redirect.ts already read), not user input — read once
    // here rather than per-request, matching buildAuth()'s own posture: a
    // malformed value should fail loudly at construction, not be silently
    // re-parsed on every /verify call.
    this.authHost = env(EnvKeys.AUTH_HOST)
    // Unlike authHost above (no default — required, load-bearing config)
    // and admin.guard.ts's own env(EnvKeys.ADMIN_EMAILS) read (no default —
    // throws if unset), this is deliberately DEFAULTED to ''. AdminGuard's
    // throw-on-missing is fine because an unset ADMIN_EMAILS only ever
    // breaks the narrow /admin surface. VerifyService cannot afford that
    // posture: Nest constructs every singleton at boot, so a throwing
    // constructor here would take down /verify — the hot path for every
    // protected host on the box — entirely, for every user, the moment
    // ADMIN_EMAILS is merely unset. isAdminBypassEmail(email, '') always
    // returns false, so this default is a genuine no-op for ordinary
    // traffic — /verify must not develop a new hard dependency on
    // ADMIN_EMAILS being configured just to keep working normally for
    // non-admins.
    this.adminEmailsEnv = env(EnvKeys.ADMIN_EMAILS, '')
  }

  async decide(input: VerifyInput): Promise<VerifyDecision> {
    const { forwardedHost, forwardedProto, forwardedUri, cookieHeader } = input

    // Fail closed on a missing service identity. This is a Traefik/infra
    // misconfiguration, NOT an anonymous user — an anonymous user still
    // carries a real X-Forwarded-Host (the service they're trying to
    // reach); there is no legitimate request shape missing this header.
    // ForwardAuth must never fail open, and a loud 5xx (rather than
    // quietly treating this like "no session" and redirecting to login) is
    // what makes this failure class visible to an operator instead of
    // masquerading as routine, high-volume anonymous traffic. No
    // access_request row is created on this path either — there is no
    // valid serviceHost to key one on.
    if (!forwardedHost) {
      return {
        outcome: 'fail-closed',
        reason: 'missing X-Forwarded-Host',
      }
    }

    const originalUrl = buildOriginalUrl(
      forwardedHost,
      forwardedProto,
      forwardedUri,
    )

    const session = await this.accessCache.resolveSession(cookieHeader)
    if (!session) {
      return {
        outcome: 'redirect',
        location: this.buildRedirectUrl(REDIRECT_PATHS.login, originalUrl),
      }
    }

    // Checked BEFORE the admin bypass AND the grant lookup — see this
    // file's header comment for why this ordering holds even for an
    // ADMIN_EMAILS address. The destination is /blocked, not /pending —
    // see REDIRECT_PATHS.blocked's own comment for why.
    if (this.accessCache.isBlocked(session.userId)) {
      return {
        outcome: 'redirect',
        location: this.buildRedirectUrl(REDIRECT_PATHS.blocked, originalUrl),
      }
    }

    // Admin bypass — unconditional for a NOT-blocked admin, and checked
    // AFTER the blocked check above (see this file's header comment for
    // why). An ADMIN_EMAILS address already has unrestricted control over
    // the whole system (approves/rejects every other user, can block/
    // unblock any account), so gating its own access to an ordinary
    // protected host behind a grant is friction with no security benefit.
    // This does NOT bypass authentication: an admin who isn't signed in at
    // all still hits the `!session` branch above like anyone else. It never
    // calls hasGrant/bindPreAuthorizedGrant, and it never writes a grant
    // row — see isAdminBypassEmail()'s own comment for the consequence of
    // that (no everGrantedAt, so an admin-only identity never appears in
    // /admin/users).
    if (isAdminBypassEmail(session.email, this.adminEmailsEnv)) {
      return { outcome: 'allow', email: session.email, userId: session.userId }
    }

    if (this.accessCache.hasGrant(session.userId, forwardedHost)) {
      // Parity with the middleware being replaced (nothing in the repo
      // reads X-Forwarded-User today (confirmed repo-wide), so this is
      // free and cannot break a migrating router). VerifyController is
      // what actually sets the response header; this method only decides
      // the value.
      return { outcome: 'allow', email: session.email, userId: session.userId }
    }

    // "the grant binds on first sign-in." Checked only here, on the
    // already-uncommon no-grant branch — see
    // AccessCacheService.bindPreAuthorizedGrant()'s own header comment for
    // the full design and why this is the one narrowly-scoped exception to
    // this class's "never writes" claim (the write it triggers happens
    // entirely inside AccessCacheService, which owns the grants/cache
    // concern already — this method still calls no repo function
    // directly).
    if (
      this.accessCache.bindPreAuthorizedGrant(
        session.userId,
        session.email,
        forwardedHost,
      )
    ) {
      return { outcome: 'allow', email: session.email, userId: session.userId }
    }

    // No grant. requests.service.ts owns turning this into a
    // created-or-absorbed access_request row — this service only
    // redirects, it never writes.
    return {
      outcome: 'redirect',
      location: this.buildRedirectUrl(REDIRECT_PATHS.pending, originalUrl),
    }
  }

  /**
   * Builds an ABSOLUTE `${AUTH_HOST}${path}?redirect=<originalUrl>` URL.
   *
   * Absolute, never relative — Traefik's `preserveLocationHeader` defaults
   * to `false`, so a relative Location out of /verify would be rewritten
   * by Traefik into a container-internal, browser-unreachable URL
   * (`http://auth:8081/relative-target`-shaped) instead of reaching
   * the browser as intended. Every non-allow outcome from this service
   * must therefore carry a full origin, derived from AUTH_HOST the same
   * way src/auth/auth.ts and src/auth/redirect.ts already do (never a
   * second, independently-hardcoded scheme).
   *
   * The login, pending, AND blocked redirects all use the SAME `redirect=`
   * query parameter carrying the full original URL — deliberately, not a
   * `service=`/`host=` param carrying just the hostname. The pending (and
   * now blocked) page can derive the service host from
   * `new URL(redirect).hostname`, so one param serves the login page
   * (where the whole URL is needed to return the user to their original
   * destination) and the pending/blocked pages (where only the host is
   * needed) without two params that could drift out of sync.
   */
  private buildRedirectUrl(
    path: (typeof REDIRECT_PATHS)[keyof typeof REDIRECT_PATHS],
    originalUrl: string,
  ): string {
    const target = new URL(path, this.authHost)
    target.searchParams.set('redirect', originalUrl)
    return target.toString()
  }
}

// Reconstructs the original browser-facing URL from the three headers
// Traefik synthesizes on every ForwardAuth subrequest — empirically
// verified, not assumed (forwardauth-contract.spec.ts's "synthesizes
// X-Forwarded-* headers that reconstruct the original request
// byte-for-byte" test). forwardedHost is guaranteed non-empty by
// VerifyService.decide()'s own early return before this is ever called;
// forwardedProto/forwardedUri are defended with sane fallbacks even though
// Traefik always sets them, since this function has no way to
// independently re-assert VerifyService's own precondition.
function buildOriginalUrl(
  forwardedHost: string,
  forwardedProto: string | undefined,
  forwardedUri: string | undefined,
): string {
  const proto = forwardedProto || 'https'
  const uri = forwardedUri ?? '/'
  return `${proto}://${forwardedHost}${uri}`
}

// Deliberately a SEPARATE function from admin.guard.ts's isAdminEmail(),
// not an import of it — admin.guard.ts imports AccessCacheService, and this
// file already constructor-injects AccessCacheService itself, so importing
// isAdminEmail from admin.guard.ts here would create a real circular module
// dependency. Named distinctly so there's no ambiguity at call sites about
// which file's check is in play. Shares normalizeEmail() (src/admin/
// normalize-email.ts) with isAdminEmail() so both stay on the same
// normalization rule without sharing a module edge back to admin.guard.ts.
//
// Kept unexported, unlike isAdminEmail()'s own deliberate export: this
// file's test suite already exercises every case through decide() itself
// via createHarness() + signInAndGetSessionCookiePair(), so a direct export
// buys nothing here the way it does for admin.guard.ts (which exports
// isAdminEmail specifically to avoid constructing a full Guard +
// ExecutionContext per case).
function isAdminBypassEmail(email: string, adminEmailsEnv: string): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return adminEmailsEnv
    .split(',')
    .map(entry => normalizeEmail(entry))
    .filter(Boolean)
    .includes(normalized)
}
