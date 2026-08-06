# lilnas-auth cutover runbook

Migrates Traefik-protected routers from `thomseddon/traefik-forward-auth`
(the `forward-auth` middleware) to `lilnas-auth` (the `lilnas-auth`
middleware), one router at a time, then retires `thomseddon` and renames
`lilnas-auth` onto `auth.lilnas.io`.

Written by U10/U11 of
`docs/archive/plans/2026-07-31-001-feat-lilnas-auth-forward-auth-plan.md` (R18-R20).
**No router was migrated and no compose file governing live routing was
changed by that work** — this document is the manual procedure for a human
operator to run the actual cutover, at whatever pace they choose. Everything
in "Status as of this writing" and "Corrected protected-host list" below was
verified directly against this repo's `infra/*.yml` and `apps/*/deploy.yml`
at U10 time; re-verify before you act if much time has passed (see the
`grep` command in that section — services get added and removed).

## Update — 2026-08-03

All 8 routers in "Corrected protected-host list" below (plus 2 added after
this document was written) have since migrated to `lilnas-auth` — Steps 1–4
are complete. "Status as of this writing" and the per-router steps below are
preserved as the historical record of how that migration was executed;
re-read them if you need to understand or roll back an individual router,
but they no longer describe the live state. Step 5 (retire thomseddon,
rename to `auth.lilnas.io`) is being executed by the
`chore(infra): retire thomseddon/traefik-forward-auth`,
`feat(lilnas-auth): rename login.lilnas.io to auth.lilnas.io`, and
`refactor(auth): rename apps/lilnas-auth to apps/auth` commits.

## Status as of this writing

- `lilnas-auth` is deployed and serving its own admin UI, OAuth, and
  `/verify` endpoint at `login.lilnas.io`, but **zero routers use it**.
  `thomseddon/traefik-forward-auth` (`infra/proxy.yml`'s `forward-auth`
  middleware) still gates every currently-protected router.
- `infra/proxy.yml` now ALSO defines a `lilnas-auth` ForwardAuth middleware,
  additive alongside `forward-auth` — see that file's own comment on the
  `traefik` service's labels. No router references it yet.
- The grants table has not been seeded. Nobody currently on the legacy
  `WHITELIST` has a `lilnas-auth` grant yet.

## ⚠️ A correction to the plan document itself

The plan's own "Verified facts" section lists the 9 currently-protected
hosts as `portal, swole, tdr, nexus-code-mbp, yacht, prometheus, grafana,
traefik, auth`, and U10's original approach text names **`nexus-code-mbp`**
as the first router to migrate ("operator-only, low traffic... obvious and
harmless" failure mode).

That fact was true when it was researched, but is **stale as of this
writing**. Commit `21b35e9` ("chore(infra): remove forward-auth middleware
from nexus-code-mbp", Jul 23) — which predates the plan's own Jul 31 date —
removed `nexus-code-mbp`'s `middlewares=forward-auth` label entirely.
`nexus-code-mbp.lilnas.io` is **not currently protected by anything**. Per
this plan's own Scope Boundaries ("Not expanding the footprint... Expansion
is a per-service decision after v1 ships"), migrating it to `lilnas-auth`
now would be adding NEW protection to a currently-open host — explicitly out
of scope, not a like-for-like swap.

Separately, the plan's list also omits **`files.lilnas.io`** (`infra/files.yml`,
the copyparty file server), which genuinely does carry `forward-auth` today.

U8's live service-registry scan (commit `2f6d5e6`) already caught and
corrected this same discrepancy independently — its verified 9-host list is
`swole.lilnas.io, tdr.lilnas.io, portal.lilnas.io, files.lilnas.io,
yacht.lilnas.io, prometheus.lilnas.io, grafana.lilnas.io, traefik.lilnas.io,
auth.lilnas.io`, matching what's re-derived below.

## Corrected protected-host list

Rather than trust a hardcoded list in this doc (which can go stale exactly
like the plan's did), re-derive it live before you start:

```bash
grep -rn "middlewares=forward-auth" infra/*.yml apps/*/deploy.yml
```

As of this writing that resolves to **8 destination hosts** (`auth.lilnas.io`
itself — thomseddon's own router — is the 9th "protected" router, but it has
no grant concept and is handled separately by deletion + rename, not
migration):

| Host | Compose file |
|---|---|
| `files.lilnas.io` | `infra/files.yml` |
| `yacht.lilnas.io` | `infra/monitoring.yml` |
| `prometheus.lilnas.io` | `infra/monitoring.yml` |
| `grafana.lilnas.io` | `infra/monitoring.yml` |
| `traefik.lilnas.io` | `infra/proxy.yml` |
| `portal.lilnas.io` | `apps/portal/deploy.yml` |
| `tdr.lilnas.io` | `apps/tdr-bot/deploy.yml` |
| `swole.lilnas.io` | `apps/swole/deploy.yml` |

`apps/lilnas-auth/src/db/seed-whitelist.ts`'s CLI entrypoint (below) derives
this same list programmatically via `scanServiceRegistry()` filtered to
`gatedBy === 'forward-auth'` — the same code path U8's admin UI uses to show
migration status — so it can never drift from this table the way the plan's
own hardcoded list did. If the two ever disagree, trust the script's live
scan, not this table.

## Step 1 — Seed the grants table

**Do this before touching any router label.** The entire point of R19 is
that nobody currently working gets bounced to a pending page at cutover.

1. On the deploy host, read the real whitelist:

   ```bash
   grep '^WHITELIST=' infra/.env.forward-auth
   ```

   (This checkout's copy of that file is a placeholder — `WHITELIST=foo@example.com`
   — real values only ever existed on the deploy host.)

2. Run the seed script inside the running `lilnas-auth` container, passing
   that value as `WHITELIST`:

   ```bash
   docker-compose exec -e WHITELIST='alice@example.com,bob@example.com' \
     lilnas-auth node dist/db/seed-whitelist.js
   ```

   It prints the protected-host list it discovered and a summary of how many
   grant/pre-authorization rows it wrote. It is idempotent — safe to re-run.

   - A whitelist member with an existing `lilnas-auth` sign-in (a real
     `user` row already exists because they've used the admin UI, or signed
     in for some other reason) gets a real grant immediately.
   - Everyone else gets a `pre_authorized_grant` row that silently binds
     into a real grant the moment they first sign in anywhere — see
     `src/verify/access-cache.service.ts`'s `bindPreAuthorizedGrant()`.

3. **Restart (or this was the container's first boot after seeding)**
   `lilnas-auth` so `AccessCacheService.onModuleInit()` preloads the
   newly-written rows into memory — the seed script only writes to SQLite,
   it does not (and cannot, running as a separate process) reach into a
   running process's in-memory cache:

   ```bash
   docker-compose restart lilnas-auth
   docker-compose ps lilnas-auth   # wait for "healthy"
   ```

4. Spot-check before migrating anything: pick one seeded email, sign in at
   `https://login.lilnas.io`, and confirm no pending page appears for any of
   the 8 hosts above (there's nothing to redirect them to yet since no
   router uses `lilnas-auth`, but this at least proves the grant exists —
   query the DB directly if you'd rather not sign in yet:
   `sqlite3 /storage/app-data/lilnas-auth/lilnas-auth.db "select * from grant;"`).

## Step 2 — Pick and migrate the first router

The plan's original reasoning for going first — lowest stakes, a failure
mode that's obvious and affects only the operator — is sound; only the
specific pick (`nexus-code-mbp`) turned out to be wrong (see the correction
above). **You know real traffic patterns for these 8 hosts better than this
document can** — `files.lilnas.io` (copyparty) is a plausible low-traffic
candidate structurally similar to what the plan wanted, but confirm that
against how it's actually used before trusting it.

Suggested full order, first entry pending your confirmation:

```
files → yacht → prometheus → grafana → swole → tdr → portal → traefik
```

`traefik.lilnas.io` (the dashboard) stays last regardless of what goes
first — losing the dashboard while debugging a middleware issue is a bad
position to be in.

### Per-router procedure (repeat for every host, in order)

1. Open the router's compose file (see the table above) and change **one
   label**:

   ```diff
   - traefik.http.routers.<name>.middlewares=forward-auth
   + traefik.http.routers.<name>.middlewares=lilnas-auth
   ```

2. Apply it:

   ```bash
   docker-compose up -d <service-name>
   ```

   (Traefik picks up label changes on the container it's attached to; no
   restart of `traefik` itself is needed — only the migrated service's own
   container needs recreating.)

3. Verify:
   - A seeded user reaches the host with **no interstitial** — this is the
     entire R19 promise. Confirm in a browser or:
     `curl -I -H "Cookie: <seeded user's better-auth cookie>" https://<host>`
     should come back 200/expected-app-response, not a redirect to
     `login.lilnas.io` or `/pending`.
   - An unseeded signed-in user lands on the pending page, and the request
     shows up in `https://login.lilnas.io/admin/queue`.
   - `swole` specifically: after migrating it, re-check that
     `swole-metrics-deny`'s separate IP-allowlist router (`apps/swole/deploy.yml:45-50`)
     still 403s from a non-loopback IP — it's a different, higher-priority
     router on the same host and must be undisturbed by this change.

4. If anything looks wrong: revert the one label, `docker-compose up -d
   <service-name>` again. That's the entire rollback for this step.

5. Only move to the next router once this one is confirmed working.

## Step 3 — Startup ordering (do this before or during the first migration)

R20: ForwardAuth must never fail open. If `lilnas-auth` is down when a
migrated router receives traffic, Traefik's ForwardAuth subrequest fails and
the router 502s — which is correct (fail-closed) — but this does **not**
require a manual restart to recover: Traefik dials the ForwardAuth address
per-request, so the moment `lilnas-auth` comes back up, ForwardAuth resumes
on the very next request with no Traefik restart needed. The
`condition: service_healthy` form this step used to suggest does not solve
a real problem, and is actively dangerous: Compose refuses to start a
dependent whose dependency never reaches healthy, and `traefik` is the
ingress for **every** host on this box, protected or not. `deploy.yml`
documents a real permanent-boot-failure mode for `lilnas-auth`
(`SQLITE_CANTOPEN` forever if the host data dir isn't chowned to UID 1000)
— a `service_healthy` dependency would turn that one service's boot failure
into **nothing on lilnas.io resolving at all**, which is a strictly worse
outcome than the fail-closed 502s on protected routes this step exists to
mitigate.

If you still want an ordering HINT (Traefik attempting to start after
`lilnas-auth` on a cold boot, purely for tidier logs — not for correctness,
since the paragraph above already covers correctness), use the
non-blocking form:

```yaml
services:
  traefik:
    depends_on:
      lilnas-auth:
        condition: service_started
        required: false
```

`required: false` is what keeps this a hint rather than a hard gate:
Traefik still starts even if `lilnas-auth` never reaches "started" at all.
This is optional — skip it entirely and Traefik still recovers correctly on
its own, per the paragraph above.

## Step 4 — Migrate the remaining routers

Repeat Step 2's per-router procedure for the rest of the suggested order
(`yacht`, `prometheus`, `grafana`, `swole`, `tdr`, `portal`, then `traefik`
last). Each is independently revertible — there is no requirement to do
them in one sitting.

## Step 5 — Retire thomseddon, rename to auth.lilnas.io

Only after every router above (including `traefik`) is confirmed working on
`lilnas-auth`:

1. Delete the `traefik-forward-auth` service block from `infra/proxy.yml`
   and the `forward-auth` middleware definition (the `traefik.http.middlewares.forward-auth.*`
   labels) — both currently live on that same service's labels. Leave the
   commented-out `truereflection-forward-auth` block alone; it's a
   different domain, out of scope.
2. Bring the service down and remove it explicitly. Plain `docker-compose
   up -d` after the file edit will **not** remove it: Traefik's Docker
   provider reads labels straight off running containers, not compose file
   text, so a container whose service key has disappeared from the file
   keeps being honored as a router indefinitely until something actually
   removes it. Use either:

   ```bash
   docker rm -f lilnas-traefik-forward-auth-1
   ```

   or `docker-compose down --remove-orphans` / `up -d --remove-orphans`
   (note the `lilnas` CLI's own `redeploy`/`up`/`down` wrappers do not
   support `--remove-orphans` at all, so this step needs plain
   `docker-compose`/`docker` rather than the CLI).
3. Rename `lilnas-auth` onto `auth.lilnas.io`:
   - `apps/lilnas-auth/deploy.yml`: change the router rule from
     `` Host(`login.lilnas.io`) `` to `` Host(`auth.lilnas.io`) ``.
   - `apps/lilnas-auth/.env.prod` (on the deploy host) and `.env.example`:
     update `AUTH_HOST` from `https://login.lilnas.io` to
     `https://auth.lilnas.io`.
   - The Google OAuth redirect URI for `auth.lilnas.io` was already
     registered in the Google console back in U3 — no console change
     needed here.
   - The `.lilnas.io` cookie domain is unchanged throughout this rename, so
     existing sessions survive it with no forced re-login.
4. `docker-compose up -d lilnas-auth traefik` and verify:
   - `https://auth.lilnas.io` serves lilnas-auth (login page for an
     unauthenticated visitor).
   - `https://login.lilnas.io` no longer resolves to anything — confirm
     nothing else in the repo still links to it:
     `grep -rn "login.lilnas.io" apps/ infra/ docs/`.
5. Final verification, repo-wide:

   ```bash
   grep -rn "forward-auth" apps/*/deploy.yml apps/*/deploy.dev.yml infra/*.yml
   ```

   Should return **only** the commented-out `truereflection-forward-auth`
   block in `infra/proxy.yml`. No `thomseddon` image reference should remain
   anywhere.
6. Update `CLAUDE.md`'s Production Deployment section — it currently says
   "Traefik authentication middleware (`forward-auth@file`)"; change to
   reference `lilnas-auth`.

## Rollback reference

| Stage | Rollback |
|---|---|
| Seeding (Step 1) | No-op to undo — grants/pre-authorizations for people who were already allowed everything are harmless. Delete rows by hand if truly needed. |
| Mid-migration (Step 2/4) | Revert that one router's `middlewares=` label back to `forward-auth`, `docker-compose up -d <service>`. `thomseddon` is still running and untouched until Step 5. |
| After Step 5 (thomseddon deleted) | No longer a one-label revert — `thomseddon`'s service definition and the `forward-auth` middleware would need to be restored from git history (`git show <sha>:infra/proxy.yml`) and re-deployed. Do not proceed to Step 5 until you are fully confident in every migrated router. |

## Verification checklist (repo-wide, run any time)

```bash
# What's protected by what, right now:
grep -rn "middlewares=forward-auth\|middlewares=lilnas-auth" infra/*.yml apps/*/deploy.yml

# No stray thomseddon references outside the (eventually deleted) service block:
grep -rn "thomseddon" infra/*.yml
```
