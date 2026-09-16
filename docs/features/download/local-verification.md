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
| Compose file                     | `apps/download/deploy.dev-remote.yml`           |
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

One more standing rule: `deploy.dev-remote.yml` must **never** be added to the
root `docker-compose.yml` `include:` list. It is a development tool, not a
service.

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

**The database is ephemeral.** `/data` is a tmpfs, so it is built from scratch
on every start and destroyed when the container stops. Nothing persists, nothing
needs cleaning up, and there is no snapshot of real user history sitting on the
host.

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
> `docker compose -f deploy.dev-remote.yml config` **inlines the whole env file
> into its output** — use `config --quiet` to validate without printing secrets.

> [!IMPORTANT]
> **A compose `environment:` entry cannot override these.** `pnpm dev` runs
> `lilnas dev`, which calls Node's `loadEnvFile()` on `apps/download/.env`
> (`packages/cli/src/commands/dev.ts:48`) and overwrites the container
> environment with it. That is why `deploy.dev-remote.yml` mounts
> `.env.dev-remote` **over** `.env` inside the container instead. Symptom if you
> get this wrong: the database silently lands wherever `.env` said.

### 3. Start it

```bash
docker compose -f apps/download/deploy.dev-remote.yml up -d
docker compose -f apps/download/deploy.dev-remote.yml logs -f
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

| Check                                   | Observed                                             |
| --------------------------------------- | ---------------------------------------------------- |
| `GET /api/auth/whoami`                  | `isAdmin: true`, `userId: "verify-user-1"`           |
| `GET /api/download/gallery`             | `total: 0` — **expected, the database is ephemeral** |
| `GET /api/download/history`             | `total: 0` — same                                    |
| `GET /api/download/discover?query=star` | `total: 40`, `degradedSources: []`, 20 genre facets  |

```bash
curl -s localhost:8090/api/auth/whoami
# {"email":"…","userId":"verify-user-1","isAdmin":true}

curl -s 'localhost:8090/api/download/discover?query=star' |
  jq '{total, page: (.items | length), degradedSources,
       genreFacets: (.facets.genres | length)}'
# { "total": 40, "page": 24, "degradedSources": [], "genreFacets": 20 }
```

Reading the numbers:

- **`gallery` and `history` being 0 is correct, not a failure.** The database is
  rebuilt empty on every start. Discovery still returns real results because
  `/discover` reads Radarr and Sonarr live rather than the database. To get rows,
  paste a link into the nav-bar field and let a real yt-dlp job run.
- `total` is the full result count; `items` is one page. Default page size is 24,
  so a first page of 24 with a non-null `nextCursor` is correct, not truncated.
- `degradedSources: []` is the important one on `/discover` — a non-empty array
  means Radarr or Sonarr was unreachable and the results are partial.
- **`/discover` takes `query`, not `q`, and it is required with a minimum of 2
  characters** (`DiscoverQuerySchema`, `packages/utils/src/download/schema.ts`).
  `?q=` returns `400 invalid_type`; a bare `?query=` returns `400 too_small`.

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
- **Booting sweeps interrupted jobs.** `reconcileInterruptedJobs()`
  (`src/bootstrap.ts`) moves every non-terminal job to `failed` at startup.
  Irrelevant on an ephemeral database, but it means an in-flight job does not
  survive a restart.
- **Container IPs are irrelevant in this shape.** The container resolves
  `radarr` / `sonarr` / `emby` / `storage` by service name on `lilnas_default`,
  so nothing goes stale when an upstream is recreated. Do not hardcode an IP.
- **Router names are global to Traefik.** This router is `dev-download`, not
  `download` — production's `deploy.yml` already registers `download` with the
  same Traefik, and **Traefik does not warn on router-name collisions.**
- **`tls=true`, not `tls.certresolver=le`.** All `*.dev.lilnas.io` routes share
  one wildcard cert; requesting a per-host cert wastes Let's Encrypt's ~50 new
  certs/week budget. See `docs/lilnas-expose.md`.
- **Do not `docker compose up` the root file to "fix" anything here.** This
  container is started only from `deploy.dev-remote.yml`.

---

## Teardown

```bash
docker compose -f apps/download/deploy.dev-remote.yml down

# also drop the cached node_modules and pnpm store:
docker compose -f apps/download/deploy.dev-remote.yml down -v
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

## The retired shape

Until 2026-09-15 this environment was **a containerised backend plus a native
`next dev`**, documented here and defined by `apps/download/deploy.verify.yml`.
It was replaced because it had three problems the current shape does not:

- **No auth.** The native server listened on `0.0.0.0:8090`, and anything
  reaching it without an `X-Forwarded-User` header took the `DEV_USER_EMAIL`
  admin fallback — so any host on the LAN had an admin session against live
  Radarr and Sonarr credentials.
- **A snapshot of real user history sat on the host** at
  `/tmp/download-verify/`, created with `sqlite3 .backup` from production.
- **Two processes to start and stop**, only one of which was under compose.

`deploy.verify.yml` still exists but is **retired — do not start it.** It would
bring up a second backend on `127.0.0.1:8081` and compete with this container.
