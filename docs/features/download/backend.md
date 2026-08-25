# Download App — Backend Plan

Companion to [`spec.md`](spec.md) and [`user-stories.md`](user-stories.md).
Covers what the backend needs to build to support the full spec — the
frontend is being rebuilt against the spec in parallel. This started as a
design/sequencing document; Phases 0–2 have since been implemented (see
their status notes below), so treat this as a living plan, not a frozen
spec — check current code before assuming a later phase is still pending.

## Context

Originally, the backend covered only a fraction of the spec: a yt-dlp
pipeline and Radarr/Sonarr request/delete, both tracked in a single
**in-memory `Map`** (`DownloadStateService`) with no persistence, no user
identity, and no list endpoints — every read was `GET /:id` by a known ID.
Phases 0–2 below closed that gap (durable SQLite persistence, forwarded-user
identity, admin check, attributed job history, list/query endpoints).
Phases 3–8 are still pending.

Four foundational decisions were made before planning:

1. **Persistence**: drizzle-orm + better-sqlite3, matching `apps/swole`'s
   existing pattern (no shared Postgres).
2. **Admin status**: sourced from `apps/auth`, not a duplicated local
   `ADMIN_EMAILS` env var.
3. **Audit log**: a generic, decoupled schema (actor/action/target/metadata),
   not tied 1:1 to the job table — satisfies the spec's explicit
   "extensible to future services" requirement.
4. **Emby indexed-check**: match by imported file path (not title/year) —
   more reliable, at the cost of one new column on the job record.

The phases below are ordered by dependency: Phase 0 unblocks everything else
and should ship first. Phases 1–2 unblock most of the rest. Phases 3–8 are
largely independent of each other and can be reordered/reprioritized freely
once 0–2 are in place.

---

## Phase 0 — Foundation: persistence, identity, admin check

**Status: done.** SQLite persistence (`7a32820d`), forwarded-identity
primitive (`625ac4df`), and the stateless auth admin-check endpoint
(`6883859c`) all shipped.

**Persistence** (confirmed pattern from `apps/swole/src/db/*`, adapted for a
real NestJS app — swole is Next.js-only with a module-level singleton and no
DI container; download needs a proper injectable):

- `apps/download/src/db/schema.ts` — one flat file, all tables (mirrors
  swole's convention). camelCase TS props, explicit snake_case column names,
  JSON columns via `text({ mode: 'json' }).$type<T>()`, timestamps via
  `integer('col', { mode: 'timestamp_ms' })`.
- `apps/download/drizzle.config.ts` — `schema: './src/db/schema.ts'`,
  `out: './src/db/migrations'`, `dialect: 'sqlite'`,
  `dbCredentials: { url: process.env.DATABASE_PATH ?? './download.db' }`.
  New `db:generate` script (`drizzle-kit generate`) in `package.json`.
- New `DbService`/provider wrapping a `better-sqlite3` connection +
  `drizzle(sqlite, { schema })`, registered as a Nest provider/export
  alongside `DownloadStateService` in a new `DbModule`. Same pragmas as
  swole (WAL, `foreign_keys=ON`, `busy_timeout`).
- Migrations run automatically at boot (in `bootstrap.ts`, before
  `app.listen()`), hard-fail on a bad `PRAGMA integrity_check` — never serve
  traffic on a half-migrated schema.
- `DATABASE_PATH` env var; `deploy.yml` volume
  `/storage/app-data/download:/data` (mirrors swole); `deploy.dev.yml` bind
  mount path; `.gitignore` entries for the sqlite file + WAL/SHM sidecars.
- Tests: `Test.createTestingModule().overrideProvider(DbService)` with an
  in-memory (`:memory:`) DB running the real migration files — simpler than
  swole's `jest.mock` workaround since Nest DI provides a real seam.

**Identity** — confirmed via repo-wide grep that **no NestJS code anywhere in
lilnas currently reads `X-Forwarded-User`/`X-Forwarded-User-Id`** (only
Grafana trusts them, via native auth-proxy config, not app code). New:

- A request-scoped decorator/guard in `apps/download` reading
  `req.headers['x-forwarded-user']` / `['x-forwarded-user-id']`, 401ing if
  absent — trusted for the same reason Grafana trusts it (Traefik's
  `lilnas-auth` middleware is the only network path in; confirmed in
  `apps/download/deploy.yml`). This is the identity primitive every other
  phase (attribution, admin-gating, audit log actor, Emby gating) builds on.

**Admin check** — confirmed no existing apps/auth endpoint answers "is this
email an admin" statelessly (the only admin-aware routes are cookie-gated).
Smallest correct addition:

- `apps/auth/src/admin/admin-check.controller.ts` — new, **guard-free**
  controller (can't hang off the existing `AdminController`, which is
  `@UseGuards(AdminGuard)` at the class level and requires a live session
  cookie): `GET /admin/check?email=` → `{ isAdmin: boolean }`, reusing the
  already-exported `isAdminEmail()` + `EnvKeys.ADMIN_EMAILS` exactly as
  `me.controller.ts` and `admin.controller.ts` already do. Registered flat
  in `app.module.ts`'s `controllers` array (matches `MeController`'s own
  no-per-feature-module convention).
- Reachability: confirmed port 8081 (where all of auth's Nest routes live)
  has no Traefik router at all — it's reached only container-to-container,
  same mechanism Traefik's own `forwardauth.address=http://auth:8081/verify`
  and `apps/tdr-bot`'s `DownloadClient.dockerInstance` already use. No
  chicken-and-egg with `lilnas-auth`. Being reachable ungated by any
  container on the shared network is accepted precedent, not a new risk
  category (`apps/tdr-code/src/bot/bot-status.controller.ts` documents the
  identical trust boundary for its own unauthenticated status route) — worth
  a one-line comment on the new controller acknowledging it.
- `apps/download` side: new `packages/utils/src/auth/client.ts`
  (`AuthClient`, mirroring `DownloadClient`'s `local/docker/remote Instance`
  shape) rather than an inline `fetch` — matches the repo's existing
  convention of publishing inter-service clients from `packages/utils`.
  Cache the result with a short in-memory TTL (~60s) keyed by email inside
  apps/download, since admin-check will be called on most list/detail
  requests once Phase 1 wires it in.

---

## Phase 1 — Job persistence & attribution

**Status: done.** Jobs table as system of record (`7a5cf18d`), attribution
masking threaded through (`85ccfa8a`), WS gateway re-validates admin status
on every broadcast rather than trusting a stale connection-time flag
(`41b53efe`) — closes the privacy gap described below.

- `jobs` table: id, type, requester user id/email, hidden-attribution flag
  (video only), status, title, timestamps, file location(s) (including the
  Phase-6 Emby-match path for movies/shows), source metadata (poster,
  overview — currently re-fetched from Radarr/Sonarr on every request).
- Write to `jobs` from the two existing choke points that already centralize
  every job mutation — `DownloadStateService.addJob()` / `updateJob()`
  (confirmed these are the _only_ two places job state changes anywhere
  today, including the video pipeline, `MediaDownloadService`, and
  `MediaPollerService`). The in-memory `Map` stays as the live/hot
  coordination structure (queue, in-progress tracking, the video job's
  live `ChildProcess` handle — which can never be persisted and shouldn't
  be, since a restart kills the underlying yt-dlp process too); the DB
  becomes the durable system of record, written alongside it.
- Populate requester + hidden-toggle at job creation (`DownloadController`'s
  `createVideoJob`/`requestMovie`/`requestShow`) from the new identity
  decorator.
- **WS gateway becomes connection-identity-aware.** `DownloadGateway`
  currently tracks connections as a bare `Set<WebSocket>` and broadcasts one
  identical JSON payload to every client — confirmed by reading
  `download.gateway.ts`. That's a real privacy gap: the spec requires hidden
  attribution to be invisible to regular users, and broadcasting the true
  requester to every socket (even if the frontend only _renders_ it for
  admins) leaks it in the raw WS frame, inspectable via devtools. Fix: read
  the forwarded-user header at WS handshake time, track
  `Map<WebSocket, { isAdmin: boolean }>` instead of a bare `Set`, and have
  `DownloadStateService.broadcastJobEvent()` send an anonymized variant to
  non-admin sockets and the real one to admin sockets.
- Update the existing single-job serializers (`getJobResponse`,
  `getMovieJobResponse`, `getShowJobResponse` in `download.controller.ts`)
  to do the same admin/hidden branch for REST reads.

---

## Phase 2 — List/query endpoints

**Status: done, response shapes since superseded.** List/query schemas
(`bdcd51f0`), DB query layer for job listing and pagination (`9419e4fd`), and
activity/gallery/history/discover endpoints (`5c376921`) all shipped as
described below. The **media entity refactor**
(`docs/features/download/plans/001-media-entity-refactor.md`) then reshaped
every response on top of the same endpoints: the gallery became
media-centric (one card per title, grouped by `(type, media_id)` instead of
one row per job), and search/discover now return the unified `Media` type
instead of the type-specific `MovieSearchResult`/`ShowSearchResult`/
`DiscoveryResult` shapes this phase originally introduced. See "The
media/job split" below for what changed and why; the list/pagination
mechanics this phase built (cursors, filters, facets) are unaffected.

Built entirely on Phase 1's durable `jobs` table:

- Downloads Activity Page: `GET` all in-progress jobs across all users
  (doesn't exist today — every read is by known ID). Admin variant reuses
  the same attribution-aware serialization from Phase 1.
- Unified gallery: filterable by date, uploader, media type.
- Discovery: interleave movie/show search results into one ranked list;
  genre/release-date-range filters, sort (relevance/title/release date).
  Note: today's `RadarrService.search()`/`SonarrService.search()` are
  straight title-lookup passthroughs — confirm Radarr's/Sonarr's own lookup
  actually supports cast/genre search before assuming it for free.
- Per-user download history (also feeds Phase 8's admin dashboard).

---

## The media/job split (media entity refactor)

**Status: done.** Full design and phase-by-phase history in
`docs/features/download/plans/001-media-entity-refactor.md`.

Phase 1's `jobs` table originally carried both the _event_ (who requested,
when, what happened) and the _metadata_ (title, poster, overview, …) on one
wide row, duplicated per download — downloading the same movie twice produced
two disconnected copies of its title and poster. The refactor splits those
two concerns:

- **`DownloadJob`** stays a plain, uniform row: id, status, error, requester,
  hidden-attribution, timestamps, plus a `(type, mediaId)` pointer. It no
  longer carries any title/poster/overview/etc. fields itself.
- **`Media`** is a discriminated union (`Video | Movie | Show`) describing the
  title. Movies and shows have **no table** — Radarr/Sonarr are already the
  system of record for that metadata, so it's resolved live through the new
  `MediaResolverService` (whole-library cache, 60s success / 10s failure TTL)
  rather than persisted a second time. Only **videos** get a table
  (`videos`), since nothing upstream tracks them.
- `Media.id` is a **derived key** (`tmdb:438631`, `tvdb:121361`,
  `video:V1StGXR8_Z5`), minted by one function and never stored as a
  separate identity — a search hit, a discovery result, and a downloaded
  movie are now literally the same `Movie` object.

This is why the gallery (Phase 2, above) became media-centric: with no media
table, `GET /gallery` groups the job log itself (`GROUP BY type, media_id`)
and hydrates each group's title through the resolver, rather than joining to
a metadata table that no longer exists. Activity and history stay job-centric
— they're event feeds by nature, unaffected by the split.

**The trade-off, stated plainly:** movie/show metadata is now
read-through-dependent on Radarr/Sonarr. If Radarr is down, a movie card
degrades to its bare key instead of 500ing (`degradedSources` names the
outage), but it can't render a title until Radarr answers again. Accepted —
see the plan's §8.2 for the full reasoning — because a persisted copy would
just drift from Radarr/Sonarr's own record the way the pre-refactor `jobs`
row already did.

`apps/tdr-bot` is intentionally untouched by this refactor (§5.2 of the
plan): a compatibility shim in `packages/utils/src/download/client.ts` keeps
its exact pre-refactor wire shape alive, tagged
`TODO(tdr-bot-migration)`, until a follow-up change migrates it onto
`DownloadJob`/`Media` directly.

---

## Phase 3 — File selection, replacement, bad-file reporting

**Status: done** (backend only — no frontend surface yet). Full plan in
`docs/features/download/plans/003-phase-3-file-selection.md`. Commits, in
order: `e2a673c3` (wire contract), `b8662002` (`bad_files` table + migration
0005), `10ec51c6` (repo), `817eb346` (Radarr wrappers), `f6bac26b` (Sonarr
wrappers), `be66eec1` (`ReleaseService` + list), `e6c28899` (grab),
`782431f3` (replace), `072cc031` (flag + enforcement), `05579b8a`
(endpoints), `4baa6e26` (test wiring).

### What shipped

| Route                                       | Auth                     | Does                                               |
| ------------------------------------------- | ------------------------ | -------------------------------------------------- |
| `GET /download/media/:id/releases`          | none                     | Interactive-search results, `flaggedBad`-annotated |
| `POST /download/media/:id/releases/grab`    | `@OptionalCurrentUser()` | Grabs one chosen release as a `DownloadJob`        |
| `POST /download/media/:id/releases/replace` | `@OptionalCurrentUser()` | Deletes current file(s), then grabs                |
| `POST /download/media/:id/bad-files`        | `ForwardedUserGuard`     | Flags a release as bad                             |
| `GET /download/media/:id/bad-files`         | none                     | Lists a title's flags                              |

Routes key on **media** id, not job id — releases belong to a title, not to a
download event, and browsing them for a title nobody has requested yet is the
primary use case. Flagging is the one route that requires identity: a flag
records a judgement _someone_ made.

### Monitoring is borrowed, not kept

The load-bearing constraint: Radarr/Sonarr won't surface (or let you grab)
releases for a title that isn't **in the library and monitored**. So listing
releases for a not-yet-requested title has to add and monitor it first —
and leaving it that way would let an RSS sync grab something nobody asked
for.

`ReleaseService.withMonitoring()` therefore captures, monitors, acts, and
restores. The rule that makes it safe: **if it was already monitored, change
nothing — on the way in or on the way out.** A title with a pending
`requestMovie` is monitored on purpose, and blindly unmonitoring after a
release listing would silently kill that request. A failed restore logs a
warning and is swallowed; failing the caller's read because the cleanup
didn't take would be the wrong trade.

Sonarr needs one extra layer: series-level `monitored` isn't enough, because
a series added with `monitor: 'none'` has a monitored series row and
unmonitored episodes. `ensureSeries` reports back **only the episodes it
switched on**, so the restore can't clobber ones the user monitored
deliberately.

**Grab and replace opt out of the restore.** Once the user has picked a
release the title stays monitored, so Radarr/Sonarr manage the import and
future upgrades — exactly the state `requestMovie` already leaves behind.

> **Accepted race:** the borrow window spans one interactive indexer search
> (seconds to ~a minute). If an RSS sync ticks inside that window _and_ the
> feed carries a matching release, Radarr can self-grab. Small, and strictly
> better than the permanently-monitored state `requestMovie` already leaves.

One side effect worth knowing: Sonarr's add path now passes
`searchForMissingEpisodes: false`. The search moved to the explicit
`SeriesSearch` command `requestShow` was _already_ sending afterwards, so a
request still searches exactly once — but browsing releases for a
not-yet-added show no longer kicks off a series-wide grab as a side effect.

### Auto-select enforcement

`requestMovie`/`requestShow` **ensure first, then decide**:

- **No flags** → fire the same generic `MoviesSearch`/`SeriesSearch` command
  as before, byte for byte. Radarr/Sonarr's own scoring still picks.
- **Flags present** → the app fetches releases itself, drops flagged and
  upstream-`rejected` ones, and grabs the best of what's left
  (`pickBestRelease`: custom-format score, then seeders, then publish date —
  all descending, fully deterministic). Nothing left fails the job with a
  message saying why, rather than leaving it in `Searching` forever.

That selector isn't trying to out-think Radarr/Sonarr's scoring, which still
runs for every unflagged title. It only has to beat the alternative, which is
failing the request outright.

Enforcement is **app-side only** — Radarr's and Sonarr's own selection logic
is untouched, so a search started from _their_ UI can still re-pick a flagged
release. That's the spec's accepted gap, not an oversight.

### Deferred

- **No frontend.** Every route above is backend-only; nothing in the Next.js
  app calls them yet.
- **No unflag route.** `deleteBadFile` exists in the repo and is tested, but
  no endpoint exposes it — a route away, not a schema change away.
- **Per-episode download/delete UX** stays Phase 4. Phase 3 passes
  `seasonNumber`/`episodeId` straight through to Sonarr where it supports
  them, but doesn't build the UI concept.

### Manual verification (needs live Radarr/Sonarr)

Not covered by the unit suite — the monitoring borrow/restore in particular
can only be proven against real instances. Run from inside the Docker
network, or against `https://download.lilnas.io`:

```bash
BASE=http://download:8081/download

# 1. Releases for a movie ALREADY in the library.
curl -s "$BASE/media/tmdb:27205/releases" | jq '.releases | length'

# 2. Releases for a NOT-YET-ADDED movie. Should return results, and the
#    movie should be left UNMONITORED afterwards - the borrow/restore.
curl -s "$BASE/media/tmdb:157336/releases" | jq '.releases[0]'
#    Then confirm in Radarr: the movie exists, monitored = false.

# 3. Releases for a movie with a PENDING request (monitored on purpose).
#    Must be left STILL MONITORED - this is the branch that would
#    otherwise silently kill the pending request.
curl -s -XPOST "$BASE/movies" -H 'content-type: application/json' \
  -d '{"tmdbId":157336}'
curl -s "$BASE/media/tmdb:157336/releases" >/dev/null
#    Then confirm in Radarr: monitored = true, still.

# 4. Grab a specific release. The title must stay MONITORED afterwards.
GUID=$(curl -s "$BASE/media/tmdb:27205/releases" | jq -r '.releases[0].guid')
IDX=$(curl -s "$BASE/media/tmdb:27205/releases" | jq -r '.releases[0].indexerId')
curl -s -XPOST "$BASE/media/tmdb:27205/releases/grab" \
  -H 'content-type: application/json' \
  -d "{\"guid\":\"$GUID\",\"indexerId\":$IDX}" | jq '.status'

# 5. Replace: deletes the current file(s), then grabs.
curl -s -XPOST "$BASE/media/tmdb:27205/releases/replace" \
  -H 'content-type: application/json' \
  -d "{\"guid\":\"$GUID\",\"indexerId\":$IDX}" | jq '.status'

# 6. Flag it, then confirm the loop closes.
curl -s -XPOST "$BASE/media/tmdb:27205/bad-files" \
  -H 'content-type: application/json' \
  -H "x-forwarded-user: you@example.com" -H 'x-forwarded-user-id: u1' \
  -d "{\"guid\":\"$GUID\",\"reason\":\"audio desync\"}" | jq

#    a) The listing now marks it.
curl -s "$BASE/media/tmdb:27205/releases" \
  | jq --arg g "$GUID" '.releases[] | select(.guid==$g) | .flaggedBad'   # true

#    b) Grabbing it is refused with a 409.
curl -s -o /dev/null -w '%{http_code}\n' \
  -XPOST "$BASE/media/tmdb:27205/releases/grab" \
  -H 'content-type: application/json' \
  -d "{\"guid\":\"$GUID\",\"indexerId\":$IDX}"                            # 409

#    c) A plain re-request now takes the fetch-and-pick path and grabs
#       something OTHER than the flagged release (check Radarr's history).
curl -s -XPOST "$BASE/movies" -H 'content-type: application/json' \
  -d '{"tmdbId":27205}' | jq '.status'
```

---

## Phase 4 — Per-episode/season granularity (shows)

**Status: done** (backend only — no frontend surface yet). Full plan in
`docs/features/download/plans/004-phase-4-episode-granularity.md`. Commits, in
order: `d7fe301e` (wire contract), `4dfbec3a` (`jobs.scope` + migration 0006),
`144c96ff` (seasons/episodes read path), `64504e66` (scoped commands,
`resolveScope`, `unmonitorScope`), `7627d1cd` (episode-file util),
`3d45f7e2` (`ShowService`), `79156215` (scoped `requestShow`), `b49bdc0d`
(poller aggregation), `1c7f6eda` (scope on grab/replace), `2a06663e`
(endpoints), `6dd7f18b` (integration).

### What shipped

| Route                              | Auth                     | Does                                                     |
| ---------------------------------- | ------------------------ | -------------------------------------------------------- |
| `GET /download/media/:id/seasons`  | none                     | Seasons + episodes, with file and monitoring state       |
| `DELETE /download/media/:id/files` | `@OptionalCurrentUser()` | Deletes an episode / a season / every file, + unmonitors |
| `POST /download/shows`             | `@OptionalCurrentUser()` | Now accepts `episodeId` / `seasonNumber`                 |

A show is no longer all-or-nothing. `POST /shows` with no scope is
byte-for-byte the pre-Phase-4 path, so nothing about the existing behavior
moved.

### The scope lives on the job, not in the media id

`media_id` stays `tvdb:121361`. A season or episode download is still a
download _of a show_, and minting `tvdb:121361:s3e5`-style keys would have
broken `mediaIdSuffix()` + `Number()` at every consumer and fragmented the
gallery into one card per episode.

So the **job** carries a nullable `scope` — `{ episodeId?, episodeNumber?,
seasonNumber? }` — in one JSON column (`jobs.scope`, migration 0006, CHECKed
to `type = 'show'`). Absent means the whole series, which is exactly what
every pre-Phase-4 row means, so there was nothing to backfill.

`episodeNumber` is denormalized on purpose. `episodeId` is a Sonarr primary
key and useless to render; without the number, an activity row for one
episode could only say "The Wire", not "The Wire — S03E05", unless the
frontend fetched the seasons endpoint per job. Same reasoning as
`bad_files.release_title`.

> **Migration 0006 needed a hand-edit.** SQLite can't add a CHECK to an
> existing table, so drizzle-kit emitted the standard table rebuild — with
> the copy step selecting `scope` from the _pre-0006_ table, which fails with
> `no such column: "scope"` and takes every migration run with it. The SELECT
> reads `NULL` in that position instead. Anyone regenerating a migration that
> adds a column **and** a constraint should expect the same and read the
> emitted SQL.

### Delete removes files, not the library entry

```
DELETE /download/media/tvdb:81189/files?seasonNumber=3&episodeId=4412
```

Narrowest first: `episodeId` → one file, `seasonNumber` → that season's,
neither → every file of the title. Works for `tmdb:` keys too (one movie
file), which gives the movie detail page a delete that needs no existing job.
The series/movie **stays in the library** — removing a title outright is
still the job-keyed `DELETE /download/shows/:jobId`.

**The delete unmonitors what it deleted**, and that is the load-bearing half.
To Sonarr a monitored episode with no file is a _missing_ episode, so without
the unmonitor the next RSS sync or missing-episode search re-downloads
exactly what the user just removed. It therefore runs even when zero files
were deleted, and a failed unmonitor logs a warning rather than failing the
request — the files are already gone by then. Afterwards
`mediaResolverService.invalidate(mediaId)` so `filePath` re-resolves off
post-delete truth.

Deleting zero files is a **success**, not a 404: the caller asked for a state
and that state already held.

### The poller aggregates instead of taking the first match

`pollShows()` used `queue.find(q => q.seriesId === job.upstreamId)`. Sonarr
queues one item **per episode**, so that was already lossy for a series-wide
search — a season flipped to `Completed` the moment its first episode landed
— and outright wrong once two episode-scoped jobs can exist for one series,
since both would read the same arbitrary item.

Items are now filtered by the job's scope and folded by
`aggregateQueueItems`: `size`/`sizeleft` summed, status fields taken from the
dominant item under `failed > downloading > importing`, `timeleft` from the
item with the largest `sizeleft` (the one that finishes last), and
`statusMessages` concatenated so every failure is still reported.
Classification runs through `deriveStatusFromQueueItem` itself, so the
aggregate can never disagree with a per-item derivation. An empty match list
returns `undefined` — exactly what `find()` returned for "no entry" — so the
disappeared-means-completed rule is untouched. Radarr keeps `find()`: one
movie, one file, one queue item.

### Scoped search picks a narrower command

The Phase 3 rule holds — a title with no `bad_files` rows keeps the command
path. Phase 4 only picks a _narrower_ command:

| Scope        | Command                                           |
| ------------ | ------------------------------------------------- |
| episode      | `EpisodeSearch`, body `{ episodeIds: [id] }`      |
| season       | `SeasonSearch`, body `{ seriesId, seasonNumber }` |
| whole series | `SeriesSearch` — unchanged                        |

When the title _does_ have flagged releases, the existing fetch-and-pick path
runs unchanged; `getReleases(sonarrId, scope)` already took a scope, so only
the argument changed.

`resolveScope` runs **after** `ensureSeries`, not before — an episode id
can't exist for a series Sonarr has never seen. That puts the resolution
inside `submit()`, after the job has already been minted, so `submit` returns
an optional `{ scope }` that `request()` folds into the same `updateJob` that
moves the job to `Searching`. One broadcast for one state change, and the job
is minted with the _requested_ scope so even the `created` event never shows
a scoped request as a whole-series one.

### Findings from implementation

- **`resolveScope` ordering vs. minting the job.** The plan called for
  `request()` to write the scope at mint time _and_ for resolution to happen
  after `ensureSeries`. Those can't both hold without a second write, hence
  the `RequestSubmitResult` return value described above.
- **`ShowScopeSchema` sits above `DownloadJobSchema`**, not under the Phase 4
  banner at the bottom of `schema.ts`, because that schema carries it and a
  `const` can't be read before its initializer runs.
- **`media-backfill.spec.ts` needed updating.** It stops at migration 0003 on
  purpose but reads back through the current drizzle schema, so `jobs.scope`
  broke it. `applyRemainingMigrationFiles()` reads the migrations folder
  rather than hard-coding tags, so the next migration won't re-break it.
- **Nothing observed about the season-level `monitored` flag** — human
  checkpoint 2 below is still outstanding.

### Deferred

- **No frontend.** Every route above is backend-only; nothing in the Next.js
  app calls them yet.
- **No `DownloadClient` methods** for the new routes — Phase 3 added none
  either, and nothing in-repo calls them yet. `apps/tdr-bot` compiles against
  the unmodified shim.
- **No season/episode summary fields on `ShowSchema`.** `GET /seasons`
  answers it; a second copy would drift.
- **No bulk `deleteApiV3EpisodefileBulk`.** The sequential per-file loop is
  slower and safer.
- **Still no unflag route** for `bad_files`, deferred from Phase 3.
- **The season-level `monitored` flag is reported, never written.** Episode
  monitoring is what governs searching. If a live check shows Sonarr ignoring
  monitored episodes inside an unmonitored season, `postApiV3Seasonpass` is
  the escape hatch.

### Manual verification (needs live Sonarr)

⚠️ **This block deletes real files.** Not covered by the unit suite — the two
command names in particular are unverified against a running Sonarr, and a
wrong literal fails _silently_ (Sonarr 400s the command and the job lands in
`Failed`).

```bash
BASE=http://download:8081/download
SHOW=tvdb:81189   # a show already in the library

# 1. Seasons listing. Season 0 (specials) must be present, not filtered out.
curl -s "$BASE/media/$SHOW/seasons" \
  | jq '.seasons[] | {seasonNumber, monitored, episodeCount, episodeFileCount}'

EP=$(curl -s "$BASE/media/$SHOW/seasons" \
  | jq -r '.seasons[] | select(.seasonNumber==3) | .episodes[0].id')

# 2. Request ONE episode. The job's scope must round-trip with the
#    episodeNumber resolved server-side.
curl -s -XPOST "$BASE/shows" -H 'content-type: application/json' \
  -d "{\"tvdbId\":81189,\"episodeId\":$EP}" | jq '{status, scope}'
#    THEN: Sonarr -> Activity -> Queue. A search must actually be queued -
#    a 201 alone does NOT prove 'EpisodeSearch' is the right command name.

# 3. Request one SEASON. Same check in Sonarr's Activity -> Queue for
#    'SeasonSearch'.
curl -s -XPOST "$BASE/shows" -H 'content-type: application/json' \
  -d '{"tvdbId":81189,"seasonNumber":3}' | jq '{id, status, scope}'

# 4. Watch that season job while its episodes land one at a time. It must
#    NOT reach `completed` until the LAST one leaves Sonarr's queue.
watch -n5 "curl -s $BASE/activity | jq '.items[] | {id, status, scope}'"

# 5. Delete one episode, then confirm in Sonarr that it is BOTH file-less
#    AND unmonitored. Unmonitored is the half that makes the delete stick.
curl -s -XDELETE "$BASE/media/$SHOW/files?episodeId=$EP" | jq
curl -s "$BASE/media/$SHOW/seasons" \
  | jq --argjson e "$EP" '.seasons[].episodes[] | select(.id==$e) | {hasFile, monitored}'
#    Expect: { "hasFile": false, "monitored": false }

# 6. Deleting again is a 200 with deletedCount 0, not a 404.
curl -s -XDELETE "$BASE/media/$SHOW/files?episodeId=$EP" | jq '.deletedCount'

# 7. A movie key with a scope is a 400, not a silently-ignored scope.
curl -s -o /dev/null -w '%{http_code}\n' \
  -XDELETE "$BASE/media/tmdb:27205/files?seasonNumber=3"                  # 400

# 8. Re-request the deleted episode. It must re-monitor and re-download.
curl -s -XPOST "$BASE/shows" -H 'content-type: application/json' \
  -d "{\"tvdbId\":81189,\"episodeId\":$EP}" | jq '{status, scope}'
```

**Also still to check by hand:** a series whose season 3 is unmonitored at
the _season_ level but whose episodes this app switched on — confirm Sonarr
still searches them. If it doesn't, `postApiV3Seasonpass` needs wiring in.

---

## Phase 5 — Video pause/resume

- New `Paused` status (distinct from `Cancelled`) +
  `resumeVideoDownloadJob`, symmetric to the existing
  `cancelVideoDownloadJob` (`download.service.ts`) — re-enters `download()`
  for the same job ID/working directory instead of finalizing it.
- Spec already verified the core mechanism works (yt-dlp's `--continue`
  resumes from exact byte offset after `proc.kill()`/SIGTERM, no files
  deleted). Open item flagged in the spec itself: confirm behavior against
  whatever default format selection actually ships (tested against a
  forced progressive format; default/best-quality may resolve to fragmented
  DASH, which resumes via a different, unverified-here mechanism).

---

## Phase 6 — Emby playback handoff

Recovered from git: the referenced `EmbyModule` was never deleted — it's
intact on the unmerged local branch `feat/theater-app`
(`apps/theater/src/emby/{emby.module,emby.controller,emby.service,emby.schema}.ts`,
recoverable via `git show feat/theater-app:apps/theater/src/emby/<file>`),
not lost history. It's much bigger than what download needs, though: ~90%
of it is streaming/HLS-proxy/subtitle plumbing for an _embedded_ player.
Per the spec, download's "Watch" is a pure **handoff** ("navigates to the
item in Emby"), not embedded playback — so the new `apps/download/src/emby`
module should be written fresh and small, reusing only:

- The `resolveUserId()` pattern (resolve `EMBY_USERNAME` to a real Emby
  `UserId` via `GET /Users`, cache it) — confirmed still needed, Emby uses
  one static shared service account regardless of which lilnas user is
  asking, same as theater's model. No per-lilnas-user Emby credential
  mapping needed.
- Two hard-won gotchas baked into the old code as comments, still relevant
  if any playback-info call is ever needed: `PlaybackInfo` 500s if `UserId`
  is omitted despite Emby's docs marking it optional; `DirectStreamUrl`
  mirrors `TranscodingUrl` even when direct streaming isn't supported, so
  mode must be decided from capability flags, never field presence. (Neither
  may even be needed for a pure deep-link handoff — confirm once Phase 6
  design lands whether a bare `{EMBY_URL}/web/index.html#!/item?id=...`
  link is sufficient, which would drop the need for `getPlaybackInfo`
  entirely.)
- Env vars: `EMBY_API_KEY`, `EMBY_URL`, `EMBY_USERNAME` (unchanged shape).

**Indexed-check**: poll Emby's `GET /Items` for an entry whose `Path` matches
the imported file's on-disk path, then match found → "Watch" with a deep link
built from the matched item's ID; no match yet → "Indexing…". This is
entirely new logic — the old theater code never had an indexed/pending
concept (confirmed: it assumed the whole library was already present).
Path-based matching was chosen over title/year matching for reliability —
Emby can render/sanitize titles differently than Radarr/Sonarr, risking a
missed match even after indexing.

**Updated by the media entity refactor (above): `filePath` is no longer a
persisted `jobs` column.** The original plan had this phase store Radarr/
Sonarr's reported path on the job row; post-refactor, `filePath` is derived
live off the Radarr/Sonarr library through `MediaResolverService` /
`toMovie()`/`toShow()` the same way every other movie/show metadata field is.
Whichever service performs the indexed-check should read `media.filePath`
off the resolved `Media` rather than a `jobs` column. This also means the
refactor's "bug that disappears" applies here too: there's nothing to null
out on delete, since Radarr simply stops reporting the path and the next
resolve is correct by construction.

**Auth**: swap theater's signed-cookie `SessionGuard` for the same
forwarded-header decorator/guard built in Phase 0 — no login flow, no
`AuthController`/session-cookie machinery needed at all, Traefik ForwardAuth
already replaces that whole layer.

---

## Phase 7 — Local save-to-device

Videos already have MinIO `downloadUrls` (`DownloadVideoService.upload()`)
— likely frontend-only wiring. Movies/shows live on Radarr/Sonarr-managed
disk paths, not MinIO, so they need a new file-serving endpoint (stream the
file at the path stored on the `jobs` row from Phase 1/6).

---

## Phase 8 — Admin dashboard & audit log

- `audit_log` table (decoupled from `jobs`): `actor`, `action` (string, e.g.
  `video.download.create`, `file.flag_bad`, `movie.delete`), `target_type`
  - `target_id` (nullable), `metadata` (JSON), `timestamp`.
- A small `AuditLogService.record()` called from each controller action
  needing an entry — centralize the write path the same way
  `DownloadStateService.addJob()`/`updateJob()` already centralizes job
  mutations, so future endpoints (and, per spec, future services calling
  into the download API) have one obvious place to hook in rather than
  scattered inline writes.
- Aggregate stats + per-user history: queries against `jobs` (Phase 2
  already built per-user history; this phase adds cross-user aggregates —
  top downloaders, usage trends). System-wide metrics may partially reuse
  the existing `DownloadMetricsService` Prometheus counters rather than
  duplicating counters in SQL.

---

## Verification (once implementation starts)

- **Unit tests** per new service, following the existing
  `__tests__`-alongside-source convention already used throughout
  (`download-state.service.test.ts`, `media-poller.service.test.ts`, etc.)
  — in particular a migration/schema round-trip test using the real
  migration files against an in-memory DB (Phase 0), and admin/hidden
  serialization branch tests (Phase 1) covering both WS payload variants
  and REST responses.
- **Manual end-to-end**: run the dev stack (`pnpm run dev` /
  `docker-compose -f docker-compose.dev.yml up -d download`), issue curl
  requests with a manually-set `X-Forwarded-User`/`X-Forwarded-User-Id`
  header to simulate Traefik locally without needing a live `lilnas-auth`
  stack, and confirm: a real yt-dlp/Radarr/Sonarr job produces a durable
  `jobs` row; a simulated-admin request sees true attribution on a
  hidden-toggled video while a simulated-regular request doesn't (both over
  REST and by inspecting the raw WS frame); a bad-file flag blocks
  re-auto-selection; and, for Phase 6, that a known-indexed title in the
  real lilnas Emby instance resolves to "Watch" while a freshly-downloaded,
  not-yet-scanned one shows "Indexing…".
