// Canonical enumeration of every `/api/*` route this app exposes, and
// whether it sits behind AuthGuard (auth.guard.ts) or is allowlisted via
// @Public(). This is the SINGLE source of truth two independent test suites
// import so guard coverage and test coverage can never diverge:
//   - auth.guard.spec.ts (this unit, U4): iterates every PROTECTED_ROUTE to
//     prove each one 401s with no session and succeeds with one.
//   - auth-e2e.spec.ts (U5, not yet built): re-runs the same sweep as the
//     pre-cutover gate, importing this exact constant rather than a second,
//     independently-typed list that could silently drift from the guard's
//     real coverage.
//
// A route added to a controller without a corresponding entry here is a
// process gap this file cannot detect by itself — but it at least guarantees
// that whatever IS enumerated is tested, and that the guard's own allowlist
// (@Public()) is exactly one route (`GET /health`), matching R19's
// deny-by-default default.
//
// `path` uses Express's own `:param` colon syntax (not a template-literal
// type) so `buildPath` below can do simple string substitution without a
// second parsing step; every current entry has at most one path param.
//
// Route count note: the plan's prose calls the pre-revoke-sessions list "13
// guarded routes," but its own comma-separated enumeration literally lists
// 14 distinct method+path items (verified one-by-one against each
// controller's actual source — reconcile.controller.ts, lifecycle
// .controller.ts, git-identity.controller.ts — rather than taken on the
// plan's word). "13" is an off-by-one in the plan's own summary sentence,
// not a route missing from this file. So: 14 pre-existing + 1 (this unit's
// own revoke-sessions deliverable, see auth-admin.controller.ts) = 15
// PROTECTED_ROUTES entries; + GET /health public = 16 total routes.

export interface ProtectedRouteSpec {
  // HTTP method exactly as NestJS's @Get/@Post/@Put/@Delete decorators use it.
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  // Path as NestJS sees it post-strip (i.e. what `req.url` looks like after
  // Next's rewrite removes '/api' — see auth.ts's long comment on the
  // public/internal path split). Path params use Express's ':name' syntax.
  path: string
  // A short human label for test descriptions / failure messages — not used
  // for any routing logic.
  label: string
  // Concrete values to substitute into `path`'s ':param' segments when a
  // test needs an actual reachable URL. Kept alongside the spec (not
  // hand-typed per test) so every route sweep in every consuming test file
  // exercises the exact same concrete path.
  params?: Record<string, string>
}

// Fixture path-param values — arbitrary but schema-valid where the
// controller validates them (Discord snowflakes are 17-20 digits; session
// ids are positive integers). These do not need to reference real rows: the
// guard runs BEFORE the controller/service layer, so a 401 (no session) or a
// 200/404-after-controller-validation (with a session) is all a route-sweep
// test needs — the guard doesn't care whether the underlying resource exists.
const FAKE_SESSION_ID = '999999999'
const FAKE_CHANNEL_ID = '100000000000000099'
const FAKE_DISCORD_USER_ID = '100000000000000099'

export const PROTECTED_ROUTES: ProtectedRouteSpec[] = [
  { method: 'GET', path: '/live', label: 'GET /live' },
  { method: 'GET', path: '/sessions', label: 'GET /sessions' },
  {
    method: 'GET',
    path: '/sessions/:id',
    label: 'GET /sessions/:id',
    params: { id: FAKE_SESSION_ID },
  },
  {
    method: 'GET',
    path: '/sessions/:id/reconcile',
    label: 'GET /sessions/:id/reconcile',
    params: { id: FAKE_SESSION_ID },
  },
  {
    method: 'GET',
    path: '/sessions/:id/jsonl-status',
    label: 'GET /sessions/:id/jsonl-status',
    params: { id: FAKE_SESSION_ID },
  },
  { method: 'GET', path: '/events', label: 'GET /events' },
  { method: 'GET', path: '/config', label: 'GET /config' },
  { method: 'PUT', path: '/config', label: 'PUT /config' },
  { method: 'GET', path: '/git-identity', label: 'GET /git-identity' },
  {
    method: 'GET',
    path: '/git-identity/discord-members',
    label: 'GET /git-identity/discord-members',
  },
  { method: 'POST', path: '/git-identity', label: 'POST /git-identity' },
  {
    method: 'DELETE',
    path: '/git-identity/:discordUserId',
    label: 'DELETE /git-identity/:discordUserId',
    params: { discordUserId: FAKE_DISCORD_USER_ID },
  },
  { method: 'POST', path: '/bot/restart', label: 'POST /bot/restart' },
  {
    method: 'POST',
    path: '/channels/:channelId/teardown',
    label: 'POST /channels/:channelId/teardown',
    params: { channelId: FAKE_CHANNEL_ID },
  },
  { method: 'GET', path: '/bot/status', label: 'GET /bot/status' },
  // U4's own revoke-sessions break-glass deliverable (see auth-admin
  // .controller.ts) — flat-admin per R19, so this is any-admin-revokes-
  // anyone, matching the git-identity controller's existing precedent for
  // "no per-identity authorization." Mutating, so it also carries
  // requireSameOrigin() defense-in-depth like the other mutating routes.
  {
    method: 'POST',
    path: '/auth-admin/users/:discordUserId/revoke-sessions',
    label: 'POST /auth-admin/users/:discordUserId/revoke-sessions',
    params: { discordUserId: FAKE_DISCORD_USER_ID },
  },
  // Unified-logging unit's browser-log ingestion endpoint (logging.module.ts).
  // Guarded, not @Public() — see browser-logs.controller.ts's own header
  // comment for why (keeps PUBLIC_ROUTES' tested single-entry invariant
  // intact; the accepted trade-off is that unauthenticated pages, chiefly
  // /login, can't report browser errors).
  {
    method: 'POST',
    path: '/logs/browser',
    label: 'POST /logs/browser',
  },
]

// The sole allowlisted route (R19: deny-by-default; @Public() is the one
// exception). Kept alongside PROTECTED_ROUTES (not just implied by "the one
// route not in the list") so a test can assert the allowlist is exactly this
// one entry without re-deriving it from the controller source.
export const PUBLIC_ROUTES: ProtectedRouteSpec[] = [
  { method: 'GET', path: '/health', label: 'GET /health (public)' },
]

// Substitutes a spec's `params` into its `:name` path segments, producing a
// concrete request path. Throws if a param the path requires is missing —
// a silent `:id` literal reaching the controller would be a test bug
// (BadRequestException from the id-parsing logic), not a guard-behavior
// assertion.
export function buildPath(spec: ProtectedRouteSpec): string {
  return spec.path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = spec.params?.[name]
    if (value === undefined) {
      throw new Error(
        `protected-routes.ts: route "${spec.label}" has an unfilled path param ":${name}" — add it to params`,
      )
    }
    return value
  })
}
