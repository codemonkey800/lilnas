# Local verification environment

A repeatable way to run `@lilnas/download` against the **live** Radarr, Sonarr,
Emby and MinIO upstreams — with real titles, real genres, real file paths — while
the production container keeps serving `download.lilnas.io` untouched.

The shape is: **one container running both halves, published through the
production Traefik.**

|                                  |                                                 |
| -------------------------------- | ----------------------------------------------- |
| `https://download.dev.lilnas.io` | For a human. OAuth in front.                    |
| `http://localhost:8090`          | For tooling on the NAS. Loopback only, no auth. |
| Compose file                     | `apps/download/deploy.dev.yml`                  |
| Container                        | `lilnas-download-dev`                           |

---

## Read this first

> [!CAUTION]
> **Never name the container `lilnas-download-1`.**
>
> That is production. `docker rm -f` on it takes `download.lilnas.io` down. The
> name used everywhere below is `lilnas-download-dev`.

> [!CAUTION]
> **`DATABASE_PATH` must never be `/storage/app-data/download/download.db`.**
>
> That is production's live database. `lilnas-download-1` holds it open in WAL
> mode; a second process writing it can corrupt the running service's data.
> This environment points at `/data/download.db` on a tmpfs, which cannot reach
> the host filesystem at all.

> [!CAUTION]
> **No mutating requests against the media library.**
>
> Grab, replace, delete-files and flag-bad-file write to Radarr and Sonarr and
> delete real files off `/storage/media-library`. The `:ro` mounts are defence
> in depth behind that rule, not a replacement for it. Video download / pause /
> cancel _are_ fair game — a yt-dlp job is self-contained.

One more standing rule: `deploy.dev.yml` must **never** be added to the
production `docker-compose.yml` `include:` list — only `docker-compose.dev.yml`'s.
It already is, deliberately (see [Why this shape](#why-this-shape)) — running
`docker-compose -f docker-compose.dev.yml up -d download-dev` from the repo root
brings this container up exposed at `download.dev.lilnas.io`, same as starting
it directly with `-f apps/download/deploy.dev.yml`.

---

## Why this shape

**One container, not two processes.** `pnpm --filter=download dev` runs both
halves — Nest on 8081, Next on 8080 — exactly as production's image does. Next's
own `/api` and `/ws` rewrites reach the backend in-process, so no host port is
needed for it and the hardcoded `http://localhost:8081` in `next.config.js`
works unchanged.

**The repo is bind-mounted, so hot reload works.** Editing a file on the host
recompiles inside the container. That is the whole reason this is a dev image
rather than the production one.

**Path fidelity.** Radarr and Sonarr report paths like `/movies/Foo (2020)/Foo.mkv`.
Those exist inside the container's `:ro` mounts and **do not exist on the host**
— the real trees are at `/storage/media-library/{movies,tv}`. A host-native
backend 404s on the disk-streaming branch that the local-save work has to verify.

**Traefik, not a published port, is the way in.** The router carries the
`lilnas-auth` middleware, so a real `X-Forwarded-User` header arrives and the
`DEV_USER_EMAIL` fallback in `src/auth/forwarded-user.ts` never fires for a
browser request. That also makes this a closer match to production than the old
shape, which had no auth at all.

**Port 8090 is bound to `127.0.0.1`, deliberately.** Headless Chrome cannot
follow the OAuth redirect, so screenshot runs and `curl` need a way past the
gate. Loopback gives them one without giving it to the LAN — which matters,
because anything arriving without an identity header takes the admin fallback.
8090 rather than 8080 because `url-shortener-proxy-1` owns host 8080.

**The database is ephemeral, but the gallery isn't empty.** `/data` is a
tmpfs, so `jobs` is built from scratch on every start and destroyed when the
container stops - nothing persists, and nothing needs cleaning up. The
gallery does not read `jobs` for movies and shows: it lists Radarr's/Sonarr's
libraries directly (plan 021 · Phase 4), joining the job log only for each
card's download summary. So a fresh container shows this app's download
_history_ as empty (nobody has requested anything through it yet), but the
gallery and "Browse movies/shows" reflect Radarr's/Sonarr's real libraries
from the first request onward.

**This IS `apps/download/deploy.dev.yml`, and it IS in `docker-compose.dev.yml`'s
`include:` list, on purpose.** Earlier this environment lived in a separate
`deploy.dev-remote.yml`, kept deliberately out of both root compose files so a
routine dev startup never auto-published a container to the internet. That
tradeoff was revisited: `download.localhost` via the dev Traefik never worked on
this host anyway (see the header comment in `deploy.dev.yml` for why), so there
was no working "plain local" mode to protect by keeping this file separate. The
standard `docker-compose -f docker-compose.dev.yml up -d download-dev` now brings
this shape up directly.

---

## Setup

### 1. Build the dev image (once)

```bash
./infra/base-images/build-base-images.sh     # builds lilnas-dev among others
# or just this one:
docker build -f infra/base-images/lilnas-dev.Dockerfile -t lilnas-dev .
```

`lilnas-dev` is the image every `apps/*/deploy.dev.yml` references. It carries
node 25 + pnpm 10.18.2 + a build toolchain, and copies no source — the repo
arrives as a bind mount.

### 2. Write `apps/download/.env.dev-remote`

```bash
cd apps/download && cp .env.dev-remote.example .env.dev-remote
```

Then fill in the secrets — the MinIO credentials and the Radarr / Sonarr / Emby
API keys — from `.env.prod`. Everything else in the template is already correct.

Two groups of values differ from `.env`, and both matter:

| Variable                                                | Value                        | Why                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RADARR_URL` / `SONARR_URL` / `EMBY_URL` / `MINIO_HOST` | service names                | The container is on `lilnas_default`, so Docker DNS resolves `radarr`, `sonarr`, `emby`, `storage`. `.env` uses hardcoded `172.18.x.x` IPs for the native flow; **those go stale whenever an upstream container is recreated.** |
| `DATABASE_PATH`                                         | `/data/download.db`          | The tmpfs. An empty path is enough — `better-sqlite3` creates the file and `src/db/db.service.ts` runs the drizzle migrator at boot, so the schema builds itself.                                                               |
| `DEV_USER_EMAIL`                                        | an address in `ADMIN_EMAILS` | Only used when no `X-Forwarded-User` arrives, i.e. requests via loopback or from another container. Must be an admin address or the admin dashboard and unmasked-attribution paths are unverifiable through that path.          |

`ADMIN_EMAILS` lives on `lilnas-auth-1`:

```bash
docker inspect lilnas-auth-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep ADMIN_EMAILS
```

> `.env.dev-remote` is covered by the root `.gitignore` rule `.env.*`, alongside
> `.env.prod`. Never commit it and never paste its values anywhere. Note that
> `docker compose -f deploy.dev.yml config` **inlines the whole env file
> into its output** — use `config --quiet` to validate without printing secrets.

> [!IMPORTANT]
> **A compose `environment:` entry cannot override these.** `pnpm dev` runs
> `lilnas dev`, which calls Node's `loadEnvFile()` on `apps/download/.env`
> (`packages/cli/src/commands/dev.ts:48`) and overwrites the container
> environment with it. That is why `deploy.dev.yml` mounts
> `.env.dev-remote` **over** `.env` inside the container instead. Symptom if you
> get this wrong: the database silently lands wherever `.env` said.

### 3. Start it

```bash
docker compose -f apps/download/deploy.dev.yml up -d
docker compose -f apps/download/deploy.dev.yml logs -f

# equivalently, from the repo root:
docker-compose -f docker-compose.dev.yml up -d download-dev
docker-compose -f docker-compose.dev.yml logs -f download-dev
```

First boot runs `pnpm install --frozen-lockfile` inside the container and takes
a few minutes. Subsequent starts are fast — the pnpm store is a named volume.

Ready when the log shows both:

```
✓ Ready in 974ms                          ← Next, on 8080
Nest application successfully started      ← Nest, on 8081
```

---

## Verification checks

Hit **`localhost:8090`**; that exercises the Next `/api` rewrite as well as the
backend. All four are read-only `GET`s.

Observed 2026-09-15 against a freshly started container:

| Check                                   | Observed                                            |
| --------------------------------------- | --------------------------------------------------- |
| `GET /api/auth/whoami`                  | `isAdmin: true`, `userId: "verify-user-1"`          |
| `GET /api/download/gallery`             | `total: 0` — before plan 021; see note below        |
| `GET /api/download/history`             | `total: 0` — expected, the database is ephemeral    |
| `GET /api/download/discover?query=star` | `total: 40`, `degradedSources: []`, 20 genre facets |

```bash
curl -s localhost:8090/api/auth/whoami
# {"email":"…","userId":"verify-user-1","isAdmin":true}

curl -s 'localhost:8090/api/download/discover?query=star' |
  jq '{total, page: (.items | length), degradedSources,
       genreFacets: (.facets.genres | length)}'
# { "total": 40, "page": 24, "degradedSources": [], "genreFacets": 20 }
```

Reading the numbers:

- **`history` being 0 is correct, not a failure.** The database is rebuilt
  empty on every start, and history is this app's own request log - nobody
  has requested anything through this instance yet. To get rows, paste a link
  into the nav-bar field and let a real yt-dlp job run, or request a
  movie/show.
- **`gallery` being 0 in the table above predates plan 021 · Phase 4,** when
  the gallery was still a `GROUP BY` over completed jobs. It now lists the
  Radarr/Sonarr libraries (plus finished videos) directly, so on a current
  container `gallery`'s `total` reflects those real libraries - zero only if
  they genuinely have nothing downloaded. Discovery was always live either
  way: `/discover` reads Radarr and Sonarr directly, never the database.
- `total` is the full result count; `items` is one page. Default page size is 24,
  so a first page of 24 with a non-null `nextCursor` is correct, not truncated.
- `degradedSources: []` is the important one on `/discover` — a non-empty array
  means Radarr or Sonarr was unreachable and the results are partial.
- **`/discover` takes `query`, not `q`, and it is required with a minimum of 2
  characters** (`DiscoverQuerySchema`, `packages/utils/src/download/schema.ts`).
  `?q=` returns `400 invalid_type`; a bare `?query=` returns `400 too_small`.

### Discord-attributed jobs

A job created by `apps/tdr-bot`'s `/download` command is attributed to a
**Discord account** rather than to a lilnas email. That identity travels as
plain request headers — `DownloadClient.withDiscordIdentity()` is the only thing
the bot does differently — so `curl` stands in for the bot exactly:

```bash
curl -s -X POST localhost:8090/api/download/videos \
  -H 'content-type: application/json' \
  -H 'x-discord-user-id: 123456789012345678' \
  -H 'x-discord-username: someuser' \
  -H 'x-discord-display-name: Some User' \
  -d '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ"}' |
  jq '{id, discordRequester, linkedDiscord, requester}'
# {
#   "id": "…",
#   "discordRequester": { "discordUserId": "123456789012345678",
#                         "discordUsername": "someuser" },
#   "linkedDiscord": null,
#   "requester": null
# }
```

`requester: null` with `discordRequester` populated is the pass — that row is
`origin: 'discord'` in the database. (`origin` is a column and an audit-log
field; it is deliberately **not** on the `DownloadJob` wire shape, so which of
the two fields is populated is how you read it from a response.)

Four things that will otherwise waste an afternoon:

- **`x-discord-user-id` is what makes this reachable through loopback at all.**
  `resolveForwardedUser()` (`src/auth/forwarded-user.ts`) suppresses the
  `DEV_USER_EMAIL` fallback when that header is present — its third gate, added
  for exactly this. Without it the dev admin identity would win on precedence,
  the Discord pair would be dropped with a warn, and you would be looking at an
  ordinary `origin: 'web'` job.
- **Both headers or neither.** `getDiscordRequester()` returns nothing unless
  `x-discord-user-id` _and_ `x-discord-username` are present. Send only the id
  and you get the worst of both: the dev fallback is still suppressed, no
  Discord pair is extracted, and the job lands as `origin: 'service'` with no
  attribution at all.
- **`x-discord-display-name` is optional and never reaches a job row.** It is
  roster enrichment for `apps/auth` only (Discord's `globalName` is nullable on
  Discord's own API, so nothing can depend on it), and it is the one header
  value treated as untrusted free text.
- **`apps/download` validates neither value** — it stores the headers raw.
  `apps/auth`'s roster is what enforces `/^\d{17,20}$/` on the snowflake and
  2–32 characters on the handle, and it does so on a fire-and-forget POST. So a
  made-up 6-digit id produces a perfectly good job that never appears in the
  admin picker, with nothing in the response to say so.

#### Did the account land in auth's roster?

Every request carrying a Discord pair reports the observation to `apps/auth`
— fire-and-forget, and _including_ one where a forwarded user took precedence.
That report is the only way an account gets into the admin link picker.

Auth's internal surface has no Traefik router and publishes no host port, so
ask from inside the Docker network:

```bash
docker exec lilnas-download-dev \
  curl -s 'http://auth:8081/internal/discord-link?discordUserId=123456789012345678'
# unseen snowflake      -> {"identity":null,"user":null}
# observed but unlinked -> {"identity":{"discordUserId":"…","username":"someuser",
#                                       "displayName":"Some User"},"user":null}
# linked                -> both halves populated
```

The same route also answers `?userId=` and `?email=` — three addresses for one
question, and `?email=` is matched case-insensitively. Supplying zero or more
than one of the three is a `400`.

> [!CAUTION]
> **`auth` on `lilnas_default` is production `lilnas-auth-1`.**
>
> `AuthClient.dockerInstance` hardcodes `http://auth:8081` with no environment
> override, and this container is on the shared network, so the roster write
> lands in **production auth's `discord_identity` table**. Nothing about that is
> dangerous — the roster confers no authorization and cannot create a link (see
> `discord-internal.controller.ts`'s blast-radius comment) — but there is **no
> delete path**, so a junk snowflake you invent here is a junk row an admin sees
> in the picker forever. Use a real Discord account you own.
>
> Observed 2026-09-20: the deployed `lilnas-auth-1` **predates these routes and
> 404s them**, so today the lookup fails open to "unlinked" and the roster write
> is a silent no-op. That changes the moment auth is redeployed from this
> branch — `docker-compose up -d --build auth` from the repo root.

#### Does linking resolve it?

Linking happens in **`apps/auth`'s admin dashboard** (`https://auth.lilnas.io/admin`,
the Discord links panel) — `apps/auth` owns both tables and the whole UI;
`apps/download` only reads across the wire. The panel is **two pick-from-a-list
columns** (people without a link, observed accounts without a link), a Link
button labelled with the pairing, and an existing-links table with Unlink.
**A handle is never typed by an admin** — there is no text input for a snowflake
or a username anywhere in it, which is also why an account that has never run
`/download` cannot be pre-linked: there is nothing to pick.

With the link made, re-read the same job:

```bash
curl -s localhost:8090/api/download/videos/<job-id> |
  jq '{discordRequester, linkedDiscord, requester}'
# requester      -> the linked lilnas email/userId   (forward direction)
# linkedDiscord  -> the same handle, as a fact about that person
# discordRequester -> still set, handle refreshed from the roster
```

And the person's history now spans both surfaces:

```bash
curl -s 'localhost:8090/api/download/history?requester=<email>' | jq '.total'
```

- **Nothing is written back.** Resolution happens at read time, so link and
  unlink are symmetric and retroactive: the Discord job you just created shows
  up under that email, and so does every job either identity made before the
  link existed. Unlink and it is all back to where it was.
- **Allow up to 60 seconds.** `DiscordLinkService` caches auth's answers for
  60s — negatives included, deliberately — and a _thrown_ lookup for 10s.
  Restarting the container clears it, since the cache is in-memory.
- **A rename needs no action either.** The roster's `username` is a cache
  refreshed on every observation, so a renamed user is picked up on their **next
  `/download` command** (re-run the `curl` above with the new handle and watch
  the roster row change). Until then the stored column holds the historical
  name — and that stored name is also what renders whenever auth is unreachable.

### Watching a video download

Start a video (paste a link into the nav-bar field, or the `POST` above
without the Discord headers), then poll it:

```bash
watch -n1 "curl -s localhost:8090/api/download/videos/<id> | jq '{status, progress}'"
```

- **`progress` is present while the job is downloading or paused**, and
  absent after a terminal state (`completed`, `failed`, `cancelled`) or a
  restart — it lives in memory only (plan 015).
- **`download.log` carries `LILNAS_PROGRESS` JSON lines** instead of
  yt-dlp's usual progress bar. Each still includes yt-dlp's human-readable
  line, so the log stays readable.

### Screenshots

Headless Chrome cannot log in, so always target `localhost:8090`, never the
public hostname. Use a throwaway profile — the Chrome MCP profile is
single-instance and cannot be shared between concurrent agents:

```bash
google-chrome-stable --headless=new --disable-gpu \
  --user-data-dir=$(mktemp -d) \
  --window-size=1280,900 --screenshot=/tmp/shot.png \
  'http://localhost:8090/gallery'
```

`playwright-core` is in `node_modules` (the Playwright _MCP_ browser is not
installed) and can drive system Chrome for exact `getBoundingClientRect()`
geometry. Measuring beats eyeballing — it is how the card-stretch bug in
`result-grid.tsx` was found.

---

## Edge cases and gotchas

- **Do not run `pnpm build` in `apps/download` while this is up.** It clobbers
  the `.next` the dev server is holding and the container starts 500ing. If it
  happens: `rm -rf apps/download/.next` and restart the container.
- **node_modules cannot come from the host.** The host runs node 24, the image
  runs node 25, and the tree contains native modules (`better-sqlite3`, `bcrypt`
  — see `pnpm-workspace.yaml`'s `onlyBuiltDependencies`). Host-built binaries
  fail node's `NODE_MODULE_VERSION` check. Only the **workspace root**
  `node_modules` is shadowed by a volume; each package's own `node_modules`
  holds relative symlinks into the root store, so it resolves against whichever
  root reads it.
- **A volume mount point must exist in the image.** Docker creates a missing one
  as `root:root`, which fails as `EACCES: permission denied, mkdir
'/source/node_modules/.pnpm'` for the non-root user. `lilnas-dev.Dockerfile`
  pre-creates them owned by `node`.
- **`/download` is a tmpfs, same reasoning as `/data`.** `VIDEO_DIR` is
  hardcoded to `/download/videos`; `/` is root-owned and the container runs as
  `1000:1001`, so without the `uid`/`gid` tmpfs mount every video job 500s with
  `EACCES: permission denied, mkdir '/download'`. Video bytes are as ephemeral
  as the database here — that's expected, not a bug.
- **The container runs as `1000:1001`** so `.next` and `.turbo` written into the
  bind mount stay owned by the host user rather than root.
- **Booting fails interrupted video jobs and re-adopts everything else.**
  `reconcileInterruptedJobs()` (`src/db/reconcile-interrupted-jobs.ts`, run
  from `src/bootstrap.ts`) moves every non-terminal **video** job to `failed`
  (`Interrupted by a service restart`) - its yt-dlp run and partial file died
  with the process. Movie/show jobs are never failed: Radarr/Sonarr hold
  their truth, so `DownloadStateService.adoptOpenJobs()` re-adopts every open
  one and the poller settles it on its first tick. The boot log reads
  `Re-adopted N open job(s)`. Mostly moot on an ephemeral database, since a
  restart empties `jobs` anyway.
- **Container IPs are irrelevant in this shape.** The container resolves
  `radarr` / `sonarr` / `emby` / `storage` by service name on `lilnas_default`,
  so nothing goes stale when an upstream is recreated. Do not hardcode an IP.
- **Router names are global to Traefik.** This router is `dev-download`, not
  `download` — production's `deploy.yml` already registers `download` with the
  same Traefik, and **Traefik does not warn on router-name collisions.**
- **`tls=true`, not `tls.certresolver=le`.** All `*.dev.lilnas.io` routes share
  one wildcard cert; requesting a per-host cert wastes Let's Encrypt's ~50 new
  certs/week budget. See `docs/lilnas-expose.md`.

---

## Teardown

```bash
docker compose -f apps/download/deploy.dev.yml down

# also drop the cached node_modules and pnpm store:
docker compose -f apps/download/deploy.dev.yml down -v
```

Nothing else to clean up — the database lived in RAM and is already gone.
Remove `apps/download/.env.dev-remote` if you want the plaintext secrets off the
host too.

Double-check afterwards that production is still up:

```bash
docker ps --filter name=lilnas-download-1
curl -s -o /dev/null -w '%{http_code}\n' https://download.lilnas.io/   # 302 → auth
```

---

## History

**Until 2026-09-15** this environment was **a containerised backend plus a
native `next dev`**, defined by `apps/download/deploy.verify.yml`. It was
replaced because it had three problems the current shape does not:

- **No auth.** The native server listened on `0.0.0.0:8090`, and anything
  reaching it without an `X-Forwarded-User` header took the `DEV_USER_EMAIL`
  admin fallback — so any host on the LAN had an admin session against live
  Radarr and Sonarr credentials.
- **A snapshot of real user history sat on the host** at
  `/tmp/download-verify/`, created with `sqlite3 .backup` from production.
- **Two processes to start and stop**, only one of which was under compose.

**Until 2026-09-19** this environment lived in a separate
`apps/download/deploy.dev-remote.yml`, kept out of the root compose `include:`
lists so a routine dev startup would never auto-expose it. That file's shape is
now `apps/download/deploy.dev.yml` itself — see the note under
[Why this shape](#why-this-shape).

`deploy.verify.yml` is deleted, not merely retired — do not try to resurrect it.
