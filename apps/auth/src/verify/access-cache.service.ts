import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { AuthService } from '@thallesp/nestjs-better-auth'
import { PinoLogger } from 'nestjs-pino'

import { normalizeEmail } from 'src/admin/normalize-email'
import type { Auth } from 'src/auth/auth'
import { DB, type Db } from 'src/db/database.module'
import {
  deletePreAuthorizedGrant,
  findPreAuthorizedGrantsByEmail,
  grantExists,
  insertGrant,
  listAllGrants,
  listAllPreAuthorizedGrants,
  listBlockedUserIds,
} from 'src/grants/grants.repo'

// ──────────────────────────────────────────────────────────────────────────────
// The preloaded, write-through-invalidated in-memory cache backing every
// /verify decision. Three independent things live here, all zero-I/O once
// warm:
//
//   1. grantsByUser — who can reach what. Preloaded at boot from
//      grants.repo.ts; mutated in place by addGrant/removeGrant, the write-
//      through invalidation surface requests.service.ts's approveRequest()
//      and users.service.ts's edit/revoke actions call after their own DB
//      writes.
//   2. blockedUserIds — the block/unblock enforcement half. Preloaded at
//      boot; mutated in place by blockUser/unblockUser, users.service.ts's
//      write-through surface. Read fresh on every decision (never itself
//      session-cached), which is exactly what makes a blocked account with
//      a stale grant still reach nothing — blocking takes effect
//      independent of whatever is cached in sessionCache below.
//   3. sessionCache — resolveSession()'s own cache. See that method's
//      comment for the full session-cache design and why it diverges from
//      a `databaseHooks.session.create.after`-based design that seems
//      obvious at first.
//
// admin.controller.ts (approve/reject) and users.service.ts (block/unblock/
// grant edits) are this file's actual write-through invalidation callers —
// see addGrant/removeGrant/blockUser/unblockUser below.
// ──────────────────────────────────────────────────────────────────────────────

// A resolved, POSITIVE session result only, cached by the EXTRACTED
// session cookie value (extractSessionCookieValue() below) — see
// resolveSession's own comment for why P2 moved this off the raw Cookie
// header. There is no negative-cache marker: a Cookie header that resolves
// to no session (never signed a valid cookie at all, or a getSession()
// call confirms it is genuinely expired/revoked) is never written to this
// Map — see resolveSession's own CACHE LIFETIME comment for why caching
// that outcome is exactly the attacker-controlled-growth vector this
// design avoids. `Map.get()`'s `undefined` is therefore the ONLY "not a
// currently-known-good session" signal this cache has.
type CachedSession = {
  userId: string
  email: string
  expiresAtMs: number
}

// Better Auth mints this session cookie as `${cookiePrefix}.session_token`,
// `__Secure-`-prefixed whenever AUTH_HOST's configured scheme is https —
// confirmed against installed better-auth@1.6.23's dist/cookies/index.mjs;
// src/auth/auth.ts never overrides cookiePrefix, so the default
// ('better-auth') applies. Both forms are matched by exact cookie name
// (not a substring marker) so extractSessionCookieValue() below works
// correctly in both dev (http, unprefixed) and prod (https, `__Secure-`).
const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
] as const

// P2: the ONE place that parses a raw `Cookie` header down to just the
// Better Auth session cookie's VALUE — used for both resolveSession()'s
// admission gate and its cache key (see that method's own comment for why
// keying on the whole header was a real bug, not just imprecise). Returns
// null if the header carries neither of SESSION_COOKIE_NAMES's two forms.
export function extractSessionCookieValue(cookieHeader: string): string | null {
  for (const pair of cookieHeader.split(';')) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1) continue
    const name = pair.slice(0, separatorIndex).trim()
    if ((SESSION_COOKIE_NAMES as readonly string[]).includes(name)) {
      return pair.slice(separatorIndex + 1).trim()
    }
  }
  return null
}

// Kept local rather than graduated into a shared cross-file registry (the
// tdr-code `src/logging/log-events.ts` convention this app will likely
// adopt once it has enough call sites to warrant it) — this is the ONLY
// log call site in the app so far. Follows that convention's SHAPE
// (kebab-case value, `event` field first, human `msg` second) without yet
// building the infrastructure a single call site doesn't need.
const LOG_EVENTS = {
  sessionCheckError: 'verify-session-check-error',
} as const

@Injectable()
export class AccessCacheService implements OnModuleInit {
  // Bounds sessionCache's worst-case memory footprint regardless of how it
  // is populated — an unauthenticated caller mints one entry per distinct
  // Cookie header it can get resolveSession() to see (e.g. via the
  // unauthenticated-by-design SSE endpoint), so this cache has no other
  // backstop against unbounded growth. Eviction (cacheSession() below)
  // drops the OLDEST entry once at cap — costing whichever real session
  // that evicts one extra getSession() call on its next request, the same
  // cost every cold cache miss already pays.
  private static readonly MAX_SESSION_CACHE_ENTRIES = 5_000

  // Clamps how long a POSITIVE session-cache entry can outlive an
  // out-of-band revocation (sign-out, revoke-session, admin block) that
  // this cache has no other way to observe — see cacheSession()'s own
  // caller in resolveSession() for where this is applied. 60s keeps
  // revocation convergence fast while staying effectively zero-I/O in
  // steady state (one DB read per session per minute, at most).
  private static readonly MAX_SESSION_CACHE_MS = 60_000

  private readonly grantsByUser = new Map<string, Set<string>>()
  private readonly blockedUserIds = new Set<string>()
  private readonly sessionCache = new Map<string, CachedSession>()
  // P1: in-flight dedup for resolveSession()'s cache-miss path — see that
  // method's own comment on why this exists and lookupSession() for the
  // deduplicated work itself.
  private readonly inFlightLookups = new Map<
    string,
    Promise<{ userId: string; email: string } | null>
  >()
  // Pre-authorizations awaiting a first sign-in, keyed by email
  // (not userId — there is no userId yet). See bindPreAuthorizedGrant()'s
  // own header comment for the full binding design and why it runs here,
  // lazily, rather than from a databaseHooks.user.create.after auth-time
  // hook.
  private readonly preAuthorizedByEmail = new Map<string, Set<string>>()

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authService: AuthService<Auth>,
    private readonly logger: PinoLogger,
  ) {}

  // Preloads grants, blocked accounts, and pending pre-authorizations once,
  // at boot — the ONE DB read this whole cache pays outside of a session
  // cache miss or a pre-authorization bind ("no I/O in steady state" is
  // about the STEADY STATE, not process startup or the rare one-time event
  // a specific user's very first post-pre-authorization verify is).
  onModuleInit(): void {
    for (const { userId, serviceHost } of listAllGrants(this.db)) {
      this.addGrant(userId, serviceHost)
    }
    for (const userId of listBlockedUserIds(this.db)) {
      this.blockedUserIds.add(userId)
    }
    for (const { email, serviceHost } of listAllPreAuthorizedGrants(this.db)) {
      this.addPreAuthorization(email, serviceHost)
    }
  }

  // ── Grants ────────────────────────────────────────────────────────────

  hasGrant(userId: string, serviceHost: string): boolean {
    return this.grantsByUser.get(userId)?.has(serviceHost) ?? false
  }

  // Write-through invalidation surface for the approve action and "edit a
  // user's services" / pre-authorize-by-email actions. Idempotent —
  // granting an already-granted pair is a no-op on the underlying Set.
  addGrant(userId: string, serviceHost: string): void {
    let hosts = this.grantsByUser.get(userId)
    if (!hosts) {
      hosts = new Set<string>()
      this.grantsByUser.set(userId, hosts)
    }
    hosts.add(serviceHost)
  }

  // Write-through invalidation surface for the revoke / "edit a user's
  // services" actions. Removing a pair that was never granted is a no-op.
  removeGrant(userId: string, serviceHost: string): void {
    this.grantsByUser.get(userId)?.delete(serviceHost)
  }

  // ── Pre-authorization ─────────────────────────────────────────────────

  // Write-through invalidation surface for the "pre-authorize by email"
  // admin action, called AFTER that action's own DB insert (mirrors
  // addGrant's own write-then-cache-update ordering). Idempotent, matching
  // the underlying table's own unique index.
  addPreAuthorization(email: string, serviceHost: string): void {
    let hosts = this.preAuthorizedByEmail.get(email)
    if (!hosts) {
      hosts = new Set<string>()
      this.preAuthorizedByEmail.set(email, hosts)
    }
    hosts.add(serviceHost)
  }

  // Write-through invalidation surface for UsersService.preAuthorize()'s
  // existing-user branch — consumes ONE specific (email, serviceHost)
  // pending pre-authorization once that call has already written a REAL
  // grant for it directly, so the coexisting grant-plus-pending-row state
  // bindPreAuthorizedGrant()'s own grantExists guard defends against can
  // never arise via this path either. Idempotent, mirroring
  // addPreAuthorization's own shape — removing a pair that was never
  // pending is a no-op.
  removePreAuthorization(email: string, serviceHost: string): void {
    const normalizedEmail = normalizeEmail(email)
    const hosts = this.preAuthorizedByEmail.get(normalizedEmail)
    if (!hosts) {
      return
    }
    hosts.delete(serviceHost)
    if (hosts.size === 0) {
      this.preAuthorizedByEmail.delete(normalizedEmail)
    }
  }

  /**
   * "The grant binds on first sign-in." Called by
   * VerifyService.decide() ONLY on the already-rare "no grant found"
   * branch (never on the hot, already-granted path), so this is checked
   * for every unauthorized request but only ever WRITES for the specific,
   * one-time case of a pre-authorized email's very first verify anywhere.
   *
   * DESIGN, AND WHY THIS RUNS HERE RATHER THAN AN AUTH-TIME HOOK:
   *
   * The "obvious" seam for "bind on first sign-in" is a better-auth
   * `databaseHooks.user.create.after` hook (confirmed against installed
   * better-auth@1.6.23's dist/db/with-hooks.mjs: `createWithHooks` invokes
   * `hooks[model]?.create?.after` with the just-created row, exactly once,
   * only on a genuine INSERT — never on a returning user's sign-in, which
   * only creates a new `session` row, not a new `user` row). That hook
   * COULD write a real grant row (it closes over the same `db` this file
   * already has, via buildAuth(db)) — but it could NOT also update this
   * cache's in-memory maps, because doing so would require injecting
   * AccessCacheService into auth.module.ts's forRootAsync() factory, and
   * that dependency is circular: AccessCacheService itself depends on
   * AuthService, which does not exist until AuthModule — the very module
   * whose factory would need AccessCacheService — finishes constructing.
   * A hook that only writes the DB without also updating this cache would
   * leave a genuinely new user's first verify reading a stale (empty)
   * in-memory grant set, silently sending a pre-authorized user to the
   * pending page instead of straight through.
   *
   * This method sidesteps that circularity entirely: AccessCacheService
   * already has both the DB and its own in-memory maps, so it can bind a
   * pre-authorization ITSELF, lazily, the first time it is asked "does
   * this (userId, email) have a grant" and finds none. Operationally this
   * is indistinguishable from "binding at sign-in" for every real request
   * flow — a freshly signed-in user's very next action is always a
   * ForwardAuth /verify call (that is the entire point of ForwardAuth),
   * so "first verify" and "first sign-in" resolve at the same moment for
   * everyone who actually goes on to use the app.
   *
   * Binds EVERY service this email was pre-authorized for in one
   * transaction, not just `forwardedHost` — "signing in" is a single
   * event for that person, not once per service they'll eventually visit,
   * so a second pre-authorized host binds silently in the background here
   * too rather than waiting for its own separate first-visit moment.
   */
  bindPreAuthorizedGrant(
    userId: string,
    email: string,
    forwardedHost: string,
  ): boolean {
    // Normalized once and reused for both the in-memory lookup and every
    // DB call below — UsersService.preAuthorize() normalizes before
    // writing too, so this is the form every pending row actually exists
    // under; `email` here is whatever a real sign-in reports (Google's own
    // `email` claim), which must be normalized the same way to ever match.
    const normalizedEmail = normalizeEmail(email)
    const pendingHosts = this.preAuthorizedByEmail.get(normalizedEmail)
    if (!pendingHosts || pendingHosts.size === 0) {
      return false
    }

    const hostsToBind = [...pendingHosts]
    this.db.transaction(
      tx => {
        for (const serviceHost of hostsToBind) {
          // Guards against a real grant and a pending pre-authorization
          // coexisting for the same (userId, serviceHost) — e.g.
          // UsersService.preAuthorize()'s existing-user branch already
          // granted this pair directly. Without this guard, insertGrant's
          // second write would throw on grant's own UNIQUE(user_id,
          // service_host) index, rolling back this WHOLE transaction
          // (including the delete loop below) and leaving the pending row
          // in place to throw again on every subsequent /verify for this
          // user — a permanent 500 that doesn't even self-heal on restart,
          // since onModuleInit() reloads the same orphaned row. Every
          // other insertGrant() caller in this app already guards this
          // way; this was the one path that didn't.
          if (grantExists(tx, userId, serviceHost)) {
            continue
          }
          insertGrant(tx, userId, serviceHost, new Date())
        }
        for (const row of findPreAuthorizedGrantsByEmail(tx, normalizedEmail)) {
          deletePreAuthorizedGrant(tx, row.id)
        }
      },
      { behavior: 'immediate' },
    )

    for (const serviceHost of hostsToBind) {
      this.addGrant(userId, serviceHost)
    }
    this.preAuthorizedByEmail.delete(normalizedEmail)

    return hostsToBind.includes(forwardedHost)
  }

  // ── Blocked status ────────────────────────────────────────────────────

  isBlocked(userId: string): boolean {
    return this.blockedUserIds.has(userId)
  }

  // Write-through invalidation surface for the block action. Takes effect
  // on the very next verify for this user, no restart — VerifyService
  // checks this Set fresh on every decision (never itself session-cached),
  // so a blocked account's session can still be a warm cache hit while its
  // blocked status is read live.
  blockUser(userId: string): void {
    this.blockedUserIds.add(userId)
  }

  // Write-through invalidation surface for the unblock action.
  unblockUser(userId: string): void {
    this.blockedUserIds.delete(userId)
  }

  // ── Session invalidation (S2b) ───────────────────────────────────────

  // Write-through invalidation surface for UsersService.revokeSessions()
  // (and, through it, blockUser()) — evicts every sessionCache entry
  // currently resolving to this user, so a DB-level session revocation
  // (auth-session.repo.ts's revokeSessionsForUser) takes effect on this
  // zero-I/O cache immediately, rather than an already-warm entry riding
  // out the up-to-MAX_SESSION_CACHE_MS clamp resolveSession() would
  // otherwise still honor. Safe to delete the CURRENT key while iterating
  // a Map — well-defined per spec, and does not skip entries.
  invalidateSessionsForUser(userId: string): void {
    for (const [sessionCookieValue, cached] of this.sessionCache) {
      if (cached.userId === userId) {
        this.sessionCache.delete(sessionCookieValue)
      }
    }
  }

  // ── Session resolution ───────────────────────────────────────────────

  // Routes every sessionCache WRITE through one place so the size cap
  // above is never bypassed by a call site that forgets it. Only ever
  // called with a POSITIVE result — see resolveSession()'s own comment for
  // why a negative outcome is never written here at all. Map iteration
  // order is insertion order (guaranteed by spec), so `.keys().next()` is
  // genuinely the oldest entry — evicted before the new one is inserted so
  // the Map never transiently exceeds the cap.
  private cacheSession(key: string, value: CachedSession): void {
    if (
      this.sessionCache.size >= AccessCacheService.MAX_SESSION_CACHE_ENTRIES
    ) {
      const oldest = this.sessionCache.keys().next()
      if (!oldest.done) {
        this.sessionCache.delete(oldest.value)
      }
    }
    this.sessionCache.set(key, value)
  }

  /**
   * Resolves a raw `Cookie` header to `{ userId, email }`, or `null` if it
   * carries no valid session — zero I/O on a cache hit.
   *
   * DESIGN, AND WHY IT DIVERGES FROM A HOOK-BASED APPROACH:
   *
   * A `databaseHooks.session.create.after` hook plus a lazy DB-read
   * fallback might seem like the obvious way to populate this cache. That
   * mechanism cannot work as described: the hook fires with the RAW,
   * UNSIGNED `session.token` at creation time — before
   * Better Auth ever constructs the SIGNED cookie value a browser actually
   * carries (name `better-auth.session_token`, or
   * `__Secure-better-auth.session_token` when AUTH_HOST is https —
   * confirmed against installed better-auth@1.6.23's dist/cookies/
   * index.mjs). The signed wire value is `${rawToken}.${base64Signature}`,
   * produced by `ctx.setSignedCookie` via better-call's HMAC signing
   * (dist/crypto.mjs) — code that is NOT part of that package's public
   * `exports` map, the same restriction better-auth's own deep internals
   * are under. A hook-populated cache keyed by the raw token could never be
   * looked up by anything /verify can cheaply derive from an incoming
   * SIGNED cookie without reimplementing that private signing/verification
   * scheme ourselves, which would duplicate crypto internals with no
   * compatibility guarantee across better-auth versions.
   *
   * ACTUAL DESIGN: cache by extractSessionCookieValue()'s result — the
   * Better Auth session cookie's OWN value, not the whole raw `Cookie`
   * header. P2 moved this off the whole-header key that shipped originally,
   * which had two real bugs: (1) this app's cookies use
   * `crossSubDomainCookies` (Domain=.lilnas.io, see auth.ts), so any OTHER
   * cookie set by ANY *.lilnas.io subdomain — Grafana, a UI preference, a
   * feature flag — rides along on every request's Cookie header; a change
   * to any of them changed the cache KEY even though the session itself
   * was unchanged, forcing a real getSession() re-verification for no
   * reason. (2) cacheSession()'s FIFO eviction assumed one entry per
   * session; keyed by the whole header, one signed-in user visiting
   * several subdomains (each mutating some unrelated cookie differently)
   * could mint many distinct entries for their OWN single session, capable
   * of evicting a meaningful fraction of the whole 5,000-entry cache by
   * themselves. Verified: 20 unrelated-cookie variants of one real session
   * produced 20 cache entries and 20 getSession() calls before this fix.
   * A header with no `Cookie` at all, or none of whose cookies match
   * either of SESSION_COOKIE_NAMES's two forms, is trivially "no session"
   * — checked BEFORE ever touching the cache, so a totally anonymous
   * request never grows this Map.
   *
   * On a cache miss, calls Better Auth's own PUBLIC `auth.api.getSession()`
   * exactly once — the SAME `auth` instance `buildAuth(db)` produces
   * (reused via the injected AuthService, never a second instance). This
   * handles cookie verification and the DB read internally; the only
   * contract this method relies on is "resolves `{ session, user } | null`,
   * or throws on a genuine infra failure" — confirmed against installed
   * better-auth@1.6.23's dist/api/routes/session.mjs, the same source
   * apps/tdr-code/src/auth/auth.guard.ts's identical getSession() call
   * documents its own failure contract against. In particular (traced
   * directly, not assumed): a garbage/forged signed-cookie value NEVER
   * throws — better-call's getSignedCookie (dist/context.mjs) returns
   * `null`/`false` for a missing signature separator, wrong length, or a
   * failed HMAC verification (verifySignature's own try/catch swallows
   * every decode/verify error and returns `false`), and getSession()'s
   * `if (!sessionCookieToken) return null` treats any of those identically
   * to "no cookie at all." So a malformed/forged cookie resolves to `null`
   * exactly like an anonymous request — no special-case handling needed
   * here beyond treating a falsy result as "no session."
   *
   * A THROWN error (e.g. SQLite busy/contention inside
   * internalAdapter.findSession) is different: logged distinctly and
   * treated as "no session" for THIS request only — NOT cached, since it
   * is not a durable fact about the cookie the way a resolved `null` is.
   * This mirrors apps/tdr-code/src/auth/auth.guard.ts's identical choice to
   * fail closed (deny) rather than 500 on the same underlying failure: a
   * 5xx here would take down every migrated service for every user on a
   * passing DB hiccup, which is a worse blast radius than one user
   * retrying a moment later. Contrast with VerifyService's OWN fail-closed
   * 5xx for a missing X-Forwarded-Host — that is a Traefik/infra
   * misconfiguration (not a session problem), a fundamentally different
   * failure class this method has no opinion on.
   *
   * CACHE LIFETIME: a positive entry's `expiresAtMs` is the session's own
   * `expiresAt` (from getSession()'s resolved `session.expiresAt`) CLAMPED
   * to at most `MAX_SESSION_CACHE_MS` from now — not the session's raw
   * expiry, and not a fixed TTL either. The clamp exists because this
   * cache has no other way to observe an out-of-band revocation (sign-out,
   * revoke-session, an admin block): without it, a cookie captured before
   * sign-out would keep passing /verify for up to the session's full
   * `expiresIn` (30 days) after the underlying `session` row is deleted.
   * Bounding the cache lifetime instead of the session's own lifetime
   * means revocation converges within `MAX_SESSION_CACHE_MS` regardless of
   * how long the session itself is configured to live, at the cost of one
   * DB read per session per clamp interval in steady state — still
   * effectively zero-I/O: the "no I/O in steady state" property is about
   * request VOLUME, not about a fixed, small number of reads per session
   * per minute.
   *
   * On lookup, an entry whose `expiresAtMs` has passed falls through to a
   * REAL getSession() call — deliberately, not an oversight, and NOT the
   * same behavior this cache had before the clamp existed. Because
   * `expiresAtMs` is now a clamp rather than the session's real expiry, a
   * passed `expiresAtMs` is no longer "definitely expired everywhere" —
   * it may simply mean the clamp window elapsed while the underlying
   * session is still perfectly valid. Re-verifying is exactly what makes
   * an out-of-band revocation ever observable: a still-valid session gets
   * re-cached with a fresh clamp window (effectively free — one DB read
   * per clamp interval); a genuinely revoked/expired one now correctly,
   * finally stops passing instead of riding out its full 30-day cookie
   * life. Neither outcome of that re-check is ever cached negatively — see
   * the cold-miss handling below, which this re-check shares entirely.
   * There is no negative-cache path anywhere in this method: the only way
   * a given session cookie value can ever become a POSITIVE cache entry is
   * a real, current getSession() success, and the only way it stops being
   * one is the clamp elapsing and re-verification failing.
   */
  async resolveSession(
    cookieHeader: string | undefined,
  ): Promise<{ userId: string; email: string } | null> {
    const sessionCookieValue = cookieHeader
      ? extractSessionCookieValue(cookieHeader)
      : null
    if (!cookieHeader || !sessionCookieValue) {
      return null
    }

    const cached = this.sessionCache.get(sessionCookieValue)
    if (cached !== undefined) {
      if (cached.expiresAtMs > Date.now()) {
        return { userId: cached.userId, email: cached.email }
      }
      // The cached entry's clamped lifetime has passed — NOT necessarily
      // the underlying session's real expiry (see this method's own CACHE
      // LIFETIME comment on why expiresAtMs is a clamp, not the session's
      // raw expiry). Deliberately falls through to a real re-verification
      // below rather than treating this as "no session": forcing exactly
      // that re-check is the entire mechanism that makes an out-of-band
      // revocation (sign-out, admin block) ever converge — a still-valid
      // session simply gets re-cached with a fresh clamp window below; a
      // genuinely revoked/expired one now correctly stops passing.
    }

    // P1: in-flight dedup, keyed by the SAME sessionCookieValue as the
    // cache above (not the raw header — see this method's own ACTUAL
    // DESIGN comment for why). MAX_SESSION_CACHE_MS's 60s clamp means
    // every entry for a given browser expires at roughly the same moment,
    // so the very next page load — one /verify subrequest per asset and
    // XHR — arrives as a burst of near-simultaneous calls for the SAME
    // session, all landing on the cache-miss path above at once. Measured
    // directly: 50 concurrent cold resolveSession() calls for one session
    // previously drove 50 independent getSession() calls; with this in
    // place, one. Populated with the lookup promise BEFORE the first
    // `await` inside it ever yields, so every concurrent caller for this
    // session gets the SAME promise instead of racing its own getSession()
    // call — cleared in `finally` so a later, non-concurrent call still
    // starts a fresh lookup (or simply hits the now-warm cache above).
    const inFlight = this.inFlightLookups.get(sessionCookieValue)
    if (inFlight) {
      return inFlight
    }

    // The FULL raw cookieHeader (not sessionCookieValue alone) is what
    // getSession() below actually needs — better-auth does its own cookie
    // parsing/verification from the complete header. Only the cache/
    // in-flight KEYS use the narrower extracted value.
    const lookup = this.lookupSession(cookieHeader, sessionCookieValue)
    this.inFlightLookups.set(sessionCookieValue, lookup)
    try {
      return await lookup
    } finally {
      this.inFlightLookups.delete(sessionCookieValue)
    }
  }

  // The actual cache-miss work resolveSession() above deduplicates: one
  // real Better Auth getSession() call, plus caching a positive result.
  // Never throws — every failure mode below resolves to `null` instead, so
  // resolveSession()'s in-flight Map entry is always cleanly settled.
  // Takes BOTH the full raw header (getSession() needs it for its own
  // cookie parsing) and the already-extracted sessionCookieValue (the
  // cache key) — the caller resolves both once rather than this method
  // re-deriving the latter from the former a second time.
  private async lookupSession(
    cookieHeader: string,
    sessionCookieValue: string,
  ): Promise<{ userId: string; email: string } | null> {
    let result: Awaited<ReturnType<AuthService<Auth>['api']['getSession']>>
    try {
      result = await this.authService.api.getSession({
        headers: new Headers({ cookie: cookieHeader }),
        // `disableRefresh: true` is NOT optional polish — without it this
        // "read-only" cache-miss path silently performs a WRITE. Found by
        // reading installed better-auth@1.6.23's dist/api/routes/
        // session.mjs — not assumed to follow automatically from this
        // cache's zero-I/O design, because it does not follow
        // automatically: getSession() computes `shouldBeUpdated =
        // session.expiresAt - expiresIn*1000 + updateAge*1000 <=
        // Date.now()` and, whenever that holds (i.e. the session is within
        // `updateAge` — 1440*60s = 1 DAY by default, confirmed in
        // dist/context/create-context.mjs, of its own expiresIn), issues
        // `internalAdapter.updateSession(...)` — a real UPDATE — and
        // returns the REFRESHED (extended) session instead of the actual
        // current row. Every real session eventually ages into that last
        // `updateAge` day of its 30-day life, so left unset this cache's
        // ONE deliberate DB read on a cold miss would, for a large and
        // entirely normal slice of real traffic, quietly become a DB
        // WRITE too — precisely the "no rolling session refresh from
        // /verify" property this cache depends on, silently violated by
        // the library's own default. `disableRefresh` (documented in
        // better-auth's own getSessionQuerySchema as "Useful for checking
        // session status, without updating the session") makes
        // getSession() return the CURRENT row's real session.expiresAt
        // unmodified — exactly the semantics resolveSession()'s own
        // expiresAtMs cache-lifetime design below depends on. Discovered
        // via the "session past its cached expiresAt" test: forcing the DB
        // row to a near-future expiresAt and expecting it to read back
        // unmodified only works with this flag set — without it, the
        // forced near-expiry triggered exactly the refresh path above,
        // silently extending the session back out to a fresh 30-day
        // expiresAt and defeating the entire test (and, in production,
        // defeating any attempt to reason about this cache's TTL from the
        // session's own configured lifetime at all).
        query: { disableRefresh: true },
      })
    } catch (err) {
      this.logger.error(
        {
          event: LOG_EVENTS.sessionCheckError,
          // Coarsened to err.name only, never err.message/err.stack/the raw
          // err object — per
          // docs/archive/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md's
          // redaction hierarchy, call-site judgment (not a redact path) is
          // the primary defense against an unanticipated secret-bearing
          // error message reaching a log line.
          errName: err instanceof Error ? err.name : undefined,
        },
        'Session lookup failed during /verify',
      )
      return null
    }

    if (!result) {
      // Deliberately NOT cached. Caching this outcome is exactly the
      // unauthenticated remote-memory-exhaustion vector this cache used to
      // have: the sole admission gate above (extractSessionCookieValue()
      // finding no match) still lets an attacker present arbitrarily many
      // distinct forged session-cookie VALUES, each of which would
      // otherwise mint its own permanent entry. Leaving it uncached costs
      // a repeat forged request one HMAC verification (no DB read — see
      // this method's own comment on getSession()'s forged-cookie
      // contract) instead of a hash-map lookup, which is an acceptable
      // trade for closing an unbounded, unauthenticated growth path.
      return null
    }

    this.cacheSession(sessionCookieValue, {
      userId: result.user.id,
      email: result.user.email,
      // Clamped to at most MAX_SESSION_CACHE_MS from now, NOT the
      // session's own (up to 30-day) expiresAt — see this method's own
      // CACHE LIFETIME comment for why bounding the CACHE's lifetime,
      // rather than trusting the session's real lifetime, is what makes a
      // sign-out/revoke-session/admin-block ever take effect on this
      // zero-I/O path at all.
      expiresAtMs: Math.min(
        result.session.expiresAt.getTime(),
        Date.now() + AccessCacheService.MAX_SESSION_CACHE_MS,
      ),
    })
    return { userId: result.user.id, email: result.user.email }
  }
}
