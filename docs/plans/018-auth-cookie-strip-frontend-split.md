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
