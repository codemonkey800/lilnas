# Local verification environment

A repeatable way to run `@lilnas/download` against the **live** Radarr, Sonarr,
Emby and MinIO upstreams — with real data, real titles, real file paths — while
the production container keeps serving `download.lilnas.io` untouched.

The shape is: **containerised backend, native frontend.**

---

## Read this first

> [!CAUTION]
> **`DATABASE_PATH` must never be `/storage/app-data/download/download.db`.**
>
> That is production's live database. `lilnas-download-1` holds it open in WAL
> mode; a second process writing it can corrupt the running service's data.
> The verification backend always points at a throwaway snapshot under
> `/tmp/download-verify`.

> [!CAUTION]
> **Snapshot with `sqlite3 .backup`, never `cp`.**
>
> A bare `cp` of `download.db` without its `-wal` sibling is a stale — possibly
> torn — read. As of this writing prod's `download.db-wal` is ~4 MB against a
> 140 KB `download.db`, so a `cp` would miss essentially all recent history.
> `.backup` takes a consistent snapshot of database + WAL in one go.

> [!CAUTION]
> **Never name the verification container `lilnas-download-1`.**
>
> That is production. `docker rm -f` on it takes `download.lilnas.io` down.
> The name used everywhere below is `download-verify-backend`.

Two more standing rules for this environment:

- `deploy.verify.yml` must **never** be added to the root
  `docker-compose.yml` `include:` list. It is a verification tool, not a
  service.
- No mutating requests. Only `GET`s against a live upstream. The `:ro` library
  mounts are defence in depth behind that rule, not a replacement for it.

---

## Why this shape

**The backend runs in a container, for path fidelity.** Radarr and Sonarr
report file paths like `/movies/Foo (2020)/Foo.mkv` and `/tv/Bar/…`. Those
paths exist inside the container's `:ro` bind mounts and **do not exist on the
host** (`ls /movies` → `No such file or directory`; the real trees live at
`/storage/media-library/{movies,tv}`). A host-native backend therefore 404s on
the disk-streaming branch, which is exactly the branch the local-save work has
to verify. `pnpm dev:backend` does boot natively and is a fine fallback for
everything _except_ local save — but the container is the closer match to
production.

**The frontend runs natively, because it is the thing being edited.** Hot
reload is the entire point; a containerised Next server defeats it.

**The backend must publish on 8081.** `next.config.js` hardcodes
`http://localhost:8081` as the destination for both the `/api/:path*` and
`/ws/:path*` rewrites. Publishing the container's 8081 to `127.0.0.1:8081` is
what makes those existing rewrites work unchanged — no config edits, nothing to
remember to revert.

**The frontend runs on 8090, not 8080.** `pnpm dev:frontend` is
`next dev -p 8080`, and `url-shortener-proxy-1` already owns host port 8080
(`0.0.0.0:8080->80/tcp`). Invoke Next directly with `-p 8090` instead of using
the script.

**`/movies` and `/tv` are mounted `:ro`.** A stray delete fails loudly instead
of removing real library files.

---

## Setup

### 1. Snapshot the database into its own **directory**

SQLite writes `-wal` and `-shm` files _beside_ the database, so mounting the
bare `.db` file is not enough — it must be a directory.

```bash
mkdir -p /tmp/download-verify
sqlite3 /storage/app-data/download/download.db \
  ".backup /tmp/download-verify/download.db"
```

The host directory must be owned by UID 1000 — the image's `node` user —
or `better-sqlite3` throws `SQLITE_CANTOPEN` on first boot. On this host
`jeremy` _is_ UID 1000, so a plain `mkdir` already gets this right.

After the container has booted once the directory holds all three files:

```
download.db  download.db-shm  download.db-wal
```

### 2. Write `apps/download/.env.verify-container`

Copy `apps/download/.env.prod` verbatim — including every secret, the MinIO
credentials and the Radarr/Sonarr/Emby API keys — and **keep the Docker service
names** (`MINIO_HOST=storage`, `RADARR_URL=http://radarr:7878`,
`SONARR_URL=http://sonarr:8989`, `EMBY_URL=http://emby:8096`). The container
runs on `lilnas_default`, so it resolves those by service name exactly as
production does.

Then override / add exactly four variables:

| Variable         | Value                        | Why                                                                                                                                                                                                                  |
| ---------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`       | `development`                | `.env.prod` says `production`, and the image bakes `NODE_ENV=production` too. `resolveForwardedUser()` refuses the dev identity fallback unless this is not `production`.                                            |
| `DATABASE_PATH`  | `/data/download.db`          | The snapshot, via the bind mount. Prod's `.env.prod` does not define this at all — `deploy.yml` injects it — so here it is a genuine addition.                                                                       |
| `DEV_USER_EMAIL` | an address in `ADMIN_EMAILS` | Dev has no Traefik, so no `X-Forwarded-User` header ever arrives; this is the only identity source. It must be an admin address or the admin dashboard and the unmasked-attribution paths cannot be verified at all. |
| `DEV_USER_ID`    | `verify-user-1`              | The paired user id. `resolveForwardedUser()` requires **both** to be non-empty before it falls back.                                                                                                                 |

`ADMIN_EMAILS` lives on the `lilnas-auth-1` container
(`docker inspect lilnas-auth-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep ADMIN_EMAILS`).
At time of writing it holds exactly one address.

> `.env.verify-container` is covered by the root `.gitignore` rule `.env.*`,
> alongside `.env.prod`. Never commit either, and never paste their values into
> a document or a PR. Note that `docker compose -f deploy.verify.yml config`
> **inlines the whole env file into its output** — useful for checking the
> resolved config, but never paste that output anywhere either.

### 3. Start the backend from the production image

```bash
docker compose -f apps/download/deploy.verify.yml up -d
```

`deploy.verify.yml` reproduces this exactly, and is the preferred entry point.
The equivalent raw command, for reference:

```bash
docker run -d --name download-verify-backend \
  --network lilnas_default \
  --env-file apps/download/.env.verify-container \
  -v /tmp/download-verify:/data \
  -v /storage/media-library/movies:/movies:ro \
  -v /storage/media-library/tv:/tv:ro \
  -p 127.0.0.1:8081:8081 \
  --entrypoint node lilnas-download dist/main
```

Notes on the overrides:

- `--entrypoint node … dist/main` replaces the image's own entrypoint,
  `ENTRYPOINT ["pnpm", "start"]`, which runs `run-p start:*` and would
  otherwise start the Next server as well. Only the NestJS backend is wanted
  here.
- The image tag is the one the root compose file already built — no `build:`,
  so verification can never rebuild or replace what production is running.
  Confirm they match with
  `docker inspect lilnas-download-1 download-verify-backend --format '{{.Image}}'`.
- The container exposes 8080 (the Next port) but only 8081 is published,
  because nothing is listening on 8080 inside it.

Check it came up:

```bash
docker logs download-verify-backend | head -5
# … "Starting Nest application…" / Started backend server at http://localhost:8081
```

### 4. Start the frontend natively

```bash
cd apps/download && npx next dev -p 8090
```

Use `npx next dev -p 8090`, not `pnpm dev:frontend` — the script hardcodes
8080, which is taken.

---

## Verification checks

Hit the **frontend** at 8090; that exercises the Next `/api` rewrite as well as
the backend, which is the point. All four are read-only `GET`s.

Observed on 2026-09-14 against the environment described above:

| Check                                   | Observed                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/auth/whoami`                  | `isAdmin: true`, `userId: "verify-user-1"`, email = the configured `DEV_USER_EMAIL` |
| `GET /api/download/gallery`             | `total: 28`, 24 items on the first page, real titles                                |
| `GET /api/download/history`             | `total: 50`, 24 jobs on the first page                                              |
| `GET /api/download/discover?query=star` | `total: 40`, 24 items on the first page, `degradedSources: []`, 20 genre facets     |

```bash
curl -s localhost:8090/api/auth/whoami
# {"email":"…","userId":"verify-user-1","isAdmin":true}

curl -s localhost:8090/api/download/gallery |
  jq '{total, page: (.items | length), titles: [.items[:3][].media.title]}'
# { "total": 28, "page": 24, "titles": [ … real titles … ] }

curl -s localhost:8090/api/download/history |
  jq '{total, page: (.items | length)}'
# { "total": 50, "page": 24 }

curl -s 'localhost:8090/api/download/discover?query=star' |
  jq '{total, page: (.items | length), degradedSources,
       genreFacets: (.facets.genres | length)}'
# { "total": 40, "page": 24, "degradedSources": [], "genreFacets": 20 }
```

Reading the numbers:

- `total` is the full result count; `items` is one page. The default page size
  is 24, so a first page of 24 with a non-null `nextCursor` is correct and not
  a truncated result.
- `degradedSources: []` is the important one on `/discover` — a non-empty array
  means Radarr or Sonarr was unreachable and the results are partial.
- **`/discover` takes `query`, not `q`, and `query` is required with a minimum
  of 2 characters** (`DiscoverQuerySchema` in
  `packages/utils/src/download/schema.ts`). `?q=` and `?query=` both return
  `400 Validation failed`. Any search term with real matches works; `star` is
  used above because it exercises a broad genre spread.
- `gallery` and `history` counts come from the **snapshot**, so they drift as
  production accrues jobs. Re-snapshot (step 1) and expect different numbers;
  what matters is that they are non-zero and the titles are real.

---

## Edge cases and gotchas

- **Booting mutates the copy.** `reconcileInterruptedJobs()` runs at startup
  (`src/bootstrap.ts`) and sweeps every non-terminal job to `failed` with
  `error: 'Interrupted by a service restart'`. That is expected and harmless on
  a copy — but it means the snapshot's in-flight states are **gone after the
  first boot**. Re-snapshot if you need to see them.
- **Mount the directory, not the file.** Repeated because it is the easiest
  mistake to make: a single-file bind mount leaves SQLite unable to create its
  `-wal`/`-shm` siblings.
- **`DEV_USER_EMAIL` must be an admin address.** A non-admin address gives a
  working session with `isAdmin: false`, and the admin dashboard plus every
  unmasked-attribution path becomes unverifiable. Note that `hiddenAttribution`
  on history rows is admin-sensitive.
- **Container IPs are irrelevant in this shape.** The backend sits on
  `lilnas_default` and resolves `radarr` / `sonarr` / `emby` / `storage` by
  service name, so nothing goes stale when an upstream container is recreated.
  Do not hardcode an IP anywhere.
- **The native backend fallback.** `pnpm dev:backend` boots fine and is quicker
  to iterate on, but it cannot resolve `/movies` or `/tv`, so anything touching
  disk streaming or local save will 404. Use the container for those.
- **Do not `docker compose up` the root file to "fix" anything here.** The two
  containers share an image but nothing else; the verification one is started
  only from `deploy.verify.yml`.

---

## Teardown

```bash
docker rm -f download-verify-backend      # or: docker compose -f apps/download/deploy.verify.yml down
# stop the `next dev -p 8090` process (Ctrl-C in its terminal)
rm -rf /tmp/download-verify apps/download/.env.verify-container
```

Removing `/tmp/download-verify` is what guarantees no stale copy of real user
history is left lying around on the host. Removing `.env.verify-container`
removes a plaintext copy of every production secret.

Double-check afterwards that production is still up:

```bash
docker ps --filter name=lilnas-download-1
```
