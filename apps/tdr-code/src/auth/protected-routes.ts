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
  { method: 'POST', path: '/git-identity', label: 'POST /git-identity' },
  // U5 (R2): self-clear, no id — resolves the acting user's own Discord
  // snowflake from the session, mirroring DELETE /git/github's self-unlink
  // shape below. GET /git-identity/discord-members (the "pick a user"
  // dropdown's backing route) is removed in the same unit, not merely
  // hidden client-side — no PROTECTED_ROUTES entry replaces it.
  { method: 'DELETE', path: '/git-identity', label: 'DELETE /git-identity' },
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
  // Logs viewer (U2) — the windowed byte-offset read endpoint. No `:param`
  // path segment (stream/anchor/direction/maxBytes are all query params),
  // so no `params` entry is needed here, matching GET /events' own
  // no-path-param shape above.
  {
    method: 'GET',
    path: '/logs/window',
    label: 'GET /logs/window',
  },
  // Logs viewer (U3) — the tab-bootstrap sources endpoint. No query params
  // and no `:param` path segment at all (see logs.controller.ts's own
  // sources() handler), so no `params` entry is needed here either.
  {
    method: 'GET',
    path: '/logs/sources',
    label: 'GET /logs/sources',
  },
  // Logs viewer, Phase 2 U8 — the append-delta live tail SSE endpoint
  // (log-tail.controller.ts). Query params only (stream/from), no `:param`
  // path segment, same shape as the two /logs/* entries above. NOTE on how
  // this route fits BOTH auth.guard.spec.ts sweeps despite being a
  // long-lived @Sse() connection: the "no session cookie -> 401" sweep
  // needs no special handling at all — AuthGuard runs as an APP_GUARD and
  // throws UnauthorizedException BEFORE the route handler (and therefore
  // before @Sse()'s Observable) ever engages, so an unauthenticated request
  // to this route gets a completely normal, quickly-ending 401 JSON body
  // just like every other route. Only the "valid session cookie ->
  // reachable" sweep actually lets the request through to the streaming
  // handler, where the body never naturally ends — that sweep uses a
  // headers-only request helper (requestHeadersOnly in auth.guard.spec.ts)
  // instead of the shared body-awaiting one, specifically to keep this
  // route's reachability check from hanging the suite. See
  // requestHeadersOnly's own header comment in that file for the full
  // rationale.
  {
    method: 'GET',
    path: '/logs/tail',
    label: 'GET /logs/tail',
  },
  // Logs viewer, Phase 2 U9 — the whole-file streaming scan (search)
  // endpoint (logs.controller.ts's search() handler). Query params only
  // (stream/text/level/process/event/cursor), no `:param` path segment,
  // same shape as every other /logs/* entry above. Unlike GET /logs/tail
  // just above, this is a NORMAL request/response route (not @Sse()) — its
  // body always ends naturally even on a valid/reachable connection, so it
  // needs none of that route's requestHeadersOnly workaround in either
  // auth.guard.spec.ts or auth-e2e.spec.ts; the shared body-awaiting
  // request() helper in both suites handles it exactly like every other
  // ordinary route.
  {
    method: 'GET',
    path: '/logs/search',
    label: 'GET /logs/search',
  },
  // GitHub linking routes (GithubLinkController) and roster (GitRosterController)
  // — neither carries @Public(), so both are protected by the global AuthGuard.
  { method: 'GET', path: '/git/github/status', label: 'GET /git/github/status' },
  { method: 'DELETE', path: '/git/github', label: 'DELETE /git/github' },
  {
    method: 'DELETE',
    path: '/git/github/:userId',
    label: 'DELETE /git/github/:userId',
    params: { userId: 'better-auth-user-id-test' },
  },
  { method: 'GET', path: '/git/roster', label: 'GET /git/roster' },
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
