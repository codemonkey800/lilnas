# tdr-code Phase D — forward-auth removal cutover runbook

**Why this document exists:** Phase D's plan
(`docs/plans/2026-07-02-001-feat-tdr-code-phase-d-auth-plan.md`, Implementation Unit U7) makes
`@lilnas/tdr-code` the sole security boundary in front of a `claude` agent running
`--dangerously-skip-permissions` that can commit and push as real users. Removing the Traefik
`forward-auth` middleware is therefore the single highest-risk step in the whole phase: get the
ordering wrong and the control surface (most sharply `PUT /config`, which is RCE-equivalent — see
the plan's Problem Frame) is briefly or permanently public. This runbook is what a human operator
follows to execute that removal safely.

**Relationship to the other Phase D runbook — read that one first, or alongside this one:**
`docs/runbooks/tdr-code-phase-d-cutover-verification.md` (created by U5) is the **manual
Discord-OAuth verification checklist** — sign in as a real guild member, attempt sign-in as a real
non-member, confirm the HTTP experience is correct. That checklist is designed to run **while
`forward-auth` is still in place**, as a precondition to this runbook. This document does **not**
duplicate that checklist's steps; wherever this runbook's Go/No-Go gate needs "a guild member signs
in end-to-end" or "a non-member is rejected," it points back at that checklist rather than
re-describing the click-through. This document instead covers what U5's checklist does not: the
`deploy.yml` label removal itself, the deploy-race sequencing, Traefik's runtime confirmation, the
post-cutover external sweep, rollback, and ongoing monitoring.

**This runbook is a precondition-driven procedure, not a feature.** Everything in the plan's
"Operational / Rollout Notes" section (Go/No-Go gate, cutover runbook steps, rollback triggers,
break-glass procedures) is the source of truth this document turns into an actionable, fill-in-the-
blanks checklist. Where this document paraphrases the plan, the plan's own prose is authoritative if
the two ever disagree — treat that disagreement as a bug in this document, not in the plan.

---

## 0. Scope and what this runbook does NOT cover

- **In scope:** the one-line `forward-auth` label removal in `apps/tdr-code/deploy.yml`, the deploy
  sequencing around it, Traefik runtime confirmation, the post-cutover external sweep, rollback, and
  the ongoing Loki monitoring query.
- **Out of scope — do not invent these while executing this runbook:**
  - Any systemd/pm2/process-supervisor change. Phase A's tmux-pane process model
    (`docs/plans/2026-06-29-001-feat-tdr-code-two-process-substrate-plan.md`) is an accepted scope
    boundary through this phase — the main server and bot run in a manual `tmux` pane
    (`pnpm start` / `run-p main + frontend`) on the deploy host, recovered by hand if it dies. This
    runbook's cutover step does not change that.
  - Any change to `infra/proxy.yml`, `apps/tdr-code/deploy/nginx.conf`, or the shared `forward-auth`
    service/middleware definition. Those stay exactly as they are for every other lilnas app; only
    tdr-code's own label is removed.
  - Creating an `infra/.env.tdr-code` file. See §1 below for why this file does not exist and should
    not be created.

---

## 1. Prerequisites

### 1.1 The real secrets-provisioning mechanism (read this before looking for a Docker env file)

Every other lilnas app has both `infra/.env.<app>` and `infra/.env.<app>.example`, consumed via
`env_file:` in that app's compose service. **tdr-code has neither, and creating one would be
misleading** — nothing in tdr-code's code would ever read it.

`apps/tdr-code/deploy.yml`'s only compose service is `image: nginx:alpine` — a reverse-proxy
container with no `environment:`/`env_file:` section at all. It proxies to
`host.docker.internal:8080`. The actual NestJS (`:8082`) and Next.js (`:8080`) processes run
**directly on the host** (in a `tmux` pane, per Phase A), not inside this container. `src/main.ts`
and `src/bot-main.ts` both call `dotenv.config()` at startup, which loads a `.env` file from the
process's **current working directory** — this is the same mechanism already used in dev via
`apps/tdr-code/.env`.

**So: in production, populate a `.env` file at the tdr-code host process's working directory** (the
directory `pnpm start` is run from inside the tmux pane), using `apps/tdr-code/.env.example` as the
template — not a `docker-compose`-consumed file. This is a pre-existing Phase A architecture
decision, not something this runbook redesigns.

### 1.2 Discord OAuth application

- [ ] Register a Discord OAuth application, or reuse the bot's existing Discord Application's
      OAuth2 page (Application → OAuth2 → Client information). Either way, the OAuth **client
      secret** must be distinct from `DISCORD_API_TOKEN` (the bot's gateway token) — they are
      different credentials on the same or a different Application.
- [ ] Add the redirect URI `https://tdr-code.lilnas.io/api/auth/callback/discord` to the OAuth
      application's registered redirect URIs. It must be **byte-identical** — this is the plan's
      origin-config-parity requirement (§1.3 below); a trailing slash or `http`/`https` mismatch
      breaks the callback.
- [ ] Generate `BETTER_AUTH_SECRET` — a random secret, **not** something Discord issues, with
      `openssl rand -base64 32`.
- [ ] Place all four values (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `BETTER_AUTH_SECRET`,
      `BETTER_AUTH_URL=https://tdr-code.lilnas.io`) into the host's `.env` file per §1.1. Do **not**
      commit this file; `apps/tdr-code/.env.example` documents the keys (including this exact
      procedure, see the note it now carries) without real values.

### 1.3 Origin-config parity (four places that must agree)

Per the plan's Operational Notes, the app origin must agree in all four of:

1. `ALLOWED_CONSOLE_ORIGIN` (env; defaults to `https://tdr-code.lilnas.io` if unset — confirm this
   default is correct for the deploy target rather than relying on it silently).
2. Better Auth `baseURL`/`trustedOrigins` (`apps/tdr-code/src/auth/auth.ts`).
3. The Discord Developer Portal redirect URI (§1.2 above).
4. The frontend auth client `baseURL` (`apps/tdr-code/src/app/lib/auth-client.ts`, `/api/auth`).

If any of these drift, expect either OAuth failures or `requireSameOrigin()` rejecting legitimate
same-app requests. Re-confirm all four before proceeding past §1.

### 1.4 forward-auth is still attached

- [ ] Confirm `apps/tdr-code/deploy.yml` still carries
      `- traefik.http.routers.tdr-code.middlewares=forward-auth` at this point. Everything through
      §3 below happens **with the edge gate still live** — it is the safety net while the app-owned
      gate underneath it is validated.

---

## 2. The Go/No-Go gate

All of the following must be **TRUE**, checked with the `forward-auth` label **still present**, from
**inside the network** (so forward-auth's own SSO gate doesn't mask whether the app itself would
deny an unauthenticated caller):

| #   | Check                                                                                                                                        | How to verify                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | Unauthenticated request → **401** on **every** enumerated route, including the reads with no same-origin backstop (`reconcile`, `sessions`). | Run `pnpm --filter @lilnas/tdr-code test -- auth-e2e` (the U5 harness) against the deployed build, or replicate its sweep with `curl` against each entry in `apps/tdr-code/src/auth/protected-routes.ts`.                                  |
| B   | The allowlist is exactly `GET /health` — nothing else is public.                                                                             | Same source: `apps/tdr-code/src/auth/protected-routes.ts`'s `PUBLIC_ROUTES` export is the single-entry source of truth; confirm no other route responds without a session.                                                                 |
| C   | A guild member completes the full OAuth flow and reaches a guarded read.                                                                     | **Do not re-derive this here** — run `docs/runbooks/tdr-code-phase-d-cutover-verification.md` §2 ("Sign in as a real guild member") and record its own Run Log entry.                                                                      |
| D   | A non-member is rejected with no working session.                                                                                            | **Do not re-derive this here** — run `docs/runbooks/tdr-code-phase-d-cutover-verification.md` §3 ("Attempt sign-in as a real non-member Discord account").                                                                                 |
| E   | Expired/tampered cookie → 401, not 500.                                                                                                      | Covered by the U5 automated harness (`auth-e2e.spec.ts`); no manual step needed if that suite is green.                                                                                                                                    |
| F   | Secrets + Discord redirect URI provisioned — **proven by C, not by "the file exists."**                                                      | C above only succeeds if the secrets and redirect URI are actually correct; a green C is the proof.                                                                                                                                        |
| G   | Main server boots clean with the new env; a missing secret fails fast (not a silent partial-auth boot).                                      | Restart the host process (tmux pane) after populating `.env` (§1.1) and confirm clean boot logs — no unhandled startup exception.                                                                                                          |
| H   | The one-line rollback diff is pre-staged and forward-auth's upstream is healthy.                                                             | Have the reverted `deploy.yml` (with the label restored) ready to apply — see §5. Confirm `infra/proxy.yml`'s `forward-auth` service is itself currently healthy (unrelated outages there would make the rollback path itself unreliable). |

**Any red = No-Go.** Do not proceed to §3 until every row above is green and both prerequisite
runbooks (`cutover-verification.md` steps 1–4, and this gate) are recorded in their respective Run
Logs.

---

## 3. Cutover runbook steps

Execute in this exact order. Each step exists specifically to close one of the residual windows the
plan calls out — do not reorder or skip.

1. **Deploy the guard-carrying image with the label still present.** The image/build being deployed
   must already contain U1–U6 (the auth schema, mount, guild gate, guard, and login UI) — this
   should already be true if the Go/No-Go gate in §2 passed, but re-confirm the running build is not
   a stale cached image (see step 3).
2. **Confirm the app itself denies, behind the still-live edge gate.** This re-runs Go/No-Go check A
   from inside the network — the app must already be behaving correctly while `forward-auth` is
   still doing its own independent gating in front of it. This is what closes the "old guardless
   image" window: if the app were still running a pre-U4 build, this step would show 200s instead of
   401s, and you'd catch it before ever touching the label.
3. **Confirm the running build via image digest / boot log line, not a cached `monorepo-builder`
   image.** Per this repo's CLAUDE.md, `lilnas-monorepo-builder` snapshots source code at build
   time — a stale cache can silently serve old code after what looks like a successful deploy. Check
   the actual running container's image digest or a boot-time log line that identifies the commit,
   not just "the deploy command exited 0."
   - **Also confirm the host process, not just the container.** The guard runs in the _host_
     main-server process (§1.1), which the container Traefik sees does not control. Confirm the tmux
     pane's `pnpm start` is running the guard-carrying build and is healthy **immediately before**
     the label removal in step 4, and avoid any concurrent host redeploy/restart while executing
     steps 4–6.
4. **Remove the one `forward-auth` label.** In `apps/tdr-code/deploy.yml`, delete exactly:
   ```yaml
   # forward-auth stays until Phase D (Better Auth + guard cutover).
   - traefik.http.routers.tdr-code.middlewares=forward-auth
   ```
   (This is the change already staged in this unit's working tree — confirm the diff matches before
   applying it to the real deploy target; see §7 "What this unit changed in the repo.")
5. **Redeploy.** Apply the compose change so Traefik picks up the label removal.
6. **Confirm via Traefik's own runtime view — not just that the file changed — that the router's
   middleware chain is empty.** Open Traefik's dashboard or query its API for the `tdr-code` router
   and confirm:
   - Exactly **one** `tdr-code` router exists (silent `Host()` shadowing between `tdr-code` and the
     reserved `tdr-bot` router is a documented hazard per
     `docs/solutions/architecture-patterns/expose-external-compose-via-lilnas-proxy-2026-06-25.md`).
   - That router's middleware chain is now **empty** (no `forward-auth` entry).
   - Traefik's label reload is not instantaneous — poll until this is confirmed rather than assuming
     the redeploy command completing means Traefik has already picked it up.
7. **External anonymous sweep confirms app-sourced 401s, not forward-auth SSO redirects.** From
   outside the network (a real anonymous client hitting `https://tdr-code.lilnas.io`), confirm:
   - Sensitive routes (start with the reads with no same-origin backstop: `GET /sessions`,
     `GET /sessions/:id/reconcile`) return a **401 with an app-sourced body** (Better Auth / Nest
     JSON) — **not** a redirect to forward-auth's SSO login page. A redirect here means the cutover
     did not actually take (Traefik is still routing through the old middleware, or the label removal
     didn't reach the live router) — treat it as a Go/No-Go-equivalent hard stop, not a cosmetic
     detail.
   - `GET /api/health` returns 200 with no cookie.
   - An old, pre-cutover `forward-auth` SSO cookie (if you have one from before this runbook)
     grants **no** app access — the app must ignore it and 401, forcing a real Discord sign-in.
8. **A member signs in through the real edge.** This is the operator's own sign-in, through the now
   fully-cutover public URL — not the pre-cutover verification runbook's sign-in (which ran with
   `forward-auth` still up as a safety net). Confirm you land on a guarded page with real data. This
   is also the check for the plan's named self-lockout risk: **you** are the operator running this
   cutover, and right after cutover nobody has an app session yet (the pre-cutover forward-auth SSO
   session grants nothing per step 7's third bullet) — do this step yourself, immediately, rather
   than assuming "someone" will eventually confirm it.

---

## 4. Post-cutover confirmation summary

Restating step 7 and 8 above as a single pass/fail table for the Run Log (§8):

- [ ] Sensitive routes 401 with an app-sourced body (not an SSO redirect) to an anonymous external
      caller.
- [ ] `GET /api/health` is 200 to an anonymous external caller.
- [ ] A stale forward-auth SSO cookie grants no access.
- [ ] The operator's own Discord sign-in works through the real, fully-cutover edge.

---

## 5. Rollback procedure

**Trigger conditions (pull fast — do not wait to "see if it's a fluke"):** any sensitive route
returns 200 to an anonymous external caller; a member cannot sign in; the container healthcheck
flips unhealthy or `/api/health` starts 401/500-ing; the main server crash-loops.

**Procedure:**

1. Re-add the single label to `apps/tdr-code/deploy.yml`:
   ```yaml
   # forward-auth stays until Phase D (Better Auth + guard cutover).
   - traefik.http.routers.tdr-code.middlewares=forward-auth
   ```
2. Redeploy.
3. Confirm in Traefik's runtime view (dashboard/API, per §3 step 6) that the `forward-auth`
   middleware is back on the `tdr-code` router — not just that the file was reverted.

**No DB rollback is needed.** This unit changes only a label and env values; it runs no migration.
Migration `0007` (the auth tables, from U1) stays in place regardless of whether the label is on or
off. Keep this _cutover rollback_ (the label) distinct in your head from a _code rollback_ of
U1–U6 — reverting the U1 migration is a heavier operation this procedure does not cover.

### 5.1 The label rollback only fixes "auth absent" — not "auth present but broken"

This is the plan's own load-bearing nuance, restated here because it's easy to reach for the label
rollback reflexively and then be surprised it didn't help: re-adding `forward-auth` restores the
**edge** gate, but the app's own hand-rolled guard still runs underneath it and still 401s — it does
not trust the forward-auth cookie, by design (that's the whole point of app-owned auth). So if the
actual failure is "auth is present but broken" — `getSession` 500s under load, the cookie's
`secure`/domain attributes are wrong so nobody can ever hold a session, or the Discord guild scope
is mis-provisioned — re-adding the label does **not** restore console access. Everyone, including
the operator, is still locked out by the app's own (broken) guard.

For that failure mode, the plan names two options. **This unit documents both as follow-up options
and does not implement either — see the rationale below.**

- **Option 1 — an env-gated `AUTH_DISABLED=true` fallback**, wired so the global guard falls back to
  allow **only when the `forward-auth` label is simultaneously re-added** (never on its own, so a
  misconfigured `AUTH_DISABLED` alone can never expose the app to the internet). Verified absent from
  the codebase today (`grep -rn AUTH_DISABLED apps/tdr-code/` returns nothing) — this is a genuinely
  new mechanism, not something already stubbed out.
- **Option 2 — a documented fast `git revert` of U4/U6** (the guard and the login UI) that explicitly
  does not touch migration `0007`, falling back to the pre-Phase-D unauthenticated console behind a
  re-added `forward-auth` label.

**Why this unit does not implement Option 1:** `AUTH_DISABLED` is a new security-relevant code path
— it would need its own test coverage proving the "only together with the label" invariant actually
holds (a misimplemented version of this is itself a vulnerability: a guard that silently allows
everything whenever an env var typo sets `AUTH_DISABLED` to a truthy-looking string is worse than no
break-glass at all). Building and verifying that safely is implementation work beyond this unit's
"code + documentation only" scope and beyond a single unit's worth of net-new surface this late in
the plan. **A genuinely useful middle ground already exists in the shipped U4 work and needs no new
code:** `POST /auth-admin/users/:discordUserId/revoke-sessions`
(`apps/tdr-code/src/console/auth-admin.controller.ts`, backed by
`apps/tdr-code/src/db/auth-session.repo.ts`) lets any authenticated admin force-expire a specific
Discord user's sessions without any deploy at all — useful for a _compromised-but-still-signed-in_
member, though it does not help if the failure is "nobody can sign in in the first place" (the
scenario this section is about). If a future operator judges Option 1 worth building, treat it as
its own small unit with its own test plan, not something bolted on here.

**Recommendation if a broken-auth lockout actually happens:** use Option 2 (revert U4/U6 via `git
revert`, redeploy, re-add the `forward-auth` label as the edge backstop while the app briefly runs
without its own guard) rather than attempting to hand-write `AUTH_DISABLED` under incident pressure.

---

## 6. Monitoring

**Do not rely on the Phase B event feed** — it cannot observe auth denials (every row needs a
non-null `generationId`, which an anonymous 401 doesn't have) and it is itself behind the guard, so
an operator locked out by a broken guard can't even see the feed that would explain why.

**The primary cutover watch is Loki request-status**, per the plan's Operational Notes:

- Expected steady state: `401`s to unauthenticated `/api/*` calls, `200`s to `/api/health` and to
  authenticated calls on guarded routes.
- **Alarm condition:** a `200` on a sensitive `/api/*` route with **no session present**. Alert on
  `>0` — this is the "slipping through" signal that the guard itself has a hole.
- Also watch `/api/health` for any non-200 (Docker healthcheck correlate) and Traefik's router state
  for "cutover took" confirmation (per §3 step 6, ongoing — not just at cutover time).

**Load-bearing scope note — what this Loki watch can and cannot see:** per U2's own empirical
finding, the Better Auth mount (`/auth/*`, i.e. sign-in/callback/sign-out/get-session) does **not**
emit `pino-http` request logs at all. The mount's own middleware fully handles the request/response
cycle before Nest's normal HTTP-logging middleware would ever see it, so there is currently no
per-request Loki trail for OAuth sign-in attempts, successes, or guild-gate rejections themselves.

**This means the Loki watch above is meaningful for the guarded `/api/*` controller routes** — the
canonical list in `apps/tdr-code/src/auth/protected-routes.ts` (`PROTECTED_ROUTES`) — **not** for the
OAuth mount's own traffic. Do not read "steady 401s in Loki" as evidence about sign-in volume or
guild-gate rejection rate; it isn't. If OAuth-mount-specific observability is ever wanted (e.g. "how
many non-members were rejected this week"), that requires new instrumentation at the guild-gate seam
itself (`apps/tdr-code/src/auth/guild-gate.ts` / `auth.ts`'s hook), not a Loki query against the
existing `pino-http` stream — that is out of scope for this unit and not attempted here.

The audit trail for _mutating_ console actions (who restarted the bot, who edited `claudeArgs`, who
revoked whose sessions) is the structured `auth_denied` / actor-keyed log lines emitted by the guard
and each mutating controller (per U4's Approach) — those routes **are** `/api/*` controller traffic
and **are** covered by the Loki watch above, unlike the OAuth mount itself.

---

## 7. What this unit changed in the repo

- `apps/tdr-code/deploy.yml` — removed the `forward-auth` middleware label and its now-stale comment
  (`# forward-auth stays until Phase D (Better Auth + guard cutover).`). No other label, the
  healthcheck, `stop_grace_period`, volumes, or networks were touched.
- `apps/tdr-code/.env.example` — added a header note explaining the host-process `.env` mechanism
  (§1.1 above) so a future operator doesn't go looking for a Docker-consumed
  `infra/.env.tdr-code` that was never real.
- This document (`docs/runbooks/tdr-code-phase-d-forward-auth-cutover.md`) — new.
- **Not touched:** `infra/proxy.yml`, `apps/tdr-code/deploy/nginx.conf` (the shared `forward-auth`
  service and its middleware definition stay for every other lilnas app), and no
  `infra/.env.tdr-code` file was created.

---

## 8. Run Log

Fill in a new entry each time this cutover is actually executed (or attempted and rolled back). Do
not overwrite prior entries.

| Date/time (with timezone) | Commit SHA cutover       | Operator    | Go/No-Go A–H (all green?) | cutover-verification.md run referenced (date) | Step 6 Traefik confirm | Step 7 external sweep | Step 8 operator sign-in | Rolled back? (Y/N + why) | Notes |
| ------------------------- | ------------------------ | ----------- | ------------------------- | --------------------------------------------- | ---------------------- | --------------------- | ----------------------- | ------------------------ | ----- |
| _(fill in)_               | _(`git rev-parse HEAD`)_ | _(fill in)_ |                           |                                               |                        |                       |                         |                          |       |

**Getting the commit SHA to record:** run `git rev-parse HEAD` (or `--short HEAD`) in the repo
checked out at the commit that produced the deployment under cutover — same convention as
`docs/runbooks/tdr-code-phase-d-cutover-verification.md`'s own Run Log.
