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

- **Steering notes saved 2026-11-26 before a context clear:**
  - Run `nexus-run:dc68de9c-10d3-43a9-9767-e9fa8748ba33`, started 2026-11-26, strong tier at
    high effort, two tasks at a time. Planner session `9d2629e6-4044-4556-8cea-63a4f216aa1d`; the
    review that led here is Nexus session `13f81898-8ae2-4aba-a8d6-a2878e0849e3`.
  - State when saved: phase 1 done and reviewed with no defects; H1 approved (emby uses no
    cookies, so T13 includes emby); H2 approved (directory 700, files 600, October copy moved to
    `/storage/backups/lilnas-auth/`); H3 approved; T4 pushed 91445071 to `main` (rollback sha
    ebedb27c, CI green, all production checks passed); T6 done. Open: H4, T5, T7, then T8 and T9.
    No change request was open and no plan edit has been made since Start.
  - User decisions, all final: one token per caller, scoped; `download` keeps the write scope
    (asked, chosen over moving the write to tdr-bot); expose convention keeps `lilnas-auth` as
    the shipped default and public routes swap to `lilnas-cookie-strip` (asked, chosen over
    making cookie-strip the shipped default); strong tier for tasks and reviews (asked); HSTS on
    `auth.lilnas.io` only; immich unchanged; four pushes, an agent pushes after each go/no-go,
    humans roll back.
  - Defaults the planner picked without asking, reported to the user and not disputed: cap of 6
    streams per user, 64 in flight per source IP, HSTS one year without preload, client code
    unchanged, middlewares defined on the container that uses them.
  - Why the order is linear: a push task pushes its worktree `HEAD`. Any new task that edits code
    must be `after` the preceding push task (T4, T10, T12) or it ships early. A fix for something
    already pushed needs its own go/no-go and push, or must ride the next push on purpose.
  - Push tasks stop if `origin/main` moved. If that happens, do not have an agent merge or
    rebase; ask the user how to reconcile.
  - Ruled out, with reasons: an auth or forwardAuth middleware on turbo, emby or immich (clients
    cannot sign in; no dependency on auth uptime); defining the new middlewares in
    `infra/proxy.yml` (recreates Traefik); `${INTERNAL_TOKEN_ENFORCE:-true}` as a host kill
    switch (a stray host variable would silently reopen the routes; a bad token only degrades
    callers, so revert on `main` is fast enough); a waiting period between push 2 and push 3
    (the routes see almost no traffic, so T10 triggers each caller instead); a custom token
    header (pino already redacts `Authorization`); a Docker-provider rig with
    `traefik.enable=true` (the production Traefik would load its labels); changing
    `pending-client.tsx` to redirect a signed-out tab (sign-in behaviour must not change); `cap_drop`,
    `no-new-privileges` and Immich PKCE in this run.
  - T8 writes production secrets. It must never print a value, create a `.decrypted` file, or
    set `INTERNAL_TOKEN_ENFORCE`. If T8 has to be re-run, the tokens it wrote earlier are
    replaced as pairs; a half-written pair breaks that caller once push 3 enforces.
  - T10 and T12 probe `POST /internal/discord-identity` with body `{}` only (400). A valid body
    writes to the production roster.
  - Push 2 restarts the eleven apps that depend on `@lilnas/utils`. Push 4 recreates emby and
    restarts auth. Both go/no-go bodies say to pick a quiet time.
  - T9 and T3 leave nothing running. If the run is cancelled mid-task, check
    `docker ps -a | grep -E 'hardening-rig|rig-'` and `docker network ls | grep rig` and remove
    what is left by hand.
  - `/opt/lilnas` needs `git -c safe.directory=/opt/lilnas` to read. `gh` is authenticated.
  - Memory file `project_auth_hardening_plan_022.md` records the decisions; update it as the
    pushes land.
  - No open thread with the user.

- **2026-11-26, after the context clear:** C1 (from T5: token values and the enforce flag are not
  in its diff) resolved `no_change`: T8 writes the tokens and env wiring, T11 sets the flag. No
  plan edit. Seen while checking: `icloud-backup-db` also loads `apps/icloud-backup/.env.prod.decrypted`,
  so push 2 recreates that database container too and it receives `AUTH_INTERNAL_TOKEN` in its
  environment (it already holds every other icloud-backup secret). Not changed in this run.

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

### 2026-11-26 · H3 · approved
Approved.

### 2026-11-26 · T4 · done
Pushed 914450718990ea8b8912beedd61b456685db8c7f to main (fast-forward from ebedb27c).
Rollback sha: ebedb27c570a2bb1ed722beb569b54ba6a774d67.
CI run: https://github.com/codemonkey800/lilnas/actions/runs/45892634636 (green; build-images auth + deploy succeeded, image not held back).
Pre-push: origin/main ancestor OK; diff only apps/auth/** + docs/plans/** (20 files); deploy.yml has auth-security-headers/auth-inflight, next.config.js poweredByHeader:false, sse-stream-limiter.service.ts present; internal-token.guard.ts absent; ci detect -> image auth only.
Production:
- lilnas-auth-1 / lilnas-auth-frontend-1 recreated 20:44:29Z, healthy, image revision 91445071; auth logs 0 errors.
- Traefik: 24 ERR at 20:44:29-30Z only, all lilnas-auth@docker ForwardAuth failing to reach auth:8081/verify during the container restart (no such host / connection refused); none name the auth router or the new middlewares; none after.
- /login 200 with HSTS max-age=31536000, XFO DENY, nosniff, CSP frame-ancestors 'none', no x-powered-by.
- /api/sse/pending 401 in 0.023s; /api/sse/admin 401 in 0.019s.
- 20 parallel /login -> 20x200.
- /api/auth/ok 200, openid-configuration 200; /verify /strip-cookie /internal/host-activity /admin/check /me /health /requests/status all 404; sonarr 302 -> auth.lilnas.io/login?redirect=...
- sign-in/social google -> 200, accounts.google.com URL; cookie __Secure-lilnas-auth.state (Max-Age=300; Domain=.lilnas.io; Path=/; HttpOnly; Secure; SameSite=Lax), value masked.
All six plan checks pass (jest: auth 987/987, utils 20/20, download 112/112, dev 21/21, icloud-backup 24/24).
Temp files /tmp/t4-* removed; tree clean.
Rollback for the human: revert ebedb27c..91445071 on main and push; or backend only:
cd /opt/lilnas && sudo -u deploy env LILNAS_TAG=ebedb27c570a2bb1ed722beb569b54ba6a774d67 docker compose up -d auth

No commits: nothing to integrate.

### 2026-11-26 · T6 · done
AuthClient(baseUrl = 'http://localhost:8081', token = process.env.AUTH_INTERNAL_TOKEN).
- Token is read when the constructor runs (default parameter), so localInstance/dockerInstance read the env per call, never at import.
- A trimmed, non-empty token adds `Authorization: Bearer <trimmed>` after Content-Type. Otherwise no Authorization header, same as before.
- Decision: `token ?? env`. An explicit constructor token, even '' or whitespace, wins over the env. '' means "no header", not "fall back to env".
- Token is held in a JS private field (#authorization), so util.inspect and JSON.stringify of the client don't show it (spec covers this).
- Error messages are unchanged: 401/403 throw "<METHOD> <route> failed with <status> <statusText>". Callers (AdminCheckService, DiscordLinkService) untouched.
- The spec deletes AUTH_INTERNAL_TOKEN in a top-level beforeEach and restores it afterAll, so the existing exact-header assertions stay deterministic.
Proof each security-relevant spec fails when the behaviour is reverted (temporary edits, restored with git checkout on the file):
- header not sent: 8 failed
- no trim/blank check: 3 failed
- env token preferred over the constructor token: 1 failed
- token added to the error message: 2 failed
- env read once at import: 5 failed
- token stored in a public field: 1 failed
All six plan checks pass:
- jest: auth 987/987, utils 34/34, download 112/112, dev 21/21, icloud-backup 24/24
- prettier ok, sh -n ok, secrets verify exit 0
Temp logs /tmp/t6-* removed. No containers created.

### 2026-11-26 · T5 · done
- Guard reads the env per request: tokens, minimum length, shared-value check, and INTERNAL_TOKEN_ENFORCE === 'true'. onModuleInit logs one error per group of callers that share a token (names only, never the value) and never throws.
- Header must match /^bearer ([^\s]+)$/i. No header is `missing`. Anything else is `invalid`, including an empty header value, two spaces, or a trailing word.
- Matching: SHA-256 of the presented token against every configured caller with crypto.timingSafeEqual, no short-circuit. A handler without scope metadata is `forbidden`. The log line has the contract fields; caller is null unless matched; remoteAddress comes from req.socket.remoteAddress. Authorization was already redacted by logger.config.ts.
- Deliberate difference: a successful POST /internal/discord-identity returns 201 (Nest's POST default, unchanged), not 200. The specs assert 201.
- Verify: /verify with no session still returns 302 while enforcing. /health and /strip-cookie return 200 with no internal-auth log line.
- Mutation evidence (each applied to the guard alone and reverted; failures in the two new spec files): enforce on any set value 8, no length check 2, no duplicate disabling 3, no scope check 21, unscoped handler allowed 4, case-sensitive scheme 3, loose shape 3, 401 instead of 403 4… actually 11, observe mode rejecting 23, header in log line 1, startup throw on duplicates 1. Swapping timingSafeEqual for === cannot be seen in behaviour, so it is checked by review only.
- README: new "Internal routes" section (caller/scope tables, header, observe/enforce, adding a caller), 5 env rows, Residual risk paragraph updated. Prettier re-padded the existing env table columns.
- Temp files /tmp/t5-c1.log and /tmp/t5-c2.log removed. No containers were created.

### 2026-11-26 · T7 · done
apps/dev: fetchActivity reads env(AUTH_INTERNAL_TOKEN, '') and sends
`Authorization: Bearer <token>` only when non-empty. Any non-200 (401/403
included) returns null and isn't cached. New specs: header when set, none
when unset, none when empty, 401/403 -> null and retried on the next call
(it.each). Revert checks: with `headers,` removed from the fetch, 1 spec
fails (the set case); with `token !== undefined` in place of the truthy
check, 2 fail (unset and empty). dev jest 26/26.
reaper.sh: AUTH_INTERNAL_TOKEN="${AUTH_INTERNAL_TOKEN:-}" sits beside
AUTH_URL. With a token, fetch_host_activity runs
`printf 'header = "Authorization: Bearer %s"\n' "$AUTH_INTERNAL_TOKEN" | curl --config - ...`
(printf is a builtin); without one, the curl call is the old one unchanged.
The startup log says `auth token set|unset`, never the value. The header
comment describes the token and 401/403.
Live check of the function copied from the file, against a throwaway node
listener on 127.0.0.1 (2s delayed reply; random test token read from a
file):
- set: curl argv `curl -s --max-time 5 --get -w \n%{http_code} --config - --data-urlencode host=a.dev.lilnas.io --data-urlencode hours=2 http://127.0.0.1:<port>/internal/host-activity`;
  the listener saw `Bearer <24 chars>` matching the token; 0 processes had
  the token in ps args.
- unset: the same argv without `--config -`; the listener saw no
  Authorization header; 0 processes had the token.
- 401 listener: fetch_host_activity returns 1.
Listeners killed, /tmp/t7-* removed, no leftover node process
(pgrep -x node checked). sh -n passes.
Decision: no escaping of `"` or `\` in the token for the curl config line.
Tokens are expected to be hex/base64url; a token containing those
characters would break the config parse, curl would fail, and the unit
would simply not be reaped.
Not done here (not this task's files): apps/dev-idle-reaper/deploy.yml and
apps/dev/deploy.yml don't pass AUTH_INTERNAL_TOKEN yet (literal
`environment:` lists, no env_file), so production behaves as before until
the wiring task adds it.
All six checks pass: lint/type-check groups rc=0; jest auth 987/987, utils
20/20, download 112/112, dev 26/26, icloud-backup 24/24; prettier clean;
sh -n ok; secrets verify rc=0.

### 2026-11-26 · T8 · done
Four tokens from `openssl rand -hex 32`. Each was set in one shell function with
the value only in a variable (unset afterwards), into auth's INTERNAL_TOKEN_* and
the caller's AUTH_INTERNAL_TOKEN. INTERNAL_TOKEN_ENFORCE is in no .env.prod.
Verification (lengths and counts only):
- secrets verify exit 0, 21 files discovered.
- grep -c encrypted: is 1 for each of the 8 keys.
- dotenvx get length is 64 for all 8.
- All 4 pairs are equal; 4 of 4 tokens are distinct (sha256 compared in the shell).
- git status shows no .env.keys or .decrypted file.
- ci detect: decrypt true; decryptServices has auth, download, icloud-backup,
  dev-dashboard and dev-idle-reaper, and not auth-frontend or icloud-backup-frontend.
Compose:
- apps/dev/deploy.yml: dev-dashboard has `env_file: [.env.prod.decrypted]` in the
  file's list style. The header comment now names AUTH_INTERNAL_TOKEN as its one secret.
- apps/dev-idle-reaper/deploy.yml: same env_file, with a comment that it carries
  the auth token.
- No other compose file changed.
New files: each starts with the 5-line dotenvx header and public-key line copied
verbatim from apps/download/.env.prod, shared PROD key. No new private key.
Docs: docs/deploy.md count 19 -> 21, and the apps/{...} list now includes dev and
dev-idle-reaper.
Fix outside the plan's jest paths: apps/icloud-backup/src/__tests__/deploy.spec.ts
checks the exact key list of icloud-backup's .env.prod. It failed (1 failed)
after AUTH_INTERNAL_TOKEN was added and now expects five keys; 54/54 pass.
All plan checks pass:
- c1 and c2 rc=0.
- jest auth 1085/1085, utils 34/34, download 112/112, dev 43/43 (activity +
  registry), icloud-backup 54/54; cli compose-include-env + ci-detect 74/74.
- prettier ok, sh -n ok, secrets verify rc=0.
Temp logs /tmp/t8-* removed. No containers were created. No .decrypted file was
created.

### 2026-11-26 · T9 · done
Live check: 78/78 rows PASS, 0 FAIL, no defects. Every production caller keeps access once enforcing,
as long as it holds its own token.
- Rig: new apps/auth/scripts/hardening-rig/tokens.sh + tokens-client.mjs (README "Internal tokens" section).
  The existing rig.sh is Traefik-specific, so this is a separate script beside it. It has no Traefik and
  no traefik.* labels. It runs the backend with INTERNAL_TOKEN_ENFORCE=true, then restarts it without
  the variable.
- Needs packages/utils/dist and apps/dev/dist built first (header and README show the commands).
  apps/dev/dist comes from `nest build -b swc`; the built HostActivityService is required unmodified.
- Reaper check uses the local ghcr.io/codemonkey800/lilnas-dev-idle-reaper:latest image (alpine 3.24.2,
  curl, jq) with entrypoint sh and no Docker socket. Plain alpine:3.24 has no curl or jq, and apk would
  need network access. fetch_host_activity is copied verbatim from reaper.sh with sed.
- Tokens are new per run (openssl rand -hex 32). They reach the backend via --env-file and the
  clients/reaper via read-only token files, never on a command line.
- Observed:
  - enforcing: icloud register gives 403; no token or a wrong token gives 401 on all three
    AuthClient methods; HostActivityService with no token gives null; reaper with no token or the
    download token gives rc=1.
  - observing: all of those succeed.
  - both modes: 16 internal-auth lines for 16 requests, each with the expected
    outcome/caller/scope/enforced; 0 log lines contain a token or a bearer value; /health 200,
    /verify 302 to /login, /strip-cookie 200, none logged by the guard.
- Spec-revert evidence: not applicable. This task adds a live check script, no specs or behaviour.
- Teardown shown: containers 0, networks 0, image 0, temp dir gone. apps/dev/dist and /tmp/t9-*
  removed too.
- Checks: both lint/type-check groups rc=0; jest auth 1085/1085, utils 34/34, download 112/112,
  dev 26/26, icloud-backup 24/24; prettier ok; sh -n ok; secrets verify rc=0.

### 2026-11-27 · H4 · approved
Approved.

### 2026-11-27 · Phase 2 · review cycle 1
Pass 1 (T6): T6 implements the AuthClient bearer token as specified: header sent only for a non-blank trimmed token, env read per construction, error messages, timeout, Content-Type and signatures unchanged, and specs cover every listed case. One P2: a token with an embedded CR/LF/NUL makes fetch throw a TypeError whose message quotes the full header value, which the callers log.
Pass 2 (T5): T5's InternalTokenGuard, caller/scope tables, controller wiring, EnvKeys, README and both specs match the task body and the Context contract. I found no defects in this slice: observe mode never rejects, enforce mode returns 401/403 as specified, the comparison is constant time over SHA-256 digests with no short-circuit, and the startup check logs instead of throwing.
Pass 3 (T7, T8, T9): Pass 3 (T7, T8, T9) is clean: T7's dashboard and reaper send the bearer only when set and still treat any non-200 as a failure; T8 wires encrypted tokens and env_file only on the backend-side services; T9's rig exercises the real clients in both modes. One P2: the dev dashboard's production dev token now reaches every compose child it spawns.
Seams pass: Seams pass over T5 to T9 found no disagreements. The bearer header format, the four INTERNAL_TOKEN_* names in env.ts, internal-callers.ts, apps/auth/.env.prod and .env.example, AUTH_INTERNAL_TOKEN on all five callers, and the env_file wiring for the two new dev and dev-idle-reaper env files all agree.
Consolidation: Consolidated four passes over T5–T9: two distinct P2s (token leak via fetch's invalid-header error for a token with control characters; dev dashboard forwards AUTH_INTERNAL_TOKEN to spawned compose processes), no P0/P1. One cross-pass suspicion on trim asymmetry between AuthClient and the guard.

Notes:
- F1 · P2 · Malformed token leaks via fetch's invalid-header error — packages/utils/src/auth/client.ts:26
- F2 · P2 · Dev dashboard passes its auth token into every compose process it spawns — apps/dev/deploy.yml:22

Suspicions:
- AuthClient trims the token; the guard compares the raw configured value — packages/utils/src/auth/client.ts:25 · bearerFor() sends token.trim(), but resolveCallerConfig() in apps/auth/src/internal/internal-token.guard.ts hashes INTERNAL_TOKEN_* untrimmed, and dev/reaper send the raw value. A stored value with surrounding whitespace on either side would never match, and the mismatch only shows once enforcement is on (observe mode would log it as 'invalid'). · confirm by: Check the T8-generated values hold no whitespace (dotenvx decrypt output) and watch observe-mode logs for 'invalid' lines after push; or make both sides agree on trimming.

Spec check:
- unverifiable: Every request carries Authorization: Bearer <token> (apps/download, apps/icloud-backup deploy env) — This only works once AUTH_INTERNAL_TOKEN is set in each caller's container on the host.
- unverifiable: INTERNAL_TOKEN_ENFORCE prod value: 'set in deploy.yml' (apps/auth/deploy.yml) — For this push, confirm it stays unset or not 'true' so the guard remains in observe mode.
- unverifiable: The real AuthClient ... with the download token: checkIsAdmin resolves (apps/auth/scripts/hardening-rig/tokens-client.mjs) — The rig passes tokens via the constructor; production's dockerInstance env path is covered only by unit specs. Confirm after deploy.
- unverifiable: decryptServices containing auth, download, icloud-backup, dev-dashboard and dev-idle-reaper (CI deploy on the host) — Only the push's CI run shows whether apps/dev and apps/dev-idle-reaper get .env.prod.decrypted before their services are recreated.

Declined to judge:
- Spreading options.headers in AuthClient assumes a plain object (a Headers instance would be dropped) — This predates the diff, and no method passes a Headers instance.
- Explicit '' constructor token suppresses the env fallback — A deliberate decision in the task notes, consistent with 'constructor token wins', and tested.
- discord-internal.controller.ts comment still names apps/tdr-bot as a caller of /internal/discord-link — The line predates the diff; grep finds no tdr-bot caller. Doc nit only.
- timingSafeEqual vs === is not distinguishable by a spec; info log line on every ok request — The comparison was checked by reading (both sides hashed, no early break); the task body requires one log line per guarded request.
- Reaper curl config line does not escape quotes or backslashes in the token — T7's notes record this decision. Tokens are openssl hex, and a bad token only skips one poll.
- tokens.sh: trap 'exit 130' ends with STATUS=1; the pgrep guard can match any 'jest' process — Cosmetic or fail-safe behaviour in throwaway test tooling.
- Seams pass: logic inside each slice — Out of scope for seams; passes 1–3 covered it.

Checked:
- Callers of AuthClient read the token at the right time — apps/download/src/auth/*.service.ts, apps/icloud-backup/src/auth/admin-check.service.ts: All use the AuthClient.dockerInstance getter as a class field, so the env is read at service construction after it is loaded; no other code calls new AuthClient with arguments.
- Spec env/mocks leak between tests — packages/utils/jest.config.js: restoreMocks is true; the spec deletes AUTH_INTERNAL_TOKEN in beforeEach and restores it afterAll.
- Some other app calls the internal routes but is missing from the contract table — apps/*, packages/utils/src/auth/client.ts: The only callers are download/icloud-backup via AuthClient, apps/dev host-activity.service.ts and reaper.sh; tdr-bot and tdr-code do not call these routes.
- Token guard spreads to routes that must stay open — apps/auth/src/internal/__tests__/internal-token.guard.spec.ts, internal-token.guard.http.spec.ts: The guard is class-level on the four controllers only; while enforcing, /health 200, /strip-cookie 200 and /verify 302, with no internal-auth log line.
- Token or Authorization header reaches logs via the guard line or pino-http — apps/auth/src/internal/internal-token.guard.ts; HTTP spec 'never logs a token': The guard line carries only contract fields; the spec with the real pinoHttpOptions asserts no token or 'Bearer' appears.
- Shared/short token handling and the never-throw-at-boot rule — resolveCallerConfig, onModuleInit: Values unset or under 32 characters are skipped; a shared value disables its whole group with one names-only error; onModuleInit never throws.
- Status codes for allowed requests change — HTTP spec 'not enforcing' block: Unchanged; the POST 201 is Nest's existing default.
- Header format agrees between callers and the guard — client.ts, host-activity.service.ts, reaper.sh, internal-token.guard.ts: All send 'Authorization: Bearer <token>', which /^bearer (\S+)$/i accepts; the reaper pipeline status is curl's, so || return 1 still fires.
- Env var names and env_file wiring agree across T5–T8 — apps/auth/src/env.ts, internal-callers.ts, apps/*/.env.prod, apps/{dev,dev-idle-reaper}/deploy.yml: Four INTERNAL_TOKEN_* names match; INTERNAL_TOKEN_ENFORCE is absent from .env.prod (observe mode holds); every caller has AUTH_INTERNAL_TOKEN; dev and the reaper gain env_file; frontends are unchanged.
- env('AUTH_INTERNAL_TOKEN', '') throws when unset; reaper image bakes in the decrypted env — packages/utils/src/env.ts, apps/dev-idle-reaper/Dockerfile: env uses ?? default and returns ''; the Dockerfile copies only reaper.sh.
- New env files found by deploy decrypt; pinned specs updated — docs/deploy.md, .gitignore, apps/icloud-backup/src/__tests__/deploy.spec.ts: apps/*/.env.prod discovery covers the new files, *.decrypted is gitignored, and the icloud spec was updated to five keys.
- Production token leaks into dev stacks via spawned compose — apps/dev/src/compose/compose-runner.service.ts:151: The env is passed through; no compose file references the token today (reported as P2).

### 2026-11-27 · H5 · approved
Approved.
