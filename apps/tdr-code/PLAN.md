# PLAN — Dev-only agent login for tdr-code (Option A)

**Status:** proposed
**Scope:** `apps/tdr-code` only
**Goal:** Let an automated agent (headless browser) reach the tdr-code admin
frontend and its `/api/*` endpoints in **local development** without performing
the interactive Discord OAuth + guild-membership flow — so the agent can test
and debug the UI end to end.

---

## 1. Problem

The tdr-code console is deny-by-default. Every page and every `/api/*` route
requires a valid Better Auth **session cookie**, and the only way to obtain one
today is the interactive Discord OAuth flow, which additionally enforces a
guild-membership gate. An agent driving a browser cannot complete that flow
(Discord login UI, consent, 2FA, real guild membership), so it can never see a
logged-in page.

## 2. Key insight — mint a real session, don't bypass the guard

Auth is validated in exactly **one authoritative place**:

- **Backend (authoritative):** `AuthGuard.canActivate()` calls
  `authService.api.getSession({ headers })` and 401s on `null` —
  `src/auth/auth.guard.ts:111`. It is a DB-backed lookup against the `session`
  table.
- **Frontend page gate (UX only):** `middleware.ts` checks *cookie presence*,
  not validity — `src/middleware.ts:72`.
- **Frontend → backend:** `api.ts` uses same-origin `fetch('/api/...')`, so the
  cookie rides along automatically.

If the agent's browser holds a **valid session cookie**, all three layers pass —
nothing downstream knows or cares that the session wasn't created via Discord.

Critically, the Discord OAuth + guild gate only runs at **account creation**
(`databaseHooks.account.create.before`, scoped to `providerId === 'discord'` —
`src/auth/auth.ts:270-284`). A session minted directly for a synthetic user via
the internal adapter **never creates a Discord `account` row**, so it never
touches that hook. We are not poking a hole in the guard; we are minting a
legitimate session the guard accepts.

**Therefore:** add a dev-only, flag-gated route that mints a real Better Auth
session for a synthetic user and Set-Cookies it using Better Auth's own signing.

## 3. Goals / Non-goals

**Goals**

- One command / one URL for an agent to become logged-in in local dev.
- The minted session is indistinguishable to the guard from a real one
  (same table, same signed cookie), so the agent exercises the real auth-gated
  code paths.
- **Impossible to enable in production**, by construction and by assertion.

**Non-goals**

- No change to the real Discord/guild login path.
- No production auth bypass, no "disable auth in dev" flag.
- Not for CI against the deployed prod host (this is a localhost dev tool).

## 4. Threat model & guardrails

This console is a **flat-admin, RCE-equivalent surface** (the code says so:
"every authenticated guild member is a full admin" — `public.decorator.ts:18-21`;
"an RCE-equivalent surface" — `auth.ts:164`). A dev login door must be locked
hard:

1. **Triple gate to even register the route:**
   `NODE_ENV !== 'production'` **AND** `TDR_CODE_DEV_LOGIN === '1'` **AND** a
   shared secret (`TDR_CODE_DEV_LOGIN_SECRET`) presented on the request
   (constant-time compared).
2. **Prod fail-fast:** `buildAuth()` throws at boot if `TDR_CODE_DEV_LOGIN==='1'`
   while `NODE_ENV==='production'` — the process refuses to start rather than
   silently shipping the door. (`buildAuth` runs in `AuthModule`'s
   `forRootAsync` factory at boot, so this aborts startup — `auth.module.ts:88`.)
3. **Structurally absent in prod:** when the gate is off, the plugin is simply
   **not added** to `buildAuth()`'s `plugins` array, so the endpoint does not
   exist (404), not merely "returns 403". No dead code path to misconfigure.
4. **Loopback only:** the backend already binds `127.0.0.1` (`bootstrap.ts:66`),
   so the route is never on a non-loopback interface.
5. **Origin defense:** require the same-origin posture the console uses
   (`trustedOrigins` / `requireSameOrigin`), closing the drive-by/DNS-rebind
   vector where a random page POSTs to `localhost`.
6. **Synthetic, clearly-marked user:** fixed id/email
   (`agent@dev.tdr-code.invalid`), so it can never be confused with a real
   member and is trivially greppable in the DB / logs.
7. **Audited:** every mint and every rejection logs a dedicated `LOG_EVENTS`
   slug (mirrors the app's existing structured-logging discipline).

> Note: in dev the cookie name is the **unprefixed** `better-auth.session_token`
> (http localhost), while prod uses `__Secure-…` (https) — see
> `middleware.ts:43-45`. This tool is inherently dev-shaped: the cookie it mints
> only works over http/localhost anyway.

## 5. Design

### 5.1 Chosen mechanism: a dev-only Better Auth plugin endpoint

Add a Better Auth **plugin** exposing `POST /api/auth/dev-login`, included in
`buildAuth()`'s `plugins` array **only when the dev gate is on**.

Why a Better Auth plugin (vs. a NestJS controller):

- **Correct cookie by construction.** Setting the session cookie requires a
  real Better Auth endpoint context (`ctx.setSignedCookie`, `ctx.context.secret`,
  `ctx.context.authCookies` — see `setSessionCookie` in
  `better-auth/dist/cookies/index.mjs:118`). A plugin endpoint handler receives
  exactly that `ctx`; a NestJS controller does not, and would have to
  hand-roll cookie signing (fragile, version-coupled).
- **Rides the existing mount.** It lives under the already-mounted
  `/api/auth/*` handler (`auth.module.ts`), so it inherits the Next `/api`
  rewrite, the `rewriteAuthRequestUrl` fix, and — importantly — it is **not**
  subject to the NestJS `APP_GUARD` (the auth mount routes aren't Nest route
  handlers; that's why the real OAuth login routes work unauthenticated today).
- **Naturally public.** `middleware.ts` excludes all of `/api/*`
  (`middleware.ts:104`), so the page gate never redirects it.
- **Prod-safe by omission.** Not in the array ⇒ endpoint doesn't exist.

It mirrors exactly how Better Auth's own credential sign-in mints a session and
sets the cookie (`better-auth/dist/api/routes/sign-in.mjs:244-249`):

```ts
const session = await ctx.context.internalAdapter.createSession(user.id, false)
await setSessionCookie(ctx, { session, user })
```

### 5.2 Request flow (agent → logged-in)

```
agent (headless Chrome)
  └─ POST http://localhost:8080/api/auth/dev-login   (header: x-dev-login-secret)
       └─ Next rewrite strips /api → NestJS :8082 sees /auth/dev-login
            └─ auth.module middleware re-prepends /api → Better Auth router
                 └─ dev-login plugin endpoint:
                      • constant-time secret check (else 403)
                      • find-or-create synthetic user (no Discord account row)
                      • internalAdapter.createSession(user.id, false)
                      • setSessionCookie(ctx, { session, user })   ← signed, httpOnly
                      • 200 { ok: true }   (or 302 → "/")
  └─ browser now holds better-auth.session_token
  └─ navigate to "/"  → middleware sees cookie → AuthGuard.getSession() validates → dashboard
```

## 6. Implementation

### 6.1 New file — `src/auth/dev-login.plugin.ts`

Sketch (grounded in installed `better-auth@1.6.23`):

```ts
import { timingSafeEqual } from 'node:crypto'

import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import type { BetterAuthPlugin } from 'better-auth'

import { EnvKeys } from 'src/env'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

const SYNTHETIC_USER = {
  // Deterministic id/email so repeated logins reuse ONE row (find-or-create),
  // and so it is trivially identifiable in the DB and logs. Domain matches the
  // guild-gate's own synthetic-email convention (auth.ts:198) so it can never
  // be mistaken for a real Discord-derived address.
  email: 'agent@dev.tdr-code.invalid',
  name: 'Dev Agent',
} as const

function secretMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Returns true only when ALL THREE gates hold. Throws (fail-fast) if the flag
// is set in production — buildAuth() calls this at boot, so a misconfigured
// prod host refuses to start instead of shipping the door.
export function isDevLoginEnabled(): boolean {
  const flag = process.env[EnvKeys.TDR_CODE_DEV_LOGIN] === '1'
  const isProd = process.env[EnvKeys.NODE_ENV] === 'production'
  if (flag && isProd) {
    throw new Error(
      'TDR_CODE_DEV_LOGIN must never be set in production (NODE_ENV=production).',
    )
  }
  const hasSecret = !!process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET]
  return flag && !isProd && hasSecret
}

export function devLoginPlugin(): BetterAuthPlugin {
  const expectedSecret = process.env[EnvKeys.TDR_CODE_DEV_LOGIN_SECRET] ?? ''
  return {
    id: 'tdr-code-dev-login',
    endpoints: {
      devLogin: createAuthEndpoint(
        '/dev-login',
        { method: 'POST' },
        async (ctx) => {
          const presented = ctx.headers?.get('x-dev-login-secret') ?? undefined
          if (!secretMatches(presented, expectedSecret)) {
            getBackendLogger().warn(
              { event: LOG_EVENTS.devLoginRejected },
              'dev-login rejected: bad or missing secret',
            )
            return ctx.json({ error: 'forbidden' }, { status: 403 })
          }

          const ia = ctx.context.internalAdapter
          const existing = await ia.findUserByEmail(SYNTHETIC_USER.email)
          const user =
            existing?.user ??
            (await ia.createUser({
              email: SYNTHETIC_USER.email,
              name: SYNTHETIC_USER.name,
              emailVerified: false,
            }))

          const session = await ia.createSession(user.id, false)
          await setSessionCookie(ctx, { session, user })

          getBackendLogger().warn(
            { event: LOG_EVENTS.devLoginMinted, userId: user.id },
            'dev-login minted a session for the synthetic agent user',
          )
          return ctx.json({ ok: true })
        },
      ),
    },
  }
}
```

Notes / to verify during implementation:

- Confirm exact `createUser` / `findUserByEmail` return shapes against installed
  types (`ctx.context.internalAdapter`), and `createSession(userId,
  dontRememberMe)` (installed signature: `(userId, dontRememberMe, override,
  overrideAll)` — `internal-adapter.mjs:162`; the sign-in route calls it with
  just `(id, false)`).
- `setSessionCookie(ctx, { session, user })` — arg shape mirrors
  `sign-in.mjs:249`.
- Optional browser convenience: also accept `GET` and `return ctx.redirect('/')`
  so the agent can log in with a plain top-level navigation. Trade-off: a secret
  in a query string gets logged; keep POST+header as canonical and treat GET as
  opt-in. (Consider `originCheck` from `better-auth/api` for extra hardening.)

### 6.2 `src/auth/auth.ts` — conditionally include the plugin + assert

```ts
import { devLoginPlugin, isDevLoginEnabled } from './dev-login.plugin'
// ...
plugins: isDevLoginEnabled() ? [devLoginPlugin()] : [],
```

`isDevLoginEnabled()` runs here at boot (inside `buildAuth`), giving us the
prod fail-fast (guardrail #2) at the single auth-construction site. Replace the
current `plugins: []` (`auth.ts:209`) and extend its comment to explain the
dev-only inclusion.

### 6.3 `src/env.ts` — add keys

Add to `EnvKeys` (with header comments matching the file's style):

```ts
// Dev-only agent login (see PLAN.md / dev-login.plugin.ts). Both must be set,
// and only ever in local dev — buildAuth() throws if TDR_CODE_DEV_LOGIN is set
// while NODE_ENV=production.
TDR_CODE_DEV_LOGIN: 'TDR_CODE_DEV_LOGIN',
TDR_CODE_DEV_LOGIN_SECRET: 'TDR_CODE_DEV_LOGIN_SECRET',
```

### 6.4 `src/logging/log-events.ts` — add a domain group

```ts
const DEV_LOGIN_EVENTS = {
  // dev-login.plugin.ts — the dev-only synthetic-session mint and its
  // rejection path. Logged at warn (not info) so a stray occurrence stands out
  // even though it is expected in local dev.
  devLoginMinted: 'dev-login-minted',
  devLoginRejected: 'dev-login-rejected',
} as const
```

…and spread `...DEV_LOGIN_EVENTS` into `LOG_EVENTS` (`log-events.ts:516`).

### 6.5 `.env.example` — document it

Append a dev-login section:

```dotenv
# Dev-only agent login (local development ONLY — never set in production).
# When TDR_CODE_DEV_LOGIN=1 (and NODE_ENV!=production) and a secret is set, the
# app mounts POST /api/auth/dev-login, which mints a session for a synthetic
# user so an automated agent can reach the console without Discord OAuth.
# buildAuth() refuses to boot if TDR_CODE_DEV_LOGIN=1 while NODE_ENV=production.
#TDR_CODE_DEV_LOGIN=1
#TDR_CODE_DEV_LOGIN_SECRET=   # e.g. openssl rand -hex 32
```

### 6.6 Files touched

| File | Change |
|------|--------|
| `src/auth/dev-login.plugin.ts` | **new** — plugin + `isDevLoginEnabled()` |
| `src/auth/auth.ts` | conditional `plugins` inclusion + comment |
| `src/env.ts` | 2 new `EnvKeys` |
| `src/logging/log-events.ts` | `DEV_LOGIN_EVENTS` group |
| `.env.example` | document the two vars + usage |
| `src/auth/dev-login.plugin.spec.ts` | **new** — tests (see §7) |

Estimated effort: ~half a day including tests. No schema change, no migration,
no new dependency (uses `better-auth` APIs already installed).

## 7. Testing

Follow the existing spec conventions (`src/auth/*.spec.ts`, which set env vars
explicitly and exercise the auth instance / handler black-box).

1. **Prod fail-fast:** `isDevLoginEnabled()` throws when
   `TDR_CODE_DEV_LOGIN=1` + `NODE_ENV=production`.
2. **Structurally absent:** with the flag off, `buildAuth(db)` builds an auth
   instance whose handler 404s on `/api/auth/dev-login`.
3. **Secret required:** flag on, wrong/missing `x-dev-login-secret` ⇒ 403, no
   session row created, `devLoginRejected` logged.
4. **Happy path:** flag on + correct secret ⇒ 200, a `session` row exists for
   the synthetic user, and the response Set-Cookie is the
   `better-auth.session_token` cookie; `devLoginMinted` logged.
5. **Guard acceptance (integration):** feed the minted cookie into
   `AuthGuard` / `auth.api.getSession()` and assert it authenticates (proves the
   minted session is indistinguishable from a real one).
6. **No Discord account row:** the synthetic user has no `account` row and the
   guild-gate hook was never invoked (idempotent find-or-create on repeat login).

Also run the repo gates before finishing: `pnpm --filter @lilnas/tdr-code lint`,
`type-check`, `test`.

## 8. Agent usage runbook (local dev)

**Prerequisites (minimal dev `.env` in `apps/tdr-code/`):**

```dotenv
PORT=8080
BACKEND_PORT=8082
BETTER_AUTH_URL=http://localhost:8080
ALLOWED_CONSOLE_ORIGIN=http://localhost:8080
BETTER_AUTH_SECRET=<openssl rand -base64 32>
DATABASE_PATH=./data.db            # local, not /storage
CLAUDE_CWD=<some dir>              # required
TDR_CODE_RUN_DIR=/tmp/tdr-code     # macOS: /run not writable
TDR_CODE_MASTER_KEY_FILE=/tmp/tdr-code/master.key   # provision per .env.example
TDR_CODE_DEV_LOGIN=1
TDR_CODE_DEV_LOGIN_SECRET=<openssl rand -hex 32>
# Discord vars can be dummy values in dev when only dev-login is used.
```

Provision the dev master key (else the backend won't boot —
`bootstrap.ts:29`):

```bash
mkdir -p /tmp/tdr-code && chmod 700 /tmp/tdr-code
dd if=/dev/urandom bs=32 count=1 of=/tmp/tdr-code/master.key && chmod 600 /tmp/tdr-code/master.key
```

**Run:** `pnpm --filter @lilnas/tdr-code dev` (starts NestJS :8082 + Next :8080).

**Agent flow (headless Chrome MCP):**

1. `POST http://localhost:8080/api/auth/dev-login` with header
   `x-dev-login-secret: <secret>` — e.g. from a page context via
   `evaluate_script`: `await fetch('/api/auth/dev-login', { method: 'POST',
   headers: { 'x-dev-login-secret': '<secret>' } })`. The response sets the
   session cookie in the browser jar.
2. `navigate_page` to `http://localhost:8080/` → the agent lands on the
   authenticated dashboard.
3. Mutating console routes (`POST/PUT/DELETE`) check `Origin` against
   `ALLOWED_CONSOLE_ORIGIN`; a real browser at `http://localhost:8080` sends the
   correct `Origin` automatically, so no extra work is needed.

(If GET convenience is implemented, step 1 collapses to a single
`navigate_page` to `/api/auth/dev-login?...` that 302s to `/`.)

## 9. Alternatives considered

- **NestJS controller `POST /auth-dev/login`** — rejected: no access to the
  Better Auth endpoint `ctx`, so it would have to hand-roll cookie signing
  (fragile, version-coupled). The plugin gets the correct `ctx` for free.
- **Enable `emailAndPassword` in dev + seed a user** — works and uses only
  public routes, but adds sign-in/sign-up surface and a seeded password;
  more moving parts than one purpose-built, self-contained endpoint.
- **Header bypass in `AuthGuard`** — rejected for this use case: only helps
  curl/API tests, **not** browser page loads (the Next page gate keys off cookie
  presence, and top-level navigations can't carry a custom header).
- **"Disable auth in dev" flag** — rejected: the agent then wouldn't exercise
  the real session path the frontend depends on, and it's higher blast-radius if
  it ever leaked to prod.
- **CLI seed script + CDP cookie injection** — viable zero-server-surface
  fallback (nothing ships in the running server): a script mints the session
  in-process and prints the cookie; the agent injects it via
  `Network.setCookie`. Keep as Plan B if we'd rather add *no* runtime route.

## 10. Open decisions

1. Support `GET` (redirect-to-`/`) for one-step browser navigation, or POST-only?
   (Leaning: POST canonical; add GET behind the same gate for agent ergonomics.)
2. Add `originCheck` on the endpoint in addition to the secret? (Cheap
   defense-in-depth; leaning yes.)
3. File location of this doc — keeping it at `apps/tdr-code/PLAN.md` (app-scoped).
