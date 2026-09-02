# Download App — Backend Plan

**Status: complete.** Every phase below (0–8, plus the media/job split
refactor) has landed and is verified against the code, not just self-reported
— see the status table for the phase list and each phase's section for its
commits. The backend now supports the full spec. What remains is out of this
document's scope: the Next.js frontend hasn't been built against Phases 3–8
yet (each phase is annotated "backend only" below), and a handful of
per-phase manual/live-infra verification steps are still outstanding (see
each phase's "Deferred" / "Manual verification" notes).

Companion to [`spec.md`](spec.md) and [`user-stories.md`](user-stories.md).
This started as a design/sequencing document for what the backend needed to
build to support the full spec; it's kept as a living implementation log
rather than being archived, since each phase's section records the decisions,
findings, and verification steps made while building it.

## Status at a glance

| Phase                                        | Status                                                     |
| -------------------------------------------- | ---------------------------------------------------------- |
| 0 — Foundation: persistence, identity, admin | ✅ done                                                    |
| 1 — Job persistence & attribution            | ✅ done                                                    |
| 2 — List/query endpoints                     | ✅ done — response shapes since superseded by the refactor |
| _(the media/job split refactor)_             | ✅ done                                                    |
| 3 — File selection, replacement, bad files   | ✅ done — backend only                                     |
| 4 — Per-episode/season granularity (shows)   | ✅ done — backend only                                     |
| 5 — Video pause/resume                       | ✅ done — backend only                                     |
| 6 — Emby playback handoff                    | ✅ done — backend only                                     |
| 7 — Local save-to-device                     | ✅ done — backend only                                     |
| 8 — Admin dashboard & audit log              | ✅ done — backend only                                     |

**"Backend only"** means the routes and their tests are built and committed,
but no Next.js surface calls them yet — the frontend rebuild consumes them
later. That's the only thing left outstanding; the backend itself is
feature-complete against the spec. Each phase's section below carries its own
commits, decisions, findings, and manual-verification steps.

## Context

Originally, the backend covered only a fraction of the spec: a yt-dlp
pipeline and Radarr/Sonarr request/delete, both tracked in a single
**in-memory `Map`** (`DownloadStateService`) with no persistence, no user
identity, and no list endpoints — every read was `GET /:id` by a known ID.
Phases 0–2 below closed that gap (durable SQLite persistence, forwarded-user
identity, admin check, attributed job history, list/query endpoints). Phases
3–7 then built out the spec's media features on top of it: file selection and
bad-file reporting, per-episode granularity, video pause/resume, the Emby
playback handoff, and save-to-device. Phase 8 closed the set with the audit
log and the admin dashboard's read endpoints. Every phase has now landed on
the backend; what's outstanding is the frontend that consumes them.

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

The phases below were ordered by dependency: Phase 0 unblocked everything
else and shipped first, Phases 1–2 unblocked most of the rest, and Phases
3–7 were largely independent of each other. That sequencing is now history —
0–8 have all landed.

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
- **Unflag route — since added.** `DELETE /media/:id/bad-files/:flagId`,
  `ForwardedUserGuard`-gated like the flag route itself — undoing a judgement
  is a judgement too. `deleteBadFile` now scopes its delete to
  `(mediaId, id)` together in one query, so a real flag id requested under
  the wrong media route 404s rather than deleting a different title's flag.
  `DownloadClient.unflagBadFile()` added alongside it. Nothing in-repo calls
  either yet.
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
- **`DownloadClient` methods — since added.** `listSeasons` and
  `deleteMediaFiles` cover both new routes, landed alongside Phase 3's five
  (`listReleases`, `grabRelease`, `replaceRelease`, `flagBadFile`,
  `listBadFiles`) in the shared-client hardening pass,
  `docs/features/download/plans/011-shared-client-hardening.md`. Nothing
  in-repo calls them yet, and `apps/tdr-bot` still compiles against the
  unmodified shim.
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

⚠️ **This block deletes real files.** Not covered by the unit suite.

**On the two unverified command names.** A wrong `name` is _not_ the silent
failure — Sonarr resolves the command type by name and rejects an unknown one
with a non-2xx, which `checkSdkError` puts on the job along with Sonarr's own
message. The genuinely silent case is a **wrong body field name**: the command
is accepted, the field is ignored, and nothing is searched.

Both are checkable directly, without reading the UI. `POST /api/v3/command`
returns a `CommandResource` whose `body` is Sonarr's _parsed_ command, so
field binding is visible in the response itself, and `GET /api/v3/command/{id}`
reports `status` (`queued → started → completed|failed`), `result` and
`exception`:

```bash
SONARR=http://sonarr:8989          # or https://sonarr.lilnas.io
H=(-H "x-api-key: $SONARR_API_KEY" -H 'content-type: application/json')

ID=$(curl -s "${H[@]}" -XPOST "$SONARR/api/v3/command" \
  -d '{"name":"SeasonSearch","seriesId":9,"seasonNumber":3}' | jq -r '.id')

sleep 5
curl -s "${H[@]}" "$SONARR/api/v3/command/$ID" \
  | jq '{name, status, result, exception, message, body}'
```

| What you see                       | What it means                                       |
| ---------------------------------- | --------------------------------------------------- |
| Non-2xx on the POST                | The command **name** is wrong                       |
| 201, but `.body` lacks your fields | **The silent one** — the body field names are wrong |
| `status: failed` + `exception`     | Bound, but the command couldn't run                 |
| `status: completed`, successful    | Good — confirm actual grabs in `/api/v3/history`    |

Cheapest check of all, with no side effects at all: open Sonarr's own UI with
DevTools → Network and click "Search Season". The outgoing request body _is_
the authoritative name and field list. Note `Command` in
`packages/media/src/sonarr/types.gen.ts` only models the base fields — the
OpenAPI spec doesn't describe the per-command subtypes, which is both why the
SDK can't type-check any of this and why raw `curl` is the right tool here.

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
#    A `searching` status means Sonarr accepted 'EpisodeSearch' - a bad name
#    would land the job in `failed` carrying Sonarr's own message. What that
#    does NOT prove is that `episodeIds` bound; use the command-resource
#    check above for that, then confirm a real grab below.

# 3. Request one SEASON. Same reasoning for 'SeasonSearch' + `seriesId`/
#    `seasonNumber`.
curl -s -XPOST "$BASE/shows" -H 'content-type: application/json' \
  -d '{"tvdbId":81189,"seasonNumber":3}' | jq '{id, status, scope}'
#    Then confirm Sonarr actually searched that season and only that season:
curl -s "${H[@]}" "$SONARR/api/v3/history?eventType=1&pageSize=20" \
  | jq '.records[] | {eventType, seasonNumber: .episode.seasonNumber, date}'

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

**Status: done** (backend only — no frontend surface yet). Full plan in
`docs/features/download/plans/005-phase-5-video-pause-resume.md`. Commits, in
order: `238ab01f` (interrupt record + `JobInterruptedError`), `222e61ec`
(`Paused`/`Pausing` statuses), `4dc19883` (pipeline reads the intent, and
`download.log` opens in append mode), `5e627d77` (scheduler interrupt branch,
`requeue()`, pause/resume counters), `010a367a` (service methods, cancel
rewritten onto the shared path), `58ec2a43` (endpoints).

A video download used to be start-or-abandon: `PATCH /videos/:id/cancel`
killed yt-dlp and the job ended at `Cancelled`. Phase 5 adds the third
option — stop now, keep the bytes, pick it up later.

### What shipped

| Route                               | Auth                     | Does                                                    |
| ----------------------------------- | ------------------------ | ------------------------------------------------------- |
| `PATCH /download/videos/:id/pause`  | `@OptionalCurrentUser()` | SIGTERMs the live yt-dlp; job goes `Pausing` → `Paused` |
| `PATCH /download/videos/:id/resume` | `@OptionalCurrentUser()` | Puts the job on the back of the queue as `Pending`      |

Both return the job `projectJobForViewer`'d, and neither has an admin gate —
whoever can start a video download can interrupt one, which is what cancel
already assumed.

```
Downloading --PATCH pause---> Pausing --(proc closes)--> Paused
Paused      --PATCH resume--> Pending (back of queue) --(slot frees)--> Downloading
Paused      --PATCH cancel--> Cancelled
Downloading --PATCH cancel--> Cancelling --(proc closes)--> Cancelled
```

The guards, and what they map to over HTTP:

| Guard                             | Code | Message                                                                                    |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| Not in the live `jobs` Map        | 404  | `Job with ID '<id>' not found`                                                             |
| `type !== Video`                  | 400  | `Job '<id>' is not a video job`                                                            |
| Pause: status isn't `Downloading` | 409  | `Job '<id>' cannot be paused while it is '<status>'; only a downloading job can be paused` |
| Pause: no live process            | 409  | `Job '<id>' has no running process to pause`                                               |
| Resume: status isn't `Paused`     | 409  | `Job '<id>' cannot be resumed while it is '<status>'; only a paused job can be resumed`    |

Neither route reads the `jobs` table as a fallback the way the read paths do:
a pausable job is by definition running right now, so it is in the Map, and a
row that outlived a restart has no process left to pause.

`videoInterruptRoute()` (the shared controller helper) deliberately does
**not** copy `cancelVideoJob`'s catch block, which rewrites every failure into
a 404. That is survivable for cancel — `cancelVideoDownloadJob` still throws
bare `Error`s, left that way on purpose so the pre-existing route keeps
behaving identically — but it would be actively wrong here: reporting "this
job isn't downloading right now" (409) as "job not found" (404) tells a UI to
drop a job that is alive and well.

### One mechanism for every deliberate kill

Pause and cancel are the **same primitive** — `proc.kill()`, SIGTERM, nothing
deleted — and differ only in what the job lands in afterwards. Before this
phase the pipeline couldn't tell a deliberate kill from a crash at all: SIGTERM
produces a non-zero exit code, `download()` threw on it, and the scheduler
marked the job `Failed`.

So `DownloadStateService` now carries a small **intent record** —
`interruptions: Map<string, JobInterruptKind>`, `'cancel' | 'pause'`, with
`setInterruption`/`getInterruption`/`clearInterruption`. The order at the call
site is load-bearing: the intent goes on record **before** the signal, because
`runProcess()`'s close handler fires as soon as the process dies and reads the
note synchronously. `assertNotInterrupted()` runs in both `download()` and
`convert()` the moment a process settles and **before** the `code !== 0`
check, throwing `JobInterruptedError`; the scheduler branches on
`instanceof` ahead of its generic `Failed` handling.

The record is never persisted. It describes an in-flight process, and a
restart kills the process anyway.

### The cancel wedge this fixed

`cancelVideoDownloadJob` used to call `proc.removeAllListeners('close')`
before attaching its own handler. The listener it stripped was the one
`runProcess()` settles its promise from — so after a cancel,
`await downloadProcess.promise` never resolved, `download()` never returned,
and the scheduler's `finally` never ran. The dead job held its `inProgressJobs`
slot forever, and the open log-file stream leaked with it. **At
`MAX_DOWNLOADS=1`, a single cancel wedged the queue until the process
restarted.**

The new mechanism removes the need for `removeAllListeners` entirely: the
close listener stays, the promise settles, `download()` throws the sentinel,
and the scheduler releases the slot. Cancel's observable outcome is unchanged
(the job still ends at `Cancelled`) — the leak is what went away. `convert()`
got the same check, so cancelling during ffmpeg stops wedging too.

### Pause is only legal while `Downloading`

One guard doing two jobs. It keeps pause off the ffmpeg phase — ffmpeg has no
resume, so pausing during `convert()` would mean restarting the transcode from
zero, strictly worse than not offering it; `Uploading` and `Cleaning` are
seconds long and not worth a button either. And it makes `getProc(id)`
unambiguous: `convert()` writes `Converting` before it spawns, so a job still
reading `Downloading` can only have the yt-dlp handle registered — the one
process that _can_ pick up where it left off.

### Resume re-runs `download()` from the top

There is no "unpause the existing process", because pausing killed it.
`resumeVideoDownloadJob` pushes the job id onto the **back** of the queue via
the scheduler's new `requeue()`, and `maybeProcessNextJob()` picks it up like
any other pending job. `download()` then runs unchanged: same
`/download/videos/<jobId>` working directory, where yt-dlp's default
`--continue` finds the leftover `.part` file and resumes from its byte offset.

Three deliberate details:

- **The redundant metadata re-fetch stays.** Skipping it would mean a second
  entry point into `download()` whose only distinguishing feature is being
  subtly different from the first — a duplicated code path for the sake of one
  avoidable HTTP request.
- **`requeue()` is not `add()`.** `addJob()` re-persists the row and
  broadcasts a `Created` event, so a resumed job would pop into every Activity
  feed a second time. `requeue()` only pushes onto the queue and pumps it.
- **A resumed job doesn't jump the line.** `Queue.push()` appends, so it
  competes for a slot on the same terms as a new one; with `MAX_DOWNLOADS`
  full it simply sits at `Pending`.

`runProcess()` also opens `download.log` with `flags: 'a'`, so a resumed run
appends instead of truncating the first run's output — which is the only
record of how the download got to where it left off.

### Two new statuses, no migration

`Paused` and `Pausing` are both **non-terminal**, so
`TERMINAL_DOWNLOAD_JOB_STATUSES` is unchanged and
`IN_PROGRESS_DOWNLOAD_JOB_STATUSES` picks them up for free — which is what
keeps a paused job on the Activity feed instead of dropping it into history.
That is the right call: a paused job is unfinished work someone still owns.

No migration was needed. `jobs.status` is `text({ enum: ... })`, and drizzle's
SQLite text-enum is a **TypeScript-only** constraint — every migration emits a
bare `` `status` text NOT NULL `` with no CHECK, and the snapshots record the
column with no enum values. Verified: no CHECK in any migration references
`status`, and `db:generate` was never run (it emits nothing for this change).

### ⚠️ A restart still fails a paused job — on purpose

`reconcileInterruptedJobs()`
(`apps/download/src/db/reconcile-interrupted-jobs.ts`) sweeps every
non-terminal row to `failed` with `Interrupted by a service restart` at boot,
and Phase 5 deliberately does **not** exempt `paused`.

The reason is where the bytes live. `VIDEO_DIR` is `/download/videos`, and
**neither `apps/download/deploy.yml` nor `deploy.dev.yml` mounts a volume
there** — only `/data` (the SQLite file) is persisted. The partial file sits
in the container's writable layer: it survives a process restart inside a live
container, and is destroyed by any `up -d --build` or recreate. Meanwhile the
in-memory `DownloadStateService.jobs` Map is gone either way. "Resume after a
restart" would therefore be a promise the deployment can't keep; failing the
job is the honest answer, and it costs zero new code.

This is a design decision, not a bug — see the [Deferred](#deferred-2) note on
what it would take to change.

### Findings from implementation

- **`Pausing` is not resumable.** Pause-then-immediately-resume returns a 409
  during the brief `Pausing` window, deliberately: the old yt-dlp is still
  winding down, and requeueing now would run a second one against the same
  `.part` file. A frontend should keep resume disabled until the job reads
  `paused`.
- **`resumeVideoDownloadJob` returns a re-read record**, not the one
  `updateJob(Pending)` returned. `requeue()` → `maybeProcessNextJob()` →
  `download()` run synchronously up to `download()`'s first `await`, and
  `download()` writes `Downloading` before that point — so with a free slot the
  `Pending` snapshot is already stale by the time the method returns. It
  returns `jobs.get(id) ?? pending`.
- **The scheduler clears the interruption on the pause path too**, not just
  cancel. `Paused` is non-terminal, so `updateJob()`'s terminal auto-clear
  never fires for a pause — and `assertNotInterrupted()` reads the note after
  _every_ process exit, so a surviving `'pause'` note would make a resumed job
  re-pause itself the moment its new yt-dlp finished. The pause branch clears
  the dead child-process handle (`clearProc`) for the same reason.
- **An interrupt recorded after a clean exit still throws** — a pause racing a
  download that was about to finish. The job parks at `Paused` with a complete,
  `.part`-free file on disk; resuming re-runs yt-dlp, which exits immediately
  with "already downloaded". Accepted and documented in a code comment rather
  than detected, since detecting it means second-guessing an explicit user
  intent to save one no-op round trip.
- **Cancel books its metric in `download.service.ts`, not the scheduler**
  (`metrics.jobCompleted('cancelled')` at the point of cancellation), so the
  scheduler's interrupt branch deliberately records nothing for cancel —
  otherwise it would double-count. Pause/resume get their own counters,
  `download_jobs_paused_total` and `download_jobs_resumed_total`.
- **Log-field inconsistency**: the pause/resume success log uses
  `inProgressJobs` where the sibling `cancelVideoJob` uses
  `inProgressJobsRemaining` for the same value. Cosmetic, worth aligning some
  day.
- **`apps/tdr-bot` stays untouched.** The compatibility shim in
  `packages/utils/src/download/client.ts` (`TODO(tdr-bot-migration)`) is
  byte-for-byte unmodified and still compiles. Adding enum members is additive:
  tdr-bot's polling loop compares statuses with plain `===` rather than an
  exhaustive switch, so a `paused` job just keeps polling until its iteration
  budget runs out — and tdr-bot has no way to pause anything, so that path is
  unreachable in practice.
- **Two pre-existing infra hazards surfaced during verification** (neither
  caused by this phase): `turbo.json` gives `test`/`type-check` no
  `dependsOn: ["^build"]` while `packages/utils` exports only `./dist/*.js`, so
  `type-check` fails hard from a genuinely cold checkout until something builds
  `packages/utils` (tests are insulated by jest's source-mapped
  `moduleNameMapper`); and `apps/download`'s `build` is `run-p build:*`, so
  `next build` rewrites `.next/types/` while `nest build --type-check`
  enumerates it via the `.next/types/**/*.ts` include at
  `apps/download/tsconfig.json:39` → intermittent `TS6053`. Seen once, did not
  reproduce across three later builds including a clean `--force` run.

### Deferred

- **No frontend.** Both routes are backend-only; nothing in the Next.js app
  calls them yet — there is no cancel button today either, and the rebuild
  consumes all three together.
- **`DownloadClient.pauseJob`/`resumeJob` — since added**, along with the
  Phase 3 and 4 methods, in the shared-client hardening pass
  (`docs/features/download/plans/011-shared-client-hardening.md`). Both take a
  job id, not a media key, exactly like `getJob`/`cancelJob`. Nothing in-repo
  calls them yet.
- **Pause does not survive a restart.** Changing that needs a volume for
  `/download/videos` (plus the `chown 1000:1000` the `/data` mount already
  documents in `deploy.yml`) _and_ boot rehydration. See the ⚠️ section above
  for why shipping without it was the honest choice.
- **No pause timeout or auto-expiry.** Nothing in the spec asks for one; a
  paused job is its owner's to resume or cancel.
- **No partial-file cleanup when a paused job dies.** Cancel doesn't clean up a
  job directory today either — an unrelated pre-existing gap.
- **No pausing movie/show jobs.** Radarr/Sonarr own that queue; the spec scopes
  pause to the yt-dlp pipeline.

### Known gap — Radarr/Sonarr pause/resume detection

Radarr/Sonarr-managed downloads can be paused and resumed **independently of
this app**, at the backing download client (qBittorrent, SABnzbd, …), from
Radarr/Sonarr's queue UI or the client's own UI. This app has no design for
surfacing that, and it needs its own phase.

The signal exists: the queue API already exposes `status: 'paused'`
(`QueueStatus` in `packages/media/src/{radarr,sonarr}/types.gen.ts`) and
`MediaPollerService` already polls that queue every 10s. What's missing is the
classification — `deriveStatusFromQueueItem`
(`apps/download/src/media/queue-status.util.ts:180-211`) doesn't special-case
it, so a paused item falls into the catch-all branch and is reported as
`Downloading`. Polling is the only available signal, too: Radarr/Sonarr fire no
Connect-notification event for pause/resume (only Grab, Download, Rename,
Health Issue, Manual Interaction Required).

### Manual verification (needs a running container)

⚠️ **Not yet run** — this spawns real yt-dlp against real hosts and needs a
running container, so it is a human checkpoint rather than something the suite
covers. Run from inside the Docker network, or against
`https://download.lilnas.io`:

```bash
BASE=http://download:8081/download

# 1. The round trip. Start something long, pause it, confirm the bytes stop
#    moving, resume it, confirm it picks up where it left off.
ID=$(curl -s -XPOST "$BASE/videos" -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ"}' | jq -r '.id')

sleep 20
curl -s -XPATCH "$BASE/videos/$ID/pause" | jq '.status'          # pausing
sleep 2
curl -s "$BASE/videos/$ID" | jq '.status'                        # paused

#    The .part file must exist and STOP growing - two reads, same size.
docker-compose exec download ls -l "/download/videos/$ID"
sleep 10
docker-compose exec download ls -l "/download/videos/$ID"

curl -s -XPATCH "$BASE/videos/$ID/resume" | jq '.status'         # pending|downloading

#    The resume proof: yt-dlp reports the offset it restarted from, and the
#    file grows FROM there rather than restarting at zero.
docker-compose exec download \
  grep -i 'Resuming download at byte' "/download/videos/$ID/download.log"
watch -n5 "curl -s $BASE/videos/$ID | jq '{status, progress}'"   # -> completed

# 2. Pausing a job that isn't downloading is a 409, not a 404.
curl -s -o /dev/null -w '%{http_code}\n' -XPATCH "$BASE/videos/$ID/pause"  # 409

# 3. A paused job can still be abandoned.
PID=$(curl -s -XPOST "$BASE/videos" -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ"}' | jq -r '.id')
sleep 20
curl -s -XPATCH "$BASE/videos/$PID/pause" >/dev/null
sleep 2
curl -s -XPATCH "$BASE/videos/$PID/cancel" | jq '.status'        # cancelled

# 4. THE WEDGE FIX. With MAX_DOWNLOADS=1, cancel the running job and confirm
#    the next queued job STARTS instead of the queue stalling forever.
A=$(curl -s -XPOST "$BASE/videos" -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ"}' | jq -r '.id')
B=$(curl -s -XPOST "$BASE/videos" -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=BaW_jenozKc"}' | jq -r '.id')
sleep 10
curl -s "$BASE/videos/$B" | jq '.status'                         # pending
curl -s -XPATCH "$BASE/videos/$A/cancel" >/dev/null
sleep 10
curl -s "$BASE/videos/$B" | jq '.status'                         # downloading, NOT pending
```

**Also still to check by hand:**

- **Resume against the format the app actually downloads.** The spec's live
  test forced a progressive format (`-f worst` → itag 18). The app forces no
  format, so a default YouTube grab may resolve to fragmented DASH, which
  resumes per-fragment through a different mechanism. Checking for: whether
  resume genuinely continues, or silently restarts from zero. **Not yet
  verified.**
- **Resume for a clip job.** A `timeRange` download adds
  `--download-sections` + `--force-keyframes-at-cuts`
  (`download-video.service.ts`), routing through a different downloader.
  Checking for: whether `.part` resume applies at all, or whether a paused clip
  restarts. **Not yet verified.**
- **A decision on a `/download/videos` volume.** Making pause survive a restart
  needs one plus a `chown 1000:1000`; it is a deploy change with a host
  prerequisite, which is why this phase shipped without it.
- **Deploy** with `docker-compose up -d download` from the repo root, per
  `CLAUDE.md` — never from `apps/download/deploy.yml` directly.

---

## Phase 6 — Emby playback handoff

**Status: done** (backend only — no frontend surface yet). Full plan in
`docs/features/download/plans/006-phase-6-emby-playback-handoff.md`. Commits,
in order: `34798d36` (wire contract), `d62d460e` (env vars), `bbbff14b`
(typed Emby HTTP client), `93817601` (`EmbyStatusService`), `789f439f`
(annotation inside `MediaResolverService.resolve()`), `6aa0d5ff` (module
wiring test).

A downloaded movie or show is watched in Emby, not here. This phase answers
the one question the spec's Watch action needs — _has Emby indexed this yet,
and where do I send the browser_ — and answers it as an optional field on the
media the frontend already fetches.

### ⚠️ There was no prior art to port — don't go digging

This section used to claim the old theater app's `EmbyModule` survived intact
on the unmerged local branch `feat/theater-app` and could be recovered with
`git show feat/theater-app:apps/theater/src/emby/<file>`, citing commit
`9c665e1`. **All of that was false**, and disproving it cost time. The
verified facts:

- `feat/theater-app` (`832a6fde`) is a single scaffold commit with **no
  `emby` directory** in it at all.
- `git rev-list --all --objects | grep -i emby` matched **zero objects**
  across the entire repo history prior to this phase. No Emby code had ever
  been committed here.
- The only Emby client ever written for lilnas (an `emby.client.ts` alongside
  tdr-bot's Radarr/Sonarr clients) was never committed, never executed (0%
  coverage), didn't typecheck against its own base class, and survives only
  inside a coverage-report HTML file in another worktree.
- The two "hard-won gotchas" cited here — that `PlaybackInfo` 500s without
  `UserId`, and that `DirectStreamUrl` mirrors `TranscodingUrl` — appear
  **nowhere in the repo**. Neither does any `resolveUserId()` implementation;
  that was written fresh for this phase.

Everything under `apps/download/src/emby/` is new code.

### What shipped — no new routes

| File                     | Does                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `emby.schema.ts`         | Zod schemas for Emby's `Users`, `Items` and `System/Info` responses                |
| `emby.service.ts`        | Typed HTTP client. Raw GETs, no caching, throws on anything unexpected             |
| `emby-status.service.ts` | Classifies a downloaded title `indexed`/`indexing`/`unknown`, builds the watch URL |
| `emby.module.ts`         | Exports `EmbyStatusService`; imported by `MediaModule`                             |

`embyStatus` attaches to `Media`, **not** to a new endpoint. It's an optional
field on `ManagedMediaBaseSchema`, so it exists on `Movie | Show` and never on
`Video`. Because the zod schema types _are_ the wire types — there is no
serializer layer — that one edit propagates to job payloads, gallery items,
media detail and WS frames with zero controller changes and zero new routes.
Nothing needed adding to `DownloadClient` either.

Annotation happens in `MediaResolverService.resolve()` via one batched
`EmbyStatusService.annotate()` call — the same "grafted at hydration, never
persisted" pattern as `queueSnapshot`. It reads `media.filePath` off the
resolved `Media`, which the media entity refactor already derives live off
Radarr/Sonarr, so the original plan's "store the Emby-match path on the job
row" never happened. The refactor's "bug that disappears" applies here too:
there's nothing to null out on delete, since Radarr simply stops reporting the
path and the next resolve is correct by construction.

### The API surface, and where it came from

Base path prefix `/emby`, auth via the `api_key` **query parameter**. Both
were taken from the one piece of Emby integration in this repo demonstrably
exercised against the live instance,
`docs/features/download/designs/assets/fetch-assets.sh`. Emby also accepts an
`X-Emby-Token` header, but that variant is unverified here; the calls are
container-to-container and never leave the Docker network, so the query
param's log-leak surface is acceptable.

**Four env vars, not three.** This section previously listed three, which is
one short. The API is reached container-to-container, but a `watchUrl` handed
to a **browser** has to use the public host — so the two addresses can't
collapse into one var.

| Env var             | Used for                          | Prod value                      |
| ------------------- | --------------------------------- | ------------------------------- |
| `EMBY_URL`          | API calls from the container      | `http://emby:8096`              |
| `EMBY_EXTERNAL_URL` | `watchUrl` construction           | `https://emby.lilnas.io`        |
| `EMBY_API_KEY`      | The `api_key` query param         | 1Password, "Emby - TDR API Key" |
| `EMBY_USERNAME`     | Resolved to a `UserId` at runtime | The shared service account      |

### A bare deep link, no `PlaybackInfo`

This resolves the open question the old text left. The spec calls Watch pure
navigation, so the URL is
`{EMBY_EXTERNAL_URL}/web/index.html#!/item?id={itemId}&serverId={serverId}`,
with `serverId` fetched once from `GET /emby/System/Info` and cached for the
process lifetime. No stream negotiation, no capability flags, no
`getPlaybackInfo`.

> **Known limitation, accepted:** Emby has its own user system, so the link
> may land on Emby's login screen. Not solving double-login is a standing
> decision — `docs/archive/brainstorms/2026-07-31-lilnas-auth-requirements.md:216`.

### Matching is by on-disk path, never title/year

Emby renders titles differently than Radarr/Sonarr do. `infra/media.yml`
mounts the same host directories at the same container paths in Radarr, Sonarr
**and** Emby, so the paths compare byte-equal.

- A `Movie` matches on its **file** path, against an Emby `Movie` item.
- A `Show` matches on its **series folder** path, against an Emby `Series`
  item. Series-level matching is deliberate: the spec's Watch navigates to the
  title, and per-episode deep links are out of scope.

There is **no fuzzy fallback**. A miss reports `indexing` — visible and
diagnosable — rather than silently pointing at the wrong item.

### Read-through cache, no poller and no WS push

One whole-library fetch per expiry builds a path index, cached with a **60s
success / 10s failure TTL**, mirroring `MediaResolverService`'s library
caches. The user id and server id resolve once per process.

There is deliberately **no background poller and no WS broadcast** when a
title flips `indexing → indexed`. That flip happens minutes after a job
completes, when nothing is broadcasting that job anyway, and a refetch or the
frontend's own polling picks it up within the TTL. Push is deferred to a later
phase if it ever becomes a requirement.

### Semantics

| Situation                                                | `embyStatus`                             |
| -------------------------------------------------------- | ---------------------------------------- |
| No `filePath` (not downloaded, or a discover/search hit) | absent — Emby was never consulted        |
| File on disk, Emby item with a matching path             | `{ state: 'indexed', itemId, watchUrl }` |
| File on disk, no matching Emby item                      | `{ state: 'indexing' }`                  |
| File on disk, Emby unreachable / errored                 | `{ state: 'unknown' }`                   |

`indexed` is the only state carrying `itemId`/`watchUrl`. A resolve where no
managed media has a `filePath` makes **zero** Emby calls, so video-only pages
and search/discover results cost nothing.

`degradedSources` was deliberately not extended — Emby isn't a `DownloadType`,
so the per-title `unknown` carries the degradation signal instead.

### ⚠️ The live-API assumptions were never verified

The plan called for a human checkpoint — curl the live API with the 1Password
key, ideally _before_ implementation. **It was not run**: SSH to the deploy
host was refused during implementation. So these all remain assumptions:

- That `Fields=Path` actually returns `Path`.
- That a `Movie` item's `Path` is the **file** (not its folder) and a `Series`
  item's `Path` is the **folder**.
- That the deep-link URL resolves in a browser.
- That an unpaged `/Items` call returns the whole library.

**The unpaged assumption is the weakest of them.** `fetch-assets.sh` — the one
live-verified caller — always passes `&Limit=$count` to `/Items`, so the
unpaged variant this phase ships has never been exercised. `EmbyService` logs
a warning when `TotalRecordCount` exceeds `Items.length`, which is the only
detector we have; treat it as expected-to-fire until someone checks.

### ⚠️ Env must be provisioned before deploying

Both Emby services read env in their **constructors** and boot-fail if a var
is unset — deliberate, matching the Radarr/Sonarr precedent in
`src/media/clients.ts`. Deploying before all four `EMBY_*` vars exist in
`apps/download/.env.prod` on the host will crash-loop the container.

### Deferred

- **No frontend.** Nothing in the Next.js app renders `embyStatus` yet; the
  rebuild consumes it alongside Phases 3–5.
- **No WS push** when a title flips `indexing → indexed` — the TTL covers it.
- **No per-episode deep links.** A show links to its series page in Emby.
- **No `PlaybackInfo`, stream URLs, or embedded player.** Watch is a handoff,
  per the spec.
- **No Emby-side scan trigger.** This app never asks Emby to rescan; it waits
  for Emby's own schedule.

### Manual verification (needs the live Emby instance)

⚠️ **Not yet run** — this is the human checkpoint the plan called for, still
outstanding. `EMBY_API_KEY` is in 1Password as "Emby - TDR API Key". Run from
inside the Docker network, or swap `EMBY` for `https://emby.lilnas.io`:

```bash
EMBY=http://emby:8096
KEY=$EMBY_API_KEY

# 1. Reachability, key validity, and the server id every watch URL carries.
curl -s "$EMBY/emby/System/Info?api_key=$KEY" | jq '{Id, ServerName, Version}'

# 2. The user id EMBY_USERNAME must resolve to. Emby matches EXACTLY,
#    including case - a near-miss boots the service with a warning listing
#    every available name.
curl -s "$EMBY/emby/Users?api_key=$KEY" | jq -r '.[] | "\(.Id)\t\(.Name)"'
USER_ID=<the shared service account's id>

ITEMS="$EMBY/emby/Users/$USER_ID/Items?IncludeItemTypes=Movie,Series"
ITEMS="$ITEMS&Recursive=true&Fields=Path&api_key=$KEY"

# 3. THE BIG ONE. Does Fields=Path come back, and is an unpaged call whole?
#    `total` must EQUAL `returned`, and `withPath` must equal both. If
#    total > returned, EmbyService.getLibraryItems() needs StartIndex/Limit
#    paging - until then every title past the first page reports `indexing`.
curl -s "$ITEMS" | jq '{total: .TotalRecordCount,
                        returned: (.Items | length),
                        withPath: ([.Items[] | select(.Path)] | length)}'

# 4. A Movie's Path must be the FILE; a Series' Path must be the FOLDER.
curl -s "$ITEMS" | jq -r '.Items[] | select(.Type=="Movie")  | .Path' | head -3
curl -s "$ITEMS" | jq -r '.Items[] | select(.Type=="Series") | .Path' | head -3
#    Compare byte-for-byte against what Radarr/Sonarr report for the same
#    title. A mismatch means every title reports `indexing` forever.

# 5. The deep link. Paste into a browser - it must land on the item page.
#    https://emby.lilnas.io/web/index.html#!/item?id=<itemId>&serverId=<Id>

# 6. End to end, through this app. An indexed title carries a watchUrl; a
#    freshly-downloaded one reads `indexing`; a title with no file on disk
#    has no embyStatus at all.
curl -s http://download:8081/download/media/tmdb:27205 | jq '.media.embyStatus'
```

---

## Phase 7 — Local save-to-device

**Status: done** (backend only — no frontend surface yet). Full plan in
`docs/features/download/plans/007-phase-7-local-save.md`. Commits, in order:
`020a19d0` (read-only library mounts), `550d2aeb` (wire contract), `9518b165`
(`mediaTypeFromKey()` promoted next to `mediaId()`), `ffb676e6`
(`MediaFileService`), `552e42c6` (the route + its counter).

Every other route in this app answers with JSON. This one answers with bytes:
"save a copy to my device", for all three media types, through one endpoint.

### ⚠️ Two things this section used to say were wrong

- **There is no file-path column on `jobs`.** The old text had the route
  streaming "the file at the path stored on the `jobs` row from Phase 1/6".
  The media entity refactor removed per-job file locations; a `jobs` row
  carries only id, type, status, requester, scope and timestamps. File
  locations are derived **live**, per request: a movie's from Radarr
  (`movieFile.path`, gated on `hasFile`, surfaced as `Movie.filePath`), an
  episode's from Sonarr's episode-file API, and a video's object key from the
  `videos` row's own `downloadUrls`. Nothing is cached and nothing is written
  back, so a title deleted upstream stops being savable when the resolver's
  TTL expires rather than when someone notices a stale column.
- **Videos were not "likely frontend-only wiring".** The `downloadUrls`
  `DownloadVideoService.upload()` writes are **unsigned public-bucket URLs**,
  and a bare `<a download>` is ignored cross-origin (`download.lilnas.io` →
  `storage.lilnas.io`) — the browser plays the file instead of saving it. An
  anonymous `response-content-disposition` override isn't honored on an
  unsigned request either. So saving streams **through the app** for all three
  types. The public URLs are untouched: they remain the in-app _playback_
  mechanism, which the spec keeps deliberately distinct from save.

### What shipped

| Route                          | Auth | Does                                                      |
| ------------------------------ | ---- | --------------------------------------------------------- |
| `GET /download/media/:id/file` | none | Streams one movie / episode / video part as an attachment |

Behind it: `GetMediaFileQuerySchema` + `GetMediaFileQuery` in
`packages/utils`; `MediaFileService`
(`apps/download/src/media/media-file.service.ts`), which turns a media id into
a `MediaFileSource` (`{ kind: 'disk', path }` or
`{ kind: 'object', bucket, key, size, contentType }`);
`mediaTypeFromKey()` lifted out of `download.controller.ts` into
`src/db/media-id.ts` beside `mediaId()`, whose prefix choice it inverts; and a
`download_media_file_saves_total{type}` counter.

The controller decides only _how_ to send, never _what_ — `MediaFileService`
has already collapsed the three types into one source shape.

### One media-keyed route, not three

Keyed on **media** id and typed by key prefix (`video:` / `tmdb:` / `tvdb:`),
exactly like every other Phase 3/4 media route. A file belongs to a title, not
to a download event: the same movie downloaded twice has one file, and saving
it shouldn't require knowing which job put it there.

`episodeId` is **required for `tvdb:` keys** — a 400, not a fallback. A series
is a folder, not a file, and there is no "the show's file" to guess at.
`Show.filePath` (the series folder) is deliberately never consulted here.
Per-file only: no season or series zip bundling. `part` is video-only,
defaults to `0`, and indexes `Video.downloadUrls` for a multi-part post.
Passing either param to the wrong key type is a 400 rather than a silently
ignored field.

Those cross-field rules live in the service, not in the Zod schema, because
which rule applies depends on the `:id` prefix the schema never sees — the
same split `DeleteMediaFilesQuerySchema` already makes.

### `:ro` library mounts at Radarr/Sonarr-identical paths

`apps/download/deploy.yml` gained `/storage/media-library/movies:/movies:ro`
and `/storage/media-library/tv:/tv:ro`. Radarr and Sonarr report
container-absolute paths in their file APIs, so mounting the library at the
**identical** container paths means those paths need zero translation — the
same byte-identical-paths trick Phase 6's Emby match already relies on, and
one less mapping to drift out of sync with the media stack.

Read-only because this app must never write the library. **No chown needed:**
the download container runs as `node` (uid/gid 1000), the same uid the media
services already write as via `PUID`/`PGID` — unlike the `/data` mount, which
does document one.

`deploy.dev.yml` gets no mounts on purpose. Dev runs no Radarr/Sonarr and the
dev host has no `/storage/media-library`, so a dev save 404s honestly instead
of half-working.

### Defense in depth: the disk-path allowlist

The client never supplies a path — the id is prefix-parsed and the query
params are coerced integers. But Radarr and Sonarr are **external services**,
and this app has an RCE-probing incident in its history. So every candidate
disk path is `path.resolve()`d and must start with `/movies/` or `/tv/`. A
miss logs a `warn` and 404s; it is never opened, and the caller learns nothing
beyond "no file".

### Range on the disk branch only

Two send paths, split by the shape of the files rather than by the storage:

- **Disk** (movie, episode) → express `res.sendFile()`, which supplies
  `Range`/206, `Accept-Ranges`, ETag and `Last-Modified` for free. These files
  run to multiple gigabytes, where resumability is the difference between a
  save that survives a dropped connection and one that starts over.
- **Object** (video) → `getObject()` piped through, with explicit
  `Content-Type` and `Content-Length` from the stat, and **no** Range
  handling. The videos this app produces are small next to a movie file;
  `getPartialObject()` is the documented escape hatch if that stops being
  true.

Both set `Content-Disposition` via the `content-disposition` package, and the
video branch names the saved file after the _title_ rather than the
`<jobId>/part0.mp4` object key.

### 503 on a degraded resolver, and no auth decorator

The route deliberately does **not** use the `mediaJobRoute()` helper, whose
catch block rewrites every failure into a 404 — same call as Phases 4 and 5.
`resolveFileSource()` already raises the right exception for each case, and
flattening them would report "pass an `episodeId`" (400) and "Sonarr is
unreachable" (503) as "not found". Telling the UI a file doesn't exist when
the library is merely unreachable would send a user off to re-request
something they already have. Degradation is therefore checked _before_ the
payload is read, since `resolve()`'s placeholder for an unreachable source is
indistinguishable from a real title with nothing downloaded.

**No auth decorator**, matching `GET /media/:id/releases` and
`/media/:id/seasons`: the route reads nothing attribution-sensitive and writes
nothing, and Traefik's `lilnas-auth` gates the edge. Recording _who saved
what_ is Phase 8's audit log, not a decorator here.

### Findings from implementation

- **`content-disposition` is pinned to `1.0.0`.** `3.0.0` is ESM-only and
  would break the SWC/CommonJS build — the same trap nanoid already set for
  the test suite. `1.0.0` is what express 5 itself depends on, so it dedupes
  in the store; a bump needs a transform first.
- **The object branch opens the MinIO stream _before_ setting any header.**
  Setting `Content-Length` first and then failing to open would leave Nest's
  exception filter writing a short JSON body under a header promising the
  whole object — which a client waits out rather than reports.
- **The save counter increments at stream hand-off, not completion.**
  `sendFile` offers no headers-committed hook, and counting at completion
  would drop every user-aborted multi-GB save. "Saves started" is the only
  figure a single request can honestly report.

### Deferred

- **No frontend.** The route is backend-only; nothing in the Next.js app calls
  it yet — the rebuild consumes it alongside Phases 3–6.
- **`DownloadClient.getMediaFileUrl` — since added**, in the shared-client
  hardening pass (`docs/features/download/plans/011-shared-client-hardening.md`),
  as a synchronous URL builder rather than a fetch method: pulling a
  `Range`-able multi-GB stream back through the client would cost a browser its
  resumability and a server-side caller a second transfer. It returns a string
  to use as an `<a href>` or a redirect target, and carries no forwarded
  identity — a URL can't. Nothing in-repo calls it yet.
- **No season/series bundling.** One file per request, by design.
- **No Range on the object branch** — `getPartialObject()` if that changes.
- **Known asymmetry, left standing:** this route is authenticated at the edge,
  but the MinIO `videos` bucket is still **anonymously readable** over its own
  public route. Known, out of scope for this phase, and worth revisiting with
  the frontend rebuild — which is also when the playback-vs-save split stops
  being theoretical.

### Manual verification (needs live Radarr/Sonarr/MinIO)

⚠️ **Not yet run** — these are the human checkpoints in
`docs/features/download/plans/007-phase-7-local-save.md`, all still
outstanding. The unit suite covers the resolver and both send branches against
fakes; none of the below can be proven without real data and a real container.

**Deploy first.** The new mounts need a container **recreate**, not a restart,
and per `CLAUDE.md` deployment runs from the repo root — never
`apps/download/deploy.yml` directly:

```bash
docker-compose up -d download
docker-compose exec download ls /movies /tv    # both readable, both :ro
```

```bash
BASE=http://download:8081/download

# 1. A movie already in the library. Expect 200 + Content-Disposition, and
#    Accept-Ranges: bytes on the disk branch.
curl -sI "$BASE/media/tmdb:27205/file" | grep -iE 'content-(disposition|length|type)|accept-ranges'

# 2. Range actually resumes. Byte 100- must come back 206, not 200.
curl -s -o /dev/null -w '%{http_code}\n' -r 100- "$BASE/media/tmdb:27205/file"   # 206

# 3. A show without episodeId is a 400, not a 404 and not a series folder.
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/media/tvdb:81189/file"           # 400

EP=$(curl -s "$BASE/media/tvdb:81189/seasons" \
  | jq -r '.seasons[] | select(.seasonNumber==3) | .episodes[0].id')
curl -sI "$BASE/media/tvdb:81189/file?episodeId=$EP" | head -1                   # 200

# 4. A video, through the app rather than the public bucket URL. The filename
#    must be the TITLE, not '<jobId>/part0.mp4'.
curl -sI "$BASE/media/video:<id>/file" | grep -i content-disposition

# 5. A title with no file on disk is a 404; an out-of-range part is a 404.
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/media/video:<id>/file?part=99"   # 404

# 6. Stop Radarr, then re-run (1). It must be 503, NOT 404 - the whole point
#    of skipping mediaJobRoute().
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/media/tmdb:27205/file"           # 503
```

**Also still to check by hand:**

- **A real multi-GB movie through Traefik**, from a browser, end to end.
  Checking for: no proxy buffering or timeout on a long transfer, the browser
  saving rather than playing, and a resumed save actually resuming.
- **`download_media_file_saves_total`** appearing on `/metrics` with the right
  `type` label after each of the three branches has been exercised.
- **An aborted save** — kill the client mid-transfer and confirm the MinIO
  socket is torn down rather than left open for the length of the object.

---

## Phase 8 — Admin dashboard & audit log

**Status: done** (backend only — no frontend surface yet). Full plan in
`docs/features/download/plans/008-phase-8-admin-dashboard-audit-log.md`.
Commits, in order: `fab1955f` (`AdminGuard`), `3cb0198d` (wire contract),
`04ac1be3` (`countJobsByStatus` + `countJobsByDay`), `f7107592` (`audit_log`
table + migration 0007), `cbcfc55a` (`audit-log.repo.ts`), `9e399580`
(`AuditModule` + `AuditLogService`), `951e7024` (the yt-dlp update trigger),
`63c6ea54` (`AdminController` + `AdminStatsService`), `2983ed32` (audit calls
across every mutating route), `c4c4123d` (`video.create` records the full raw
URL).

Every other phase added something a user can do. This one adds the record of
who did it, plus the two read endpoints an admin dashboard needs on top of
that record and the `jobs` table.

### What shipped

| Route                           | Auth         | Does                                           |
| ------------------------------- | ------------ | ---------------------------------------------- |
| `GET /download/admin/audit-log` | `AdminGuard` | Cursor-paginated audit rows, newest first      |
| `GET /download/admin/stats`     | `AdminGuard` | Job aggregates for the admin dashboard's panel |

Behind them: `AUDIT_ACTIONS` / `AUDIT_TARGET_TYPES` / `AuditLogEntrySchema` /
`AuditLogQuerySchema` / `AdminStatsQuerySchema` / `AdminStatsResponse` in
`packages/utils`; the `audit_log` table (migration
`0007_neat_lila_cheney.sql`); `apps/download/src/db/audit-log.repo.ts`
(`insertAuditLog`, `listAuditLogPage`); `AuditLogService` (`record()`,
`listAuditLog()`) in a standalone `AuditModule`; `AdminStatsService`; the
first reusable `AdminGuard` in `apps/download/src/auth/`; and
`countJobsByStatus` / `countJobsByDay` alongside the existing aggregates in
`jobs.repo.ts`.

Fourteen actions are recorded. Thirteen come from `DownloadController` —
every one of its mutating routes (`video.create`, `video.cancel`,
`video.pause`, `video.resume`, `movie.request`, `movie.delete`,
`show.request`, `show.delete`, `media.delete_files`, `release.grab`,
`release.replace`, `file.flag_bad`) plus `media.save_file`, which is a read
but is recorded anyway because a copy leaving the building is worth knowing
about. The fourteenth is `ytdlp.check_update` on `YtdlpUpdateController`.

### Recording is success-only, and happens at the controller seam

`record()` is called **after** the action succeeded, from the controller or
from the shared route helper it already funnels through — the one layer that
knows both the actor and the outcome. A service several frames down knows what
happened but not who asked; a guard knows who asked but not whether it worked.

Failed attempts are deliberately **not** audit rows. They are already in the
structured logs, queryable in Loki, and mixing "tried and was refused" into a
table whose value is "this is what happened" makes every row need a second
field read before it can be believed.

### The actor is nullable, and a CHECK says when

`audit_log` copies the `jobs` shape verbatim: nullable
`actor_email`/`actor_user_id`, an `origin` of `'service' | 'web'`, and a CHECK
tying the two together — `origin = 'web'` requires both actor columns,
`origin = 'service'` requires both to be null. So a null actor is never
ambiguous: it either says "a service did this, as expected" or it can't be
written at all.

That nullability isn't hypothetical. Most mutating routes take
`@OptionalCurrentUser()` because **`apps/tdr-bot` calls them
service-to-service with no forwarded identity** — requiring an actor would
have turned this phase into a breaking change for the bot.

### A TypeScript-only action enum, no SQL CHECK

`AUDIT_ACTIONS` is a `const` tuple in `@lilnas/utils`, pinned into the DB
schema through the house `AssertSameUnion` pattern (`auditActionPin` /
`auditTargetTypePin` in `apps/download/src/db/schema.ts`). Like `jobs.status`,
drizzle's SQLite text-enum is a **TypeScript-only** constraint — the emitted
DDL is a bare `text NOT NULL` — so adding an action later is purely additive
with no migration.

The pin was verified **non-vacuous**: adding a bogus member to one tuple makes
`tsc` fail, which is the only thing that makes a compile-time assertion worth
having.

### `record()` never throws

The insert is wrapped in try/catch. On failure it logs a `warn` and increments
`download_audit_write_failures_total`; the request itself is untouched. Every
call site is the tail of something the user already succeeded at, so turning a
lost record into a 500 would undo nothing while telling the user their action
didn't happen.

That counter is a **module-level `prom-client` singleton** in
`audit-log.service.ts`, not a method on `DownloadMetricsService`. Injecting
the metrics service would make `AuditModule` depend on `DownloadModule` —
exactly backwards, since `DownloadModule` and `MediaModule` are the ones that
need to import `AuditModule`. `register` is process-wide, so the counter lands
on `/metrics` with no wiring. It is the **only** externally visible signal
that a write was lost; a non-zero rate means the log is no longer complete,
which makes it worth an alert.

### The first reusable `AdminGuard` — and `/history`'s inline 403 stays inline

`AdminGuard` layers on the same identity primitive as `ForwardedUserGuard`:
**missing identity is a 401** (the request never proved who it is), a resolved
**non-admin identity is a 403** (we know who it is, they just aren't allowed).
It resolves the forwarded user itself rather than trusting request mutation
from another guard, so it works alone.

It sits at the **class** level on `AdminController`, because every route that
controller will ever grow is admin-only by definition and a new route
therefore can't ship ungated by omission.

`DownloadController.getHistory()` keeps its inline check on purpose. Its rule
— admins may query anyone, everyone may query themselves — depends on the
**parsed query**, which a class- or route-level guard runs too early to see. A
guard is the right tool for an unconditional gate and the wrong one for a
conditional scope.

### True attribution, safe _because_ of the gate

Neither admin endpoint masks anything, and `AdminStatsService` deliberately
does **not** pass `excludeHiddenVideos` to any aggregate — unlike every other
requester-facing count, which does, to keep a hidden uploader from being
inferred from a facet.

That is not a lapse in the attribution-oracle discipline the public endpoints
maintain; it is where that discipline hands off. These routes exist to show
admins the truth, and the 403 is what makes showing it safe. The consequence
is a rule for the future: `AdminController` must never host a route intended
for ordinary users.

### "Usage trends" means per-day job counts, not system metrics

The old text left this open. It is pinned to **per-UTC-day job counts by
type** over a `?days=` window (default 30, max 365) — the activity chart, and
nothing else.

System-level metrics (CPU, memory, queue depth, phase durations) stay where
they already live, in Prometheus and Grafana. The stats endpoint serves
job-log aggregates only and does **not** proxy `/metrics`; a second, worse
copy of a metrics stack behind an app endpoint is not a dashboard feature.

**The windowing is deliberately split.** Only `jobsPerDay` is bounded by
`?days=`. `totalsByType`, `totalsByStatus`, `totalJobs` and `topRequesters`
are **all-time**, because a "lifetime total" that silently means "the last 30
days" is the kind of number people quote wrongly. `windowDays` echoes the
window that was actually applied, so a response always says which series it
describes.

**Aggregates are sparse, by contract.** A status nobody has hit, or a
`(day, type)` pair with no jobs, is **absent** — not `{ count: 0 }`. Zero-fill
here would mean inventing rows a client couldn't distinguish from real ones,
so clients that need a continuous axis densify their own gaps.
`topRequesters` is capped at 20: a leaderboard, not a user directory.

### Cold start, and no backfill

The table starts **empty**. Phases 0–7 all shipped without recording anything,
and nothing was reconstructed.

That is not just laziness about a script. Retroactive _download_ history
already exists — that is what the `jobs` table is, which is why the stats
endpoint reads real numbers from day one. Retroactive _interaction_ history —
who paused what, who flagged a release, who saved a file to their device —
was never captured anywhere and **cannot** be reconstructed. The audit log's
coverage therefore starts at this phase's deploy, and reading it as "nobody
did anything before then" would be wrong.

### The Phase 7 debt is closed

`GET /media/:id/file` gained `@OptionalCurrentUser()` — **identity capture
only, still no guard**, so service callers and the no-identity dev path keep
working exactly as they did. It records `media.save_file` on successful stream
start, at the same hand-off point the `download_media_file_saves_total`
counter increments and for the same reason: the bytes leave over minutes, and
the request has no later moment it can still speak for.

### The yt-dlp update trigger is audited too

`POST /api/ytdlp-update/check` can **replace the yt-dlp binary** and
previously had no identity capture at all. It now takes an identity decorator
and records `ytdlp.check_update`, with `dryRun` in the metadata so the trail
distinguishes a real update from a simulated one. It is the one action with no
target at all — hence `target_type`/`target_id` being nullable as a pair. The
controller's GET routes are untouched.

### Findings from implementation

- **The integer-PK cursor hazard is not the one it looks like.** `ListCursor.id`
  is a `string` (minted for `jobs.id`, a nanoid), while `audit_log.id` is an
  `INTEGER PRIMARY KEY`. The obvious worry — binding the id as text — turns out
  to be harmless: SQLite applies the column's NUMERIC **affinity** to a bare
  bound parameter, so `id < '3'` compares identically to `id < 3`. The real
  hazard is a **non-numeric** id. Affinity only converts text that already
  looks numeric, so `id < '3abc'` stays an integer-vs-text comparison, SQLite's
  type ordering puts every integer before every string, the predicate goes
  **vacuously true**, and the cursor row is served again on the next page — a
  silent duplicate across the boundary rather than an error. `parseCursorId()`'s
  `/^\d+$/` guard is therefore the load-bearing defense (reject, never coerce),
  and the regression test is pinned to that case rather than to the
  well-formed-string one.
- **`instanceof Error` is unreliable for better-sqlite3 errors under Jest.**
  The native addon constructs its errors outside Jest's vm sandbox, so
  `instanceof Error` is `false` even though the prototype chain genuinely ends
  at `Error`. Tests covering DB-failure paths assert on `error.message`
  instead.
- **`video.create` records the raw URL, not the sanitized one** (`c4c4123d`).
  The surrounding log lines use a query-stripped `sanitizedUrl`, and matching
  them "for consistency" was wrong: for the URL shape this service mostly sees,
  the video's identity lives entirely in the query string
  (`youtube.com/watch?v=…`), so stripping it leaves an entry that can't say
  what was downloaded. The audit log is the stricter surface — behind
  `AdminGuard`, unmasked by design, meant to outlive the job row it points at
  — so it carries the URL in full. There is a code comment saying so.

### Deferred

- **No frontend.** Both routes are backend-only; there is no admin dashboard
  in the Next.js app yet — the rebuild consumes these alongside Phases 3–7.
- **`DownloadClient` methods — since added.** `getAuditLog` and `getStats`
  cover both routes, landed with the Phase 3–7 methods in the shared-client
  hardening pass (`docs/features/download/plans/011-shared-client-hardening.md`);
  the same pass added `checkYtdlpUpdate` for the yt-dlp trigger audited above.
  Neither admin method checks anything client-side — `AdminGuard`'s 403 (or a
  401 from a caller that skipped `withForwardedIdentity()`) arrives as a
  `DownloadApiError` like any other failure. Nothing in-repo calls them.
- **No backfill**, for the reason above.
- **No retention or pruning.** `audit_log` grows without bound; nothing
  vacuums it. Sized for this service's traffic, revisit if that stops holding.
- **No audit rows for reads.** Who _looked_ at the audit log isn't recorded.
- **No stats caching.** Every request re-runs the aggregates; they are
  `COUNT`/`GROUP BY` over one indexed table behind an admin gate.
- **Unflag route for `bad_files` — since added** (Phase 3's own Deferred
  section has the detail).

### Manual verification (needs a running container)

⚠️ **Not yet run.** The full script is the **"Human checkpoints"** section of
`docs/features/download/plans/008-phase-8-admin-dashboard-audit-log.md`; it is
not duplicated here. The shape of it:

1. **Deploy from the repo root** with `docker-compose up -d download`, per
   `CLAUDE.md` — never `apps/download/deploy.yml` directly.
2. **Watch migration 0007 apply at boot** in the container logs, and confirm
   the service starts serving rather than hard-failing its integrity check.
3. **Exercise the 401 / 403 / 200 split** against both admin routes with real
   forwarded headers: no `X-Forwarded-User` → 401, a non-admin identity → 403,
   an admin identity → 200.
4. Then perform a few mutating actions and confirm the rows land with the
   right actor, action, target and metadata — including a tdr-bot-style
   service call landing as `origin: 'service'` with a null actor.

---

## Verification conventions

The conventions Phases 0–8 followed, and that anything built on top of them
should follow too. Each completed phase's section above also carries its own
manual-verification block with the live curl checks specific to it.

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

---

## Legacy frontend teardown

**Status: done.** The "no Next.js surface calls them yet" caveat above now
means something stronger than it did when it was written: the pre-spec
frontend has been **removed**, not merely left un-updated. `apps/download` is
the Phase 0–8 backend plus an empty App Router shell. No backend module was
modified — the teardown was frontend-only by construction.

The full reasoning, file-by-file verdicts and task breakdown live in
[`plans/010-legacy-frontend-teardown.md`](plans/010-legacy-frontend-teardown.md).

| Commit    | What it did                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `2367db4` | Deleted the legacy UI (pages, components, jotai store, MUI theme) and left a bootable Next.js shell                     |
| `e20cbe3` | Dropped 17 frontend-only and already-dead dependencies from `apps/download/package.json`, regenerating `pnpm-lock.yaml` |
| `89ad6df` | Deleted the dead `src/constants/version.ts` and the unread `FRONTEND_PORT` from `.env.example`                          |

### What the rewrite inherits

An **empty App Router shell** survives — `src/app/layout.tsx` plus a
placeholder `src/app/page.tsx` — along with the `/api` and `/ws` rewrites in
`next.config.js`, untouched:

```js
{ source: '/api/:path*', destination: 'http://localhost:8081/:path*' }
{ source: '/ws/:path*',  destination: 'http://localhost:8081/ws/:path*' }
```

So the rewrite has a working proxy to the Nest backend on day one, and the
Docker build, `deploy.yml`'s `loadbalancer.server.port=8080` and the
TypeScript setup all stayed correct rather than being churned and un-churned.

`download.lilnas.io` still boots on port 8080 and serves the placeholder. The
API and WebSocket gateway stay fully live behind it, so tdr-bot's `/download`
Discord command is **unaffected** — it talks to the Nest port directly via
`DownloadClient.dockerInstance`, never through Next.js.

### Recovering the WebSocket hook

`src/components/use-download-job-socket.ts` and its 304-line test file were
deleted, because they were shaped around the single-job `/downloads/[id]`
view rather than the multi-job live feed the new activity surface needs. The
parsing logic is worth resurrecting from git rather than rewriting:

```bash
git show 2367db4^:apps/download/src/components/use-download-job-socket.ts
git show 2367db4^:apps/download/src/components/__tests__/use-download-job-socket.test.ts
```

Note the `2367db4^` ref — the plan's own snippet says `HEAD:`, which was
correct only while it was being written. Now that A1 has landed, those paths
no longer exist at `HEAD` and the command must name a pre-teardown commit.

The gateway the hook parses (`src/download-gateway/download.gateway.ts`) is
**unchanged** by the teardown, so the wire format is still current.

### Two pieces of intentional dead code were kept

Neither has an importer after the teardown. Both stay on purpose; they are
not cleanup targets.

- **`src/lib/download-client.ts`** — its doc comment encodes a non-obvious
  auth-attribution rule: a plain `DownloadClient.localInstance` call from a
  server component **drops the `X-Forwarded-User` headers Traefik sets**,
  silently persisting every web-originated job as an unattributed service
  call. Deleting it means rediscovering that the hard way.
- **`src/auth/auth-debug.controller.ts`** — its `GET /auth/whoami` returns
  `{ email, userId, isAdmin }`, which is exactly what the rewrite's account
  avatar and admin-gated surfaces (spec §10, §11) need.
