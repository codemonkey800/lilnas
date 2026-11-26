---
nexus-plan: 2
title: 'Auth hardening 2: security headers, tokens on internal routes, SSE limits, cookie drop for turbo and emby'
branch: feat/auth-internal-tokens-headers-sse
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && pnpm --filter @lilnas/media build && pnpm --filter @lilnas/utils lint && pnpm --filter @lilnas/utils type-check && pnpm --filter @lilnas/auth lint && pnpm --filter @lilnas/auth type-check
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && pnpm --filter @lilnas/media build && pnpm --filter @lilnas/download lint && pnpm --filter @lilnas/download type-check && pnpm --filter @lilnas/dev lint && pnpm --filter @lilnas/dev type-check && pnpm --filter @lilnas/icloud-backup lint && pnpm --filter @lilnas/icloud-backup type-check
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/auth exec jest --maxWorkers=2 && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/utils exec jest src/auth --maxWorkers=2 && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/download exec jest src/auth --maxWorkers=2 && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/dev exec jest src/activity --maxWorkers=2 && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm --filter @lilnas/icloud-backup exec jest src/auth --maxWorkers=2
  - pnpm exec prettier -c apps/auth/next.config.js apps/auth/README.md apps/dev-idle-reaper/deploy.yml docs/deploy.md
  - sh -n apps/dev-idle-reaper/reaper.sh
  - pnpm lilnas secrets verify
parallel: 2
model: strong
review: per-phase
review-model: strong
commit-style: 'conventional, scope required, e.g. feat(auth): …, feat(utils): …, feat(infra): …, test(auth): …, docs(auth): …'
---

# Auth hardening 2: security headers, tokens on internal routes, SSE limits, cookie drop for turbo and emby

## Goal
Harden lilnas-auth (`apps/auth`) against the second-order attacks found in the security review of
2026-11-26. Nothing here is exploitable from the internet today. Each fix limits what a
compromised sibling container, another `*.lilnas.io` page, or an anonymous client can do.
Sign-in behaviour does not change.

1. **Security headers on `auth.lilnas.io`.** A Traefik `headers` middleware (HSTS, frame deny,
   `frame-ancestors 'none'`, nosniff) on the `auth` router, and Next's `x-powered-by` off.
2. **Tokens on the backend's internal routes.** `/internal/discord-link`,
   `/internal/discord-identity`, `/internal/host-activity` and `/admin/check` require a bearer
   token, one per caller, each limited to the routes that caller uses. Today any of the 46
   containers on `lilnas_default` can call them.
3. **Bounded SSE.** `/sse/pending` returns 401 without a session, each user has a cap on open
   streams, and the `auth` router has a Traefik in-flight limit per source IP.
4. **No lilnas session cookie to turbo and emby.** A plain Traefik `headers` middleware deletes
   the `Cookie` request header on both routers, with no dependency on auth uptime. The expose
   convention makes `lilnas-cookie-strip` the form for public dev routes.
5. **Database file permissions.** A host step by a human: directory 700, files 600, the stale
   October backup removed or moved.

The run ships in four pushes to `main`, each behind a human go/no-go and followed by a
verification task and a human check: (1) headers, `x-powered-by`, SSE limits; (2) tokens sent by
every caller, accepted but not required; (3) tokens required; (4) cookie drop and the expose
convention.

## Decisions
- **One token per caller, scoped to that caller's routes.** Four callers exist: `download`,
  `icloud-backup`, `dev` (the dashboard) and `dev-idle-reaper`. The table is in Context.
- **`download` keeps the write scope.** `POST /internal/discord-identity` is called only by
  `apps/download` (`DiscordLinkService.registerObservedIdentity`); `tdr-bot` never calls auth.
  The user chose to leave the write in download over moving it to tdr-bot. A compromised
  download can still relabel roster entries; it cannot create links or grant access.
- **Bearer token in `Authorization`.** `apps/auth/src/logger.config.ts` already redacts that
  header. Callers read `AUTH_INTERNAL_TOKEN`.
- **Enforcement is an env flag, `INTERNAL_TOKEN_ENFORCE=true`, set as a literal in
  `apps/auth/deploy.yml`.** Push 2 ships the guard without the flag (allow and log); push 3 adds
  the flag. Dev stacks never set it. A spec pins the flag in `deploy.yml` once it is on.
- **Every guarded request is logged with caller and outcome.** The internal routes saw almost no
  traffic in the 24 h before planning, so the check between push 2 and push 3 triggers each
  caller and reads these lines; it cannot rely on waiting.
- **SSE: 401 without a session, 400 without a host, 429 over the cap; the client code does not
  change.** `pending-client.tsx` and `admin-dashboard-client.tsx` already treat a non-2xx as a
  dead stream: recheck, rebuild after 5 s, and poll every 30 s regardless. Cap: 6 open streams
  per user across `/sse/pending` and `/sse/admin` (`SSE_MAX_STREAMS_PER_USER`).
- **In-flight limit: 64 per source IP on the `auth` router.** High, because one page load opens
  many parallel requests and LAN users may share an address; it bounds one address, it does not
  rate-limit sign-in. `sourcecriterion.ipstrategy.depth=0` is required: the middleware's default
  groups by request host, which would make the limit global.
- **HSTS on `auth.lilnas.io` only**, one year, no `includeSubDomains`, no preload.
- **Middlewares are defined on the container that uses them** (`auth-frontend`, `turbo`, `emby`),
  not on Traefik, so no push recreates Traefik.
- **Cookie drop is a plain `headers` middleware, never forwardAuth**, on turbo and emby. It
  drops every cookie, so it is only for apps that use none. emby is gated on a human check of a
  signed-in web session (H1) and is dropped from the run if it uses cookies. immich stays as it
  is.
- **Expose convention: `lilnas-auth` stays the shipped default; going public means swapping the
  label to `lilnas-cookie-strip`, never removing the middleware.** Chosen by the user over making
  cookie-strip the shipped default.
- **Pushes and rollback follow plan 018.** A task agent pushes after a human go/no-go; humans
  roll back (agents have no sudo).
- **Task and review model: strong**, chosen by the user.
- **Out of scope:** `rocky-roads.lilnas.io` (compose project `hop-road`, outside this repo;
  follow-up: give it `lilnas-cookie-strip`), a fresh-session requirement for admin actions,
  shorter sessions, the cookie domain, the forward-auth model, any auth middleware on turbo, emby
  or immich. PKCE for the Immich OIDC client and container hardening (`cap_drop`,
  `no-new-privileges`, read-only rootfs) are not included: neither is trivial to verify beside
  four pushes.

## Context
- pnpm + Turbo monorepo. `apps/auth` (`@lilnas/auth`) is the ForwardAuth provider: a NestJS
  backend on :8081 (`src/`, wired in `src/app.module.ts`) and a Next.js frontend on :8080
  (`src/app/`, `next.config.js`). Production runs two containers from `apps/auth/deploy.yml`:
  `auth` (backend, secrets, SQLite) and `auth-frontend` (no secret, no `env_file`, literal env
  only). `src/services/__tests__/frontend-isolation.spec.ts` enforces that; never weaken it.
- Traefik v3.7.15. Routers and middlewares are container labels in `apps/*/deploy.yml` and
  `infra/*.yml`. No new middleware name may contain `lilnas-auth`
  (`apps/dev/src/registry/compose-file.ts` treats that substring as gated). Do not edit
  `infra/proxy.yml`.
- Internal-route contract, fixed for every task. Callers send `Authorization: Bearer <token>`
  and read it from `AUTH_INTERNAL_TOKEN`. Auth holds one env var per caller:
  - `download`: `INTERNAL_TOKEN_DOWNLOAD`; scopes `admin-check` (`GET /admin/check`),
    `discord-link:read` (`GET /internal/discord-link`), `discord-identity:write`
    (`POST /internal/discord-identity`)
  - `icloud-backup`: `INTERNAL_TOKEN_ICLOUD_BACKUP`; scope `admin-check`
  - `dev`: `INTERNAL_TOKEN_DEV`; scope `host-activity:read` (`GET /internal/host-activity`)
  - `dev-idle-reaper`: `INTERNAL_TOKEN_DEV_IDLE_REAPER`; scope `host-activity:read`

  Auth rejects only when `INTERNAL_TOKEN_ENFORCE=true`; otherwise it allows and logs. `/verify`,
  `/strip-cookie` and `/health` never take a token.
- Tests: Jest, specs in `__tests__/` beside the source. Run only your own specs, e.g.
  `cd apps/auth && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm exec jest <paths> --maxWorkers=2`,
  and read the `Tests:` line. Never run jest without `--maxWorkers=2`, never the full
  `apps/download` suite, never two jest runs or docker builds at once: this machine is the
  production server.
- Lint: `pnpm --filter <pkg> lint` covers that package's `src` only. For any other file run
  `pnpm exec prettier -c <file>`; if it failed before your edit (most `deploy.yml`,
  `.env.example` and expose docs do), match the file's style and don't reformat the rest.
- Production is compose project `lilnas` in `/opt/lilnas`, deployed only by pushing to `main`
  (`docs/deploy.md`). Never run `docker compose up/down/restart/pull/build` against it. Never use
  `apps/auth/deploy.yml` in a test: it mounts the production database. Never push unless your
  task says to. Allowed on production: `docker compose -p lilnas ps|logs`, `docker inspect`,
  `docker logs`, and what your task names.
- Secrets: never print, log or copy `.env.keys`, a `*.decrypted` file, a token or a cookie value.
  Mask them in output.
- Throwaway containers: own network, unique name prefix, no published ports, test values only.
  Remove containers, networks, images and temp files before finishing and show the cleanup.
- No `any`. Report what you can't fix as `defects:` in your result.

## Done means
- The task's interfaces and edge cases are implemented as written; any deliberate difference is
  stated in the result with the reason.
- Every behaviour the task lists under Tests has a spec, and for each security-relevant one the
  result says how the spec was shown to fail when the behaviour is reverted.
- All `checks:` pass. A file outside a package's `src` that passed `prettier -c` at `base` still
  passes.
- Sign-in is untouched: no change under `apps/auth/src/auth/`, `apps/auth/src/app/login/` or
  `apps/auth/src/verify/verify.service.ts`, and no change to a cookie name or attribute.
- The public surface is unchanged: `apps/auth/next.config.js` rewrites exactly
  `/api/auth/:path*`, `/.well-known/openid-configuration`,
  `/.well-known/oauth-authorization-server` and `/api/sse/:path*`; no task adds a Traefik router
  or publishes a port; `auth-frontend` gains no env var, `env_file` or volume.
- `infra/proxy.yml` is not in any diff.
- A task with `files: []` commits nothing. A task that pushes reports the pushed sha, the
  rollback sha, the CI run URL, each check with its observed value, and the rollback steps.
- A task that creates throwaway containers, networks, images or temp files shows they are gone.
- No secret, token or cookie value appears in the diff or in a result; committed env files hold
  only `encrypted:` values.

## Planner notes
Research on 2026-11-26 at `main` ebedb27c.

- **Checks at base, in a clean worktree after `pnpm install --frozen-lockfile`:** all six pass.
  Jest at `--maxWorkers=2`: auth 943 tests in 10 s; utils `src/auth` 20; download `src/auth` 112;
  dev `src/activity` 21; icloud-backup `src/auth` 24. `@lilnas/download` type-check needs
  `@lilnas/media` built first. `pnpm lilnas secrets verify` runs in a clean worktree without
  `.env.keys`.
- **Prettier at base** fails on `infra/shared.yml`, `infra/media.yml`, `apps/auth/deploy.yml`,
  `apps/dev/deploy.yml`, `apps/download/deploy.yml`, every `.env.example`, `docs/lilnas-expose.md`
  and everything under `plugins/lilnas/skills/expose`. The prettier check lists only files that
  pass and that this plan edits.
- **Callers, found by grep and by reading each service:** `AuthClient`
  (`packages/utils/src/auth/client.ts`) is used by `apps/download` (`AdminCheckService`,
  `DiscordLinkService`) and `apps/icloud-backup` (`AdminCheckService`). `apps/dev`
  (`src/activity/host-activity.service.ts`) and `apps/dev-idle-reaper/reaper.sh` (curl) call
  `/internal/host-activity` directly. `tdr-bot` has no call to auth. Nothing under `~/dev`
  references these routes. The auth frontend calls only `/me`, `/requests/*` and `/admin/*` with
  the user's cookie, so it needs no token.
- **`apps/dev` and `apps/dev-idle-reaper` have no env file today.** Each gets a new
  `apps/<x>/.env.prod`, which shares `DOTENV_PUBLIC_KEY_PROD`, so no new private key and no host
  key copy. `dotenvx set` encrypts with only the public key line (tested on a scratch file; no
  stray `.env.keys` is written). Both containers hold the Docker socket, and `dev-dashboard`
  mounts `/home/jeremy/lilnas` read-only, which includes the dev checkout's `.env.keys`: a token
  does not contain a compromise of either. Follow-up, not in this run.
- **Traefik sees real client addresses:** 65 distinct prefixes in 6 h of access log; LAN clients
  appear as `192.168.x.x`. No proxy sits in front, so `ipstrategy.depth=0` is the right source.
- **Traefik docs for v3.7.15:** an empty `customrequestheaders.<Name>=` label removes the header;
  `inFlightReq` groups by `requestHost` unless a source criterion is set. Both are verified again
  in T3's rig, with the Docker provider.
- **The rig must stay invisible to the production Traefik**, which watches the same Docker
  daemon with `exposedByDefault=false`. Rig containers never carry `traefik.enable=true`; the rig
  Traefik uses `exposedByDefault=true` with a label constraint.
- **The main risk in the SSE cap** is a slot that is never released when the browser closes a
  stream behind the Next rewrite proxy. T3 tests that path with the real image.
- **emby:** unauthenticated responses set no cookie; the web client's API modules
  (`modules/emby-apiclient/*.js`, 4.10.1.0) contain no `document.cookie` and use local storage
  and `X-Emby-Token`. A signed-in session was not checked; H1 is the gate.
- **CI mapping** (`packages/cli/src/utils/ci-detect.ts`, `docs/deploy.md`): a change under
  `apps/<x>/` rebuilds `lilnas-<x>`; a change under `packages/utils` rebuilds every app that
  depends on it (eleven), so push 2 restarts nearly everything; a changed `apps/<x>/.env.prod`
  re-decrypts and `up -d`s the services that load it. Push 4 edits a spec and the README under
  `apps/auth`, so it also rebuilds and restarts auth.
- **Why code tasks sit after the previous push task:** a push task pushes its worktree `HEAD`, so
  anything merged before it ships with it. Never add work in parallel with a pending push.
- **Rollback:** push 1 and push 4 change labels, so roll back by reverting on `main`
  (`LILNAS_TAG=<sha>` changes the image only). Push 3 is one line in `apps/auth/deploy.yml`;
  under enforcement a caller with a bad token degrades (download hides attribution, the reaper
  does not reap, the dashboard shows "unknown", icloud-backup denies admin), it does not break
  sign-in.
- **Not verified by the planner:** that a thrown `HttpException` inside an async `@Sse` handler
  yields a plain 401 on Nest 12 (T2's HTTP-level spec proves it); whether `ipstrategy.depth=0`
  as a label alone selects the IP strategy (T3); that a task worktree's `HEAD` is the run branch
  tip (push tasks check the diff contents instead).
- **Possible follow-ups:** close an open stream when its session stops resolving; rocky-roads;
  PKCE for Immich; `cap_drop` and `no-new-privileges` on both auth containers; stop mounting the
  dev checkout's `.env.keys` into `dev-dashboard`.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-11-26 · T1 · done
- The `auth` router on auth-frontend now has `middlewares=auth-security-headers,auth-inflight`, plus the six middleware labels exactly as the task gave them. The comment above them covers: what each middleware is for; HSTS is for this host only; the in-flight limit is per IP and needs the ipstrategy line; headers come first so a 429 carries them. The backend `auth` service still has no traefik.* label.
- next.config.js returns `poweredByHeader: false` in every phase (one shared object). The rewrites are unchanged.
- deploy.yml volume comment now also has `chmod 700 … && chmod 600 …lilnas-auth.db*` and the reason. The existing `sudo chown` line is kept. Comment only.
- The new spec auth-router-hardening.spec.ts (backend project) parses the YAML the same way frontend-isolation.spec.ts does. Shown to fail when each behaviour is reverted: order swap 1 failed; ipstrategy removed 1 failed; stspreload added 1 failed; `lilnas-auth` in a name 4 failed; poweredByHeader removed 3 failed.
- All checks pass: lint and type-check; jest auth 955, utils 20, download 112, dev 21, icloud-backup 24; prettier; sh -n; secrets verify.
- No containers were created. Temp files: two /tmp backups, removed at the end of the revert run.

### 2026-11-26 · T2 · done
- /sse/pending: 401 JSON with no session, 400 when host is missing/empty/whitespace (both before any slot is taken), 429 'Too many open streams' at the cap, otherwise the same merged data + keepalive stream as before.
- /sse/admin: AdminGuard unchanged (401/403). The handler is now async, resolves the session again for the userId, and applies the same cap. One count per user, shared across both routes.
- SseStreamLimiter is provided in SseModule (module-local). The cap comes from SSE_MAX_STREAMS_PER_USER, read once at construction; only a positive integer is accepted, anything else means 6. Extras beyond the specified interface: `cap`, `trackedUsers()`, exported `parseMaxStreams`.
- Release is idempotent and bound to both finalize() on the returned Observable and req.once('close'). It is also released at once if req.socket is already destroyed. The map entry is deleted at zero.
- Client behaviour (pending-client.tsx and admin-dashboard-client.tsx read, not changed): a signed-out pending tab gets 401, the browser closes the EventSource for good, the error handler rechecks immediately and rebuilds every 5 s (each rebuild gets another 401), and the 30 s poll keeps running. It no longer gets an endless keepalive stream. A seventh tab gets 429 and behaves the same way until a slot frees, then its next 5 s rebuild gets a stream.
- Revert proof (specs failing of 42): no-session keepalive 2; cap removed 15; close-release removed 1; close+teardown release removed 13; non-idempotent release 4; blank host allowed 6. The limiter spec's fill() helper is bounded at 100 so a broken cap fails instead of hanging.
- Checks, all passing: builds plus utils/auth/download/dev/icloud-backup lint and type-check; auth jest 975/975; utils src/auth 20; download src/auth 112; dev src/activity 21; icloud-backup src/auth 24; prettier -c on the four listed files; sh -n reaper.sh; secrets verify exit 0.
- README env table was realigned by prettier (the new key widened the column). .env.example has no prettier parser, before and after.
- Temp dirs from the revert runs were removed. No containers were created.

### 2026-11-26 · T3 · done
- Live rig: 35 of 35 rows PASS, twice on the same image (hardening-rig-auth:86f2aef7, built once from this worktree with no other build or jest run going). Traefik v3.7.15, node v26.12.0.
- Main risk is clear: closing one SSE client through Traefik and the Next rewrite frees its slot. A new request was 200 after 5 ms, right after the 7th stream got 429. Extra row 4e: after all six are closed, six fresh streams open in 26 ms, so no slot leaks.
- Headers come only from Traefik; the frontend sets none of the four itself. They are on 200, 404 and the in-flight 429. HSTS is exactly max-age=31536000. No x-powered-by, direct or via Traefik.
- In-flight limit: with amount 3 and ipstrategy depth=0, client B (other IP) got 200 while A was refused. With the ipstrategy line removed, B got 429 too, which confirms the limit becomes global for the host without it.
- Cookie drop: `customrequestheaders.Cookie=` (empty value) removes every Cookie header on HTTP/1.1 cleartext, HTTP/1.1 TLS and HTTP/2 TLS, for cookies in one header or two, and on ws and wss upgrades. Authorization and X-Emby-Token arrive unchanged. The control router passes the cookies.
- Sign-in: POST /api/auth/sign-in/social returns 200 with an accounts.google.com URL. Only cookie set: __Secure-lilnas-auth.state.
- Production Traefik: 0 lines with `rig-` in `--since 5m` and 0 errors since rig start, checked after the rig came up and again after the matrix, in both runs.
- Two label changes beyond the task's list, both in labels.mjs: traefik.enable is dropped, and tls.certresolver=le becomes tls=true because the rig has no resolver.
- Case 3 holds open SSE streams, because an open stream counts as in flight until it closes. In production every open stream also counts against the 64-per-IP limit, well above the 6-per-user cap.
- echo.mjs now also reports authorizationPresent and embyTokenPresent, plus the values only with ECHO_VALUES=1. The cookie-rig README is updated to match.
- Teardown shown: 0 containers, networks, images or volumes named hardening-rig, and none named rig-; no /tmp/hardening-rig* left; image removed.
- Checks, all passing: builds plus lint and type-check for utils, auth, download, dev and icloud-backup. Jest: auth 987, utils src/auth 20, download src/auth 112, dev src/activity 21, icloud-backup src/auth 24. prettier -c on the four files, sh -n reaper.sh, secrets verify exit 0.
- No spec is added. The task is a live check and its result is the table above. The rig's own controls (ipstrategy removed, keep router) show it can fail.

### 2026-11-26 · H1 · approved
emby uses no cookies. Signed-in emby.lilnas.io shows only __Secure-lilnas-auth.session_token (.lilnas.io) in DevTools cookies. No Emby-owned DLL in emby/embyserver:4.10.1.0 contains a Set-Cookie string (only bundled .NET/ServiceStack libs). Emby gets the cookie-drop middleware in T13.

### 2026-11-26 · H2 · approved
Done. /storage/app-data/lilnas-auth is 700, lilnas-auth.db/-shm/-wal are 600. The October copy was moved (not deleted) to /storage/backups/lilnas-auth/ (dir 700, file 600). lilnas-auth-1 is Up (healthy); download.lilnas.io returns 302 to sign-in.

### 2026-11-26 · Phase 1 · review cycle 1
Pass 1 (T1): T1 adds exactly the seven required labels to auth-frontend in the required order, with an accurate comment. It also adds poweredByHeader: false to the shared next.config.js object, extends the volume comment while keeping the chown line (comment only), and adds a spec that covers all five required behaviours. No defects found.
Pass 2 (T2): T2 adds the 401/400 rejections before any stream starts, the per-user cap with 429 and an idempotent release from both teardown and request close, and the required unit and real-HTTP specs, as the task asked. No defects found.
Pass 3 (T3): T3's rig is sound. Every check fails when its behaviour is broken, labels.mjs copies the auth router labels from apps/auth/deploy.yml and stops on a missing line, the cleanup trap removes everything the rig creates, and no rig container carries traefik.enable. No defects found in this slice.
Seams pass: Seams pass over T1 (Traefik headers/in-flight labels, poweredByHeader), T2 (SSE 401/400, per-user stream cap) and T3 (live hardening rig). The rig's label rewriter, its expected values and T1's spec all match the deploy.yml labels as shipped. The rig's SSE cases match T2's statuses and default cap. No cross-task disagreement found.

Spec check:
- extra: acquire(userId) / openStreams(userId) interface (apps/auth/src/sse/sse-stream-limiter.service.ts) — Adds a cap getter, trackedUsers() and exported parseMaxStreams; no behaviour change.
- extra: echo.mjs as a backend that reports the headers it received (apps/auth/scripts/cookie-rig/echo.mjs) — Now also reports authorizationPresent and embyTokenPresent, plus the Authorization and X-Emby-Token values when ECHO_VALUES=1. Case 5 needs this. The cookie-rig README was updated to match.
- extra: close one client: within 5 s a new request is 200 (apps/auth/scripts/hardening-rig/client.mjs) — Adds row 4e: close all six and reopen six, to show no slot leaks. Not asked for, and harmless.
- unverifiable: traefik.http.middlewares.auth-inflight.inflightreq.sourcecriterion.ipstrategy.depth=0 makes the limit per source IP (apps/auth/deploy.yml) — Whether Traefik v3.7.15's label parser creates a non-nil IPStrategy from depth=0 alone (and so does not fall back to the request-host criterion) can only be shown live. T3's rig is meant to cover this; a person should confirm its result.
- unverifiable: Read them to confirm, and say in your result what a signed-out pending tab and a seventh tab now do (apps/auth/src/app/pending/pending-client.tsx, apps/auth/src/app/admin/admin-dashboard-client.tsx) — Not in the diff; a person should confirm the 5 s rebuild and 30 s poll the notes describe.
- unverifiable: Report a table of case, expected, observed ... Show the teardown (T3 result) — The table and the teardown output exist only in the run transcript. The task notes claim every row passed and teardown was clean in both runs. A person should check the run log.
- unverifiable: The run ships in four pushes ... (1) headers, x-powered-by, SSE limits (apps/auth/deploy.yml) — Whether the in-flight ipstrategy depth=0 groups by real client IP in production depends on Traefik seeing client RemoteAddr directly (no upstream proxy). The rig's control case shows the difference only in its own topology, so a person should confirm production's ingress path.

Declined to judge:
- deploy.yml comment says plain `chmod` with no sudo, though the files belong to UID 1000 — Comment only, and the wording comes from the task body. It works when the operator is UID 1000 and is obvious otherwise.
- The spec re-requires next.config.js once per phase without clearing the module cache — Harmless: nextConfig is a pure function of phase and the require only fetches it.
- The pending topic now uses the trimmed host instead of the raw query value — Matches the task's blank-host rule; it only differs for whitespace-padded hosts, which no real caller sends.
- Extra limiter surface: cap getter, trackedUsers(), exported parseMaxStreams — Test helpers with no behaviour change; the task notes list them.
- parseMaxStreams rejects forms like '1e3' and '+5' and accepts ' 12 ' — Within 'not an integer of at least 1 falls back to 6'; a style choice.
- README env table realigned by prettier — Formatting only; the prettier check passes.
- The production Traefik check looks for 'rig-' only in the last 5 minutes (`--since 5m`), and only at two points: once the rig is up and after the matrix — The task names that window. Production Traefik would only log rig label changes when the frontend restarts for case 3, and that happens within the last few minutes before the final check. The error search also covers everything since RIG_START.
- The two version-probe `docker run --rm` calls (traefik version, node --version) run on the default bridge network, not the rig network — They are short-lived, carry no labels and publish no ports. Neither Traefik routes them.

Checked:
- A new `middlewares` value on the auth router changes how the admin registry or the dev dashboard classifies auth.lilnas.io — apps/auth/src/services/service-registry.service.ts classify(); apps/dev/src/registry/compose-file.ts:110: Both classify only on the substring/element `lilnas-auth`. Neither new name contains it, so auth.lilnas.io stays 'none' (ungated), as before.
- next.config.js export shape: the spec calls require(...) as a function — apps/auth/next.config.js (tail): module.exports = nextConfig (a function with origin properties attached). All three phases return the same object literal, which now holds poweredByHeader: false.
- The in-flight limit keys on the wrong IP (a proxy or NAT in front of Traefik would make 64 effectively global) — infra/proxy.yml ports and forwardedHeaders: Traefik publishes 443:443 directly, with no proxyProtocol or trusted forwarded headers, so ipstrategy depth=0 keys on RemoteAddr, the real client IP under Docker's iptables DNAT. Internal callers and forwardAuth reach auth:8081 directly and never go through this router.
- An existing CSP or frame header from Next conflicts with the Traefik headers middleware, or an RP flow needs to frame auth pages — apps/auth/src, apps/auth/next.config.js: Nothing in the app sets a CSP or X-Frame-Options, and there is no iframe, check_session or prompt=none code, so frame deny breaks no known flow.
- frontend-isolation invariant: the backend `auth` service gains a traefik label — apps/auth/deploy.yml auth service: The diff adds no label to the auth service. The only changes there are comment lines above the volume.
- A thrown 401/400/429 from an async @Sse handler might be sent after SSE headers, as text/event-stream — apps/auth/node_modules/@nestjs/core router-response-controller.js sse(): Nest passes the handler promise into sse(), commits headers lazily and sends a rejection to the exception filter through fail(), so the answer is JSON. The HTTP spec asserts this.
- Nest's own teardown listens on request.socket close, while the controller binds req 'close'; the two could disagree across Node versions — router-response-controller.js; infra/base-images/lilnas-node-base.Dockerfile: Host Node v26.12.0 matches the image's node:26.12.0-slim, so the real-HTTP spec's cap and release results carry over to production.
- Client disconnects while resolveSession is pending: Nest marks the stream settled and never subscribes, so finalize never runs — apps/auth/src/sse/sse.controller.ts takeSlot: takeSlot releases at once when req.socket.destroyed, and req.once('close') covers later hang-ups. The release is idempotent.
- Check-then-act race in acquire across concurrent requests for one user — apps/auth/src/sse/sse-stream-limiter.service.ts: acquire is synchronous after the await, so no interleaving between the get and the set.
- AdminGuard in the HTTP spec uses a different AccessCacheService method than the fake provides — apps/auth/src/admin/admin.guard.ts:45: The guard calls resolveSession(req.headers.cookie), the only method the fake implements.
- env() throws for an unset SSE_MAX_STREAMS_PER_USER — packages/utils/src/env.ts: The '' default is used, so unset means '' and then 6, with no throw.
- Other code constructs SseController with the old two-argument constructor — apps/auth/src (non-test): None found; Nest DI injects it and SseModule provides SseStreamLimiter.
