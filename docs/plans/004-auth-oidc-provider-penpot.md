---
nexus-plan: 2
title: lilnas-auth as an OIDC provider; Penpot signs in through it
branch: feat/auth-oidc-provider
base: main
setup:
  - pnpm install --frozen-lockfile
  - pnpm --filter @lilnas/utils build
checks:
  - pnpm --filter @lilnas/auth lint
  - pnpm --filter @lilnas/auth type-check
  - pnpm --filter @lilnas/auth exec drizzle-kit check
  - pnpm --filter @lilnas/auth exec jest --maxWorkers=2 --testPathIgnorePatterns compose-mount-coverage
parallel: 3
review: per-phase
commit-style: "conventional with scope, e.g. feat(auth): …, feat(infra): …, docs(auth): …"
---

# lilnas-auth as an OIDC provider; Penpot signs in through it

## Goal
Turn `apps/auth` (lilnas-auth, Better Auth on NestJS + Next, SQLite via Drizzle)
into an OpenID Connect provider at issuer `https://auth.lilnas.io`, with Penpot
(`infra/penpot.yml`, `penpot.lilnas.io`) as its first trusted client. A Penpot
user clicks "Sign in with lilnas", lilnas-auth issues an authorization code only
if that user holds an allowed grant for `penpot.lilnas.io` (same rules as
`/verify`: blocked → denied, admin → allowed, literal or pattern grant →
allowed, pending pre-authorization binds, else → pending), and Penpot creates or
links the profile by email. Password login in Penpot is turned off. The
client→host mapping is generic so Grafana, Immich, etc. can be added later by
one entry plus one secret. Ends with a gated production deploy and a real
end-to-end check (one allowed user, one denied user).

## Decisions
- **OIDC, not LDAP.** lilnas-auth users are Google-only with no passwords, so
  LDAP would need a second directory (lldap) and second passwords.
- **No trusted-header login.** Penpot has none (verified in its `flags.cljc`
  and `oidc.clj`); one "Sign in with lilnas" click per Penpot session is
  accepted. Penpot cannot auto-redirect to the IdP.
- **`@better-auth/oauth-provider@1.6.23` + `jwt` plugin**, not the bundled
  `oidc-provider` (deprecated, removed in v2). Version 1.6.23 of the new package
  exists and peer-depends on `better-auth ^1.6.23` — no better-auth upgrade.
  (`@better-auth/oauth-provider@latest` needs better-auth 1.7.7; not taken.)
- **Clients live in the DB, seeded at boot.** The new plugin has no config-time
  `trustedClients`; the only client store is the `oauthClient` model. A static
  registry in code (`src/oidc/clients.ts`: id, display name, lilnas host,
  redirect URIs, env key of the secret) is upserted into `oauth_client` on boot
  with `skip_consent: true`, `require_pkce: false` (Penpot sends no PKCE),
  `token_endpoint_auth_method: client_secret_post` (Penpot posts the secret in
  the form body), `metadata: { lilnasHost }`. Dynamic registration and the
  client CRUD endpoints are disabled (`clientPrivileges: () => false`).
- **Issuer is `https://auth.lilnas.io`** (= `AUTH_HOST`), set via
  `jwt.issuer`. Discovery must therefore exist at the ROOT
  `/.well-known/openid-configuration`; Better Auth only serves it under
  `/api/auth/...`, so two Next rewrites proxy `/.well-known/openid-configuration`
  and `/.well-known/oauth-authorization-server` to the backend. Endpoints in the
  metadata are absolute (`https://auth.lilnas.io/api/auth/oauth2/...`), so
  nothing else moves. Penpot gets `PENPOT_OIDC_BASE_URI=https://auth.lilnas.io/`.
- **Penpot reaches lilnas-auth over the public URL** (hairpin). Verified from
  inside `penpot-backend`: `auth.lilnas.io` resolves to the public IP and
  `https://auth.lilnas.io/api/auth/ok` returns 200. No `PENPOT_SSRF_ALLOWED_HOSTS`,
  no internal URI overrides.
- **Signing keys RS256** (not the jwt plugin's EdDSA default) so Penpot's
  `buddy-sign` verifies the id_token from JWKS; Penpot falls back to userinfo
  if it can't, but RS256 is also what Grafana/Immich expect.
- **The grant gate runs in a Better Auth `hooks.before` on
  `/oauth2/authorize`** and reuses `/verify`'s decision (extracted from
  `VerifyService.decide()`), resolved lazily through Nest's `ModuleRef` to avoid
  the AuthModule↔AccessCacheService construction cycle. Denied users are sent
  to lilnas-auth's own `/pending` or `/blocked` page (same pages ForwardAuth
  uses), not an OAuth `access_denied` back to Penpot. Backstop: the same gate
  runs again in `customIdTokenClaims`/`customUserInfoClaims` and throws, so the
  post-Google-login resume path (which bypasses the authorize endpoint's hooks)
  also fails closed. An unresolvable gate denies.
- **ForwardAuth stays on the Penpot router.** The browser carries the
  `.lilnas.io` session cookie to Penpot's `/api/auth/oidc/callback`, so
  `/verify` allows it; the token exchange is backend→`auth.lilnas.io`, whose
  router has no ForwardAuth. Nothing to remove.
- **Penpot flags:** `enable-login-with-oidc enable-oidc-registration
  disable-login-with-password` added; `disable-registration
  disable-email-verification enable-prepl-server enable-admin-console` kept.
  `enable-oidc-registration` means a first-time user completes Penpot's
  one-field "create account" form once. The existing password profile
  (`jeremyasuncion808@gmail.com`) links by email because lilnas emits
  `email_verified: true` (Penpot's `oidc.clj` accepts a profile from another
  auth backend when the provider asserts a verified email).
- **Denied-user test account:** `fallenskateboarder808@gmail.com` (exists in
  lilnas-auth, no grants, not blocked).
- **Theater mount fix is included** (two mount lines) so
  `compose-mount-coverage.spec.ts` passes again; the test check excludes that
  spec because it fails at `base`.
- **The uncommitted Penpot files on `main`** (`infra/penpot.yml`,
  `infra/.env.penpot.example`, auth deploy mounts, `service-meta.ts`) are the
  user's to commit before Start; the run branches from committed `main`.

## Context
- Repo: pnpm + Turbo monorepo. This plan touches `apps/auth` (`@lilnas/auth`)
  and `infra/penpot.yml`. Package scripts: `pnpm --filter @lilnas/auth lint |
  type-check | test | db:generate`. Jest: `pnpm --filter @lilnas/auth exec jest
  --maxWorkers=2 <paths>`; read the `Tests:` summary line. Always `--maxWorkers=2`
  (this machine is the production server). Whole-suite baseline: 35 suites /
  562 tests green except `src/services/__tests__/compose-mount-coverage.spec.ts`.
- lilnas-auth layout (`apps/auth/src`): `auth/auth.ts` builds the Better Auth
  instance (`buildAuth(db)`, `AUTH_PATH_SEGMENT = '/api/auth'`, Google only,
  deliberately no plugins — that comment must be rewritten by the task that
  adds them); `auth/auth.module.ts` mounts it via `@thallesp/nestjs-better-auth`
  `forRootAsync({ inject: [DB], useFactory })`; `db/schema.ts` + `db/migrations`
  (drizzle-kit, SQLite; migrations run on boot via `db/database.module.ts`
  `runMigrations`); `verify/verify.service.ts` is the ForwardAuth decision
  (session → blocked → admin bypass → grant → pre-auth bind → pending) over
  `verify/access-cache.service.ts`; `grants/host-matcher.ts` handles `*.suffix`
  pattern grants; `env.ts` `EnvKeys` lists every env var (document new ones in
  `.env.example` too). Backend is Nest on :8081, UI is Next on :8080;
  `next.config.js` rewrites `/api/auth/:path*` to the backend unchanged.
- Test patterns to imitate: `src/auth/__tests__/auth-mount.spec.ts` (boots the
  real Nest mount on a random port, drives a fake Google callback);
  `src/verify/__tests__/verify.service.spec.ts` + `helpers/session-fixtures.ts`
  (`signInAndGetSessionCookiePair(auth, authHost, {sub,email})` returns a real
  session cookie). In-memory DB: `createTestDb()` as in those files. Spec files
  set `process.env.*` at module scope for required keys.
- Installed plugin sources to read before coding (don't guess APIs):
  `apps/auth/node_modules/@better-auth/oauth-provider/dist/index.mjs` (schema
  near the `src/schema.ts` region; `runOAuth2Authorize`; the `before`/`after`
  hooks that consume `oauth_query`) and `.../dist/oauth-*.d.mts` (options);
  `apps/auth/node_modules/better-auth/dist/plugins/jwt/`. Client secrets are
  stored as `base64url(sha256(secret))` without padding
  (`@better-auth/utils/hash` `createHash('SHA-256')` + `@better-auth/utils/base64`).
  SQLite adapter stores `string[]`/`json` fields as JSON text.
- Comment style: dense "why" comments citing installed-package paths, as the
  existing files do. Prettier + ESLint must pass (`pnpm --filter @lilnas/auth
  lint`). Avoid `any`.
- Production: this machine IS lilnas.io. Deploy only from a tree that has the
  gitignored env files; see the deploy tasks for the exact recipe (run compose
  with `-p lilnas` so it manages the existing `lilnas-*` containers). Never run
  `apps/*/deploy.yml` or `infra/*.yml` standalone. `/verify` gates every
  service: if `lilnas-auth` is unhealthy, everything is down.
- Penpot 2.18.3 facts (from `backend/src/app/auth/oidc.clj`): discovery is
  fetched at `<PENPOT_OIDC_BASE_URI>/.well-known/openid-configuration` at
  backend start (so lilnas-auth must be up first); token request is
  `application/x-www-form-urlencoded` with `client_id`/`client_secret` in the
  body, no PKCE; redirect URI is `https://penpot.lilnas.io/api/auth/oidc/callback`;
  user info comes from id_token claims first, userinfo as fallback; needs
  `email` + `name` and uses `email_verified`.

## Done means
Implemented with tests in the package's style; every check green; new tests
cover each state named in the task body; comments explain why, citing installed
sources where behaviour was verified; `.env.example` and `README.md` document
every new env var and endpoint the diff introduces; no change to existing
`data-testid`s or `/verify` behaviour (its spec file stays green unchanged apart
from pure refactors); `compose-mount-coverage.spec.ts` passes after T5 (run it
directly: `pnpm --filter @lilnas/auth exec jest --maxWorkers=2
src/services/__tests__/compose-mount-coverage.spec.ts`); nothing commits a
secret; deploy tasks report exact commands run and outputs in their result.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report. -->

### 2026-10-12 · T5 · done
compose-mount-coverage.spec.ts passes (28/28). `docker-compose config -q` exits 1 in this worktree only because the gitignored infra/.env.nexus-code is absent here (it exists only in the main checkout). It is unrelated to the diff, and I didn't run compose in the main checkout.
The four plan checks (lint, type-check, drizzle-kit check, jest ignoring compose-mount-coverage) were not run; the diff is two compose YAML lines only.

### 2026-10-12 · T6 · done
Edits as specified: seven-flag PENPOT_FLAGS (written as a `>-` folded scalar with an explanatory comment), the four PENPOT_OIDC_* vars on penpot-backend, PENPOT_OIDC_NAME on penpot-frontend, PENPOT_OIDC_CLIENT_SECRET= in .env.penpot.example, rewritten header Auth comment. No AUTH/TOKEN/USER/JWKS URIs and no SSRF allow-list.
Validation: root `docker-compose config -q` can't run in this worktree because the gitignored env files (infra/.env.nexus-code, infra/.env.penpot) are absent. I validated infra/penpot.yml standalone with a temp .env.penpot copied from the example, then deleted it. Config renders the full flags string and all OIDC vars, so the commit is not blocked.
Phase 2 must: add PENPOT_OIDC_CLIENT_SECRET to the real infra/.env.penpot (same value as OIDC_PENPOT_CLIENT_SECRET in apps/auth/.env.prod), and bring lilnas-auth up before recreating penpot-backend (discovery is fetched at backend start).
infra/penpot.yml was already not prettier-clean before this change (quote style, long merge key); left as-is to avoid unrelated churn.

### 2026-10-12 · T1 · done
Deviations from the task body:
- Discovery is served ONLY at the root. The oauth-provider plugin's onRequest hook matches the full request pathname against `${issuerPath}/.well-known/openid-configuration`; issuer = AUTH_HOST gives issuerPath '', so the match is `/.well-known/openid-configuration`. `/api/auth/.well-known/openid-configuration` is a 404 (the plugin's .well-known endpoints are SERVER_ONLY). So next.config.js rewrites `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server` to the SAME path on :8081, and a new Nest controller (src/auth/oidc-well-known.controller.ts, registered in AuthModule) forwards them to auth.handler, because @thallesp's mount only forwards /api/auth/*.
- The plugin forces a non-loopback issuer to https:// (oauth-provider dist/index.mjs ~L3805), so issuer === AUTH_HOST only holds when AUTH_HOST is https or loopback. oidc-discovery.spec.ts uses https://login.localhost.test. Document for dev: use http://localhost... or https. Prod (https://auth.lilnas.io) is fine.
- apps/auth/tsconfig.json: composite/declaration/declarationMap set false (config is already noEmit). With the plugins, tsc declaration emit failed with TS2742/TS7056 on the inferred buildAuth type. Type-check and AuthService<Auth> consumers pass.
- All option names (loginPage, consentPage, scopes, grantTypes, allowDynamicClientRegistration, allowUnauthenticatedClientRegistration, clientPrivileges, silenceWarnings.{openidConfig,oauthAuthServerConfig}, jwt disableSettingJwtHeader/issuer/keyPairConfig) exist in 1.6.23; none dropped.
- Schema: references with no declared onDelete use cascade (Better Auth generator default); sessionId is set null as declared. oauth_client.client_id is unique (FK parent for the other tables). Seeding (T2) must insert oauth_client rows with text id, client_id, client_secret = base64url(sha256(secret)) no padding, redirect_uris/scopes etc. as JSON text, skip_consent=1.
- Traefik: the auth host router must send /.well-known/* to the Next process (:8080) so the rewrites apply; not checked in this task (T5/deploy should verify with curl https://<auth host>/.well-known/openid-configuration).
- Checks: lint, type-check, drizzle-kit check green; jest (ignoring compose-mount-coverage) 36 suites / 567 tests pass. auth-mount.spec.ts unchanged.

### 2026-10-12 · T2 · done
- Added `jose@6.2.0` and `@better-auth/utils@0.4.2` as direct deps of @lilnas/auth (neither resolved from the package before); installed offline from the existing store, lockfile updated.
- cachedTrustedClients exists in 1.6.23 and is passed in auth.ts. Cached trusted clients are immutable via the plugin's client CRUD endpoints, so OidcClientsService is the only writer.
- Secret hash matches the plugin's defaultHasher (oauth-provider dist/utils-B3Myyglw.mjs ~L163): base64url(sha256) without padding.
- An unregistered redirect_uri on /oauth2/authorize returns a 302 to `<AUTH_HOST>/login?error=invalid_redirect&...` with no code (asserted in the spec). A wrong client_secret returns 401.
- The spec uses an https AUTH_HOST (https://login.localhost.test), as oidc-discovery.spec.ts does, so the id_token `iss` equals AUTH_HOST.
- Prod needs OIDC_PENPOT_CLIENT_SECRET (openssl rand -hex 32) in apps/auth/.env.prod, with the SAME value as PENPOT_OIDC_CLIENT_SECRET in infra/.env.penpot. lilnas-auth refuses to boot without it, and /verify gates every service, so set it before deploying this commit.
- compose-mount-coverage.spec.ts was not run by me (excluded per the checks).

### 2026-10-12 · T4 · done
- T3 had not landed on this branch (no `resolveVerifyService` in `buildAuth`), so `oidc-post-login.spec.ts` uses plain `buildAuth(db)`. Once T3 lands, the spec needs `{ resolveVerifyService }` stubbed to allow, or the after-hook may deny the resume.
- The spec drives `auth.handler` directly, as `session-fixtures.ts` and `oidc-clients.spec.ts` do, rather than booting the Nest mount.
- The fake Google callback must send `sec-fetch-mode: navigate`. The plugin's after-hook only puts the resumed authorize in the 302 `Location` for browser navigations. Otherwise it returns `{redirect,url}` JSON and leaves `Location` at `/`. A real browser callback is a navigation, so production is unaffected.
- A tampered `sig` is rejected by the provider's before-hook with 400 `invalid_signature`.
- For an unknown `client_id`, no OIDC pill is shown. The page falls back to the existing `?redirect=` pill logic, so with no redirect there is no pill.
- `page.tsx` `searchParams` is now typed as `Record<string, string | string[] | undefined>`.
- No new env vars or endpoints, so `.env.example` and the README are unchanged.
- `compose-mount-coverage.spec.ts` was not run, as the checks exclude it.

### 2026-10-12 · T3 · done
- buildAuth(db, { resolveVerifyService }) is now two-arg everywhere. Existing specs pass a stub returning undefined, except oidc-clients.spec.ts's authorization-code block. That block runs a real authorize, so the stub would 403; it passes a fake VerifyService whose authorizeHost always allows (the gate is covered in oidc-gate.spec.ts).
- Extra export beyond the task: decideOidcAccessForHost, a host-keyed variant used by the id-token claims callback, which gets client metadata (lilnasHost) and not the client id.
- Both layers log denials through a static Nest Logger('OidcGate'), because the claims callbacks have no request ctx. The 403 body is a generic access_denied; the reason appears only in the log.
- Verified in the test run that the backstop is what rejects a revoked grant: the log shows "token/userinfo denied: pending", and the exchange and userinfo return non-2xx.
- Whole-suite jest, ignoring compose-mount-coverage: 38 suites / 587 tests green. compose-mount-coverage.spec.ts was not run by me.
- No new env vars or endpoints. README gained a paragraph on the gate; .env.example is unchanged.

### 2026-10-12 · T7 · done
- The README already held a short OIDC section (after the topology section), the OIDC_PENPOT_CLIENT_SECRET env row and the topology backend rows from earlier tasks. I moved and expanded the section and left the env row and topology rows unchanged.
- Docs-only change. Ran `prettier -c README.md` (clean). Did not run lint, type-check or jest.

### 2026-10-13 · Phase 1 · review cycle 1
Pass 1 (T5, T6): T5 and T6 are correct and match their task bodies; no defects found. The root docker-compose config check could not run in the task worktrees because gitignored env files are missing, so the real-environment check is deferred to phase 2.
Pass 2 (T1): T1's OIDC plugins, schema, migration, discovery controller and tests match the task body and the checks are green; no defects found. Production routing of /.well-known/* to the Next process is unverified and left to the deploy task.
Pass 3 (T2, T4): T2 and T4 look correct and consistent with each other and with T3's merged gate: the specs now stub resolveVerifyService, the hash matches the plugin's, seeding is an idempotent upsert, and the env var is documented. I read every hunk in this slice and found no defects.
Pass 4 (T3, T7): Pass 4 (T3 gate, T7 README) reads clean: `authorizeHost` is a faithful extract of `decide()`, both gate layers are wired as specified, and the tests cover every state in the task body. I read every hunk and ran nothing myself. `compose-mount-coverage` was not run for T3, but it belongs to T5. One P2 note on the first-login UX.
Seams pass: Seams pass over the export-level diff found no cross-task disagreements. The exports agree: `AuthDeps`/`buildAuth`, `HostAccessDecision` and the gate helpers, `OIDC_CLIENTS` and the seeded `metadata.lilnasHost`, and the `oauth_client` schema fields against the seeding service. I did not check `auth.module.ts`, `app.module.ts`, `env.ts` or the migration, since they are outside the export-level diff.

Notes:
- F1 · P2 · First-time Penpot login by an ungranted user ends in a token-exchange 403, not /pending — apps/auth/src/auth/auth.ts:404

### 2026-10-12 · T8 · done
Secrets: OIDC_PENPOT_CLIENT_SECRET (apps/auth/.env.prod) and PENPOT_OIDC_CLIENT_SECRET (infra/.env.penpot) appended with one matching value (neither existed); grep -c = 1 each. No values printed.
Env symlinks: 31 files linked into the worktree; git status clean. Extra: empty apps/theater/.env.prod created in the worktree ONLY (gitignored), because prod checkout also lacks it and `docker-compose -p lilnas config` fails without it (pre-existing, not caused by this task). Deploy tasks from another tree need the same empty file.
Config: `docker-compose -p lilnas config -q` exit 0 (after the theater stub).
DB backup kept: /storage/app-data/lilnas-auth/lilnas-auth.db.bak-20261012-211150. Dry run on /tmp copy applied migrations OK; tables now include jwks oauth_client oauth_access_token oauth_refresh_token oauth_consent; user count 3 before and after; /tmp copy deleted.
Build: `docker-compose -p lilnas build auth` exit 0; new image sha256:434c1f9eb7e9... tagged lilnas-auth:latest. Not started.
Rollback: running container lilnas-auth-1 uses sha256:1cc4b536486447659d5b09efefb44dc8fe12ff75f2b95dcb0a14b6f467ffb51c, now also tagged lilnas-auth:rollback-pre-oidc (do not prune). Container still healthy; https://auth.lilnas.io/api/auth/ok = 200.

No commits: nothing to integrate.

### 2026-10-13 · H1 · approved
Approved.

### 2026-10-12 · T9 · done
Deployed lilnas-auth (healthy ~10s; swole.lilnas.io -> 302 auth.lilnas.io/login) and Penpot (backend logged "provider initialized" for oidc, no warnings). All provider and Penpot-side smoke checks passed; the exact commands and outputs are in the message above.
New lilnas-auth image id: sha256:e544a66bc33502ebf3264e2107089c274c91e2c2df058aa7bba647626ce4c919 (previous: sha256:1cc4b536486447659d5b09efefb44dc8fe12ff75f2b95dcb0a14b6f467ffb51c).
Backup DB left in place: /storage/app-data/lilnas-auth/lilnas-auth.db.bak-20261012-211150.
The task text had two errors. The penpot-frontend image has no wget, so config.js was fetched via the curlimages/curl container. The Penpot 2.18 OIDC start route is POST /api/auth/oidc, not /api/auth/oauth/oidc (that returns 404).
Password login is disabled: it returns 400 login-disabled with no session cookie.
The env symlinks from T8 were missing and were recreated (gitignored, not committed). apps/theater/.env.prod is absent in the main checkout too, which only makes `docker-compose config` complain; the up commands worked.
The Penpot backend logs a masked prefix of the OIDC client secret at startup. This is Penpot's own behaviour and is not repeated here.

No commits: nothing to integrate.

### 2026-10-13 · H2 · approved
Approved.

### 2026-10-12 · Final report
Outcome: lilnas-auth is an OIDC provider, deployed to production, and Penpot signs in through it with password login off. H1 and H2 were approved; all nine tasks are integrated.

Task outcomes:
- `T1` · OIDC plugins, schema, migration, discovery at the root · done · `ad25ee95`
- `T2` · client registry, boot-time Penpot client seeding, token-exchange test · done · `9cef4df9`
- `T3` · grant gate on /oauth2/authorize, reusing the /verify decision · done · `7cf676c2`
- `T4` · login page resumes an OIDC authorize after Google sign-in · done · `befa7581`
- `T5` · mount apps/theater/deploy.yml into lilnas-auth · done · `82a22978`
- `T6` · Penpot OIDC login, password login off · done · `c3739f84`
- `T7` · README documents the OIDC provider · done · `da8604f4`
- `T8` · pre-deploy: secrets, DB backup, migration dry run, image build · done · no code commit (its Log entry is `42581ad3`)
- `T9` · deploy lilnas-auth, then Penpot, and smoke-test · done · no code commit (the recorded `f910904d` is its plan Log commit)
- `H1` · approve production deploy · approved
- `H2` · end-to-end sign-in as an allowed and a denied user · approved

Deviations:
- `T1`: discovery is served only at the root (`/.well-known/*`), not under `/api/auth`. next.config.js rewrites it, and a Nest controller forwards it to the auth handler. Traefik routing of `/.well-known/*` was not verified until the deploy.
- `T3`: the first integration failed type-check and jest on `oidc-post-login.spec.ts`, since `buildAuth` gained a second argument. It was fixed in a resolve pass, which is why `7cf676c2` squashes two commits.
- `T8`: `apps/theater/.env.prod` was created as an empty gitignored stub in the worktree, because `docker-compose config` fails without it. The main checkout also lacks it. Deploy tasks from other trees need the same stub.
- `T9`: the T8 env symlinks were missing and were recreated. The task text had two errors: the penpot-frontend image has no wget, so config.js was fetched through a curl container, and the Penpot 2.18 OIDC start route is `POST /api/auth/oidc`, not `/api/auth/oauth/oidc`.

Unfixed review findings:
- `F1` · P2 · first-time Penpot login by an ungranted user ends in a token-exchange 403, not /pending. The post-login resume skips `hooks.before`, so a code is issued before the gate runs. The gate fires at token exchange, and no access request is created. Location: apps/auth/src/auth/auth.ts:404. Status: noted, not fixed.

Open items:
- Rollback: the previous image is tagged `lilnas-auth:rollback-pre-oidc` (`sha256:1cc4b536…`). Do not prune it.
- The DB backup `/storage/app-data/lilnas-auth/lilnas-auth.db.bak-20261012-211150` is kept in place.
- Penpot logs a masked prefix of the OIDC client secret at startup. This is Penpot's own behaviour and is not configurable here.
- `compose-mount-coverage.spec.ts` was excluded from the per-task checks and runs only as part of `T5`.

### 2026-10-13 · Landed
Squash-merge of `feat/auth-oidc-provider` into `main` as `feat(auth): add OIDC provider; Penpot signs in through lilnas`, authored as Jeremy Asuncion.
