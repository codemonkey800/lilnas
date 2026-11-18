---
nexus-plan: 2
title: 'Auth hardening: strip the session cookie from backend requests, split the frontend from the secrets'
branch: feat/auth-cookie-strip-frontend-split
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && pnpm --filter @lilnas/auth lint && pnpm --filter @lilnas/auth type-check
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/auth exec jest --maxWorkers=2
  - pnpm exec prettier -c infra/proxy.yml apps/theater/deploy.yml apps/auth/next.config.js apps/auth/README.md
  - docker build --check -q -f apps/auth/Dockerfile .
parallel: 2
model: frontier
review: per-phase
review-model: strong
commit-style: 'conventional, scope required, e.g. feat(auth): …, feat(infra): …, test(auth): …, docs(auth): …'
---

# Auth hardening: strip the session cookie from backend requests, split the frontend from the secrets

## Goal
Two independent hardening changes to `apps/auth`, the ForwardAuth provider behind Traefik, from
the security review of 2026-11-17.

**Change 1: stop forwarding the lilnas session cookie to backends.** The session cookie is scoped
to `.lilnas.io`, lives 30 days, and Traefik forwards it untouched to every backend under
`*.lilnas.io`. One compromised app can harvest an admin's cookie, which passes `/verify` for
every host and opens `/admin`. After this change `/verify` returns the request's cookies minus
lilnas-auth's own, Traefik swaps the `Cookie` header before forwarding, and six open routers get
an always-allow forwardAuth that does the same strip. The cookie gets a unique name first, so the
strip can never delete another app's cookie, and every existing session is revoked once.

**Change 2: split the Next.js frontend from the secrets and the database.** Today one container
runs Next (the only pre-auth internet-facing surface) beside Nest, sharing the signing secret, the
Google client secret, the writable SQLite volume and the compose-file mounts. After this change a
separate `auth-frontend` container has no secret env file, no volume and no mounts; the backend
keeps all three and keeps the service name `auth`.

The run ships in three pushes to `main`, each behind a human go/no-go and followed by a
verification task and a human check: the auth image, then the Traefik labels, then the split.
Change 1 is complete after the second push and does not depend on Change 2.

## Decisions
- **Strip in `/verify`, no Traefik plugin, no per-host cookies.** Verified on traefik:v3.7.15 in
  an isolated rig on 2026-11-17 (HTTP/1.1 only). Per-host cookies with a redirect exchange are
  the fallback only if the live checks in this plan fail.
- **Rename the cookie prefix to `lilnas-auth` and revoke all sessions with a boot migration.**
  `apps/tdr-code` and nexus-code's own-login mode run Better Auth with the default cookie name; a
  name-based strip would delete their sessions. Everyone signs in again once. The migration runs
  when the new image boots, so there is no window where an old token works under the new name.
  Chosen by the user over a manual revoke and over keeping the name.
- **Strip every cookie in the `lilnas-auth.` family**, not only `session_token`, so a later
  cookie cache or state cookie is covered without another change.
- **Open routers: strip on dashcam, equations, theater, theater-ws, storage and tdr-code; not on
  emby, immich or turbo.** The strip makes a router return errors while the auth backend is down
  or restarting (about 10 s per auth deploy). The user chose to keep emby, immich and turbo
  independent of auth; they keep receiving the cookie. The `auth` router is never stripped.
- **Change 1 ships in two pushes: auth image first, labels second.** If the labels went live
  against an auth image that doesn't return `Cookie`, every gated app would lose all its cookies
  and the stripped open routers would return 404.
- **An agent pushes after a human approves.** Each push has a go/no-go H task before it. Rollbacks
  are done by a human (the agent has no sudo).
- **A canary on the production Traefik before the shared labels change.** A throwaway echo
  container with private copies of both middlewares covers what the rig could not: HTTP/2 on the
  TLS entrypoint, WebSocket upgrades and a real signed-in browser.
- **Change 2: same image, two services.** Backend stays `auth` so `http://auth:8081` keeps
  working for Traefik and other containers; `auth-frontend` takes the router labels. Both keep
  `image:` and `build:` so `lilnas ci detect` deploys both.
- **Rewrites are chosen by Next's build phase, not an env var.** Production builds always proxy
  to `http://auth:8081`; `next dev` proxies to `localhost:8081`. No build argument, no
  `turbo.json` change (the root one would rebuild every image).
- **`deploy.dev.yml` stays single-container.**
- **Out of scope:** `rocky-roads.lilnas.io` (compose project `hop-road`, outside this repo), a
  secret header on `/internal/*`, security headers, edge rate limiting, admin re-auth, OIDC
  trimming, request caps, the session-cache key, DB file permissions.

## Context
- pnpm + Turbo monorepo. `apps/auth` (`@lilnas/auth`) is the ForwardAuth provider: a NestJS
  backend on :8081 (`src/`, wired in `src/app.module.ts`) and a Next.js frontend on :8080
  (`src/app/`, `next.config.js`). Traefik v3.7.15 (`infra/proxy.yml`) calls
  `http://auth:8081/verify` for every router with `middlewares=lilnas-auth`; other containers
  call `http://auth:8081` too.
- Compose: root `docker-compose.yml` includes `infra/*.yml` and `apps/*/deploy.yml`. Traefik
  routers and middlewares are container labels.
- Names this plan fixes: cookie prefix `lilnas-auth` (`lilnas-auth.session_token`, or
  `__Secure-lilnas-auth.session_token` on https); endpoint `/strip-cookie`; Traefik middleware
  `lilnas-cookie-strip` (no middleware name may contain `lilnas-auth`:
  `apps/dev/src/registry/compose-file.ts` treats a substring match as gated); frontend service
  `auth-frontend`; backend service stays `auth`; env `AUTH_BACKEND_URL`.
- Tests: Jest, specs in `__tests__/` beside the source; projects `backend` (node) and `frontend`
  (jsdom) in `apps/auth/jest.config.js`. Run only your own specs:
  `cd apps/auth && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm exec jest <paths> --maxWorkers=2`
  and read the `Tests:` line. Never run jest without `--maxWorkers=2` and never run two jest
  runs or docker builds at once: this machine is the production server.
- Lint: `pnpm --filter @lilnas/auth lint` covers `apps/auth/src` only. For any other file you
  edit run `pnpm exec prettier -c <file>`; if it failed before your edit (many `deploy.yml`
  files do), match the file's style and don't reformat the rest.
- Production runs here as compose project `lilnas` from `/opt/lilnas`, deployed only by pushing
  to `main` (`docs/deploy.md`). Never run `docker compose up/down/restart/pull/build` against
  project `lilnas`. Never use `apps/auth/deploy.yml` in a test: it mounts the production database.
  Never push unless your task says to. Allowed on production: `docker compose -p lilnas ps|logs`,
  `docker inspect`, `docker logs`, and what your task names.
- Throwaway containers: own network, unique name prefix, no published ports, test values only.
  Remove containers, networks, volumes, images and temp files before finishing and show the
  cleanup in your result.
- Never print or copy `.env.keys`, a `*.decrypted` file, or a production cookie or token. Mask
  values in output.
- No `any`. Report what you can't fix as `defects:` in your result.

## Done means
- The task's interfaces and edge cases are implemented as written; any deliberate difference is
  stated in the result with the reason.
- Every behaviour the task lists under Tests has a spec, and for each security-relevant one the
  result says how the spec was shown to fail when the behaviour is reverted.
- All `checks:` pass. A file outside `apps/auth/src` that passed `prettier -c` at `base` still
  passes.
- `apps/auth/src/verify/__tests__/auth-response-headers.spec.ts` passes at every commit: the
  `authResponseHeaders` list in `infra/proxy.yml` and the controller's constants agree.
- The public surface is unchanged: `apps/auth/next.config.js` rewrites exactly `/api/auth/:path*`,
  `/.well-known/openid-configuration`, `/.well-known/oauth-authorization-server` and
  `/api/sse/:path*`; no task adds a Traefik router or publishes a port.
- A task with `files: []` commits nothing. A task that pushes reports the pushed sha, the CI run
  URL, each check with its observed value, and the rollback command.
- A task that creates throwaway containers, networks, volumes, images or temp files shows they
  are gone, unless the task says to leave something for a later task.
- No secret, cookie value or token appears in the diff or in a result.

## Planner notes
Research on 2026-11-17 at `main` d2a90309 (equal to `origin/main`).

- **Checks at base, in a clean worktree after `pnpm install --frozen-lockfile`:** all four pass.
  Jest: 47 suites, 706 tests, about 11 s at `--maxWorkers=2`. `pnpm lilnas ci detect` runs in a
  clean worktree without a build.
- **Deploy order** (`scripts/deploy/lilnas-deploy.sh`): `pull` + `up -d` for services whose image
  was rebuilt, then `up -d` for services whose compose file changed, then `--force-recreate`. A
  service whose image is held back by a red check is dropped, but other services still deploy.
  That is why the labels ship after the image.
- **CI mapping** (`packages/cli/src/utils/ci-detect.ts`): `listImages()` groups services by image
  name and needs both `image:` and `build:` on a service. A change under `apps/<x>/` rebuilds
  `lilnas-<x>`, so the labels push rebuilds dashcam, equations, theater and auth. Root
  `turbo.json` is a global input (rebuilds every image); `apps/tdr-code` is never built but its
  nginx proxy service is still `up`'d when its `deploy.yml` changes.
- **Traefik's Docker provider skips a container whose health is `starting` or `unhealthy`.** The
  auth router is therefore absent for up to one healthcheck interval (30 s) after a deploy today.
  The frontend service gets `start_interval` so it becomes routable in seconds.
- **`/verify` does not depend on the frontend.** After the split a broken frontend breaks sign-in
  but not requests from users who already have a session.
- **Frontend env reads** (everything under `src/app`): `BACKEND_PORT`, `AUTH_HOST`,
  `REDIRECT_ALLOWED_SUFFIX`, `PROFILE_ALLOWED_ORIGINS` (default `''`; not set in `.env.prod`).
  `src/app/login/page.tsx` imports `src/oidc/clients`, which reads no env at import.
- **Better Auth 1.7.12** (`dist/cookies/index.mjs`): cookie name is
  `${advanced.cookiePrefix || 'better-auth'}.${name}`, `__Secure-` when the base URL is https.
  Names in use: `session_token`, `session_data`, `account_data`, `dont_remember`, `oauth_state`.
- **Who reads the lilnas cookie:** only `apps/auth`. `apps/theater` uses `theater_session`.
  nexus-code reads `X-Forwarded-User-Id` and calls `/api/profile` on `auth.lilnas.io` from the
  browser, which is not stripped. `~/dev/nexus-code/packages/server/src/auth.ts` also has an
  own-login Better Auth mode with the default cookie name.
- **Prettier at base:** fails on `infra/shared.yml`, `apps/auth/deploy.yml`,
  `apps/auth/deploy.dev.yml`, `apps/dashcam/deploy.yml`, `apps/equations/deploy.yml`,
  `apps/tdr-code/deploy.yml`, `docs/lilnas-expose.md` and two files under
  `plugins/lilnas/skills/expose`. The prettier check lists only files that pass.
- **Rollback limits:** after the labels push, the auth image must never go back to one older than
  the first push. After the split, `LILNAS_TAG=<old sha>` still works for the backend (the
  entrypoint paths exist in older images) but not for `auth-frontend`, whose rewrites would point
  at `localhost`; roll the split back by reverting on `main`.
- **Not verified by the planner:** that a task worktree's `HEAD` is the run branch tip (the push
  tasks check the diff contents instead), and the reasoning effort setting, which is not a plan
  frontmatter key and has to be set on the run.

- **Steering notes saved 2026-11-18 before a context clear:**
  - Run `nexus-run:e6e4cfd3-f886-4568-ab7e-8c8edc19e653`, started 2026-11-18. The user asked
    for Fable (frontier) at high effort; the draft did not record an effort, so it was the
    user's to set on the Start screen. Not confirmed.
  - User decisions, all final: cookie prefix `lilnas-auth` with a boot migration that deletes
    every session; strip on dashcam, equations, theater, theater-ws, storage and tdr-code only
    (emby and immich excluded at interview, turbo dropped afterwards with "lets actually not add
    to turbo"); Change 1 in two pushes; an agent pushes after each human go/no-go; humans roll
    back (the agent has no passwordless sudo).
  - Why the order is linear: a push task pushes its worktree `HEAD`, so nothing that must not
    ship may be merged before it. Any new task that edits code must be `after` the preceding
    push task (T5, T9) or it ships early. Never add work in parallel with a pending push.
  - Ruled out: a build argument or env var for the rewrite origin (Turbo strict env mode and
    remote-cache poisoning; root `turbo.json` rebuilds every image); `depends_on` with
    `service_healthy` (first probe comes after a 30 s interval); running `apps/auth/deploy.yml`
    in tests (mounts the production DB); rotating `BETTER_AUTH_SECRET` to revoke sessions (the
    stored JWKS private keys are encrypted with it); pushing label changes together with the
    image (a held-back image plus live labels drops every cookie); `lilnas-auth-*` as the strip
    middleware name (substring match in `apps/dev`).
  - Push tasks stop if `origin/main` moved. If that happens, do not have an agent merge or
    rebase; ask the user how to reconcile.
  - The canary (`cookie-canary` compose project, files in `/tmp/lilnas-cookie-canary/`) runs
    from T6 until T10. If the run is cancelled in between, it must be removed by hand:
    `docker compose -p cookie-canary down` and delete the temp dir.
  - `/opt/lilnas` needs `git -c safe.directory=/opt/lilnas` to read. `gh` is authenticated.
    Wildcard DNS and the wildcard certificate cover `*.dev.lilnas.io`.
  - Memory file `project_auth_hardening_plan_018.md` records the decisions; update it when the
    pushes land.
  - No open thread with the user.

- **C1, 2026-11-18 (T9 blocked before pushing; production unchanged):**
  - Cause was the planner's T7 body, which asked for a comment on the four exempt routers.
    `ci detect` is per file, so comments in `apps/auth/deploy.yml`, `infra/immich.yml` and
    `infra/media.yml` added emby, radarr, sonarr, sabnzbd and immich* to `up`. Verified with
    `ci detect` at 2ab60d54.
  - Fix: T15 removes those three comments (the turbo one in `infra/shared.yml` stays; that
    file changes anyway). T9 is now `after` T15 and its `up`/`pull` sets are exact. Ruled
    out: widening T9's allowed paths, which would touch services H3 did not describe.
  - T9's `task_blocked` checkpoint was left for the user to retry once T15 is done, since a
    commit lands after the H3 approval.
  - The run's config shows `modelId: sonnet` and effort `high`, although the frontmatter says
    `model: frontier`; T9's first attempt ran on sonnet. Told the user.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-11-18 · T1 · done
Cookie names are now `lilnas-auth.session_token` (http) and `__Secure-lilnas-auth.session_token` (https); import them from `src/auth/cookie-names.ts`. Other Better Auth cookies (state, etc.) also carry the `lilnas-auth.` prefix now.
drizzle-kit --custom also emitted meta/0007_snapshot.json (identical to 0006 apart from key order, so no schema changes); it is committed because it continues the snapshot chain.
Migration 0007 deletes all session rows at first boot of the new image. oauth_access_token/oauth_refresh_token.session_id are ON DELETE set null, so token rows survive with a null session_id.
README and .env.example did not name the cookie; I added a short note to each rather than editing existing text.
Checks run: utils+ui build, auth lint, auth type-check, full auth jest (47 suites, 712 tests, --maxWorkers=2), prettier -c on the four listed files, docker build --check (no warnings). Nothing was pushed or deployed. Rollback after merge: revert the commit; sessions deleted by 0007 cannot be restored.

### 2026-11-18 · T2 · done
/verify now sets a `Cookie` response header on ALLOW (request cookies minus `lilnas-auth.*` / `__Secure-lilnas-auth.*`), and none when nothing remains. infra/proxy.yml authResponseHeaders is unchanged (two identity headers), so Traefik ignores it until a later task adds `Cookie` to that list; add it only after this is deployed. auth-response-headers.spec.ts is unmodified and passes. When the list is updated, that spec will need VERIFY_SANITIZED_HEADERS added to its comparison.
Decision: VerifyController now constructor-injects PinoLogger (4th arg) for the sanitize-failure warning; the only other construction site is the integration harness in verify.service.spec.ts, which already provides it. app.module has LoggerModule globally.
SECURE_COOKIE_PREFIX is '__Secure-' (not '__Secure-lilnas-auth'), so the secure name prefix is SECURE_COOKIE_PREFIX + COOKIE_PREFIX + '.'.
Checks: utils/ui build, auth lint, auth type-check, full auth jest (49 suites, 748 tests, --maxWorkers=2), prettier -c on the 4 files, docker build --check — all pass. Mutation checks (6) each made the relevant specs fail; sources restored. Nothing pushed or deployed; no containers or temp files left. Rollback after merge: revert 84b40f3d.

### 2026-11-18 · T3 · done
GET/POST/any method on backend :8081 /strip-cookie returns 200, empty body, and a `Cookie` response header = stripAuthCookies(request cookie) (omitted when undefined or on a throw, with a content-free warn `strip-cookie-sanitize-failed`). It reuses VERIFY_SANITIZED_HEADERS from verify.controller.ts for the header name. No rewrite was added; public-allowlist.spec.ts guards the four public rewrite sources and the never-reachable destination prefixes (does not assert the destination host, so a later AUTH_BACKEND_URL change won't break it).
Decision: the controller constructor-injects only PinoLogger (like VerifyController after T2); no GatedHostsService/HostActivityService, enforced by a design:paramtypes spec.
The later Traefik task must add a `Cookie` entry to authResponseHeaders on the `lilnas-cookie-strip` middleware (forwardAuth address http://auth:8081/strip-cookie), and add VERIFY_SANITIZED_HEADERS to auth-response-headers.spec.ts comparison for lilnas-auth's list. Only after this is deployed.
Mutation checks (5) each failed the relevant specs; sources restored. Checks: utils/ui build, auth lint, auth type-check, full auth jest (51 suites, 768 tests, --maxWorkers=2), prettier -c on proxy.yml/theater deploy.yml/next.config.js/README.md, docker build --check — all pass. Nothing pushed or deployed; no containers/temp files left. Rollback after merge: revert 7d7d0fbc.

### 2026-11-18 · T4 · done
Verdict: the cookie strip holds on HTTP/1.1 cleartext, HTTP/1.1 TLS and HTTP/2 TLS against the real backend (node dist/main, throwaway SQLite, https AUTH_HOST) behind traefik:v3.7.15. 45/45 rows match (2 direct, 39 for cases 1-13 across three transports, 4 for case 14) and 3/3 for case 15. Node v26.12.0 (node:26.12.0), Traefik 3.7.15. No mismatches, no defects.
Case 15 (open route, echo stopped): Traefik returns 502 on all three transports.
Run it: apps/auth/scripts/cookie-rig/rig.sh (SKIP_BUILD=1 reuses apps/auth/dist). Exit 1 on any mismatch; always tears down. Proof: containers 0, networks 0, temp dir gone, /tmp/cookierig* gone.
Mutation check: with TRAEFIK_DYNAMIC pointing at a config without Cookie in authResponseHeaders (gated and open), 25/45 rows FAIL (cases 2, 3, 6, 8, 9, 11, 12, 14; control case 1 still passes), so the matrix does fail when the fix is absent. rig.sh accepts TRAEFIK_DYNAMIC for this.
Decisions: (1) each logical route is two routers, <name> on websecure with tls and <name>-web on web, because a tls router never matches cleartext; same middlewares. (2) Case 14 runs over HTTP/1.1 only (ws and wss); WebSocket over h2 (extended CONNECT) was not tested. (3) /json also accepts POST and adds bodyBytes and bodySha256 for case 9. (4) The matrix adds two direct rows (0a /verify, 0b /strip-cookie on :8081) as the "/verify returns 200 for the minted cookie" confirmation. (5) The backend runs with the checkout mounted read-only, uid of the invoking user, and the minted session is created via docker exec into the backend container (same DB handle namespace); mint.json is handed to the client container through a mode-default temp dir that is removed on exit. (6) mint-session.mjs refuses /data and /storage, including via a symlink (verified).
For later tasks: canary.private.yml defines its own middlewares (dev-cookie-canary-auth, dev-cookie-canary-strip) and works before infra/proxy.yml has lilnas-cookie-strip; canary.shared.yml uses lilnas-auth and lilnas-cookie-strip and only works after infra/proxy.yml is updated and deployed (it needs Cookie in authResponseHeaders on lilnas-auth and a lilnas-cookie-strip middleware with address http://auth:8081/strip-cookie and authResponseHeaders=Cookie). Both use project name cookie-canary and the same container and hosts, so run one at a time. Neither was run here. Checks: utils/ui build, auth lint, type-check, full auth jest (51 suites, 768 tests, --maxWorkers=2), prettier -c on the four listed files, docker build --check all pass. apps/auth/dist (gitignored) is left in the worktree from the build.

### 2026-11-18 · Phase 1 · review cycle 1
Pass 1 (T1): T1 (unique lilnas-auth cookie prefix, SESSION_COOKIE_NAMES moved to cookie-names.ts, migration 0007 DELETE FROM session, spec updates) matches its task body; no defects found in this slice.
Pass 2 (T2, T3): T2/T3 implement stripAuthCookies, the /verify ALLOW Cookie header and the always-allow /strip-cookie endpoint to spec, with good tests. One P1: /strip-cookie is not excluded from pino-http's completion log and res.headers.cookie is not redacted, so the sanitized cookies (other apps' session tokens) would be logged to Loki on every open-router request.
Pass 3 (T4): Pass 3 (T4) covers the cookie-rig verification kit. One P1: on both HTTP/1.1 transports, matrix case 8 never sends two Cookie headers, because Node merges a cookie array into one header, so those rows pass without testing what the task required. One P2: echo.mjs crashes on an aborted POST, which matters on the internet-reachable production canary.
Seams pass: Seams pass over T1-T4: the cookie prefix, session cookie names, the sanitized-header constant, the /strip-cookie route and the rig's Traefik middlewares all agree across tasks. No cross-task disagreement found.
Consolidation: I merged the four passes into three distinct findings. Two are P1: the /strip-cookie completion log writes the kept cookies to Loki, and matrix case 8 on HTTP/1.1 never sends two Cookie headers. One is P2: echo.mjs crashes on an aborted POST. T1 and the seams pass reported no findings.

- F1 · P1 · /strip-cookie completion log writes the kept cookies to Loki — apps/auth/src/app.module.ts:85 → R1
- F2 · P1 · Case 8 on HTTP/1.1 never sends two Cookie headers — apps/auth/scripts/cookie-rig/client.mjs:343 → R2

Notes:
- F3 · P2 · echo.mjs crashes on an aborted POST body — apps/auth/scripts/cookie-rig/echo.mjs:170

Spec check:
- missing: gated, cookies split over two `Cookie` headers (HTTP/1.1) ... merged, session stripped (apps/auth/scripts/cookie-rig/client.mjs) — On HTTP/1.1 the client sends one merged header; see the P1.
- extra: GET /json returns { httpVersion, method, cookieNames, ... } (apps/auth/scripts/cookie-rig/echo.mjs) — It also accepts POST and adds bodyBytes and bodySha256 for case 9; the task note says so.
- unverifiable: for each security-relevant one the result says how the spec was shown to fail when the behaviour is reverted (T1 task notes) — The notes list the checks run but don't describe reverting the cookie-name match or the migration to show the specs fail. A person should confirm the T1 result covered this.
- unverifiable: The redirect and 500 branches do not change. (apps/auth/src/verify/verify.controller.ts) — Unchanged in the diff and covered by unit and integration specs.
- unverifiable: Result: the matrix as a table of expected against observed ... Any mismatch in cases 2 to 14 is blocking (apps/auth/scripts/cookie-rig/rig.sh) — No check re-ran rig.sh; the 45-row pass and the mutation check (25/45 FAIL) are claims in the task note. A person should look at the run output.

Declined to judge:
- meta/0007_snapshot.json committed alongside the --custom migration — drizzle-kit emits it for custom migrations; it only continues the snapshot chain and holds no schema change.
- The old-name resolveSession/verify tests would still pass if old names were re-added to SESSION_COOKIE_NAMES, because Better Auth's getSession reads only the configured name — The exact-name contract is pinned directly by the extractSessionCookieValue spec cases for both old forms.
- Style-only items: the redundant sqlite.pragma('foreign_keys = ON') after migrate() in the migration spec, and the duplicated try/catch sanitize block in VerifyController and StripCookieController — Style or reuse only; both behave as the task bodies specify.
- Traefik authResponseHeaders wiring for Cookie in production proxy.yml — It belongs to a later task and is outside this phase.
- rig.sh exit codes: 'exit 2' (missing image or dist) and 'exit 130' (INT/TERM) become exit 1, because the EXIT trap always runs 'exit "$STATUS"' — Cosmetic; the script still exits non-zero, and nothing in the plan depends on the specific code.
- Case 14 does not cover WebSocket over HTTP/2 (extended CONNECT) — The task note says so openly; browsers use an HTTP/1.1 upgrade for ws/wss against Traefik, and the task did not list h2 for case 14.
- echo.mjs new URL(req.url) can throw on a malformed absolute-form request target inside the upgrade listener — Traefik normalizes the request target before forwarding, so this is only reachable when hitting echo directly.
- echo.mjs hard-codes AUTH_COOKIE_PREFIXES and mint-session.mjs hard-codes the session cookie name instead of importing from src/auth/cookie-names.ts — These are plain .mjs scripts that can't import the TS module, and the values match COOKIE_PREFIX and SESSION_COOKIE_NAMES today. The only risk is drift if the prefix changes later.

Checked:
- Code outside apps/auth, or other auth code, still matching the old better-auth.session_token name — git grep across the repo: Only apps/tdr-code (which has its own Better Auth and is out of scope) and plan docs reference it.
- DELETE FROM session failing under foreign_keys = ON, and the migration applied at boot with the pragma on — apps/auth/src/db/schema.ts, apps/auth/src/db/database.module.ts applyPragmas: Only the oauth token tables reference session, both with ON DELETE set null. applyPragmas sets foreign_keys = ON before migrate(), and the spec covers both.
- Journal ordering: idx 7's `when` must exceed prior entries so migrate() applies it — apps/auth/src/db/migrations/meta/_journal.json: 1794991941397 > 0006's 1792524883510; the spec asserts this.
- pino logging of the new Cookie response header — apps/auth/src/app.module.ts LoggerModule config; pino-std-serializers res serializer: res.headers.cookie is not redacted and /strip-cookie is not in autoLogging.ignore (the P1).
- PinoLogger injection into VerifyController and StripCookieController registration — apps/auth/src/app.module.ts:27,94; apps/auth/src/services/*.service.ts: PinoLogger is injected as in other providers, LoggerModule is global, and StripCookieController is listed in controllers.
- Circular import between strip-cookie.controller and verify.controller — apps/auth/src/verify/verify.controller.ts: No cycle.
- Sanitized-header constant shared by both controllers, and the auth-response-headers spec still matching proxy.yml — apps/auth/src/verify/verify.controller.ts:47,143-144; strip-cookie.controller.ts: VERIFY_RESPONSE_HEADERS is unchanged. Both controllers take Cookie from VERIFY_SANITIZED_HEADERS and call the same stripAuthCookies.
- Cookie prefix and session-name agreement across T1, T2 and T4 (Better Auth config, strip prefixes, SESSION_COOKIE_NAMES type change, minted name) — apps/auth/src/auth/auth.ts:212, strip-auth-cookies.ts, access-cache.service.ts:79-84, scripts/cookie-rig/mint-session.mjs:75-77: All are built from COOKIE_PREFIX and SECURE_COOKIE_PREFIX and agree, and type-check passed.
- Node http client behaviour with a cookie header array, and the async echo handler on aborted bodies — client.mjs requestHttp1; echo.mjs createServer handler: Both confirmed by local runs (the case-8 P1 and the echo P2).
- Rig middlewares agreeing with production lilnas-auth and the endpoints (gated sends X-Forwarded-User(-Id) and Cookie to /verify, open sends Cookie to /strip-cookie) — infra/proxy.yml:102-119, scripts/cookie-rig/traefik-dynamic.yml, canary.private.yml: Same address, preserveLocationHeader and authResponseHeaders, plus Cookie.
- Middleware names containing 'lilnas-auth' would be treated as gated by apps/dev, and the idle-reap opt-out label name — canary.private.yml, apps/dev/deploy.yml: No canary middleware name contains the substring, and the label matches 'lilnas.idle-reap.enabled=false'.
- Cookie values leaked in rig output — rig.sh, client.mjs mask(), echo.mjs: mint.json goes to a temp file, the backend log and client output are masked, and echo returns values only with ECHO_VALUES=1.

### 2026-11-18 · R1 · done
Added 'res.headers.cookie' to the pino redact paths and '/strip-cookie' to autoLogging.ignore. The pino-http options moved unchanged (apart from those two additions) from app.module.ts into src/logger.config.ts (exported pinoHttpOptions) so the regression spec can run the real config. Deliberate difference from the suggested fix: the options moved to a separate file instead of staying inline in AppModule.
Spec strip-cookie-logging.spec.ts failed 3/3 on the old config. Reverting only the redact path fails the stand-in-route spec; reverting only the ignore entry fails the no-completion-line spec.
All four plan checks pass (jest full run: 52 suites, 771 tests).

### 2026-11-18 · R2 · done
Regression spec (apps/auth/scripts/cookie-rig/__tests__/http1.spec.mjs) failed on the old transport: the server received `Cookie: theme=dark; a=b; lang=en` (one merged line) where two lines were expected. It passes after the fix.
requestHttp1(secure, host, req, {port, connectHost}) now lives in http1.mjs and is hand-written over net/tls; array header values become one line each; it returns cookieLinesSent. Case 8's check requires cookieLinesSent === 2 on the h1 transports.
Added a third Jest project `rig` (native ESM, transform {}, roots scripts/cookie-rig, testMatch **/__tests__/**/*.spec.mjs) so the rig specs run under the plan's jest check. The kit directory is mounted whole into the client container, so http1.mjs needs no rig.sh change.
Full rig.sh run against Traefik: 45/45 + 3/3 rows PASS; teardown showed 0 containers, 0 networks, temp dir gone. All four plan checks pass (jest: 52 suites, 771 tests).

### 2026-11-18 · Phase 1 · review cycle 2
Re-review of the cycle-1 remediation. R1 (pino redact + /strip-cookie autoLogging ignore, config moved to logger.config.ts with a real-config spec) and R2 (hand-written HTTP/1.1 transport sending separate Cookie lines, case 8 asserts two lines sent) both fix their findings; no new P0/P1 in the remediation diff. F3 (P2) is untouched.

Earlier findings: F1 fixed, F2 fixed.

Notes:
- F4 · P2 · Duplicated /strip-cookie comment in logger config — apps/auth/src/logger.config.ts:51

Spec check:
- extra: Add 'res.headers.cookie' to LoggerModule redact.paths. Add '/strip-cookie' to autoLogging.ignore (apps/auth/src/logger.config.ts) — The config was also moved into a new module. The R1 note states this, and behaviour is unchanged.
- extra: Optionally assert that the client really wrote two Cookie lines (apps/auth/jest.config.js) — A third Jest project 'rig' was added so the kit spec runs under the plan's jest check.
- unverifiable: Full rig.sh run against Traefik: 45/45 + 3/3 rows PASS (apps/auth/scripts/cookie-rig/rig.sh) — Only the R2 notes claim this. A person should rerun rig.sh to confirm case 8 passes on both HTTP/1.1 transports with 'cookie lines sent=2'.

Declined to judge:
- Moving pinoHttpOptions out of app.module.ts into src/logger.config.ts — A deliberate difference the R1 note states; the options are byte-identical apart from the two additions, and the move lets the spec use the real config.
- Test 1 in strip-cookie-logging.spec.ts passes trivially once /strip-cookie is in autoLogging.ignore — Tests 2 and 3 cover the ignore entry and the redact path separately, and each one fails when its part is reverted.
- http1.mjs: Content-Length uses body.length and header values are not validated — Rig-only test client. Every caller passes a Buffer body and fixed test header values.

Checked:
- The new rig Jest project needs native ESM, and CI runs pnpm test — apps/auth/package.json, .github/workflows/ci.yml: The test, test:watch and test:cov scripts all set --experimental-vm-modules, and CI calls pnpm test, so the rig project runs in CI.
- Changed requestHttp1 signature (route became host) with callers left on the old form — apps/auth/scripts/cookie-rig/client.mjs: Every caller (both h1 transports and ready()) passes hostFor(route). Case 15 goes through transport.send.
- Type import from pino-http resolves only transitively — apps/auth/package.json: pino-http 11.0.0 is a direct dependency.
- Redact path casing against setHeader('Cookie') in VerifyController — apps/auth/src/logger.config.ts: res.getHeaders() lower-cases header names, so 'res.headers.cookie' also matches the 'Cookie' header that /verify sets.
- The rig project's roots overlap the backend/frontend projects — apps/auth/jest.config.js: The backend root is src, the frontend root is src/app and the rig root is scripts/cookie-rig, so the projects don't overlap.
- Prettier on the kit files — apps/auth/scripts/cookie-rig/, apps/auth/jest.config.js: prettier -c passes.

### 2026-11-18 · H1 · approved
Approved.

### 2026-11-18 · T5 · done
Pushed 0553a8a760d9016d27b34e2481869c5d6d6c9406 to main (fast-forward from d2a903094e9c9d3ef454b90e633a866ba16bcd94, the rollback sha).
CI run https://github.com/codemonkey800/lilnas/actions/runs/44274534107 succeeded (detect, check, build-images auth, deploy, summary; base-images skipped).
Production checks all passed; see the table above. The session table has 0 rows after the deploy, and __drizzle_migrations has 8 rows, so 0007 applied.
The sign-in start returned a Google URL and set only __Secure-lilnas-auth.state with Domain=.lilnas.io; no cookie name contained better-auth.
In-container checks used docker cp of a temp script (removed) because the task suggested node -e; the behaviour checked is the same.
Rollback (human only, not run): cd /opt/lilnas && sudo -u deploy env LILNAS_TAG=d2a903094e9c9d3ef454b90e633a866ba16bcd94 docker compose up -d auth
No throwaway containers, networks, volumes, images or temp files remain.

No commits: nothing to integrate.

### 2026-11-18 · T6 · done
Canary started from /tmp/lilnas-cookie-canary/ as compose project cookie-canary; container cookie-canary-cookie-canary-echo-1 is up on lilnas-proxy with no published ports. It is left running on purpose for the gated-host check; a later task removes it.
URLs: gated https://cookie-canary.dev.lilnas.io/ ; open https://cookie-canary-open.dev.lilnas.io/ (/json, /ws).
Observations (fake values only):
- Gated host without a session: HTTP/2 302 to https://auth.lilnas.io/login?redirect=https%3A%2F%2Fcookie-canary.dev.lilnas.io%2F.
- Open /json, curl --http2, all three cookies: 200, http_version 2, cookieNames [theme, __Secure-better-auth.session_token], authCookiePresent false.
- Same over --http1.1: 200, http_version 1.1, same result.
- HTTP/2 with the cookies split across two cookie: headers: 200, version 2, same result, cookieHeaderCount 1.
- Only the lilnas-auth cookie: cookieNames [], cookieHeaderCount 0.
- No cookie: 200, cookieNames [].
- WebSocket upgrade to wss://cookie-canary-open.dev.lilnas.io/ws with the first cookie set (raw TLS script /tmp/lilnas-cookie-canary/ws-check.mjs): 101, frame authCookiePresent false, names theme and __Secure-better-auth.session_token.
- docker logs lilnas-auth-1 --since 5m: no error from these requests. The only WARN (Better Auth rate-limit IP notice, 09:22:39Z) comes from the T5 /.well-known curl and predates the canary start (09:23:32Z). Auth does not log /verify or /strip-cookie requests, so this means no level 40+ lines, not a count.
Removal: docker compose -p cookie-canary -f /tmp/lilnas-cookie-canary/canary.private.yml down && rm -rf /tmp/lilnas-cookie-canary
(the task's short form `docker compose -p cookie-canary down` also works; -f just guarantees the compose file is found).
Extra file ws-check.mjs lives only in /tmp/lilnas-cookie-canary/ and is removed by the rm -rf. Nothing was committed, the worktree tree is clean, the lilnas project was only read.

No commits: nothing to integrate.

### 2026-11-18 · T7 · done
Nothing deployed or pushed. Services whose labels changed (recreated on deploy): traefik, storage, dashcam, equations, theater (theater + theater-ws), tdr-code. Comment-only edits touch auth, emby, immich and turbo, so Compose may recreate those too; their router config is unchanged.
Checks: utils/ui build, auth lint and type-check pass; full auth jest passes (54 suites, 808 tests, --maxWorkers=2); prettier -c passes on infra/proxy.yml, apps/theater/deploy.yml, apps/auth/next.config.js and apps/auth/README.md; docker build --check reports no warnings.
The other edited deploy.yml/infra yml files (auth, dashcam, equations, tdr-code, immich, media, shared) already failed prettier -c before my edit; I matched their style and did not reformat them.
Mutation checks (each reverted afterwards): removing the dashcam strip label (2 failures), adding a new open router (1), removing Cookie from the lilnas-auth list (1), adding trustForwardHeader to the strip middleware (1), strip address changed to /verify (1), emby given the strip middleware while exempt (2), turbo router removed while still exempt (1), extra header on the strip list (1), registry classifier matching any lilnas-* middleware (the new service-registry test fails).
Two commits so auth-response-headers.spec.ts passes at both: bf41fa5f (proxy.yml, controller comments, header spec), 8c265e4e (router labels, coverage spec, registry spec).
No apps/auth/src behaviour changed; only comments in verify.controller.ts. The router-cookie-coverage spec treats an exempt router that also carries a middleware as a failure (exactly one state), and matches `lilnas-auth@docker` style suffixes.
Temp files /tmp/t7-* removed; no containers, networks, volumes or images created.

### 2026-11-18 · T8 · done
Docs only. README gained a "Cookie forwarding" section and the Allow bullet in "Request flow" now mentions the sanitized Cookie header. The expose docs and the example compose file describe the cookie exposure on routes without lilnas-auth and the lilnas-cookie-strip alternative (a commented label in the example).
At this branch's base, infra/proxy.yml does not yet list Cookie in authResponseHeaders and has no lilnas-cookie-strip middleware; the docs describe the finished state. The auth-side code (/strip-cookie, /verify sanitizing) is present.
The five expose files already failed prettier -c; I did not reformat them. apps/auth/README.md still passes.
Checks: utils/ui build, auth lint and type-check pass; auth jest 53 suites / 774 tests pass; prettier -c on the four listed files passes; docker build --check reports no warnings.
No throwaway containers, networks, volumes, images or temp files were created.

### 2026-11-18 · H2 · approved
Approved.

### 2026-11-18 · Phase 2 · review cycle 1
Phase 2 is clean. T7 adds the Cookie header to lilnas-auth, adds the lilnas-cookie-strip middleware and puts it on exactly the six routers, with specs that fail on drift. T8's docs state the required facts. T5 and T6 committed nothing.

Suspicions:
- T5 rollback command becomes unsafe after the label push — apps/auth/README.md:33 · T5 recorded the command LILNAS_TAG=d2a90394 docker compose up -d auth. Once Cookie is in authResponseHeaders, that image sends no sanitized Cookie header, so every gated backend would lose all its cookies. The README's rollback rule says this, but the command from T5 is still in the run's notes. · confirm by: Make sure the human go/no-go for the label push replaces the T5 rollback command with 'revert on main'.

Spec check:
- extra: Leave a one-line comment on those four routers saying so (apps/auth/deploy.yml, infra/media.yml, infra/immich.yml, infra/shared.yml) — Done as asked. Recreating these services on deploy is a side effect that T7's note discloses.
- unverifiable: T5/T6 production and canary observations (production lilnas project, cookie-canary project) — These are claims in the task notes with no diff. A person should confirm the canary is still running for the gated-host check and is removed afterwards.

Declined to judge:
- storage.lilnas.io (MinIO S3 API) now depends on auth uptime through lilnas-cookie-strip — The task body names storage explicitly. It is a user decision, not a defect.
- Comment-only edits on the auth, emby, immich and turbo services may get them recreated on deploy — T7's note already discloses it. Their router config is unchanged.
- The 'exactly one state' test asserts the length twice (inside toEqual and again with toHaveLength) — Style only.

Checked:
- An open-router backend relies on the lilnas-auth cookie for identity — apps/theater/src/auth/auth.service.ts, apps/tdr-code/src/proxy.ts: theater uses its own theater_session cookie and tdr-code uses its own better-auth session cookie. The strip removes only lilnas-auth.* cookies, so neither is affected.
- The dev dashboard treats lilnas-cookie-strip as gated — apps/dev/src/registry/compose-file.ts:110: It uses includes('lilnas-auth'), which does not match lilnas-cookie-strip.
- Prettier regression on edited files outside apps/auth/src — dashcam/equations/tdr-code/auth deploy.yml, infra/shared|media|immich.yml, expose docs: Every one of them already failed prettier -c at base d2a90394 in repo context. proxy.yml, theater/deploy.yml and the README pass.
- /strip-cookie behaves differently from /verify's Cookie contract — apps/auth/src/verify/strip-cookie.controller.ts: It uses the same VERIFY_SANITIZED_HEADERS and stripAuthCookies, and sends no header if sanitizing fails or there are no cookies left, which matches the proxy.yml comment.
- The coverage spec misses a router or passes vacuously — apps/auth/src/verify/__tests__/router-cookie-coverage.spec.ts: A guard test checks that portal, dashcam and emby are found and that router names are unique. Exempt routers that also carry a middleware fail, and both list and map label forms are handled.

### 2026-11-18 · H3 · approved
Approved.
