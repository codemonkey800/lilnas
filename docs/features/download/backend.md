# Download App — Backend Plan

**Status: complete.** Every phase below (0–8, plus the media/job split
refactor) has landed and is verified against the code, not just self-reported
— see the status table for the phase list and each phase's section for its
commits. The backend supports the full spec as it stood when these phases
shipped; one spec change since then is **not** covered — the admin full
cross-user, any-status download history (see the known-gap note in Phase 8).
What remains beyond that is out of this document's scope: the Next.js frontend hasn't been built against Phases 3–8
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

> ⚠️ **Superseded by
> [The gallery is the library (plan 021 · Phase 4)](#the-gallery-is-the-library-plan-021--phase-4)**:
> the `GROUP BY` is gone. `GET /gallery` now lists the Radarr/Sonarr libraries
> and finished videos, and joins the job log only for each card's download
> summary.

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

### Browsing adds unmonitored; only a pick monitors

_Rewritten for plan 024 (`57bdb050`, `9b7cf742`, `dd96632f`, `967fdcd8`).
This used to borrow monitoring: turn it on for the listing, then restore it,
deleting a title the listing had added. That broke grabs (Radarr caches a
release decision for 30 min, keyed to the deleted movie's id), could delete
a concurrent request's title, and was never needed._

Radarr/Sonarr key their release endpoints on their own library ids, so a
listing for a title not in the library has to add it first. Their
interactive search and `POST /release` never check `monitored`, so nothing
here needs it on.

| Path                             | A missing title is added         | Monitoring                                                 |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------- |
| Browse (`listReleases`)          | **unmonitored**, and kept        | never touched — never flipped on, and nothing is deleted   |
| Grab (`grabRelease`)             | unmonitored (`ensureForGrab`)    | turned on **after the grab succeeds** (`monitorAfterGrab`) |
| Replace (`replaceRelease`)       | unmonitored                      | grab → delete the old file(s) → turn on                    |
| Request (`requestMovie`/`…Show`) | monitored, on the tier's profile | a movie at the ensure; a show's scope in `startSearch`     |

- **An unmonitored title with no file reads `absent`**, exactly like one that
  isn't in the library.
- **A fresh add waits for its refresh.** `ensureForBrowse` re-sends the
  add-time refresh (`isNew: true`, which Radarr/Sonarr dedupe onto the add's
  own) and waits up to `BROWSE_REFRESH_WAIT_MS` (30 s), so the search sees
  the alternate titles that refresh saves. Best effort: a timeout or a
  failed refresh logs and lists anyway.
- **A show listing must name a season or an episode.** Sonarr's unscoped
  `GET /release` is its RSS feed, not a search, so an unscoped listing is a
  400 `Pick a season or an episode` (`PICK_A_SCOPE_MESSAGE`) before anything
  is added.
- **What a grab monitors.** A movie: the movie. A show: the grabbed episodes
  first, then the series flag — an episode scope is that episode, a season
  scope its episodes, an unscoped grab every episode **outside season 0**.
  Replace adds the episodes whose files it deleted (a multi-episode file).
  A failed monitor write only warns: the release is already handed over.
- **Replace grabs first, deletes after.** A failed grab deletes nothing. A
  failed delete after a good grab logs and the job carries on.
- **A grab that misses the release cache is retried once.** `POST /release`
  looks the pick up in the last search's 30-minute cache; a 404 re-runs the
  same listing and grabs again if the pick is still there
  (`grabWithRelist`), otherwise the job fails
  `That release is no longer available — search again`.
- **One title, one sequence at a time.** Every ensure and every monitor write
  runs inside `mediaMutex` (`keyed-mutex.util.ts`: a FIFO async lock keyed by
  the canonical media id), so two browses add a title once and a browse can't
  interleave with a request. The grab, the relist and the delete run outside
  it.
- **Adds never search.** Radarr's add sends `searchForMovie: false`, Sonarr's
  `searchForMissingEpisodes: false`; a request's search is its own command.

### Auto-select enforcement

A request ensures the title first; `startSearch` (`start-search.ts`) then
decides:

- **No flags** → the narrowest command the scope allows: `MoviesSearch`,
  `EpisodeSearch`, `SeasonSearch` (season 0 included) or `SeriesSearch`.
  Radarr/Sonarr pick. The job follows the command (see
  [Commands, and when a search ends `not_found`](#commands-and-when-a-search-ends-not_found)).
- **Flags present** → the app runs the interactive search itself and drops
  every release that is flagged, `rejected`, or not `downloadAllowed`:
  - a movie or episode takes the **first** eligible release, in
    Radarr/Sonarr's own order (`pickBestRelease`) — that order already is
    the profile's preference, so it is never re-ranked;
  - a season takes a full-season pack, or else one release per missing
    monitored episode (`pickSeasonReleases`);
  - an unscoped show is searched season by season (`grabPerSeason`), since
    Sonarr's unscoped release list is its RSS feed.
- **Nothing usable** ends the job `not_found`, noted
  `No usable release — every result is flagged or rejected`
  (`NO_USABLE_RELEASE_NOTE`), not `failed`.

### Flagged releases are enforced twice

_Plan 024 (`760fcf37`). Before it, enforcement was app-side only, and
Radarr's/Sonarr's RSS sync, automatic search and retry-after-failure could
grab a flagged release again._

**App-side.** `assertNotFlagged` refuses a flagged guid on grab and replace
with a 409 before any job exists, and the pickers above skip flagged
releases. This half is load-bearing: an interactive grab (`POST /release`)
bypasses release profiles, so upstream would take a flagged release from
this app without complaint.

**Upstream.** Each app gets one app-managed release profile,
`lilnas · Flagged releases` (`FLAGGED_RELEASE_PROFILE_NAME`), whose
`ignored` terms are every flagged title of that type:

| Field       | Value              | Why                                                    |
| ----------- | ------------------ | ------------------------------------------------------ |
| `enabled`   | `true`             | the resource defaults to `false`, so it is always sent |
| `required`  | `[]`               |                                                        |
| `ignored`   | the flagged titles | a case-insensitive substring of the release title      |
| `indexerId` | `0`                | every indexer                                          |
| `tags`      | `[]`               | every movie/series                                     |

- **Every flag and unflag re-syncs the app's full list** (`mirrorFlags` →
  `syncFlaggedReleases`), started and not awaited: the flag is this app's
  record either way, and a failure only warns. Boot syncs both apps once
  (`ArrProfilesBootstrap`).
- **One sync per app at a time**, reading `bad_files` under the lock, so
  quick flags can't PUT out of order or create the profile twice.
- **Written only on drift** — the term set (ignoring order and case) or the
  shape above. **Deleted when no flags remain**: Radarr/Sonarr reject a
  profile with no terms. A profile under any other name is never touched.
- **A title with `/` is skipped** and logged once: a term with two slashes is
  read as a regex. A flag sent without a real title takes the title of the
  file on disk from `media_file_releases`; one with no title anywhere is
  skipped and logged once.

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

Not covered by the unit suite — the monitoring rules in particular can only
be proven against real instances. Run from inside the Docker network, or
against `https://download.lilnas.io`:

```bash
BASE=http://download:8081/download

# 1. Releases for a movie ALREADY in the library.
curl -s "$BASE/media/tmdb:27205/releases" | jq '.releases | length'

# 2. Releases for a NOT-YET-ADDED movie. Should return results, and the
#    movie should be added UNMONITORED and left that way.
curl -s "$BASE/media/tmdb:157336/releases" | jq '.releases[0]'
#    Then confirm in Radarr: the movie exists, monitored = false.

# 3. Releases for a movie with a PENDING request (monitored on purpose).
#    Must be left STILL MONITORED - a listing never writes monitoring.
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

> ⚠️ **Superseded by
> [Monitoring cascades and full removal (plan 019)](#monitoring-cascades-and-full-removal-plan-019)**,
> which cascades a delete up and makes a whole-title delete a real
> Radarr/Sonarr `DELETE`. Kept as the historical record of Phase 4.

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

> ⚠️ **Superseded by
> [Jobs are attempts (plan 021 · Phase 3)](#jobs-are-attempts-plan-021--phase-3)**:
> a job with no queue item now settles from the files, not straight to
> `completed`.

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
- **The season-level `monitored` flag was checked live, and it turns out not
  to matter.** Verified against the real instance (Mr. Robot S00E01, season 0
  left unmonitored): flipping the episode's own `monitored` flag to `true`
  put it in `GET /wanted/missing` regardless of the season flag. Sonarr's
  search eligibility is governed by episode-level monitoring alone.

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
- **The season-level `monitored` flag is reported, never written — confirmed
  fine as-is.** See the Findings note above: episode-level monitoring alone
  governs search eligibility, so `postApiV3Seasonpass` is not needed.

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

**Checked.** A series whose season is unmonitored at the season level but
whose episode this app switched on individually: verified live against Mr.
Robot S00E01 (`3722`, season 0, 2026-09-01) that Sonarr still lists it in
`GET /wanted/missing` — episode-level monitoring alone is what governs
search eligibility. No `postApiV3Seasonpass` wiring needed. (Toggled and
reverted directly against the running instance, not through this app —
`ensureSeries`'s own `monitorEpisodes` path was not separately exercised.)

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

> ⚠️ **Narrowed by
> [Jobs are attempts (plan 021 · Phase 3)](#jobs-are-attempts-plan-021--phase-3)**:
> the sweep now fails video rows only; a paused video is still failed.

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

### Radarr/Sonarr pause/resume detection — since fixed

Radarr/Sonarr-managed downloads can be paused and resumed **independently of
this app**, at the backing download client (qBittorrent, SABnzbd, …), from
Radarr/Sonarr's queue UI or the client's own UI. `deriveStatusFromQueueItem`
(`apps/download/src/media/queue-status.util.ts`) used to have no branch for
it, so a paused item fell into the catch-all and was reported as
`Downloading` — actively wrong, not just imprecise.

Fixed by adding a `status === 'paused'` branch that maps to the existing
`DownloadJobStatus.Paused` (reused rather than a second status: it's already
non-terminal, so a paused movie/show job stays on the Activity feed exactly
like a paused video does). `aggregateQueueItems`'s `STATUS_PRECEDENCE` is
deliberately untouched — `Paused` sits outside it, so a season with one
paused episode and others still active still folds to `Downloading`, only
reporting `Paused` once every episode in scope is.

There is still no in-app _action_ for this — resuming happens back at
Radarr/Sonarr or the download client, since this app has no route for it and
the spec scopes pause/resume to the yt-dlp pipeline. This fix is
classification only: the job's `type` is what a future frontend uses to tell
"this app can resume it" (video) apart from "it can't" (movie/show).

Polling is still the only available signal: Radarr/Sonarr fire no
Connect-notification event for pause/resume (only Grab, Download, Rename,
Health Issue, Manual Interaction Required), and `MediaPollerService` already
polls the queue every 10s.

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
#    Since plan 015, `progress` is a live snapshot while the job downloads or
#    is paused (bytes, percent, file/fragment counters), and a resumed run's
#    first tick replaces the paused one. It is absent once the job completes.
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

### ⚠️ Known gap vs. the current spec: no full cross-user history query

The spec's §11 changed after this phase shipped: the admin dashboard's
downloads view is now specced as **every download, in every status, across
every user** — the complete job history, filterable down to one user —
rather than a reuse of §10's in-progress feed. No current query path serves
that. `listActivity()` (`GET /activity`,
`apps/download/src/download/job-query.service.ts`) is pinned to
`IN_PROGRESS_DOWNLOAD_JOB_STATUSES`, and `listHistory()` (`GET /history`)
requires a single `requesterEmail` and returns only that user's terminal
jobs. The new view needs a new or extended query path — flagged here so this
document doesn't silently drift from the spec; no implementation is planned
in this doc.

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

## Monitoring cascades and full removal (plan 019)

**Status: done.** Full plan in
`docs/features/download/plans/019-monitoring-cascade-and-full-removal.md`.
Commits, in order: `c9390b4a` (`SonarrService.setSeasonsMonitored`),
`527cdd99` (the pure `planShowDelete` planner), `c7d3370d` (movie/series
confirm-dialog copy), `97df9b09` (the request-side cascade), `5395d66e` (the
delete-side cascade and removal) — plus the wire contract gaining
`removedFromLibrary` and the audit metadata gaining `cascade`, and the
cancellation of a removed title's non-terminal jobs, which landed alongside
this section.

Sonarr keeps **three independent `monitored` flags** — series, season and
episode — and this app had only ever written two. Nothing here touched
`series.seasons[].monitored`, so after a delete unmonitored and removed every
episode of a season, Sonarr's own UI and its RSS / missing-episode jobs still
saw a **monitored season**. Radarr has one flag and one scope, so none of this
applies to a movie beyond the removal rule below.

### Three flags, and what writes each

| Flag                         | Writer                               | Called from                                                                                                     |
| ---------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `series.monitored`           | `SonarrService.setSeriesMonitored`   | `ensureSeries` (on, for an existing unmonitored series); `ReleaseService.withMonitoring` (back off, on restore) |
| `series.seasons[].monitored` | `SonarrService.setSeasonsMonitored`  | `MediaDownloadService.requestShow` (on); `ShowService.deleteFiles`'s show path (off) — **new in `c9390b4a`**    |
| `episode.monitored`          | `SonarrService.setEpisodesMonitored` | `ensureSeries`'s episode pass, `unmonitorScope`, and `ReleaseService.withMonitoring`'s restore                  |

`setSeasonsMonitored(sonarrId, seasons, monitored)` takes `readonly number[]`
or `'all'` and returns **only the season numbers it actually changed**. It
costs one `GET /api/v3/series/{id}` and at most one `PUT` — an empty list is
answered before the GET, and an already-correct series skips the PUT
entirely. A season Sonarr no longer lists is logged as a warning and skipped,
never thrown: the delete side can name a season that has since disappeared,
and failing the whole unmonitor over it helps nobody. Every scope check is set
membership rather than truthiness, because **season 0 is specials** — a real
season, and one `'all'` includes.

### Request side — the cascade goes down

`POST /download/shows` now always hands `ensureSeries` an explicit scope
(`monitorEpisodes: scope ?? {}`; `{}` is "the whole series"), and then writes
the season flags the request covers:

| Request                    | Season flag                 | Episodes                    |
| -------------------------- | --------------------------- | --------------------------- |
| `{ tvdbId, episodeId }`    | **untouched, deliberately** | that episode only           |
| `{ tvdbId, seasonNumber }` | that season's, on           | every episode in the season |
| `{ tvdbId }` (bare)        | **every** season's, on      | every episode               |

A bare request is not an absence of scope — it is an explicit "monitor
everything", which is why it reaches `ensureSeries` as `{}` rather than as no
options at all.

**Season flags are written after episodes, never before.** Sonarr's
`PUT /series` may cascade a changed `seasons[].monitored` down to that
season's episodes, so every episode read that feeds a result
(`turnedOnEpisodeIds` here, the unmonitored count on the delete side) has to
have happened already. Nothing depends on that cascade either way — every
episode flag this app wants is written explicitly through
`setEpisodesMonitored`.

### Delete side — the cascade goes up

`DELETE /download/media/:id/files` no longer stops at the scope it was given.
The show path takes **one** snapshot — `getEpisodes(sonarrId)` plus
`getQueue([sonarrId])`, in parallel — and hands it to `planShowDelete`
(`apps/download/src/media/delete-cascade.util.ts`), a pure function returning
a `ShowDeletePlan`: the file ids to delete, the seasons to unmonitor, the
scope to unmonitor, and how far the delete reaches (`'none' | 'season' |
'series'`).

- Deleting the **last remaining episode of a season** also unmonitors the
  season — the first time any path here writes the season flag on a delete.
- Deleting the **last remaining season of a series** removes the series.
- An episode delete can therefore escalate two levels at once: episode →
  season → series.

The plan's `unmonitorScope` then `setSeasonsMonitored(..., false)` pair runs
inside the existing warn-don't-fail `unmonitor()` wrapper: the files are gone
by then, so a failed flag write is a logged inconsistency, not a failed
delete. On a `'series'` plan there are no per-file deletes at all — Sonarr
removes the folder. Deleting zero files is still a **success**, not a 404.

The response carries `removedFromLibrary`, and the audit row's metadata
carries `cascade`, so a caller can tell a partial delete from a removal. A
removal also cancels the title's non-terminal jobs: nothing upstream is
searching for them any more, and `MediaPollerService.trackedJobs` skips a job
whose media no longer resolves to an upstream id, so left alone they would sit
at `Searching` until a restart failed them.

> Since plan 021 · Phase 3 a restart re-adopts movie/show rows rather than
> failing them, so left alone they would now sit at `Searching` indefinitely.

### A whole-title delete is the arr's real `DELETE`

A movie delete, and a series-scope show delete, are now Radarr's
`DELETE /api/v3/movie/{id}` and Sonarr's `DELETE /api/v3/series/{id}` with
`deleteFiles=true`, through the existing `unmonitorAndDelete` wrappers — not
"delete the files and unmonitor". Leaving a title in the library with
everything unmonitored was the source of the re-grab bugs this kept patching:
`ensureSeries` reads a monitored series row, skips its episode pass, and
`SeriesSearch` finds nothing to grab. A title with nothing left is better off
gone, and it can still be requested again later — that re-adds it.

A movie has exactly one scope, so **every** movie delete is a whole-title
delete; a season or episode on a `tmdb:` key is a 400, checked before anything
upstream is resolved. Both wrappers cancel the title's queue items
(`removeFromClient: true`) before issuing the `DELETE`, and Sonarr's passes
`addImportListExclusion: false` so a re-request is not blocked.

This is also what the confirm dialog says: the movie/series copy names the
removal from Radarr/Sonarr and offers "can be requested again later" in place
of the old, now-false "stays in Radarr/Sonarr" reassurance. Season and episode
copy is untouched — those scopes really are files only.

### The in-flight guard, and why one snapshot

"Remaining" means an episode **has a file on disk OR has a Sonarr queue
item**. A queue item is a file that is about to exist, and the cascade's
removal path calls `unmonitorAndDelete`, which cancels the title's queue items
— so cascading over something still downloading would be a silent, destructive
side effect of an unrelated click. Queue items Sonarr could not pin to an
episode still count: one naming only a season keeps that season, one naming
neither keeps the series.

An **explicit** whole-series or movie delete is not guarded. The user named
the title.

> ⚠️ **Say this plainly:** a currently-airing show whose only downloaded
> episode is deleted **is** removed from Sonarr, even though future episodes
> are monitored and expected. Unaired episodes are neither downloaded nor in
> flight, so nothing remains by this definition. The cascade-aware dialog copy
> is what makes that a choice the user sees rather than a surprise.

Cascade detection reads that one snapshot and is **not** re-queried after each
delete. A fresh read is not more accurate: Sonarr's file list and an import
racing the delete disagree for the same few seconds either way. The snapshot
is the truth the user was looking at when they clicked. The queue read is
series-scoped on purpose — `planShowDelete` takes no series id and would read
a whole-instance queue as this series still having work in flight.

One more subtlety the planner handles: a multi-episode file appears as the
same `episodeFileId` on each episode it backs, so file ids are deduplicated
before anything is deleted.

### ⚠️ Accepted gap: a scoped request on a fresh add

`ensureSeries` adds a missing series with `addOptions.monitor: 'all'`. For a
**scoped** request that has to add the series, that monitors every episode.

It stays that way because Sonarr creates a series' episodes
**asynchronously** after `POST /series` — a `RefreshSeries` command runs after
the add. Adding with `monitor: 'none'` and then monitoring the scope would
find no episodes to monitor yet, and the scoped search would find nothing
monitored: a job that wedges instead of a series that over-monitors. Making
the scope stick at add time needs a wait for the refresh to finish, which is
its own feature.

Reachable only from tdr-bot or the raw API — the web UI cannot request a
season of a show that is not in the library, because there are no seasons to
list yet. Recorded here so nobody re-discovers it as a bug.

### Manual verification (needs live Sonarr/Radarr — human only)

> [!CAUTION]
> **Every step below mutates the real Sonarr/Radarr library**, and the delete
> steps remove real titles and real files. `local-verification.md`'s standing
> rule — **no mutating requests against the media library** — forbids this as
> an agent task. A human runs it, on a throwaway title, with explicit intent.

⚠️ **Not yet run.** _Checking for:_ the three flags end in the state this
section promises at each level, and that a whole-title delete really removes
the title.

All through `http://localhost:8090`, loopback only; Sonarr checks via
`GET /api/v3/series/{id}` and `GET /api/v3/episode?seriesId=`.

1. Pick a **short, cheap, disposable** series nobody wants (2–3 short
   seasons). Record Sonarr's `series.monitored`, every `seasons[].monitored`,
   every `episode.monitored` / `hasFile` as the baseline.
2. `POST /download/shows { tvdbId, seasonNumber: 1 }` → expect: series on,
   **season 1 flag on**, S1 episodes on, other seasons' flags and episodes
   **unchanged**.
3. `POST /download/shows { tvdbId }` (bare) → expect: **every** season flag
   on, every episode on.
4. Let one season finish downloading.
   `DELETE /media/tvdb:N/files?episodeId=<one>` → expect: that episode off,
   file gone, season flag **unchanged** (siblings remain). Response
   `removedFromLibrary: false`.
5. Delete the rest of that season one episode at a time; on the **last** one
   expect: season flag **off**, every S1 episode off. If it was the only
   downloaded season: the series is **gone** from `GET /api/v3/series`,
   `removedFromLibrary: true`, and the title's `searching` jobs (if any) show
   `cancelled` in `/download/activity`.
6. Re-add with a bare request → a fresh add, everything monitored.
7. **Record what Sonarr did to the episodes when only the season flag was
   PUT** — that is the ordering gotcha this section assumes but has not
   observed.
8. Movie: request a disposable movie, let it land, `DELETE /media/tmdb:M/files`
   → gone from `GET /api/v3/movie`, `removedFromLibrary: true`.
9. Confirm nothing else changed against the baselines. Remove the throwaway
   titles.

⚠️ Before trusting any live result, confirm the dev backend is running this
code:

```bash
docker logs lilnas-download-dev 2>&1 \
  | grep -c "Nest application successfully started"
```

against when the commits landed; `docker restart lilnas-download-dev` if in
doubt.

---

## Stuck imports and the in-app importer (plan 020)

**Status: done.** Full plan in
`docs/features/download/plans/020-stuck-import-needs-attention.md`. Commits,
in order: `8d8e6420` (the `needs_attention` status), `1fc5ad5c` / `b2ddb13a`
(Radarr's and Sonarr's manual-import and queue-removal methods), `135bc8d5`
(the wire contract), `a8e41f5e` (the classification), `42c0afa4` (rendering
it as stopped rather than busy), `6c2bf12f` (the restart exemption),
`22959ced` / `be95eaa6` (the server actions and their audit actions),
`495d03eb` (upstream's own sentence carried onto the job), `af14a9a5` (the
dialog), `77ac2729` (`ManualImportService`), `3cf9ecae` / `0ddc7d2b` (the
dialog mounted in the lifecycle panel and on a stuck episode row),
`5bd08375` (the three routes).

Radarr and Sonarr can finish a download and then refuse to import it. The
bytes are on disk, the queue row reads "Downloaded - Waiting to Import" with
a warning icon and a one-line reason — usually that the folder name did not
match the grabbed release — and **nothing moves again** until a human opens
their manual-import dialog and picks the destination by hand. This app used
to fold that row into `importing`: accent colour, breathing dot, "the machine
is working on it", and upstream's sentence dropped on the floor. A
permanently stuck job was indistinguishable from a 30-second import, and
never reached a terminal status.

### The signal, and the ordering trap

Classification is `deriveStatusFromQueueItem` in
`apps/download/src/media/queue-status.util.ts`. A queue item is
`NeedsAttention` when either holds:

| Condition                                                              | Why it counts                                                   |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `trackedDownloadState` of `importPending` or `importBlocked`           | Upstream's own words for "the file is here and I won't move it" |
| `status === 'completed'` **and** `trackedDownloadStatus === 'warning'` | The transfer is done and something is wrong with the import     |

> ⚠️ **The branch order is load-bearing.** A live stuck item is
> `status: 'completed'` **and** `trackedDownloadState: 'importPending'` at
> the same time, so the needs-attention test has to run **before** both
> importing branches — the branch below it, which calls an `imported` state
> or a `completed` status `Importing`, would otherwise swallow it, and the
> job would sit in the accent colour forever.

Not every warning is this. Radarr and Sonarr warn about a stalled torrent, a
missing category, an unpack in progress — all still `downloading`, and none
of them fixed by a manual import — so a warning on an item that is still
transferring deliberately stays `Downloading`. **Only import-stage signals
count.**

`STATUS_PRECEDENCE` (the fold `aggregateQueueItems` uses when Sonarr queues
one row per episode) is `[Failed, NeedsAttention, Downloading, Importing]`.
A season with one blocked episode and nine still transferring therefore
reports `needs_attention` immediately rather than minutes later: it is the
one thing in the list a person can act on **now**. The summed
`size`/`sizeleft` still drive the bar, so the card reads "9 of 10 — needs
your decision", which is exactly true.

### The status, and why it is not `failed`

`DownloadJobStatus.NeedsAttention = 'needs_attention'`
(`packages/utils/src/download/schema.ts`), **non-terminal** — the job is
still open work, still on the Activity feed, still polled.

- Not `failed`, because `failed` offers Retry, and a retry re-searches and
  re-grabs a file that is already sitting on disk.
- Not `importing`, because that is the bug this replaced.

It renders tone `warn` with **no breathing dot** — the visual grammar
`paused` already uses — and the chip reads **"needs your decision"**
(`statusTone` in `src/lib/format.ts`, `JOB_STATUS_LABELS` in
`src/components/detail/job-state.ts`). `jobActionState` offers `import` for
this status and no other: everywhere else there is either nothing on disk to
import or nobody waiting on a choice.

Upstream's own sentence rides on `job.error`, written by the poller through
`describeQueueItemError` — the same field a `failed` job uses, because both
statuses are "upstream said why". A job can sit here for hours while upstream
re-parses the release and changes its mind about _why_, so `applyUpdate`
treats a changed reason at an unchanged status as a real update rather than
letting the early return pin the first sentence forever.

> ⚠️ **Leaving the status must clear `error` explicitly**, as
> `{ error: undefined }`. `updateJob` spreads its patch over the record and
> never touches `error` on its own, and `buildJobRow` persists
> `record.error ?? null` — so without the explicit `undefined` a job that
> finally imported carries "was not found in the grabbed release" into its
> history forever. Both writers do it: `MediaPollerService.applyUpdate` when
> the poller moves the job on, and `ManualImportService.moveJobs` when a
> person does.

### The three routes, and the command they post

Media-keyed, with the show scope alongside, mirroring the release routes.
All three live on `DownloadController` and delegate to `ManualImportService`.
⚠️ The scope arrives **in the query** on the GET and the DELETE and **in the
body** on the POST, so the paths and the season/episode they belong to arrive
as one document — which is also why `ImportFilesInputSchema` uses plain
`z.number()` where the two query schemas coerce.

| Route                                | Does                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `GET /download/media/:id/imports`    | Lists the manual-import candidates for every queue item in scope         |
| `POST /download/media/:id/imports`   | Commits the chosen candidates through upstream's `ManualImport` command  |
| `DELETE /download/media/:id/imports` | Discards every queue item in scope, the download client's files included |

Keyed on **media plus scope, never on a job id**: the candidate list belongs
to a title's download, and one title can have several jobs pointed at the
same queue item (a series job and an episode job). Answering per media
answers all of them at once — `moveJobs` then moves every `needs_attention`
job of that title the request covers, `Importing` for a commit and
`Cancelled` for a discard. Which jobs those are is `jobScopeCovers`: an
episode-level request cannot finish a season job, because the season may
still have other episodes waiting.

The client sends **paths and nothing else**. Quality, languages, release
group, indexer flags, folder name and `downloadId` are all re-resolved
server-side from a **fresh** candidate list — the same trust boundary
`GrabReleaseInputSchema` draws with `guid`. A path that is no longer on offer
is a 400, as is one the server marked `importable: false`; an empty `paths`
is a 400 from zod (`.min(1)`), and a scope with no queue rows at all is a
404 response. The download client's `downloadId` is **never persisted**: it
lives on the queue item and is re-read on every call, because a column is a
second copy of transient upstream state that goes stale the moment upstream
re-queues.

> ⚠️ **`postApiV3Manualimport` is the _reprocess_ endpoint.** That route
> (`POST /api/v3/manualimport`) re-evaluates candidates after a user edits a
> field in upstream's own dialog and hands back updated candidates — it
> **imports nothing**, and is deliberately unused here.

The import is a command posted through `postApiV3Command`. Neither SDK types
command-specific fields, so both services declare the body locally as
`CommandResourceWritable & { files, importMode }`:

```ts
// Radarr
{ name: 'ManualImport', importMode: 'auto', files: [{
  path, folderName, movieId, quality, languages, releaseGroup, indexerFlags,
  downloadId }] }
// Sonarr
{ name: 'ManualImport', importMode: 'auto', files: [{
  path, folderName, seriesId, episodeIds, episodeFileId?, quality, languages,
  releaseGroup, indexerFlags, releaseType, downloadId }] }
```

One command per upstream carrying **every** file, because upstream processes
a `ManualImport` as a unit and one call per file would be N commands racing
over the same folder. `importMode: 'auto'` is what upstream's own UI sends —
it lets upstream pick move-vs-copy from the download client's settings rather
than this app overriding a choice the user already made there.

`importedCount` is how many files were **submitted**, not how many landed:
the command queues at upstream's end. This is also why the jobs move to
`Importing` rather than `Completed`, and why **the import path never removes
the queue row** — upstream drops it once the import succeeds, and the
poller's existing "no queue entry while Downloading/Importing/NeedsAttention
→ Completed" branch finishes the job a tick or two later. If the import fails
upstream, the row stays with a new warning and the poller puts the job
straight back to `needs_attention` carrying the new sentence.
`removeQueueItem` has exactly one caller, and it is discard.

### A rejection is informational, and `importable` is not

A candidate's `rejections` explain why the **automatic** import declined.
Upstream's `ManualImportService` builds a **fresh** `ImportDecision` with no
rejections for every file it is handed, so even a `permanent` rejection does
not block a manual import. `manual-import-mapper.util.ts` therefore keeps the
`reason` sentences and **drops the `type`** (`permanent`/`temporary`) on
purpose: surfacing the severity would only invite the dialog to gate on it.

What _does_ gate a row is the server-decided `importable` flag, and there is
exactly one way to be false:

- **Movie candidates are always `importable: true`.** Radarr is asked by
  `downloadId` **and** `movieId`, and resolves the movie from that id even
  when the filename defeats its parser — which is precisely the case this
  feature exists for.
- **A show candidate needs episode ids**, because the command is keyed on
  `episodeIds`. Sonarr's parse is used when it has one; failing that, an
  **episode-scoped** request supplies the answer from its own scope, since
  the job already names the episode. Only a file with neither is
  `importable: false`, carrying `UNPARSED_EPISODES_REASON` — the one sentence
  that points the user at Sonarr.

### The dialog

`src/components/detail/import-dialog.tsx`, mounted by `JobLifecycle` (movie
and series panels) and by `ShowEpisodeRow`, wherever
`jobActionState(status, 'import')` is `offered`. The three calls arrive as an
`ImportDialogActions` prop — `listImportCandidates` / `importFiles` /
`discardImport` from `src/app/actions/media-files.ts` — so the _page_ wires
the backend and the component tests need none of it. A page that never wired
the importer simply renders no Import control.

- **Trigger:** an `outline` button reading `Import`, beside the "needs your
  decision" chip. The `uv` treatment belongs to the footer's confirm, not to
  the trigger.
- **Fetch on open, once.** `GET …/imports` asks upstream about live queue
  items, and a detail page rendering this control once per episode row would
  otherwise fire one request per row on load. A ref keyed on
  `mediaId|episodeId|seasonNumber` makes a parent re-render a no-op rather
  than a second round trip.
- **A list, not a file.** Every row is a real `<button role="checkbox">` with
  a **square** box, not the mockup's round dot: a round indicator would be
  promising a radio group, and several rows can be committed together.
  Importable rows start checked. A blocked row renders `aria-disabled`, never
  `disabled`, so it keeps the focus order and the `aria-describedby` that
  carries its reason.
- **Rejections in one note.** `importRejections` collects every distinct
  cleaned rejection across the whole list — a real list repeats the same
  sentence on every row — and the note closes with
  `IMPORT_REJECTION_NOTE`: "Informational only — a manual import ignores it."
  Without that line the note reads as a blocker on a row the user is
  perfectly able to import.
- **Discard is confirmed inline**, and its note says the three things that
  matter: the files go too, the job ends, and **nothing is blocklisted**.
- An empty candidate list hides Import and keeps Discard: the queue row is
  real even when the file list is not, and discarding is the only honest way
  out of it.

### Discard: the give-up path

`DELETE /api/v3/queue/{id}` per row, with `removeFromClient: true`,
`blocklist: false`, `skipRedownload: true`.

- **No blocklist**, because the release was never the problem — the folder
  name was — and blocklisting it would stop upstream picking the same
  perfectly good release next time. This is the whole reason Discard sits
  beside Retry instead of being Retry.
- **`skipRedownload: true`**, so upstream does not immediately go searching
  for a replacement nobody asked for.

Removals run through `Promise.allSettled`, so one failing row does not lose
the others; each failure is logged. Discarding **zero** rows is a success for
the reason `DeleteMediaFilesResponse` gives — the caller asked for a state
and that state already held — but a discard whose removals **all** fail
throws `ServiceUnavailableException` (503). A poller tick landing between the
removal and the job write can briefly stamp the job `Completed`; the
`Cancelled` write simply wins, and the stamp is harmless — not a race worth a
lock.

Both routes audit. `media.manual_import` renders `IMPORT` in tone `uv` and
reads "manually imported files"; `media.discard_download` renders `DISCARD`
in tone `bad` and reads "discarded a stuck download". The import row keeps
the paths verbatim, because "which files did someone force in" is the whole
question a later reader brings to it, and the discard row is recorded even at
zero.

### Surviving a restart

`reconcileInterruptedJobs` fails every non-terminal row at boot — that is
what keeps a `downloading` row from sitting frozen after the process that was
downloading it died. `needs_attention` is the one exemption,
`RESTART_SURVIVING_STATUSES` in
`apps/download/src/db/reconcile-interrupted-jobs.ts`.

The reason: the state it describes is **upstream's queue row**, which
outlived this process. Failing it would be a lie about Radarr/Sonarr _and_
would hand the user a Retry that re-grabs a file they already have.

Sparing the row is only half of it, though — `MediaPollerService` iterates
the in-memory Map, and a restart empties it, so an unadopted row would sit at
`needs_attention` forever with nothing watching it.
`DownloadStateService.adoptSurvivingJobs()` puts every spared row back in the
Map, and `bootstrap.ts` runs it in order: **sweep → adopt → library sync**,
all before `app.listen()`, so the poller tracks the job on its first tick and
there is no WS subscriber to miss a broadcast.

> ⚠️ **Superseded by
> [Jobs are attempts (plan 021 · Phase 3)](#jobs-are-attempts-plan-021--phase-3)**:
> `RESTART_SURVIVING_STATUSES` is gone, the sweep fails video rows only, and
> `adoptSurvivingJobs()` is now `adoptOpenJobs()`, which adopts every open
> movie/show row plus `needs_attention` videos. And since
> [Phase 4](#the-gallery-is-the-library-plan-021--phase-4) library sync is
> gone, so the boot order is sweep → adopt.

### ⚠️ Accepted gaps

- **A season pack Sonarr could not parse cannot be imported from here**, on a
  season- or series-scoped request: the command needs episode ids and nobody
  has them. The row says so and points at Sonarr, whose own dialog lets a
  human pick the episodes. An episode-scoped request is unaffected — its
  scope answers the question. A "choose the episodes" picker in this app is a
  separate feature.
- **Disappearance from the queue still means `completed`**, exactly as it
  does for `importing`. A user who removes the item at Radarr's own UI gets a
  `completed` job for a download that produced no file. `didJobComplete`
  (`src/media/job-completion.util.ts`, plan 016) is the eventual fix — it
  asks the library whether a file actually appeared — and it is **not wired
  here**; it has no production caller yet. **Closed by
  [plan 021 · Phase 3](#jobs-are-attempts-plan-021--phase-3)**: such a job
  now fails with `Left the queue without producing a file`.
- **Whether Radarr accepts `ManualImport` with `importMode: 'auto'` for a
  file carrying a `permanent` rejection** is confirmed from Radarr's source
  (a fresh `ImportDecision` per file, no rejections) but **not yet exercised
  live**.

### Manual verification (needs live Radarr)

> [!CAUTION]
> The import and discard steps **mutate the real Radarr library and the
> download client's files**. `local-verification.md`'s standing rule — no
> mutating requests against the media library — forbids them as an agent
> task. A human runs those, on a throwaway stuck download, with explicit
> intent. Only step 1 is safe to run unattended.

⚠️ **Not yet run.** _Checking for:_ that a real stuck row is classified,
explained, importable and discardable from this app, and that it survives a
restart.

⚠️ **The stuck item the plan was written against is gone.** As of
2026-09-21 Radarr's queue is **empty** and _Game Night (2018)_
(`tmdb:445571`, Radarr movie `434`) **has a file** — something imported it
out of band. Step 1's shape is still right, but it now answers
`{"candidates":[]}`, and steps 2–4 need a **fresh** stuck download to work
on.

1. **Read-only.** The candidate list, through Next's `/api` rewrite (the
   backend's 8081 has no published host port — see `local-verification.md`):

   ```bash
   curl -s 'localhost:8090/api/download/media/tmdb:445571/imports' | jq
   ```

   Against a genuinely stuck movie, expect one candidate with
   `importable: true`, its parsed quality (`Bluray-1080p`) and languages
   (`English`), and Radarr's cleaned rejection — "Movie [Game Night
   (2018)][tt2704998, 445571] was not found in the grabbed release: …". A
   GET only; nothing mutates.

2. **The import, by hand.** Open `download.lilnas.io/movies/445571` (or
   whatever title is stuck). The lifecycle panel should read **"needs your
   decision"** in `warn` with **no breathing dot**, Radarr's sentence beside
   the chip, and an **Import** control. Press it, tick the file, Import.
   Then confirm all four:
   - Radarr's queue drops the row within a minute and the movie has a file.
   - The job goes `importing` → `completed`, with **no `error`** left on it.
   - `/download/activity` and the detail page agree.
   - The audit log has a `media.manual_import` row carrying the path.

3. **The discard**, when a throwaway case exists: it removes the queue row
   **and** the download client's files, leaves the title in the library
   **un-blocklisted**, and the job reads `cancelled` with Retry offered.

4. **A restart with a stuck job present.** Run
   `docker restart lilnas-download-dev`, then confirm the job comes back
   `needs_attention` — **not `failed`** — is still tracked by the poller (its
   reason updates on the next tick), and still offers Import.

⚠️ Before trusting any live result, confirm the dev backend is actually
running this code — the running process is the one thing none of the above
checks. It mounts this worktree, but `nest start -w` does not always pick up
a rebase:

```bash
docker inspect lilnas-download-dev --format '{{.State.StartedAt}}'
docker logs lilnas-download-dev 2>&1 | grep 'Mapped {/download/media/:id/imports'
```

If the routes are not in that list, the process predates `5bd08375`; a `GET
…/imports` answers 404 for that reason and not because the title has nothing
stuck. `docker restart lilnas-download-dev` and re-check.

---

## Media state and the fed cache (plan 021 · Phase 1)

**Status: Phase 1 done.** Full plan in
`docs/features/download/plans/021-media-as-source-of-truth.md`. Commits, in
order: `c42ae042` (the vocabulary), `1cef3ea8` (the `media` frame and its
parser), `9601f4e0` (the derivation), `2d27b7c6` (the mapper fields),
`29a1e5d1` (`MediaStateService`), `55da3a26` (the resolver annotates),
`210209a6` (full-queue polling), `f08f4ef1` (episode states on the seasons
route), `1c453bb5` (video media events), `9fd24a68` (movie/show media events
from the poller).

The `jobs` table used to stand in for a media table: a title's status was
its newest job's. Plan 021 makes **media** — a Radarr movie, a Sonarr
series, a `videos` row — carry a live `state` derived from upstream on every
poll, and turns a **job** into one download attempt (who, when, scope,
outcome). **Phase 1 is additive**: every field is new and optional, and
nothing the frontend already reads changes meaning.

### The vocabulary

`MEDIA_STATES` / `MediaStateSchema` in `packages/utils/src/download/schema.ts`;
the helpers in `types.ts`.

| State             | Movie / show                                                   | Video                                  |
| ----------------- | -------------------------------------------------------------- | -------------------------------------- |
| `absent`          | Not in the library, or unmonitored with no file                | No row, or a row with no file          |
| `wanted`          | Monitored, no file, nothing queued                             | Job queued, not started                |
| `downloading`     | A queue item is moving bytes                                   | yt-dlp running, or cancelling          |
| `importing`       | Bytes down, Radarr/Sonarr importing                            | Converting, uploading or cleaning      |
| `needs_attention` | A queue item is stuck or failed; a human must act              | Mapped for completeness; never reached |
| `paused`          | The queue item is paused at the download client                | Paused or pausing                      |
| `available`       | A file on disk — movie `filePath`, show `episodeFileCount > 0` | `downloadUrls` non-empty               |

- **Precedence** (`MEDIA_STATE_PRECEDENCE`, highest first): `needs_attention`
  → `downloading` → `importing` → `paused` → `available` → `wanted` →
  `absent`. `rollupMediaState()` picks the highest present; an empty input
  is `absent`. So a series with 3 of 45 episodes on disk is `available`, and
  the counts say how much.
- **`stateReason`** is upstream's one-line sentence, present **only** for
  `needs_attention`. Episodes carry no reason — the series-level one is the
  rollup's.
- **`state` is optional on the wire, like `embyStatus`**: the mappers build a
  `Media` before anything has looked at the queue. The resolver fills it on
  everything the API serves, but readers never read `media.state` directly
  — they call `mediaState(media)`, which falls back to `absent`.
  `isMediaInFlight()` is `downloading`, `importing`, `needs_attention` or
  `paused`; `wanted` is not in flight, since nothing has been grabbed.

### Derivation

`apps/download/src/media/media-state.util.ts`, pure functions.

- **Managed (`deriveManagedState`).** A queue item wins over the library — a
  movie with a file _and_ a downloading item is an upgrade in flight and
  reads `downloading`, with a `queueSnapshot`. The item is classified
  through the same `deriveStatusFromQueueItem` the poller uses for jobs, so
  a media's state can never disagree with its attempt's status:
  `Failed`/`NeedsAttention` → `needs_attention` (reason from
  `describeQueueItemError`), `Importing` → `importing`, `Paused` → `paused`,
  anything else → `downloading`. No item: file → `available`, else
  monitored → `wanted`, else `absent`.
- **Several items (`deriveManagedStateFromItems`).** Each item is derived on
  its own and the highest-precedence result wins, keeping that item's
  snapshot and reason. The library never needs to join the contest: every
  item state outranks every library state.
- **Series.** The rollup over every item with the series' `seriesId`, plus
  the library. ⚠️ The file signal is **`episodeFileCount > 0`, never
  `filePath`** — on a `Show`, `filePath` is the series folder and is set for
  every library series. With more than one item, the winner's state and
  reason stand but the snapshot is `aggregateQueueItems` over all of them
  (summed bytes, last-to-finish ETA), so a season grab shows the whole
  grab's progress rather than one episode's.
- **Episodes (`toEpisodeStateEntries`, `annotateEpisodes`).** Items are
  matched per episode with `matchesScope` **before any fold** —
  `aggregateQueueItems` would collapse a season into one synthetic item with
  no episode id. An episode with no item falls back to its own
  `hasFile`/`monitored`.
- **Video (`deriveVideoState`).** An in-flight job's status wins, through
  the `VIDEO_JOB_STATE` `Record` (a new `DownloadJobStatus` fails
  type-check there); a terminal job, or none, leaves it to the file:
  `available` or `absent`.

### The fed cache

`MediaStateService` (`apps/download/src/media/media-state.service.ts`)
holds the last Radarr and Sonarr queues and the status of every in-flight
video job. It **fetches nothing and injects nothing**: `DownloadStateService`
already reaches into `MediaModule` through the `DownloadModule ⇄
MediaModule` forwardRef, and the resolver annotates through this service,
so if it injected `DownloadStateService` the cycle would need a second
forwardRef pair. The writers push instead.

| Side   | Who                                                              | Call                                         |
| ------ | ---------------------------------------------------------------- | -------------------------------------------- |
| Writes | `MediaPollerService`, every tick, both sources                   | `setQueue(source, items)` — replaces, copies |
| Writes | `DownloadStateService.trackVideoActivity` (`addJob`/`updateJob`) | `setVideoActivity(mediaId, status)`          |
| Reads  | `MediaResolverService.resolve()`, right after Emby's annotate    | `annotate(media.values())`                   |
| Reads  | `ShowService.listSeasons`                                        | `annotateEpisodes(sonarrId, seasons)`        |

- Both annotators are **synchronous and mutate in place**, the shape of
  `EmbyStatusService.annotate()` — they only read memory.
- `annotate` is **idempotent**: a field that no longer applies is deleted,
  so re-annotating after the queue empties clears a stale snapshot and
  reason. It never touches `embyStatus`. A placeholder (no upstream id, no
  file, no `monitored`) falls through to `absent` with no special case.
- `setVideoActivity` with `undefined` or a terminal status **clears** the
  entry, so the map never grows by one per video ever downloaded.
  `trackVideoActivity` runs **before** the job is broadcast, so the
  broadcast's hydrate already annotates with the new status. Movie/show jobs
  are skipped — their state comes from the queues.

### Full-queue polling, and when to refresh

`poll()` runs `pollSource('radarr')` and `pollSource('sonarr')` side by
side. Each reads **the whole queue** every tick (`getQueue()` with no ids),
`setQueue`s it, then matches tracked jobs from that list (`matchJobItems`).
Before this, a download grabbed in Radarr's own UI, from Discord or another
tab was invisible.

- **`RefreshMonitoredDownloads` is sent only when it buys something**
  (`requestQueueRefresh`, before the tick's `getQueue`). With SABnzbd read
  directly and healthy, once per SAB phase change — see
  [Event refresh](#event-refresh-and-the-3f1-fallback). Otherwise only while
  an item in the previous tick's queue, owned or not, is moving — see
  [The queue refresh](#the-queue-refresh-plan-024--3f1). A failed refresh
  logs and reads the queue as-is.
- **A failed `getQueue` throws before `setQueue`**: the previous cache is
  kept and the poller backs off as before. `poll()` awaits both sources with
  `Promise.allSettled` (rethrowing the first failure), so the media diff
  never starts while the other source is mid-tick.

### The media event

```ts
// MEDIA_EVENT_TYPE = 'media', inside the usual { type, data } envelope
{ type: 'media', data: { media: Media, episodes?: EpisodeStateEntry[] } }
```

`media` is a full, current snapshot — `state`, `stateReason`,
`queueSnapshot` included — so a subscriber may replace its copy blind.
`episodes` rides only on a show. It goes out through
**`DownloadGateway.broadcast()`**: serialised once, the same frame to every
open client. A media snapshot has no requester for the attribution oracle to
mask, so it needs none of `broadcastPerViewer()`'s per-viewer variants.

**Movies and shows — the poller** (`broadcastMediaChanges`, after the job
updates, only for sources whose queue was stored this tick):

- **Which media.** Every media id with a queue item this tick **or last**.
  The first half reaches pages for downloads no job owns; the second sends
  the event a finished download ends on. "Left the queue" is judged by
  **upstream id**, not by whether the media id still resolves, so a failed
  or lagging library read can't read as every download finishing at once.
- **Upstream id → media id** comes off the resolver's **cached library**
  (`getMovieLibrary`/`getShowLibrary`, now public), costing upstream
  nothing. ⚠️ A title added upstream since the cache filled isn't found yet
  and is retried each tick — **up to 60 s** (`TTL_MS`) before its first
  event.
- **Invalidate before resolve.** A media whose upstream id left the queue is
  `invalidate()`d first, so its last event carries the imported file rather
  than the cache's mid-download copy. Then one batched `resolve()`; a
  **degraded** source skips the tick entirely (a placeholder would clobber
  a subscriber's real copy) and the whole batch is retried.
- **One event per series**, whatever its queued-episode count: one
  `getEpisodes` call, folded through `toEpisodeStateEntries`.
- **Diff by digest** of `{ state, stateReason, queueSnapshot, episodes }`
  (`JSON.stringify`) against the last one sent for that media id — a tick
  that moved nothing sends nothing. An event that couldn't be built
  (episode read failed, media missing) is kept for next tick; a media gone
  from the queue whose last event went out is forgotten.
- **Never throws**: resolve, library and episode failures log and retry
  next tick; none back off the poll or touch job tracking.

**Videos — ride along with job events.** Every video job event also sends a
`media` frame (`DownloadStateService.broadcastMediaEvent`) from the media the
job's hydrate already resolved and annotated, ahead of the attribution
lookup so a failure there can't swallow it.

**Parsing — `parseMediaEventFrame`**
(`packages/utils/src/download/job-events.ts`), the twin of
`parseJobEventFrame` and silent the same way: a non-string,
malformed JSON, another `type`, or a `media` failing `MediaSchema` →
`undefined`. ⚠️ A bad **`episodes`** array does **not** reject the frame —
the media is returned with `episodes` omitted, so the state chip can't
freeze over an episode row nobody is looking at.

### Mapper fields

| Field                               | Source                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `Movie.monitored`, `Show.monitored` | Upstream's flag, **library titles only** — a lookup hit's is a default |
| `Movie.addedAt`                     | `movieFile.dateAdded`, only when `hasFile`                             |
| `Show.addedAt`                      | `series.added`, library series only                                    |
| `Video.addedAt`                     | `videos.updated_at`, only when `download_urls` is non-empty            |
| `Show.episodeCount` / `…FileCount`  | `series.statistics`, from **`getLibrary()` only**                      |

- ⚠️ **Sonarr's `/series/lookup` zeroes `statistics`** even for a library
  series — a fully downloaded one comes back `episodeFileCount: 0`. Search
  and lookup map through `toLookupShow`, which drops `statistics` so the
  counts are absent rather than a false "nothing on disk".
- Upstream dates go through `toUpstreamIsoDateTime`
  (`src/media/upstream-date.util.ts`), which drops .NET's
  `DateTime.MinValue` (`0001-01-01…`, a non-library lookup's `added`) and
  never substitutes "now".

### ⚠️ Known gaps

- **The per-job `queueSnapshot` graft in `toJob` still exists** until
  Phase 3: `DownloadStateService` grafts the poller's per-job snapshot onto
  the job's `media`, over the media-level one `annotate` set. Both are read
  from the same queue through the same helpers, so they agree. **Removed in
  [Phase 3](#jobs-are-attempts-plan-021--phase-3).**
- **A video's `addedAt` moves on re-request.** It is `videos.updated_at`,
  and `upsertVideoByNaturalKey`'s conflict branch bumps it on every
  re-request, so a video requested again reads as freshly added.

---

## Detail pages read media (plan 021 · Phase 2)

**Status: Phase 2 done.** Frontend only — no backend or wire change. Commits,
in order: `879fab78` (labels and tones), `be9351b5` (the live store follows
media frames), `6ab7439d` (show/season/episode state from episodes),
`3476e87b` (`useLiveMedia`), `7dc6d173` (`MediaStatus` and `AttemptList`),
`79716fe6` (movie page), `169d9ed1` (video page), `c9cfd0d5` (show page),
`be15095c` (one `media` prop name), `d8d4ad79` (the job-derived helpers
deleted).

Phase 1 put `state` on every media; Phase 2 makes the movie, show and video
pages read it. The motivating bug: **_Cars_ read `failed` while it was
playable**, because a restart failed its newest job and the page's chip was
that job's status.

### What changed for the user

- **The chip is the media's.** `mediaState(media)` (or a rollup of episode
  states on a show), never a job. _Cars_ now reads `in library`, with the
  failed attempt listed under it and no Retry.
- **Jobs are an Attempts list** under the chip, newest first. Only an
  in-flight attempt carries controls.
- **Downloads started elsewhere show live.** A grab from Radarr's/Sonarr's
  own UI, Discord or another tab reaches the page by media id — chip and
  progress bar, with "Grabbed from Radarr/Sonarr directly — no attempt to
  show, cancel or pause here." when no attempt of ours is behind it.
- **No `router.refresh()` anywhere in the app.** The media frame carries
  the file, state and queue snapshot, so the page never asks for a server
  re-render.

### Vocabulary → UI

Words in `apps/download/src/components/detail/media-state.ts`
(`mediaStateLabel(state, type)`, `mediaStateIsLive`, `mediaProgress`); tones
in `src/lib/format.ts` (`MEDIA_STATE_TONES`, `mediaStateTone`). `Record`
tables keyed on `MediaState` and `DownloadType`, so a new state or type fails
type-check here.

| State             | Movie / show        | Video               | Tone   | Live dot |
| ----------------- | ------------------- | ------------------- | ------ | -------- |
| `available`       | in library          | **downloaded**      | `ok`   | –        |
| `wanted`          | wanted              | wanted              | `mute` | –        |
| `downloading`     | downloading         | downloading         | `uv`   | yes      |
| `importing`       | importing…          | **processing…**     | `uv`   | yes      |
| `needs_attention` | needs your decision | needs your decision | `warn` | –        |
| `paused`          | paused              | paused              | `warn` | –        |
| `absent`          | not downloaded      | not downloaded      | `mute` | –        |

- **Live dot is narrower than `isMediaInFlight`**: `needs_attention` and
  `paused` are in flight but stopped, and a breathing dot would promise
  movement.
- **`mediaProgress(media)`** reads `queueSnapshot` — `null` for a video, no
  queue item, or a non-finite percentage (a `0%` bar is a claim).
- **Rollups** (`components/detail/show-state.ts`): `seasonState(season)` is
  `rollupMediaState` over its episodes; `seriesState(show, seasons)` over
  every episode **outside season 0** (specials would pin a finished series at
  `wanted`), falling back to `mediaState(show)` when there is nothing to roll
  up. `episodeState(episode)` maps an episode's own state through the same
  label/tone/live helpers — one vocabulary at every level.

### Live plumbing

**The store** (`src/lib/use-job-events.ts`, one socket per page) holds two
maps — jobs by `job.id`, media frames by `media.id` — and replaces only the
one a frame touched, so subscribers can memoize on identity.

| Frame | Kept when                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------- |
| Job   | an unfiltered subscriber exists, **or** `job.id` ∈ `jobIds`, **or** `job.media.id` ∈ job-filter `mediaIds` |
| Media | `media.id` ∈ a `useMediaEvents` subscriber's `mediaIds`                                                    |

- **Two separate media-id interest sets** (`jobMediaIds`, `mediaIds`), each
  ref-counted. One shared set would make a job-only subscriber store every
  media frame for its title (and vice versa) that nobody reads.
- **`JobEventsFilter { jobIds?, mediaIds? }`** — once either key is given,
  the omitted one means "nothing"; both omitted is the activity feed's
  unfiltered mode.
- **`useMediaEvents({ mediaIds })`** returns the latest `MediaEvent` per
  requested id through a cached selector — it re-renders only when one of
  its own ids gets a frame or `connected` flips.

**`useLiveMedia({ jobs, media, seasons? })`** (`src/lib/use-live-media.ts`)
subscribes both ways by `media.id` and folds the frames into the page's
server props:

- **Media** — the live frame replaces the prop **only when its `type`
  matches**; a mismatched frame is ignored whole, episodes included.
- **Episodes** — patched by `episodeId` (`state`, `queueSnapshot`; an entry
  with no snapshot drops the served one). Unmoved seasons keep their
  identity.
- **Jobs** — live jobs for this media upserted by id over the served ones,
  newest first by `createdAt` (stable). Other media's jobs are ignored.
- **No importing hold, no refresh** — a landed job is shown as landed; the
  chip reads the media, not the job.

### Components

- **`MediaStatus`** (`media-status.tsx`) — no directive, no hooks, so a
  server page can render it. Chip from `scopeState ?? mediaState(media)` in
  `media.type`'s wording; note is `explain ?? media.stateReason`; a
  `ProgressBlock` whenever `progressPct ?? mediaProgress(media)?.pct` exists —
  **with or without a job**. Takes no job at all, so a failed attempt cannot
  reach the chip.
- **`AttemptList`** (`attempt-list.tsx`, client) — heading "Attempts",
  newest first, `null` when empty.
  - **Every non-terminal job gets its own highlighted card** (a deviation
    from the mockup's one card: a show can have a season grab and an episode
    grab in flight together). Status chip, scope note
    (`attemptScopeLabel` → "Season 3, episode 6"), `jobProgress` bar, and
    controls gated by `jobActionState` — `acknowledged` (`pausing`,
    `cancelling`) stays drawn but `aria-disabled`; a missing handler draws
    nothing; Import mounts `ImportDialog` when `imports` is passed.
  - **Terminal jobs are `StateLine` rows** in a sunk card: status chip,
    relative `completedAt ?? createdAt`, requester masked as the header masks
    it, error in `text-bad`.
  - **`retryable`** puts Retry on the **newest** job only, only when it is
    failed/cancelled. ⚠️ Pages pass it from the **media** state
    (`absent`/`wanted`), never the job — a failed attempt says nothing about
    the file, and a Retry over _Cars_ would re-grab a title on disk.
- **Shared pieces** — `job-actions.tsx` (`JobAction`, `ActionSpec`,
  `ACTION_SPECS`, `ACTION_BUTTON`, `ActionRow`) and `progress-block.tsx`
  (`ProgressBlock`).
- **Deleted** — `JobLifecycle`, `JobHistory`, `JobLifecycleLink`,
  `currentJob`, `mergeLiveMediaJobs` (and its importing hold),
  `mergeVideoJobs`, `useLiveMediaJobs` (the app's only `router.refresh()`),
  `seriesScopedJobs`, `isScopeDownloading`. `jobProgress` stays for the
  attempt card.

### Per-page gating

**Movie** (`movie-detail.tsx`, `MovieDetailLive`):

- **Download** (outline `MovieRequestButton`) iff the movie is
  `absent`/`wanted` **and** no attempt is in flight — a press beside a
  pending grab would race it.
- **Watch, Save, Delete** follow the file (`movieHasFile`: `filePath` or
  `embyStatus`), not the state.
- **Attempts** get `retryable` from `absent`/`wanted`, but `onRetry` is
  unwired (see gaps) — Import is the only attempt control a movie offers.

**Video** (`video-detail.tsx`, `VideoDetailLive`):

- **`complete = state === 'available'`** gates the player, Save and Delete —
  a video whose file was deleted no longer draws a player over nothing.
- **`videoSourceJob(jobs, complete)`** — the newest **completed** attempt
  once downloaded (who produced the file), else the newest. Drives the
  attribution line and the delete's job id (`DELETE /download/videos/:jobId`).
- **Pause, Cancel, Resume** on the in-flight card; **Retry** only while
  `absent`/`wanted` and the newest attempt is not an unrecognised link.
  Phase 3 replaced that Retry with a page-level **Download**.
- No progress bar, ever — nothing on the wire carries a video's progress.

**Show** (`show-detail.tsx`, `show-seasons.tsx`, `show-episode-row.tsx`):

- **Series chip** from `seriesState`; bar from the show's `queueSnapshot`,
  else the files-on-disk rollup while in flight. The series Attempts lists
  every attempt at the show, any scope.
- **Season** — its own `MediaStatus` (`seasonState`, the series' snapshot
  stripped so its bar doesn't draw on every tab) and "Season N attempts"
  (`seasonScopedJobs`). `retryable` from `isDownloadableState(seasonState)`.
- **Season tabs** — live dot + files-on-disk pct for `downloading`/
  `importing`; warn dot (with `sr-only` state text) for `needs_attention`/
  `paused`.
- **Episode rows** — chip and bar from the episode's own `state` and
  `queueSnapshot`. **Download** when `absent`/`wanted` and no in-flight
  attempt at that episode; **Import** when the **episode** is
  `needs_attention` (the importer is addressed by media key + scope, so it
  needs no job); **Cancel** on the episode's in-flight attempt when wired.

### ⚠️ Known gaps

- **No movie/show cancel, pause, resume or retry.** Those routes are
  `/download/videos/:id/…` only, and the frontend never calls a show's
  `DELETE /download/shows/:id`. The handlers are threaded through every
  scope but unwired, so a movie/show attempt offers only Import.
- **The chip sits in `DetailHeader`'s `lifecycle` slot**, above the
  actions, not directly under the title as in the mockup — `meta` is a
  `<p>` and cannot hold `MediaStatus`'s `<div>`.
- **A stuck scoped show attempt appears twice** — in the series Attempts and
  again in its season's.
- **"Download series" stays visible on an `available` partial series** —
  the header's `ShowRequestButton` is not gated.
- **A deleted video whose newest attempt is `completed` has no re-download
  path**: completed attempts offer no Retry and videos have no Download. The
  page's own Delete cancels the attempt, which does leave a Retry; a file
  removed any other way doesn't. To be addressed with Phase 3's delete
  change. **Closed by [Phase 3](#jobs-are-attempts-plan-021--phase-3)'s
  Download button.**
- **Activity and home "in flight" counts are still job-driven.**

### Verified live (2026-09-23)

| Page              | Result                                                |
| ----------------- | ----------------------------------------------------- |
| `/movies/50546`   | `in library`                                          |
| `/movies/1158406` | `wanted` + Download                                   |
| `/movies/920`     | _Cars_: `in library`, failed attempt listed, no Retry |
| `/shows/74413`    | series `in library`, 45 of 55 episodes                |

---

## Jobs are attempts (plan 021 · Phase 3)

**Status: Phase 3 done.** Commits, in order: `09650431` (the restart sweeps
video jobs only), `3286894b` (`didJobComplete` needs one file, not every
episode), `435a73f3` (jobs settle from files), `fe52ba90` (deletes keep
completed attempts), `d2398e51` (the video page's Download), `b5341653` (one
source for `queueSnapshot`).

Phase 1 gave media a state; Phase 2 made the pages read it. Phase 3 makes a
**job** what the plan always said it was: one download attempt, whose status
records how that attempt ended and nothing else. Three rules used to rewrite
an attempt after the fact, and each is gone:

- **No queue item meant `completed`**, file or no file.
- **A restart failed every open job**, including downloads Radarr/Sonarr were
  still running. This is the job side of _Cars_.
- **A delete cancelled the attempt** that had downloaded the file.

### Settling from files

_Updated for plan 024: history now decides a download's outcome, and a
missing queue item alone no longer fails anything. See
[Radarr/Sonarr as the source of truth](#radarrsonarr-as-the-source-of-truth-plan-024)._

A tracked movie/show job with a queue item takes its status from the item
(`deriveQueueItemState(current, item, context)`): progress, import trouble
(`needs_attention`) and a delay-profile hold (`searching`, noted
`Delayed by Radarr until 14:05`). A failed item is **not** `failed` — the
history `failed` event decides that, and whether a retry follows; only a
failed item still there after `ATTENTION_DELAY_MS` (2 min) turns
`needs_attention`.

A job with **no** item is settled by `settleAbsentJob(current, facts)` in
`queue-status.util.ts`, from the library (`fileLanded`, via `didJobComplete`)
and the job's persisted download links (`job_downloads`). First match wins:

| No queue item, and …                                                                       | Result                                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| terminal (incl. `not_found`), or a video-only status                                       | unchanged                                                                                    |
| `cancelling` (plan 022)                                                                    | see below                                                                                    |
| a file for the job's scope landed                                                          | `completed`                                                                                  |
| no download links                                                                          | unchanged — `requested`/`searching` have nothing to lose from the queue                      |
| every link resolved, at least one imported                                                 | `completed`                                                                                  |
| every link failed                                                                          | unchanged — history's `failed` event already moved the job (`failed`, or `searching` + note) |
| a link still open, absent ≥ `ABSENT_REMOVED_MS` (10 min) with the client healthy all along | `completed` if another link imported, else `cancelled`, `Removed from the download client`   |
| otherwise                                                                                  | unchanged                                                                                    |

- **The absence clock only runs while the download client is healthy.** The
  poller passes `min(absent, healthy)`, so a SABnzbd outage settles nothing.
- **`not_found` is terminal and never reached from here.** Only a search's
  end decides it (see
  [Commands](#commands-and-when-a-search-ends-not_found)).
- **`statusNote`** is the job's one grey line about where it stands. It is
  kept while the status holds and dropped when it moves, unless the move
  writes its own.

A `cancelling` job with no file settles `cancelled` after 30 s
(`CANCEL_GRACE_MS`), or after 5 s if every link says its download was
removed or failed. See
[Cancelling a movie or show attempt](#cancelling-a-movie-or-show-attempt-plan-022).

- **The poller's path**: private `settleAbsentJobs` → private
  `completionInputs` (one file read per title: Radarr `getMovieFiles`, or
  Sonarr `getEpisodeFiles` + `getEpisodes`) → `didJobComplete`.
- **`completionInputs` never throws.** A failed read logs and leaves that
  title's jobs exactly as they are, past the grace or not. Without the
  listing there is no telling a finished import from a dropped download, and
  one flaky title must not trip `poll()`'s backoff.
- **`completed` invalidates the resolver first**, as before, so the broadcast
  carries the imported file.
- **A `searching` job whose download went grabbed → imported between two
  ticks now completes.** It used to wedge at `searching` with its file on
  disk. A `needs_attention` job a human imported at Radarr/Sonarr completes
  the same way.

### `didJobComplete`, per scope

`src/media/job-completion.util.ts` (plan 016) has its first production
caller. "Newer" means a file's `dateAdded` is strictly after the job's
`createdAt`; an equal or unparseable timestamp is not new.

| Scope                                                  | Completes when                                 |
| ------------------------------------------------------ | ---------------------------------------------- |
| Movie                                                  | any movie file is newer than the job           |
| Episode (`episodeId`)                                  | that episode's file is newer                   |
| Season (`seasonNumber`)                                | **any** episode of the season has a newer file |
| Whole series (no scope, `{}`, or `episodeNumber` only) | **any** series file is newer                   |

- **Lenient on purpose.** The rule was "every episode in scope". Episodes
  already on disk before the job, unaired ones and ones no indexer had never
  get a new file, so demanding them failed an attempt that landed everything
  it could.
- **The job records the attempt; media state says how much landed.** The
  chip and "N of M episodes" come from the media, not from this verdict.
- **Some evidence is still required**, so a download that vanished without
  a file doesn't read as finished.

### The 60 s grace

> ⚠️ **Superseded by plan 024** (`ea73b63d`): `QUEUE_ABSENCE_GRACE_MS` and
> `LEFT_QUEUE_WITHOUT_FILE_ERROR` are gone. The queue drops items for reasons
> that are not failures — SABnzbd briefly unreachable, a Radarr/Sonarr
> restart, SABnzbd's history rolling past its last 60 items — so a job with a
> live link now waits `ABSENT_REMOVED_MS` (10 min) of healthy absence, and
> ends `cancelled`, not `failed`. See the table above.

A grabbed job (`downloading`/`importing`/`paused`) with no item and no file
waits `QUEUE_ABSENCE_GRACE_MS = 60_000`, then fails with
`LEFT_QUEUE_WITHOUT_FILE_ERROR`:

```
Left the queue without producing a file
```

- **Why wait**: Radarr/Sonarr drop the queue row at the end of an import
  slightly before the file listing reports the file, and a tick can land in
  between.
- **`absentSince`** (job id → epoch ms) is wall-clock, so a run of failed
  polls counts toward the grace rather than pausing it. It clears when the
  item reappears, the job settles, or the job is no longer tracked.
- **Plan 020's accepted gap is closed**: an item removed in Radarr's own UI
  now ends its job `failed`, not `completed`.

### Surviving a restart

| Row at boot                        | Before Phase 3                     | Now                                           |
| ---------------------------------- | ---------------------------------- | --------------------------------------------- |
| Video, non-terminal (incl. paused) | `failed`                           | `failed` — `Interrupted by a service restart` |
| Movie/show, non-terminal           | `failed`, unless `needs_attention` | untouched, re-adopted                         |
| `needs_attention`, any type        | spared, re-adopted                 | spared, re-adopted                            |

- **`reconcileInterruptedJobs` sweeps `type = 'video'` rows only.** A video's
  download _is_ this process (yt-dlp, the in-memory Map, bytes under an
  unmounted `/download/videos`), so a restart really did end it. A movie/show
  download runs in Radarr/Sonarr, which outlived the process; failing it was
  a lie, and on _Cars_ it put `failed` on a playable title.
- **`adoptSurvivingJobs()` is now `DownloadStateService.adoptOpenJobs()`**:
  every non-terminal movie/show row (`listOpenJobs(db, types?)` in
  `jobs.repo.ts`) plus every `needs_attention` video.
  `RESTART_SURVIVING_STATUSES` is deleted.
- **Boot order is unchanged**: sweep → adopt → library sync, all before
  `app.listen()`. The boot log reads `Re-adopted N open job(s)`.
  _Superseded by [Phase 4](#the-gallery-is-the-library-plan-021--phase-4):
  library sync is gone, so it is sweep → adopt._
- **The poller settles an adopted row on its first tick** — from its queue
  item if it has one, otherwise from the files. A download that finished
  while the process was down completes; one that vanished fails after the
  grace.

### Deletes keep history

- **Only an attempt still in flight is cancelled.** `MediaDownloadService.deleteJob`
  (`DELETE /download/movies/:id`, `/shows/:id`) and
  `DownloadService.deleteVideoDownloadJob` (`DELETE /download/videos/:id`)
  cancel only when `!isTerminalDownloadJobStatus`. A completed attempt stays
  `completed` with its `completedAt`: it did download the file, and deleting
  that file later is a second fact about the title, not a rewrite of the
  first.
- **A finished movie/show attempt gets no job event on delete**, since
  nothing about it changed. A video still broadcasts, through `updateVideo`
  clearing its `downloadUrls`.
- **Also fixed**: a job completed before a restart could not be deleted.
- ⚠️ **Stopgap — `markRemovedFromLibrary`.** The gallery lists titles with a
  `Completed` job, and relied on the delete's `cancelled` to drop a deleted
  one. Both delete paths now flag every job of the title
  `removed_from_library`, the flag `ShowService.deleteFiles` already sets on
  a whole-title removal (plan 019). A re-request mints a fresh, unflagged
  job, which brings the card back. **Phase 4 moves the gallery onto media
  state and removes the flag.** _Superseded by
  [Phase 4](#the-gallery-is-the-library-plan-021--phase-4): the flag, its
  writes and the column are gone; a card goes when its file does._
- **`scripts/verify/mutate.ts` `MEDIA_TRANSITIONS`**: `completed → cancelled`
  on delete is gone. Newly legal: `requested`/`searching` → `completed`,
  `searching`/`downloading`/`importing` → `paused`, `paused` →
  `downloading`/`importing`/`completed`.

### The video page's Download

Closes Phase 2's gap: a deleted video whose newest attempt was `completed`
had no way back to a file.

- **Download** (`VideoDownloadButton`,
  `components/detail/video-detail-download.tsx`) shows while the video is
  `absent`/`wanted`, no attempt is in flight, and the newest attempt is not
  an unrecognised link.
- **It calls the existing `retryVideoJob`** with the newest attempt's id — a
  fresh `POST /download/videos` from that attempt's `sourceUrl`, `timeRange`
  and `hiddenAttribution`. That is a **new** job row; the attempt it names
  keeps its outcome.
- **Retry is gone from the video's `AttemptList`** — one verb, one button.

### One source for `queueSnapshot`

- **Removed**: `DownloadStateService.queueSnapshots` / `setQueueSnapshot` /
  `getQueueSnapshot`, and `toJob`'s graft of the poller's per-job snapshot
  onto `job.media` (Phase 1's known gap).
- **`job.media.queueSnapshot` is only what `MediaStateService.annotate()`
  sets** during `resolve()`, off the queue cache. It is per title, not per
  job: two attempts at one series show the same whole-grab progress.
- **`touchJob(id)`** re-broadcasts a job as `Updated` and writes nothing; the
  broadcast's hydrate picks up the new snapshot. The poller calls it on a
  progress-only tick (a status move already broadcasts through `updateJob`),
  and once when a job's item leaves the queue without settling, so the stale
  bar clears.
- **The poller's private `lastSnapshot`** (job id → last snapshot) is only a
  change detector. It is never what goes on the wire.
- **Plan 025 adds SABnzbd's live fields** — `downloadedBytes`, `totalBytes`,
  `speedBps`, `etaSeconds`, `stage`, `stageDetail`, `clientPaused`,
  `clientDiskLow` — merged in by the same `toQueueSnapshot`, all optional
  and absent while SABnzbd is off. See
  [Readings on `queueSnapshot`](#readings-on-queuesnapshot).

### ⚠️ Known gaps

- **`removed_from_library` is a stopgap** until Phase 4 (above). **Closed by
  [Phase 4](#the-gallery-is-the-library-plan-021--phase-4)**, which drops the
  column in migration 0004.
- **Not yet verified live.** The dev container's backend process predates
  every Phase 3 commit — its `nest start -w` watcher has exited, and its last
  boot log still reads `Re-adopted 0 restart-surviving job(s)`. Reads of
  `tmdb:50546` and `tmdb:920` (_Cars_) both return `available`, but that is
  Phase 1/2 behaviour. Re-check after the next restart: the boot line should
  read `Re-adopted N open job(s)`. **Checked 2026-09-24**: after the dev
  container's restart the boot log reads `Re-adopted 0 open job(s)`.

## The gallery is the library (plan 021 · Phase 4)

**Status: Phase 4 done.** Commits, in order: `e9ecc01d` (`listLibrary` on the
resolver), `941df833` (`GalleryItem` gains `addedAt`), `40057f70` (the gallery
and its facets from the library), `571a9af6` (cards say "added"), `dbb59b6e`
(a shared partial-migration test harness), `34f9e815` (migration 0004, the end
of library-sync).

Until now the gallery was a `GROUP BY type, media_id` over completed jobs. The
job log is not the library, so it needed two workarounds:

- **library-sync** backfilled a fake `completed` job at every boot for each
  Radarr/Sonarr title that had a file but no job, so titles nobody requested
  through this app still got a card.
- **`removed_from_library`** flagged a title's jobs when its files were
  deleted, so the card went away (Phase 3's stopgap).

Phase 4 lists the library itself. A card exists because a file is on disk,
and the job log only adds a download summary to it. Both workarounds are gone.

### `listLibrary`

`MediaResolverService.listLibrary(): Promise<LibraryListing>` returns
`{ degradedSources, entries: { addedAt, media }[] }`. It reads the same 60 s
library caches `resolve()` uses, so listing costs upstream nothing extra.

| Source                                                 | In the library when          | `addedAt`                    |
| ------------------------------------------------------ | ---------------------------- | ---------------------------- |
| Radarr movie                                           | `filePath` is set            | the movie file's `dateAdded` |
| Sonarr series                                          | `episodeFileCount > 0`       | `series.added`               |
| `videos` row (`listVideosWithFiles`, not the resolver) | `download_urls` is non-empty | `updatedAt`                  |

- **Never a show's `filePath`.** It is the series folder, set for every
  library series whether it has files or not.
- **A video's `addedAt` is a stand-in.** It is the same one `hydrateVideo()`
  puts on `Video.addedAt`: the pipeline's last write is the one that sets
  `download_urls`.
- **A title with a file but no `addedAt` is skipped** and logged. Dating it
  "now" or at the epoch would invent a sort position.
- **Entries are unordered and unannotated.** They are the cache's own objects,
  so they can carry stale annotations. Callers resolve the page they render.
- **A down source is omitted and named in `degradedSources`**, never thrown.

**The failure cache.** After a failed fetch, the resolver caches an empty map
for 10 s (`FAILURE_TTL_MS`) and hands it back without throwing. `resolve()`
copes, because it looks up each miss by id. A listing would have read it as
an empty library, so Radarr being down would look like "no movies". Cache entries now carry
`failed: boolean`. `listSource` spots the stand-in by identity
(`cache.current.failed && cache.current.entries === entries`), not by
emptiness, because an empty library is a real answer.

### The pipeline

`JobQueryService.listGallery`, in order:

1. **Collect titles.** `listLibraryTitles(types)` calls `listLibrary()` only
   when a movie or show is wanted, and `listVideosWithFiles(db)` only when a
   video is.
2. **Filter by type and date.** `from`/`to` apply to **`addedAt`**, inclusive.
   The params keep their `createdFrom`/`createdTo` names.
3. **Filter by requester.** `?requester=` keeps the titles that requester has a
   **completed job** for, via `countCompletedJobsByMediaIds` (500 ids per
   query; a title with no jobs is absent from the map).
4. **Sort** by `addedAt` desc, then media id asc. It uses plain code-unit
   comparison so `isAfterCursor` agrees with it exactly.
5. **Page** from the cursor, `limit` titles.
6. **Resolve only the page** with `resolve()`, which puts fresh Emby status
   and `state` on the cards actually rendered.
7. **Attach the summary**: `downloadCount`, `lastDownloadedAt` and the last
   requester, from `resolveLastRequesters`, masked by `showTrueAttribution`.

- **Paged in memory.** The library is a home NAS's, and a requester-scoped
  page has to join all of it before `total` means anything.
- **An unscoped page only counts jobs for its own ids.** A scoped page reuses
  the counts it already computed in step 3.
- **The cursor** is the same `encodeListCursor` codec: base64url of
  `${addedAtMs}:${mediaId}:${filterKey}`. The filter key now covers
  `addedFrom`/`addedTo` and `types`, so **a cursor minted before Phase 4
  fails its filter-key check and gets the route's 400**. A client restarts
  from page 1.
- **A down source is left out** and logged as a warning. The gallery response
  has never carried `degradedSources`, so its titles silently drop out of
  `items` and `total` until the source recovers.

**The hidden-video rule is unchanged.** A requester-scoped gallery run by a
non-admin passes `excludeHiddenVideos` to the job join. That way a non-admin
cannot confirm, through either the rows or `total`, that someone else has a
hidden video. The unfiltered gallery still lists hidden videos, with
attribution masked.

**Facets count two different things on purpose.** `getGalleryFacets` is async
now, because it reads the library.

| Facet       | Counts                                                         | Date range on          |
| ----------- | -------------------------------------------------------------- | ---------------------- |
| `types`     | library titles, exactly what `listGallery` would list per type | the title's `addedAt`  |
| `uploaders` | completed jobs, by `requester_email` (`countJobsByRequester`)  | the job's `created_at` |

An uploader chip is a claim about people, and people live in `jobs`. The
uploader count always gets `excludeHiddenVideos` for a non-admin. Otherwise the
chip list itself would reveal who hid something.

### `GalleryItem`

| Field              | Before                          | Now                                                                       |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------- |
| `addedAt`          | —                               | **required**: when the title landed in the library (the sort key)         |
| `lastDownloadedAt` | required, the newest job's time | **nullable**: `completedAt`, or `updatedAt` on rows older than that stamp |
| `downloadCount`    | ≥ 1                             | **may be 0**: a title nobody downloaded through this app                  |

- **Cards date by `addedAt`.** The gallery and home cards render
  `<time dateTime={addedAt}>` with a screen-reader-only "added" in front.
- **The avatar is gated on `lastDownloadedAt !== null`**, not on the
  requester fields. A masked upload also arrives with both requesters null, so
  gating on them would lose the dashed "hidden" avatar. The backend fills all
  three from the same lookup.

### Migration 0004

`0004_eminent_prodigy.sql`. drizzle-kit generated the `DROP COLUMN`; the
`DELETE` was prepended by hand:

```sql
DELETE FROM `jobs` WHERE `origin` = 'service' AND `status` = 'completed'
  AND `type` IN ('movie', 'show') AND `created_at` = `completed_at`;
ALTER TABLE `jobs` DROP COLUMN `removed_from_library`;
```

**Why the predicate only hits library-sync's rows:**

- **`created_at = completed_at` is the tell.** library-sync stamped both with
  the title's `addedAt`. A real attempt is created when it is requested and
  completes later, so it always has `created_at < completed_at`.
- **Real service-origin jobs** (tdr-bot calls with no identity) were never a
  movie or show on prod.
- **Read-only counts on 2026-09-22**: dev had 357 matching rows (283 movie +
  74 show). Prod has 21 service-origin completed rows, all videos, none with
  `created_at = completed_at`. So the migration deletes 357 rows on dev and 0 on
  prod.
- **No `audit_log` row references any of them.**
- **A plain `DROP COLUMN` is safe on SQLite.** No index or CHECK references
  `removed_from_library` (added by 0003), so no table rebuild is needed.

`migrate-0004.spec.ts` runs the migration on a prod-shaped DB (at 0002) and a
dev-shaped DB (at 0003). The "migrate a real DB up to tag X, seed it, run the
rest" harness moved out of `migrate-0002.spec.ts` into
`db/__tests__/helpers/partial-migrations.ts` (`dbb59b6e`), so both specs share
it.

### What was removed

- **`src/media/library-sync.ts`** (`syncDownloadedLibrary()`) and its boot call.
  Boot order is now **sweep → adopt**, and the `Library sync: backfilled …` log
  line is gone.
- **The `removed_from_library` column**, `DownloadStateService.markRemovedFromLibrary`,
  `markJobsRemovedFromLibrary` in `jobs.repo.ts`, and
  `JobListFilter.excludeRemovedFromLibrary`. The delete paths no longer touch
  a title's other jobs to take its card down, because the card goes when the
  file does.
- **`listMediaGroupsPage`** (the `GROUP BY`), along with its query-plan test in
  `schema.spec.ts`.
- **Kept: `DeleteMediaFilesResponse.removedFromLibrary`.** It means "removed
  from Radarr/Sonarr" (plan 019), not the dropped column.

### ⚠️ Known gaps

- **A new season doesn't bubble a show up.** A series' `addedAt` is
  `series.added`, when the series first entered Sonarr, not when its newest
  episode file landed. Accepted: Sonarr's per-episode `dateAdded` costs one
  call per series, and 74 calls a minute is not worth it.
- **A title deleted outside this app lingers up to 60 s.** A delete through
  `DELETE /download/media/:id/files` invalidates the resolver's library cache,
  so its card goes at once. One removed in Radarr/Sonarr's own UI drops out
  when the cache next refreshes.
- **A down source empties its half of the gallery silently.** See the
  pipeline above. The response has no field to say so.
- **The requester filter is still email-only**, as before (plan 017 §E2's
  scope cut, see `listGallery`'s doc comment).
- **`getDownloadedMovies`/`getDownloadedSeries` are unused now.** Only their
  comments were fixed. Phase 5 · A1 removes them.

### Verified live (2026-09-24)

The dev container restarted at 10:59 PDT. `nest start -w` last reloaded at
11:01:34 after the Phase 4 edits, and the boot log reads
`Re-adopted 0 open job(s)` with no `Library sync:` line. Read-only checks:

| Check                                                         | Result                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `__drizzle_migrations`                                        | 5 rows; the last hash matches `0004_eminent_prodigy.sql`                              |
| `jobs` with `origin='service'` and `type IN ('movie','show')` | 0 (357 before)                                                                        |
| `removed_from_library` in `pragma_table_info('jobs')`         | absent                                                                                |
| `GET /download/gallery?limit=3`                               | `total: 358`; newest first by `addedAt`; `downloadCount: 0`, `lastDownloadedAt: null` |
| `GET /download/gallery/facets`                                | `types`: 284 movie, 74 show; `uploaders`: `[]`                                        |
| `GET /download/gallery?cursor=abc`                            | 400                                                                                   |

## Cancelling a movie or show attempt (plan 022)

**Status: done.** Commits, in order: `428f2824` (audit actions and
`DownloadClient` methods), `45280738` (`CANCEL_GRACE_MS` and
`settleWithoutQueueItem`'s `cancelling` branch), `3ed6c3b8` (unmonitor only
what has no file), `b39cc720` (server actions), `996ee928` (mockups),
`0cce024a` (the poller carries a `cancelling` job), `5aa85f3a`
(`cancelMovieJob`/`cancelShowJob` and the `request()` guard), `1ab4f34f`
(routes), `8edf4579` (the pages wire Cancel and Retry).

Until now only a video attempt could be cancelled. A movie or show attempt
ran to the end in Radarr/Sonarr, and the only way to stop it was their own UI.

### The routes

| Route                               | Service                                   | Audit action   |
| ----------------------------------- | ----------------------------------------- | -------------- |
| `PATCH /download/movies/:id/cancel` | `MediaDownloadService.cancelMovieJob(id)` | `movie.cancel` |
| `PATCH /download/shows/:id/cancel`  | `MediaDownloadService.cancelShowJob(id)`  | `show.cancel`  |

- **`:id` is a job id**, like `DELETE /download/movies/:id`. The frontend's
  `JobAction` is `(jobId) => …`, and each attempt card calls it with its own
  id. A media-keyed route would have to guess which of a show's several
  in-flight attempts was meant.
- **Through `mediaJobRoute`**, so every error is a 404 `Job not found`. A
  finished job is a 404 too, as `PATCH /download/videos/:id/cancel` answers.
- **Audited** as `movie.cancel`/`show.cancel` (`CANCEL`, tone `warn`), with
  the caller as actor and the job as target. There is no Discord
  attribution: unlike the video cancel, these routes read no Discord headers.
- **Clients**: `DownloadClient.cancelMovieJob`/`cancelShowJob` in
  `@lilnas/utils`, and the server actions `cancelMovieJob`/`cancelShowJob` in
  `src/app/actions/media-job.ts`, which log and swallow a failure like
  `video-job.ts` does.

### What `cancelJob` does upstream

Private `cancelJob(id, type)` does the upstream work first and writes the
status last:

1. **A finished job throws** (the route's 404). **A job already
   `cancelling` is returned as is**, with no upstream calls: the first press
   did the work.
2. **`cancelUpstream`** reads the queue fresh with `getQueue([id])`, not
   `MediaStateService`'s copy, which is up to a tick old. That tick is
   exactly when a just-grabbed release lives.
   - It keeps this title's items. A show job keeps only those that pass
     `matchesScope(item, job.scope)`, so an episode job never touches a
     sibling episode's download.
   - Each item goes through `removeQueueItem` under `Promise.allSettled`,
     with the Discard flags: `removeFromClient: true`, `blocklist: false`,
     `skipRedownload: true`.
   - It unmonitors only what has no file: `RadarrService.unmonitorIfMissing`,
     or `SonarrService.unmonitorScope(…, { withoutFileOnly: true })`.
3. **The resolver is invalidated**, because its library cache holds the
   pre-cancel `monitored` flag.
4. **The job is re-read and written `cancelling`**, with `error` cleared. A
   job cancelled out of `needs_attention` would otherwise keep upstream's
   import error.

Why each rule:

- **Unmonitor, but only what has no file.** To Radarr/Sonarr a monitored
  title with no file is missing, and the next RSS sync would grab it again. A
  title with a file stays monitored, so cancelling a replacement doesn't
  stop Radarr looking after the copy already on disk.
- **Season and series flags are untouched.** They decide what happens to
  future episodes, not to this attempt.
- **A library file is never deleted.** Cancel stops a download. Deleting
  files is `DELETE /download/media/:id/files`.
- **A thrown upstream call leaves the job as it was.** `getQueue` or the
  unmonitor failing propagates, so the user can press again.
- **A failed removal does not throw.** It is logged, the job still goes
  `cancelling`, and the poller removes what is left on its next tick.
- **No upstream id means nothing to undo.** A first request that `submit()`
  hasn't added to Radarr/Sonarr yet skips the upstream half; `request()`
  does it after `submit()` (below).

### Why `cancelling`, not `cancelled`

A search can outlive the cancel. An API-sent `MoviesSearch`/`SeriesSearch`
runs as a user-invoked search, which ignores `monitored`, so a search already
running at the press can grab after the unmonitor. The job therefore waits in
`cancelling` and the poller makes the last move.

### How the poller settles it

> ⚠️ **Partly superseded by plan 024**: the remembered download ids are now
> persisted `job_downloads` links, so they survive a restart, and "history
> says removed or failed" means every link carries a `failedAt`. A season pack
> that also covers other episodes is kept rather than removed — see
> [Cancelling out of a season pack](#cancelling-out-of-a-season-pack).

| This tick                                         | Result                                        |
| ------------------------------------------------- | --------------------------------------------- |
| A queue item in the job's scope                   | removed by `removeLateGrab`; status unchanged |
| No item, a file landed                            | `completed`: the cancel came too late         |
| No item, history `removed`/`failed`, absent ≥ 5 s | `cancelled`                                   |
| No item, absent ≥ `CANCEL_GRACE_MS` (30 s)        | `cancelled`                                   |
| No item, otherwise                                | unchanged                                     |

- **A late grab is removed, not followed.** Private `removeLateGrab` removes
  the items (every row for a movie; for a show, only in-scope matches) and
  never calls `applyUpdate`, which used to move the job back to
  `downloading`. It never throws: an item with no id is logged and skipped,
  and a refused removal is retried next tick.
- **`absentSince` is left alone** while a late grab is removed, so the grace
  doesn't restart with each one. It is timed from the first tick the job had
  no item.
- **The history path is the fast path.** Commit `433035cc` (before plan 022)
  settles a job whose remembered download ids read `removed` or `failed` in
  Radarr/Sonarr history, once it has been absent `QUEUE_REMOVAL_CONFIRM_MS`
  (5 s). A cancelled job that had grabbed something takes that path: its
  item was seen, so its id is remembered, and a removal writes no history,
  which reads as `removed`.
- **The 30 s grace only applies to a cancel pressed before anything was
  grabbed**, since there are no ids to look up. After a restart the ids are
  gone too (they live in memory), so such a job settles on the grace or on a
  landed file.
- **Why 30 s.** Indexer requests time out at about 30 s, so a search that
  hasn't grabbed by then is very unlikely to. The 60 s absence grace would
  double the wait. Much below 20 s it would be two poll ticks, the same as
  the 5 s confirm, and no grace at all.
- **No "Removed from Radarr's queue".** `settledError(…, previous)` gives a
  job leaving `cancelling` no reason short of a failure. That sentence is for
  a removal someone made in Radarr/Sonarr; this one was the user's own press.
- **Leaving `cancelling` clears `error` explicitly** in `writeStatus`.
  `updateJob` spreads the patch and never touches `error` by itself, so a
  stale reason would otherwise stay on the record and the row.
- **`scripts/verify/mutate.ts` `MEDIA_TRANSITIONS`**: `cancelling` →
  `cancelled`/`completed`.

### The `request()` guard

`updateJob` has no compare-and-set, and a cancel can land while `request()`'s
`submit()` is out upstream. Writing `searching` blind would un-cancel the
job. After `await submit()`, `request()` re-reads the job with no `await`
before its write:

| Job after `submit()` | `request()` does                                                     |
| -------------------- | -------------------------------------------------------------------- |
| `requested`          | writes `searching` (and the resolved scope), as before               |
| `cancelling`         | writes only the resolved scope, then runs the upstream cleanup again |
| anything else        | leaves it alone: the poller got there first                          |

- **The re-run cleanup is needed.** The title now certainly has an upstream
  id, and the search `submit()` just dispatched may grab. It is logged, not
  thrown: the cancel did take, and the job is already `cancelling`.
- **The catch path never writes `failed` over `cancelling`.** It logs a
  warning and runs the same cleanup.

The same race has a second shape. A cancel on a `requested` job that already
has an upstream id runs its upstream half first, and `submit()` can finish in
the meantime and write `searching`. So `cancelJob` re-reads before its write:

- **Terminal** (the poller settled it) or **already `cancelling`** (a
  concurrent press): returned, not overwritten.
- **Anything else**: written `cancelling` anyway. If the job was `requested`
  at the press and isn't any more, the upstream half runs once more, quietly.
  `submit()`'s `ensure*` may have re-monitored what was just unmonitored, and
  its search came after the queue read.

### `needs_attention` and `paused`

Both cancel the same way, since `cancelJob` refuses only terminal jobs.
Removing the queue row is exactly what the import dialog's **Discard** does
(plan 020). Discard stays, and still moves the job straight to `cancelled`.

### ⚠️ Accepted gaps

- **A whole-series or season cancel removes every item in its scope**,
  including one a narrower concurrent job (one episode, say) was waiting on.
  That job then settles `cancelled` with "Removed from Sonarr's queue" through
  the history path.
- **A `cancelling` job whose queue item can't be removed stays `cancelling`**,
  retrying the removal every tick.

### Video, movie and show

| Control                        | Video                                                  | Movie                                                                                                | Show                                                                                             |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cancel on an in-flight attempt | ✅                                                     | ✅                                                                                                   | ✅, and on an episode-scoped one's row                                                           |
| `cancelling…`, inert           | ✅                                                     | ✅                                                                                                   | ✅                                                                                               |
| Pause / Resume                 | ✅                                                     | —                                                                                                    | —                                                                                                |
| Asking again after a cancel    | the page's Download; no Retry row (plan 021 · Phase 3) | Retry on the newest attempt if it failed or was cancelled (`retryMovieJob`), and the header Download | Retry re-requests that attempt's own scope (`retryShowJob`); season, episode and header Download |

Retry shows only while the title is `absent` or `wanted`; a show's season
lists go by the season's state instead. It is a fresh request, so it adds a
new attempt row and the cancelled one keeps its outcome.

## Downloads started in Radarr/Sonarr are adopted (plan 022)

**Status: done.** Commits, in order: `7ee8b964` (`adoption.util.ts`),
`122a896f` (the `upstream` origin and migration 0005), `f58c6b31` (the poller
adopts), `7bfac749` (the UI credits Radarr/Sonarr).

A grab made in Radarr's or Sonarr's own UI, by their RSS sync, or by a search
this app didn't send had no job. Its title's page drew a progress bar off the
queue snapshot with nothing under it to cancel. The poller now mints a job for
each such download, and from then on it is an ordinary attempt.

### How a download is adopted

> ⚠️ **Partly superseded by plan 024**: `rememberDownloads` is gone. An
> adopted download is linked in `job_downloads`, ownership reads those
> persisted links, and a download linked to a job that ended within the last
> hour reopens that job instead — see
> [Adoption and reopen](#adoption-and-reopen).

The poller runs private `adoptUnownedDownloads(type, queue)` at the end of each
source's tick, after the tracked jobs are settled. The rules live in
`src/media/adoption.util.ts` (`planAdoptions`, `isAdoptable`, both pure).

1. **Group.** Queue items are grouped per title by `downloadId`, so a season
   pack Sonarr queues as one item per episode is one candidate. An item with
   no `downloadId` is its own group. An item with no `movieId`/`seriesId` is
   ignored.
2. **Drop owned groups.** See below.
3. **Drop terminal groups.** A group whose aggregate status is terminal (a
   `failed` item lingering in the queue) is skipped. Otherwise it would mint
   a job that settles `failed` and gets adopted again next tick, forever.
4. **Map to media ids** with `mediaIdsFor`, the helper the media diff uses. A
   title the library can't map yet is skipped and asked about next tick.
5. **Drop upgrades.** See below.
6. **Mint the job** with `DownloadStateService.addJob`: `startedUpstream:
true`, no requester, and the status the queue derives (never `requested`
   or `searching`, since it's already grabbed). Its download ids go into
   `rememberDownloads`, so its history can settle it later. It gets a log line
   `Adopted a download started upstream` and no audit row: nobody here asked
   for it.

**Ownership.** A group is owned, and skipped, when any non-terminal job of
the same type and title covers it. For a movie that's any such job; for a
show, one whose scope passes `matchesScope` for every item in the group.

- **`cancelling` counts**, so a late grab `removeLateGrab` is removing is
  never adopted.
- **Download ids remembered for an existing job count too**, via
  `claimedDownloadIds()`.
- **The check reads `downloadStateService.jobs`**, not `trackedJobs()`.
  `trackedJobs()` drops a job whose title didn't resolve this tick, and
  reading it would adopt a duplicate.
- **A cheap pre-pass runs first.** `planAdoptions` with no open jobs and only
  the claimed ids is pure and in memory. While every queued download is one a
  tracked job just remembered, it returns nothing and the tick makes no reads.
- **The check runs again right before `addJob`**, synchronously, with no
  `await` in between. The 1 s cron has no overlap guard and `addJob` has no
  compare-and-set, so a job minted meanwhile by an overlapping tick or a
  request wins.

**Scope.** The narrowest scope that covers the group:

| Group                                                  | Job scope                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Movie                                                  | none                                                                             |
| One episode                                            | `{ episodeId, seasonNumber, episodeNumber }`, `episodeNumber` from `getEpisodes` |
| Several episodes, one season                           | `{ seasonNumber }`                                                               |
| Episodes across seasons, or no item with an episode id | none (whole series)                                                              |

One job per download means a season pack is one season-scoped attempt, not
one per episode.

**Never failing the poll.** Every read in here (the resolve, the library, the
episodes) is caught and logged, and the download waits a tick. None of them
trips `poll()`'s backoff.

**Restart needs nothing new.** `addJob` persists the row, so the boot's
`adoptOpenJobs` re-adopts it like any open movie/show job. The ownership
check sees it, so its download isn't adopted a second time.

### What is not adopted, and why

- **Upgrades.** A movie whose resolved media has a `filePath` or an
  `embyStatus`, or a show group where every episode already has a file.
  Radarr/Sonarr grab cutoff-unmet upgrades on their own, and adopting them
  would put an attempt nobody asked for on title after title. A show group
  with any item Sonarr couldn't tie to an episode is adopted, since nothing
  proves it's an upgrade. A degraded movie resolve adopts nothing that tick.
  An upgrade keeps its bar, with the note "Radarr is upgrading the file
  already on disk — it can't be cancelled here." (Sonarr: "Sonarr is
  upgrading an episode already on disk — it can't be cancelled here."). The
  same note can show for the one tick before a fresh grab is adopted.
- **Terminal items**, as above.
- **Titles the library can't map yet.** Tried again next tick.

### The `upstream` origin

An adopted job has no requester and no Discord requester, like a tdr-bot job
(`service`). It needed its own value to tell the two apart.

- **`DownloadJobSchema.startedUpstream`** is optional: `true` on an adopted
  job, absent on every other. Existing fixtures, stored rows and
  `apps/tdr-bot`'s parse stay valid.
- **`JOB_ROW_ORIGINS = [...JOB_ORIGINS, 'upstream']`**, in `db/schema.ts`, is
  `jobs.origin`'s tuple alone. `JOB_ORIGINS` stays three-valued because
  `audit_log.origin` shares it and `AuditLogEntrySchema.origin` mirrors it.
  An audit actor is never Radarr.
- **`jobs_origin_matches_requester`** gains an `upstream` arm with the same
  all-NULL shape as `service`.
- **`buildJobRow`** writes `upstream` for `startedUpstream`, checked after
  the requester and Discord fields, so a person's attribution always wins.
  **`hydrateJobRow`** reads it back as `startedUpstream: true`.

### Migration 0005

`0005_remarkable_wallflower.sql`. SQLite can't `ALTER` a CHECK, so this is
drizzle-kit's generated `__new_jobs` rebuild, unedited: create, copy all 15
columns, drop, rename, then recreate all six `jobs_*` indexes. It is the second
`jobs` rebuild after 0002.

- **Tested on a copy of the prod DB**: rows byte-identical, indexes
  recreated, integrity check ok.
- **Prod was still on migration 0000** when it was written (73 jobs, no
  Discord columns). Its next deploy runs 0001 through 0005 in one boot.
  `migrate-0005.spec.ts` covers both starting shapes: prod at 0000 and dev at 0004.

### UI

`jobUpstreamSource(job)` (`components/activity/activity-requester.tsx`)
returns `Radarr` for an adopted movie and `Sonarr` for an adopted show, and
`undefined` for everything else, videos included. It's the only thing that
tells an adopted job from a masked one, since both arrive with every identity
field `null`. Before, every requester surface read that pair of nulls as
`hidden`.

The label is plain text (`Radarr · 12m ago` on the detail header), with no
avatar and no profile link. It appears on the detail header, in the attempt
history and on activity rows. A requester or Discord requester always wins
over it.

The gallery and home "recent" cards read the grouped gallery row, not a job,
so `GalleryItem` carries `lastStartedUpstream` (`d4218497`): set in
`JobQueryService.resolveLastRequesters` from the latest job's
`origin = 'upstream'`, outside the `showRequester` mask because it names
nobody, and turned into the label by `galleryUpstreamSource(item)`. `/admin`
history, where a `null` requester means the service, passes
`jobUpstreamSource(job)` as `AdminActor`'s `serviceLabel`, so the chip reads
`Radarr`/`Sonarr` instead of `service` (`3c9c1a4b`).

### ⚠️ Known gaps

- **A season pack adopted as one season-scoped job** unmonitors every
  file-less episode of that season on cancel, including episodes the pack
  didn't contain.
- **A late grab after a cancel's grace window** is adopted as a new
  attempt credited to Radarr/Sonarr.

---

## Video download progress (plan 015)

**Status: done, not yet verified live.** Full plan in
`docs/features/download/plans/015-video-download-progress.md`. Commits, in
order: `0ec93d8f` (`VideoProgressSchema` and `DownloadJob.progress`),
`4f2c38a2` (`formatBytes` moves to `lib/format`, plus `formatSpeed` and
`formatEta`), `9bcc6ba6` (the in-memory snapshot and its throttle),
`6f1eeceb` (the parser), `a95b4bd9` (`jobProgress`'s video arm,
`jobTransferLine`, the `'processing'` handoff), `f7d590b4` (the activity
feed), `4c36c780` (the attempt card), `035d62c9` (the capture).

A video download — a yt-dlp job, the only download this app runs itself —
now shows live progress on the page, the same way a movie or show's
Radarr/Sonarr queue progress already did. Before this, yt-dlp's stdout went
straight into `download.log` and was never read. **No route, gateway,
frame-parser, client-store or tdr-bot change**: the snapshot rides on
`DownloadJob.progress` inside the existing `download-job` frame.

### What yt-dlp is asked

`YTDLP_PROGRESS_ARGS` (`apps/download/src/download/ytdlp-progress.ts`),
placed before the URL on the download spawn:

```bash
--newline --progress-delta 1 --progress-template 'download:LILNAS_PROGRESS %(progress)j'
```

yt-dlp then prints one JSON line per tick: each file's first line, at most
one transfer line a second, and a `finished` line. The `--dump-json` probe
and ffmpeg's convert step are untouched.

### Capture

`download-video.service.ts` **tees** stdout rather than redirecting it: it
is still piped into `download.log` unchanged, and is also read line by line.
`createLineSplitter` carries partial lines across chunks.
`createProgressReducer`, fresh per run so a resume starts clean:

- parses each `LILNAS_PROGRESS {json}` line (`parseYtdlpProgressLine`);
- reads the file count from yt-dlp's
  `[info] <id>: Downloading 1 format(s): 160+139` line
  (`parseYtdlpFormatCountLine`);
- increments `fileIndex` when `filename` changes;
- computes `percent = round2(clamp(downloadedBytes / totalBytes × 100))`
  itself. ⚠️ yt-dlp's own `_percent` reads 100% at fragment 0 of an HLS
  stream.
- takes `totalBytes` from `total_bytes`, falling back to
  `total_bytes_estimate` with `totalIsEstimate: true`. With no total there
  is no `percent`, so no bar, but the bytes-and-speed line still shows.
- leaves a null `speed`/`eta` **absent**, never `0`.

**The line handler never throws.** A throw is logged once per run and
swallowed — the lesson of the `c7eebc62` spawn-error wedge.

### The snapshot

`VideoProgressSchema` in `packages/utils/src/download/schema.ts`:

```ts
{ downloadedBytes, etaSeconds?, fileCount?, fileIndex, fragmentCount?,
  fragmentIndex?, percent?, speedBps?, totalBytes?, totalIsEstimate? }
```

- **Per job and per file.** A default YouTube grab is two files, video then
  audio, each running 0 → 100%, with a `file 1 of 2` counter rather than a
  blended figure.
- `DownloadJobRecord` is `Omit<DownloadJob, 'media' | 'progress'>` — the
  row never carries it.

### Lifetime

**In memory only**: `DownloadStateService`'s `progress` Map, beside `procs`.
Never SQLite, and no migration — `reconcileInterruptedJobs()` fails every
non-terminal video row at boot anyway, so a stored snapshot could only
describe a dead download.

- **`toJob()` attaches it**, so `GET /download/videos/:id`,
  `GET /download/media/:id`'s `jobs[]` and the activity/history pages all
  carry it, and a server-rendered page mid-download has it before the first
  socket frame.
- **Terminal transitions clear it** (`Completed`/`Failed`/`Cancelled`).
- **`Pausing`/`Paused`/`Pending` (resume)/`Converting` keep it.**
- **A resumed run's first tick replaces it.**

### The throttle

`setProgress` re-broadcasts through `touchJob()` — the Radarr poller's
no-write re-broadcast path — at most once per
`PROGRESS_BROADCAST_INTERVAL_MS` (1 s) per job, **trailing-edge**: a tick
inside the window arms one `.unref()`'d timer that sends the latest
snapshot.

- **Two kinds of tick flush immediately:** the first tick of a new file,
  and a `finished` tick when no further file is expected.
- `download()` calls `flushProgress` in a `.finally` on the process promise,
  so it flushes on every exit path, before `assertNotInterrupted`.

### What a tick costs

`touchJob` → `broadcastJobEvent` → `hydrate()` (resolver cached 60 s) →
`broadcastPerViewer`. The same cost as a movie queue tick today, once a
second per job; with `MAX_DOWNLOADS=5` the ceiling is 5 ticks a second.

`parseJobEventFrame` validates with `DownloadJobSchema`, so a malformed
`progress` drops the whole frame.

### Frontend

- **`AttemptCard`**, while in flight, shows a counter
  (`file 1 of 2 · fragment 4 of 123`), a percentage and a bar, with
  `412 MB / 640 MB · 3.1 MB/s · ~2m left` underneath (`jobTransferLine()`;
  a `~` before an estimated total).
- **The bar keeps settling** through `Converting`/`Uploading`/`Cleaning` (a
  new `'processing'` handoff in `components/detail/job-state.ts`), as well
  as `finishing` at 100% during yt-dlp's merge.
- **The activity feed's** `jobProgressPct()` reads `job.progress.percent`,
  so its progress column shows the same figure.
- **`MediaStatus`**, the header chip, stays chip-only for a video.

### ⚠️ Accepted gaps

1. **A clip gets no bar.** A `timeRange` download (`--download-sections`)
   uses yt-dlp's ffmpeg downloader, which is not expected to print
   progress, so it keeps the status word with no bar. Still to be confirmed
   live.
2. **A tick sends two frames.** Every video job frame is still followed by a
   `media` frame, which carries no progress: redundant, not wrong.
3. **The header chip stays chip-only.**

### Operational note

`download.log`'s human-readable progress bar is replaced by
`LILNAS_PROGRESS {json}` lines. Each still includes yt-dlp's
`_default_template` string, so it stays readable.

### Not yet verified live

The dev-container restart and a live run on `download.dev.lilnas.io` —
progressive, HLS, clip, pause/resume — are pending human checkpoints. The
polling snippet is in `local-verification.md` under "Watching a video
download".

---

## Radarr/Sonarr as the source of truth (plan 024)

**Status: backend done.** Key commits, in order: `f6cde551` (`mediaMutex`),
`89f3e955` (history normalizing and `claimGrab`), `57bdb050` (browse without
borrowing monitoring), `8ef0b7de` (tier profiles), `97ba035f` (`not_found`
and `statusNote`), `ef740d4e` (requests apply a tier), `0b8f41f7` (migration
0007), `760fcf37` (flagged-release profile), `ea73b63d` (history settles
jobs), `81708a50` (searches end `not_found`), `05038a93` (reopen), `8835c324`
(credit own imports), `3d030f7e` (pack cancel), `a3c51bbd` (Sonarr v5),
`10cc0f64` (requests start searches through command tracking).

The poller used to decide outcomes from what was missing from `/queue`. That
queue is rebuilt in memory and drops items whenever SABnzbd is briefly
unreachable, after any Radarr/Sonarr restart, and once SABnzbd's history
rolls past its last 60 items — so live downloads were mass-cancelled. The
job → download link lived in memory and died with every restart.

**History decides outcomes; the queue reports progress.**

### History ingestion

`MediaPollerService.syncHistory` → `ingestHistory`, per app, at the start of
each tick (before commands and the queue):

- **Every `HISTORY_POLL_MS` (5 s)**, one unpaged `GET /history/since`
  (Sonarr with `includeEpisode: true`, for the season/episode numbers),
  oldest first.
- **Inclusive, then re-sorted.** The read starts _at_ the cursor's date.
  `normalizeHistory` re-sorts by `(date, id)`: the wire sorts by date alone,
  at second precision, and ids are not monotonic inside a second.
- **The cursor** is `arr_history_cursors` (`app`, `cursor_date`,
  `cursor_ids`): the newest date applied, plus every record id already
  applied _at_ that date. Up to 52 records have been seen in one second, so a
  single-id cursor would skip or replay. A re-fetched tie is skipped by id;
  `setCursor` replaces the ids on a later date, unions them on an equal one,
  and never moves backwards.
- **First boot** (no cursor) reads `HISTORY_FIRST_READ_MS` (1 day) back, and
  stores a cursor even when it found nothing. **Later boots** resume from the
  cursor, but never more than `HISTORY_MAX_CATCH_UP_MS` (7 days) back.
- **An event that fails to apply stops the batch.** The cursor covers only
  what went before it, and the next interval retries from it. Every write is
  idempotent on replay.
- **Boot backfill** (`backfillLinks`, once per boot): a grabbed job with no
  links yet — from before 0007, or whose grab was never read — is linked from
  its title's own history by the same `claimGrab` rules.
- ⚠️ **Never log a history record or its `data`.** A grab's
  `data.downloadUrl` carries the indexer's API key. Only `message`, `source`,
  `releaseSource` and (for completion) `fileId` are ever read out of `data`.

| Event (`eventType`)                         | Effect                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `grabbed`                                   | linked to the job `claimGrab` picks; a new grab clears a retry note                 |
| `downloadFolderImported`                    | `markImported` on every job linked to the download                                  |
| `downloadFailed`                            | `markFailed`; the job goes back to `searching` with a note, or `failed` (see Retry) |
| `downloadFailed`, marked failed by a person | `cancelled`, `Removed and blocklisted in <App>`                                     |
| `downloadIgnored`                           | `cancelled`, `Ignored in <App>`                                                     |

- **A person's failure** is `data.message` `Manually marked as failed`
  (v4), or a Sonarr v5 `data.source` that isn't the failed-download handler.
- **A failure or removal leaves a job alone** while another of its links is
  still in flight, and a `cancelling` job only has its link marked.
- **The numeric `eventType` form is accepted too.** `ignored` is 9 in Radarr
  and 7 in Sonarr.

### `job_downloads`

Migration 0007 (`0007_greedy_thunderbolts.sql`) is purely additive: two new
tables, and four nullable `jobs` columns.

| Column                                   | Holds                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `job_id` + `download_id` (PK)            | one row per download per job; `ON DELETE CASCADE` from `jobs`            |
| `app`                                    | `radarr` / `sonarr` (CHECK); indexed with `download_id`                  |
| `grabbed_at`, `imported_at`, `failed_at` | the history events' own `date` strings, verbatim                         |
| `fail_reason`                            | the failure's `data.message`                                             |
| `interactive`                            | the grab's `releaseSource === 'InteractiveSearch'`; NULL = not known yet |

- **A season pack is one `downloadId`.** Sonarr writes one `grabbed` record
  per episode, all sharing it, so the pack links once.
- **Two jobs can share a download** (a season job and an episode job covered
  by one pack), hence the composite key.
- **A queue match links too.** A title-matched queue item is linked to its
  job right away (`grabbed_at` NULL until the event is read), so its outcome
  is known even if the grab event never is.
- **Which queue items are a job's** (`matchJobItems`): every item carrying a
  download it is linked to, plus its title's (and scope's) items that no
  other in-flight job is linked to. An item whose download already failed for
  the job is never read again.

**`claimGrab`** (`history-events.util.ts`) picks the job a grab belongs to.
A candidate is:

- open, of the event's type and title (`movieId` / `seriesId`);
- scoped to cover the event — a season job can't claim an event that
  doesn't carry its season;
- in `requested`, `searching`, `downloading`, `importing` or `cancelling`;
- created no later than `CLAIM_CREATED_AT_SLACK_MS` (5 s) after the grab.

Candidates rank by: a job whose upstream command predates the grab (at the
grab's whole-second precision), then the narrowest scope (episode < season <
series), then the oldest. No candidate means someone else grabbed it — that
is adoption's business.

### Commands, and when a search ends `not_found`

A job records the Radarr/Sonarr command it waits on in `upstream_command_id`,
`upstream_command_kind` (`refresh` | `search`) and `upstream_command_at`
(ISO). All three are internal: `DownloadJobRecord` only, never the wire.

| Request for a title …  | `request()` does                                                             | The job waits on                                                     |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| already in the library | `startSearch` at once                                                        | the `search` command, or nothing if the app grabbed itself           |
| added by this request  | re-sends the add-time refresh (`isNew`, deduped onto the add's own), returns | the `refresh`, noted `Waiting for Radarr to finish adding the movie` |

The Sonarr note reads `Waiting for Sonarr to finish adding the show`.

`trackCommands` reads each job's command at most every `COMMAND_POLL_MS`
(2 s), after the history sync, so a grab is linked before its search is
judged:

| The command                                                            | The job                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| a `refresh` still queued/running `REFRESH_WAIT_TIMEOUT_MS` (10 min) on | `failed`, `Radarr never finished adding the movie` (`Sonarr … the show`)                |
| ended `failed` / `aborted` / `cancelled` / `orphaned`                  | `failed`, with the command's message                                                    |
| a `refresh` that completed                                             | `startSearch` runs; the note clears; the job now waits on the `search` (or ends, below) |
| a `search` that completed, with a link grabbed since it started        | stops waiting; `upstream_command_at` is kept, since `claimGrab` still ranks by it       |
| a `search` that completed, nothing grabbed                             | `not_found`                                                                             |
| gone (404 — upstream restarted)                                        | judged as completed                                                                     |

- **`startSearch` runs only after the refresh.** Sonarr creates a new show's
  episodes during it, and saves back a snapshot taken before it fetched, so a
  monitor flag written meanwhile is undone. `startSearch` resolves the scope
  (an episode asked for by number gets its `episodeId`, or the job fails
  `S02E05 isn't in Sonarr`), monitors it (`monitorScope`, under
  `mediaMutex`), then searches or picks (see
  [Auto-select enforcement](#auto-select-enforcement)). One that throws is
  retried until the refresh timeout, then fails
  `Couldn't start the search in <App>: …`.
- **`not_found` waits for history.** It is concluded only once a history
  read that started at least 2 s after the command ended has applied
  completely: a search can end between two reads, before the one that would
  show its grab.
- **Never read the command's message.** "N reports downloaded" is dropped
  about five minutes after the command ends; the links are the answer.
- **`not_found` never carries `error`**: the mockups draw it with a warn chip
  and a grey note. It is terminal, and Retry is offered like any other
  unsuccessful attempt.

| `statusNote`                                                       | When                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| _(none)_                                                           | a plain `not_found` — its chip already reads "no release found"    |
| `No usable release — every result is flagged or rejected`          | `not_found`: a title with flags, and nothing eligible              |
| `<App>'s retry found no other release`                             | `not_found` after a failed download's retry (below)                |
| `Waiting for <App> to finish adding the movie` / `… the show`      | `searching`, a fresh add's refresh still running                   |
| `Delayed by <App> until HH:MM` / `Delayed by <App>`                | `searching`, held by a delay profile or an unreachable client      |
| `Last download failed: <reason>. <App> is trying another release.` | `searching`, after a failure upstream retries                      |
| `The download came back in <App>`                                  | a reopened job, for as long as the status the reopen gave it holds |
| `KEPT_PACK_NOTE`                                                   | `cancelled` out of a season pack that keeps running                |

### Retry after a failed download

On a `downloadFailed` event, `retriesAfterFailure` asks whether
Radarr/Sonarr will look for another release on their own:

- **`autoRedownloadFailed`** in the app's download-client config (re-read
  every 10 minutes; a missing flag reads as on, their own default).
- **For a release picked by hand, also
  `autoRedownloadFailedFromInteractiveSearch`.** "By hand" is the grab's
  `releaseSource === 'InteractiveSearch'`, off the link's `interactive`, or
  else the download's own history; unknown reads as automatic.

| Upstream retries? | The job                                                                               |
| ----------------- | ------------------------------------------------------------------------------------- |
| yes               | `searching`, noted `Last download failed: <reason>. <App> is trying another release.` |
| no                | `failed`, with the client's message (or `Download failed in <App>`)                   |

- **The retry search is followed.** `findRetrySearches` reads the command
  list every tick while a job is looking (it only holds commands ~5 minutes
  after they end), for a `trigger: 'unspecified'` `MoviesSearch` (Radarr) or
  `EpisodeSearch`/`SeasonSearch` (Sonarr) on the job's title and scope,
  queued no earlier than 2 s before the failure. The job then waits on it as
  a `search`.
- **A grab clears the note.** A retry that grabs nothing, or none seen within
  `RETRY_SEARCH_TIMEOUT_MS` (30 min) of the failure, ends the job
  `not_found`, noted `<App>'s retry found no other release`.

### The absence rule and the health gate

A job with no queue item settles by `settleAbsentJob` — the table is in
[Settling from files](#settling-from-files). What keeps a flaky queue from
cancelling live downloads:

- **Absence never settles a job with nothing grabbed** (no links).
- **A removal takes `ABSENT_REMOVED_MS` (10 min)** of absence with a link
  still open, and ends `cancelled`, `Removed from the download client`
  (`REMOVED_FROM_CLIENT_ERROR`) — or `completed` if another link imported.
  A removal made in Radarr/Sonarr writes no history, so absence is the only
  signal for it.
- **The clock only runs while the download client is healthy.**
  `checkClientHealth` reads each app's `/health` every `HEALTH_POLL_MS`
  (30 s): a `DownloadClientCheck` or `DownloadClientStatusCheck` warning or
  error is unhealthy, and so is a check that fails. `settleAbsentJobs` passes
  `min(absent, healthy)`, so **nothing settles while SABnzbd is
  unreachable**, and an outage mid-absence restarts the clock.
- **`absentSince` is in memory.** A restart restarts every absence, which can
  only delay a settle.
- **A `cancelling` job is exempt from the gate**: its absence counts from
  its first item-less tick, and it settles within `CANCEL_GRACE_MS`.

### Completion credits the job's own downloads

`didJobComplete` (`job-completion.util.ts`) now takes the job's `links` and
the title's imports (`completionImports`: its `downloadFolderImported`
records, reading only `data.fileId` from `data`).

| Job                                 | Completes when                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| movie, season or series, with links | a new file **one of its own downloads imported**                                |
| movie, season or series, no links   | any file newer than the job — the old date rule (pre-0007 jobs, manual imports) |
| episode                             | that episode's file is newer than the job                                       |

- **Why:** an RSS grab of another episode, or an upgrade of another season,
  used to complete a job that was still stuck.
- **An import is tied to a file** by its `fileId`, else by its episode's
  current file, else — a Radarr record naming neither — any file, if the
  import came after the job.
- **The import history is read only when it can matter**: a linked job whose
  title has a file newer than it (`hasFileAddedAfter`).
- **An episode can complete while still queued** (`completeQueuedEpisodes`):
  its row says `episodeHasFile` and the file is newer than the job — a pack
  held up on another episode, or the row Sonarr keeps after a partial manual
  import. A season or series waits for the queue.

### Adoption and reopen

- **Ownership reads persisted links.** `planAdoptions` skips a download
  linked to an open job in `job_downloads`, so a restart forgets none. An
  adopted download is linked to its new job at once.
- **A download that comes back goes home.** `reopenEndedJob` /
  `pickReopenableJob` (`adoption.util.ts`): a queued download whose link
  (neither failed nor imported) belongs to a job that ended `cancelled` or
  `failed` within `REOPEN_WINDOW_MS` (1 h, by its `updatedAt`) reopens the
  newest such job. It takes the status the queue derives, its `error` and
  command clear, it is noted `The download came back in <App>`, and it keeps
  its requester — rather than a second, `upstream` job beside it.
- **Never reopened:** a `completed` job, a job past the window, or a pack a
  cancel kept running (`keptDownloadIds`), which is neither adopted nor
  reopens anything.

### Cancelling out of a season pack

Sonarr's queue has one row per episode, and a season pack is N rows sharing
one `downloadId`. Deleting any one row drops the whole download from the
client, so a single-episode cancel used to kill the pack.

`planQueueCancel` (`queue-cancel.util.ts`) plans a cancel per download:

- **A download with rows outside the job's scope is kept.** The job's
  fileless episodes are unmonitored, and it settles `cancelled` with no
  `error`, noted `KEPT_PACK_NOTE`:
  `Part of a season download that is still running — this episode may still import`.
- **Any other download is removed with one DELETE**, named by one of its
  rows — never one per row, which would only 404 after the first.
- **The kept pack stays linked** to the cancelled job, which is what keeps
  adoption and reopen off it. The poller's late-grab path follows the same
  plan.

### Quality tiers and the boot profile sync

Every movie/show request carries a `qualityTier` (optional on
`POST /download/movies` and `/shows`):

| `QualityTier` | Profile (each app)          | Allows                                                  |
| ------------- | --------------------------- | ------------------------------------------------------- |
| `up_to_4k`    | `lilnas · Up to 4K`         | 2160p (Remux, Bluray, WEB, HDTV) and everything in `hd` |
| `hd`          | `lilnas · HD (up to 1080p)` | Remux-1080p down to SDTV                                |
| `up_to_720p`  | `lilnas · Up to 720p`       | Bluray-720p down to SDTV                                |

- **Caps, not exact matches.** A tier allows everything up to its cap, so a
  title with no 1080p release still downloads at 720p. Pre-release rips,
  disc images and raw captures are never allowed
  (`NEVER_ALLOWED_QUALITY_IDS`).
- **No upgrades.** `upgradeAllowed: false`, the cutoff is the best allowed
  item, and custom-format scores are zeroed. Radarr profiles carry English.
- **Built by quality id** from each app's `/qualityprofile/schema`
  (`TIER_QUALITY_IDS`, `quality-tiers.ts`). A schema that renumbers a listed
  quality throws rather than allowing the wrong thing.
- **`ArrProfilesBootstrap`** (`OnApplicationBootstrap`, started and not
  awaited) creates a missing profile and repairs a drifted one in place —
  allowed set, order, cutoff or `upgradeAllowed` — keeping its id, name and
  anything else someone tuned. It matches by exact name, so a profile
  without the `lilnas · ` prefix is never touched. A failure only logs;
  `tierProfileId()` retries on first use. The same bootstrap mirrors the
  flagged releases.
- **The default** is `defaultQualityTier()`: env `DEFAULT_QUALITY_TIER`, or
  the shared `DEFAULT_QUALITY_TIER` (`hd`) when unset. An unknown value falls
  back to `hd`, warned once.
- **Applied before any write.** An add uses the tier's profile; a library
  title on another profile is moved onto it (the whole series, for a show);
  a tier whose profile can't be had fails the job naming it, never falling
  back. A browse or grab add gets the default tier's profile.
- ⚠️ **The dev container talks to prod Radarr/Sonarr** (it joins
  `lilnas_default` and reaches them by service name), so **any dev boot
  writes these profiles, and the flagged-release profile, to prod.**

### Sonarr v5 notes

- **The v3 API is still served.** Everything here calls `/api/v3`, and v3
  queue rows stay one per episode, so the pack rules above hold.
- **A path-like lookup term is a 400.** `/series/lookup` rejects a term
  starting with `/`, `\` or a drive letter (`PATH_LIKE_LOOKUP_TERM`), so
  `SonarrService.search` returns `[]` for one without the round trip, and
  maps any lookup 400 to `[]` (logged, never with the term).
- **Manual failures** are detected by v4's message
  (`Manually marked as failed`) or v5's `data.source` naming something other
  than the failed-download handler.
- **`SeriesSearch` is missing-only** under a profile that disallows upgrades
  — every tier profile. No re-grab uses it: a re-download is a delete and a
  grab by guid (`ReleaseService`), and Sonarr's own retry after a failure is
  a `SeasonSearch`/`EpisodeSearch` (`RETRY_SEARCH_NAMES`).
- **Manual import:** v5 lets `downloadId` win over `seriesId` but then
  ignores `seasonNumber`, so candidates are read by `downloadId` alone.

### The queue refresh (plan 024 · 3·F1)

> **Now the fallback (plan 025).** This timed gate runs only while SABnzbd is
> unset, not read yet, or unhealthy (`MediaStateService.clientHealth()` is
> `'off'` or `'unhealthy'`). While it is `'ok'`, the live numbers come from
> SABnzbd and a refresh is sent once per SAB phase change instead — see
> [Event refresh, and the 3·F1 fallback](#event-refresh-and-the-3f1-fallback).

Each `RefreshMonitoredDownloads` makes Radarr/Sonarr re-read SABnzbd, write
two command rows, and retry every pending import (a folder scan and an
ffprobe per file). So the poll still ticks every second, but the refresh is
sent only for an item a person could see move, and only at a capped rate.

- **Moving** (`isQueueItemMoving`, `queue-status.util.ts`):
  - an import running now (`trackedDownloadState: 'importing'`), however
    long it takes;
  - anything else that reads as Downloading or Importing and whose
    `sizeleft` or tracked state changed within `STALL_MS` (60 s). A newly
    seen item counts as changed.
- **Never moving:** failed at the client, held (`delay`,
  `downloadClientUnavailable`), `importBlocked`, NeedsAttention, Paused.
- **Stall clock:** the poller's per-source `queueProgress` map, keyed by
  row id + download + what it was grabbed for. It is read from the previous
  tick's queue, so it must run before that tick's `setQueue`. An item is
  forgotten once it leaves the queue.
- **Rate:** at most every `QUEUE_REFRESH_MS` (5 s) per source, or every
  `WATCHED_QUEUE_REFRESH_MS` (1 s) while a moving item's title has a detail
  page open (`DownloadGateway.watchedMediaIds()`, mapped through
  `queuedMedia`). 500 ms of slack keeps the cron's jitter from skipping
  every other tick.
- **A tracked job alone sends nothing.** Radarr/Sonarr refresh on their own
  5 s after a grab or an import, and history settles outcomes.

---

## SABnzbd live progress (plan 025)

**Status: built, not yet verified against live SABnzbd.** Full plan in
`docs/features/download/plans/025-sabnzbd-integration.md`. Commits, in order:
`0eaf4e8a` (the snapshot fields), `e32b9b44` (disk-full wording), `2b2cef98`
(mockups), `67395416` (API fixtures), `5101f4ff` (the read-only client),
`e99a6a94` (the reducer), `dba6746b` (the monitor), `3e08a455` (event
refresh), `829fd102` (the snapshot merge), `ca5c36e3` (attempt cards),
`8af6570e` + `6d4c1452` ("Paused in SABnzbd").

Radarr/Sonarr sit between this app and SABnzbd, and drop or distort what
SABnzbd knows:

- **Post-processing is invisible.** While SABnzbd verifies, repairs or
  unpacks, their queue reads "Downloading" at 100 %.
- **Progress was only as fresh as their `/queue`**, so plan 024's 3·F1
  force-refreshed it every ~5 s — and each refresh costs two command rows, a
  SABnzbd read and a retry of every pending import.

**SABnzbd is now the source of live progress; Radarr/Sonarr stay the source
of status and outcome.**

| Fact                                                          | From                              |
| ------------------------------------------------------------- | --------------------------------- |
| Bytes downloaded / total, speed, ETA                          | SABnzbd `queue`                   |
| Post-processing step and its text                             | SABnzbd `history` (live rows)     |
| SABnzbd's own queue pause, free disk                          | SABnzbd `queue`                   |
| Job status (`downloading`, `importing`, `needs_attention`, …) | Radarr/Sonarr `/queue`, as before |
| Outcome (imported, failed, retried)                           | Radarr/Sonarr history (plan 024)  |

### The SABnzbd 5.1.3 API contract

Pinned in `src/sabnzbd/sabnzbd.schema.ts` and the fixtures
(`src/sabnzbd/__tests__/fixtures/sabnzbd.fixtures.ts`), both derived from
SABnzbd 5.1.3's source. The image is pinned to `5.1.3` in `infra/media.yml`.

- **Endpoint.** `GET {SABNZBD_URL}/api?mode=…&output=json&apikey=…`; prod's
  URL is the container's, `http://sabnzbd:8080`. The key is accepted **only**
  as the `apikey` query param — there is no header auth.
- **`queue` and `history` need the full API key.** The NZB key covers
  level-1 modes only.
- **Two error shapes.** An API error is HTTP 200
  `{"status": false, "error": "…"}` (`SabnzbdApiError`). A key or host
  rejection is HTTP 403 plain text whose body may be empty
  (`SabnzbdAuthError`, classified on the status alone).
- **Queue numbers are strings** (`"%.2f"`); the schemas coerce them. `mb` and
  `mbleft` are MiB.
- **`percentage` can go backwards** (par2 held back, then Fetching), so
  progress is derived from `mb`/`mbleft`, never from it.
- **Every runnable slot says `Downloading`.** While the downloader runs,
  every slot not paused on its own reports `Downloading`, so only the first
  in queue order (`index`) is treated as downloading. A Force-priority slot
  downloads through a global pause.
- **`timeleft` is cumulative** — the queue bytes ahead of and including the
  slot, over the global speed — so the queue is always read unfiltered.
  Never filter it by category.
- **`history` answers `{"history": false}`** when nothing changed since the
  `last_history_update` passed in. That is a change counter (starts at 1,
  wraps to 1), not a timestamp.
- **`limit=0` means SABnzbd's `history_limit`, not "all"**, so `getHistory`
  always passes one (≥ 1, or it throws). The limit applies after the
  `nzo_ids` filter.
- **Post-processing rows come first** in `history`, with a live
  `action_line` (`Repairing: 45% - 1:23 left`). Finished jobs are DB rows
  reading `Completed` or `Failed`.
- **A completed job is archived once Radarr/Sonarr import it** (prod runs
  them with Remove Completed on), so it leaves the default view; `archive=1`
  finds it. Prod deletes failed jobs outright, so a failed row is only
  briefly visible.
- **`nzo_id` is Radarr/Sonarr's `downloadId`.** It changes on a SABnzbd
  "Retry".

### Read-only by construction

`SabnzbdService` (`src/sabnzbd/sabnzbd.service.ts`) knows three modes,
`SAB_READ_MODES = ['version', 'queue', 'history']`. `request()` takes the
mode as a plain string, so the allowlist is a **runtime** guard: any other
mode throws before a URL is built. Raw HTTP only — no caching, no retries, a
10 s timeout.

Deletes, retries and blocklists stay with Radarr/Sonarr. Done in SABnzbd
directly:

| SABnzbd write | What goes wrong                                                          |
| ------------- | ------------------------------------------------------------------------ |
| delete        | the item vanishes from Radarr/Sonarr with no blocklist and no re-search  |
| retry         | the job gets a new `nzo_id`, so it no longer matches the `downloadId`    |
| `change_cat`  | the category no longer matches the one Radarr/Sonarr track the job under |

### Configuration and blast radius

| Variable          | Holds                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `SABNZBD_URL`     | `http://sabnzbd:8080` in prod                                         |
| `SABNZBD_API_KEY` | SABnzbd's **full** API key — the NZB key can't read `queue`/`history` |

- **Both optional, both in `apps/download/.env.prod`.** With either unset,
  `SabnzbdService.enabled` is false, the monitor's tick returns at once,
  health stays `'off'`, and the app behaves exactly as before plan 025.
- **Dev leaves them unset.** `lilnas-download-dev` joins `lilnas_default`
  and could reach prod SABnzbd by service name. `.env.example` lists both
  with placeholders; leave them out of a dev `.env`.
- ⚠️ **The full key is SABnzbd admin** — it can change config, add NZBs and
  delete jobs. Mitigations:
  - the mode allowlist above;
  - the key and URL never reach a log or an error: a failed `fetch` is
    rewrapped as `SABnzbd <mode> request failed` **without** `cause`
    (undici's cause carries the URL, and the URL carries the key), and a
    non-2xx body is discarded unread;
  - not set in dev.
- **The stronger option, not taken:** a read-only proxy sidecar in front of
  SABnzbd that forwards only these three modes, so the app never holds the
  key.

### The monitor

`SabnzbdMonitorService` (`src/sabnzbd/sabnzbd-monitor.service.ts`) ticks
every `SAB_POLL_MS` (1 s, `@Interval`). A tick that fires while the last one
is still waiting on SABnzbd is skipped, not stacked, and a tick never
throws. `MediaModule` provides it, and nothing injects it: it pushes into
`MediaStateService`.

**The active set** — the ids worth reading — is every `downloadId` in the
stored Radarr and Sonarr queues, plus every id the monitor still holds a
non-terminal reading for, so a download Radarr/Sonarr dropped is followed to
its end. An empty set sends no request and clears the readings. Only active
ids keep a reading: a manual NZB nobody here tracks never reaches the store
or triggers a refresh.

**Per tick:**

1. `mode=queue`, unfiltered.
2. `mode=history` for the active ids **not** in the queue, skipped when there
   are none. It carries the `last_history_update` cursor only when the id
   list matches the one that cursor came from — a different query must not
   be answered "unchanged".
3. An id about to go `gone` (already missing `SAB_GONE_GRACE_TICKS` ticks)
   gets **one** `archive=1` lookup, to tell a job Radarr/Sonarr already
   imported from one that really vanished. On that tick step 2 goes out
   without the cursor, so the history is a full picture, and the archive
   rows are merged into it.
4. `reduceSabReads` (`src/sabnzbd/sab-readings.util.ts`, pure) → one reading
   per `nzo_id`, plus the phase transitions. Stored with
   `setClientReadings(readings, 'ok')`; transitions queued with
   `pushClientTransitions`.

Every read goes out before anything is committed, so a failed tick leaves the
cursor and the lookups untouched.

**Phases** (`SabPhase`): `queued → downloading → paused → post_processing →
completed | failed | gone`.

| Phase                  | Read from                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `queued`               | a slot waiting its turn — `Queued`, `Grabbing`, `Propagating`, `Checking`, or a later `Downloading` slot |
| `downloading`          | the first `Downloading`/`Fetching` slot in queue order                                                   |
| `paused`               | a slot paused on its own, or any non-Force slot while the whole queue is paused                          |
| `post_processing`      | a history row that isn't `Completed`/`Failed` — `Verifying`, `Repairing`, `Extracting`, `Moving`, …      |
| `completed` / `failed` | a history (or archive) row                                                                               |
| `gone`                 | missing from both views for more than `SAB_GONE_GRACE_TICKS` (2) ticks in a row                          |

- **The grace** covers the download → post-processing handoff, when a job
  can briefly be in neither view.
- **Bytes** come from `mb`/`mbleft`. A history reading keeps the last queue
  total; post-processing and completed read as fully downloaded.
- **Speed** is an EWMA (`SAB_SPEED_EWMA_ALPHA` 0.3) of the byte delta between
  consecutive `downloading` reads — SABnzbd has no per-job speed. Null until
  two samples, and in every other phase.
- **ETA** is the slot's own `timeleft`; null while paused, post-processing or
  gone.
- **A transition** is emitted only when an id's phase changes, `null → X` for
  a newly seen id included. A terminal reading is dropped the first tick it
  is absent, so the map never accumulates finished jobs.

**Health** (`SabClientHealth`):

| Health        | When                                            | Readings                       | Refresh                  |
| ------------- | ----------------------------------------------- | ------------------------------ | ------------------------ |
| `'off'`       | SABnzbd unset, or not read successfully yet     | none                           | 3·F1 timed gate          |
| `'ok'`        | one successful read                             | live                           | one per SAB phase change |
| `'unhealthy'` | `SAB_UNHEALTHY_AFTER` (3) failed ticks in a row | cleared, reducer state dropped | 3·F1 timed gate          |

- **The first two failures keep the last readings** and `'ok'`. Clearing on
  `'unhealthy'` makes snapshots fall back to Radarr/Sonarr's numbers instead
  of freezing a stale speed.
- **One log line per change**, not per failure:
  `SABnzbd reachable, live download readings on`,
  `SABnzbd reachable again, live download readings resumed`,
  `SABnzbd unreachable, falling back to Radarr/Sonarr progress`.
- **An auth error (HTTP 403)** also logs
  `SABNZBD_API_KEY rejected - needs the full API key, not the NZB key`, once
  per failing stretch.
- A tick with nothing to read asked SABnzbd nothing, so it leaves health as
  it is.

**Where readings live:** `MediaStateService`, in memory only —
`setClientReadings` (replaces, never merges), `clientReading(downloadId)`,
`clientHealth()`, and `pushClientTransitions` / `takeClientTransitions`
(drains). A restart starts from `'off'`.

### Readings on `queueSnapshot`

`toQueueSnapshot(item, lookup)` (`queue-status.util.ts`) takes a
`ClientReadingLookup` — `MediaStateService.clientReading`, passed in so the
util stays pure — and merges SABnzbd's side over Radarr/Sonarr's. Every
snapshot builder passes it: `annotate`, `annotateEpisodes`,
`toEpisodeStateEntries` (media events, `LibraryWatchService`) and the
poller's `applyUpdate`.

| Field                           | From                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `progress`                      | SABnzbd's bytes ratio when every download's size is known, else Radarr/Sonarr's         |
| `status`, `timeLeft`            | always Radarr/Sonarr's — they decide the job's status                                   |
| `downloadedBytes`, `totalBytes` | summed over the downloads                                                               |
| `speedBps`                      | summed over the downloads that have one                                                 |
| `etaSeconds`                    | the largest one known                                                                   |
| `stage`                         | `queued` / `paused` / `downloading` / `post_processing` — the least advanced download's |
| `stageDetail`                   | the `action_line`, HTML stripped — only when exactly one download is post-processing    |
| `clientPaused`, `clientDiskLow` | see ["Paused in SABnzbd"](#paused-in-sabnzbd)                                           |

- **All optional** on `DownloadQueueSnapshotSchema`
  (`packages/utils/src/download/schema.ts`), and **absent** — never `false`
  or `0` — while SABnzbd is off or has no reading.
- **Aggregates merge per `downloadId` first.** `aggregateQueueItems` records
  a fold's distinct `downloadIds`, so a Sonarr season pack — one download
  behind many rows — counts its bytes once. A fold with a row lacking a
  `downloadId` carries none and stays Radarr/Sonarr-only.
- **All or nothing.** If any of the downloads has no reading, the whole
  snapshot stays Radarr/Sonarr's: half of each would mix two clocks and two
  notions of size. A download SABnzbd first saw in history has no size, so
  its bytes are left out and `progress` stays Radarr/Sonarr's.
- **`completed`, `failed` and `gone` downloads** count their bytes but have
  no stage.
- **Change detection.** `isQueueSnapshotEqual` compares `speedBps` in
  10 KiB/s buckets, so smoothed-speed jitter alone never sends a job frame;
  `downloadedBytes` is exact, so a moving download sends one every tick.
- **1 Hz, with no new broadcast path.** The poller re-reads `/queue` and
  rebuilds snapshots every 1 s tick, and `resolve()`'s `annotate` reads the
  latest readings, so SABnzbd's numbers reach job frames (`touchJob`) and
  media events at the poll's pace.
- **Post-processing is a stage, not a job status.** It rides the existing
  `finishing` handoff: the card's chip reads `unpacking`, the bar pins to
  100 % and the line quotes `stageDetail`. Why not a status: a new
  `DownloadJobStatus` touches every exhaustive status map, and the shared
  `z.enum` an old tdr-bot build would reject.

### Event refresh, and the 3·F1 fallback

`MediaPollerService.requestQueueRefresh` runs in each `pollSource` before the
queue read, and branches on `MediaStateService.clientHealth()`:

| SABnzbd health         | Refresh                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `'ok'`                 | `requestEventRefresh`: one `RefreshMonitoredDownloads` per SAB phase change              |
| `'off'`, `'unhealthy'` | 3·F1's timed gate, unchanged — see [The queue refresh](#the-queue-refresh-plan-024--3f1) |

With SABnzbd healthy, all a refresh still buys is Radarr/Sonarr noticing a
phase change — above all a finished download, ready to import — sooner than
their own once-a-minute refresh.

- **Owner.** A transition belongs to the app whose previous-tick queue (what
  `getQueue` holds before this tick's `setQueue`) lists its `nzo_id` as a
  `downloadId`.
- **Rate.** At most one refresh per app per `EVENT_REFRESH_MIN_MS` (2 s); a
  burst inside it collapses into the next refresh allowed.
- **The pending list is taken whole and split.** The app's own transitions
  are spent by the refresh, or pushed back while the limit holds; the other
  app's are pushed back untouched, in order; one neither queue lists is
  dropped.
- **A refused refresh** is logged
  (`Queue refresh request failed, reading the queue as-is`), counts against
  the interval, and never backs off the poll.

### Disk-full wording

Needs no SABnzbd client: it reads the failure text Radarr/Sonarr already
pass on.

**Why.** Radarr/Sonarr map SABnzbd's failure to a Warning only when
`fail_message` is exactly `Unpacking failed, write error or disk is full?`.
SABnzbd's unrar paths append the unrar output, so a RAR disk-full arrives as
**Failed**: Radarr/Sonarr blocklist a good release and re-search into the
same full disk. The job used to show the raw unrar text, which reads like a
broken release.

`describeClientFailure` (`src/media/client-failure.util.ts`) matches
`/disk (is )?full|write error|no space left/i` and rewords it:

```
The NAS ran out of disk space while SABnzbd was unpacking it. (<original>)
```

`<original>` is the client's text up to and including the first `?` or `.`
at or after the disk phrase — which drops the unrar tail — or all of it when
there is none. Any other text passes through unchanged.

| Where                                             | What a person reads                                                                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applyFailure`, no upstream retry                 | `failed`, with the reworded `error`                                                                                                                            |
| `applyFailure`, upstream retries                  | `searching`, noted `Last download failed: the NAS ran out of disk space. Radarr is trying another release, which will fail the same way until space is freed.` |
| `describeQueueItemError` / `deriveQueueItemState` | the `needs_attention` reason — the 7z case, which reaches Radarr/Sonarr as a Warning and escalates after `ATTENTION_DELAY_MS` (2 min)                          |

- The Sonarr note names Sonarr.
- The download link (`job_downloads.fail_reason`) keeps the client's raw
  text.
- **The blocklist is deliberately not undone.** Removing it is a prod write,
  and a re-grab would hit the same full disk.

### "Paused in SABnzbd"

SABnzbd pauses its whole queue on its own — a full or nearly full disk, a
quota, or a pause in its UI — and Radarr/Sonarr then report every item
`paused`, the same as any other pause.

- **`clientPaused`** is set when the merged `stage` is `paused` and at least
  one paused download was read while SABnzbd's whole queue was paused. A
  Force download that keeps going reads `downloading` and never counts; nor
  does a download paused on its own with the queue running.
- **`clientDiskLow`** rides with it when the lowest free space those readings
  report (`diskspace1`, the download disk) is under `SAB_LOW_DISK_GB` (5 GB).
  An unknown free space never counts.
- **The attempt card** says `Paused in SABnzbd` — or
  `Paused in SABnzbd — the download disk is almost full` — under its chip,
  in place of `statusNote`. It keeps only the bytes under the bar and offers
  **Cancel only**: this app didn't make the pause, so it doesn't offer to
  undo it.

### ⚠️ Known limits

- **A SABnzbd "Retry" mints a new `nzo_id`.** The old job reads as removed
  from the client, and the new download is adopted as an unowned job —
  confusing, but correct. A manual retry needs the SABnzbd UI, now behind
  `lilnas-auth` (`a84b2c7f`).
- **Cancel during post-processing is deferred.** SABnzbd ignores a delete
  for a job it is post-processing but answers success, and Radarr/Sonarr
  re-track it and import.
- **Status can lag SABnzbd.** It still comes from Radarr/Sonarr's `/queue`,
  until the event refresh lands.
- **Media events have no speed bucket.** `broadcastIfChanged` diffs the raw
  snapshot (`JSON.stringify`), not through `isQueueSnapshotEqual`, so a
  `downloading` reading whose smoothed speed moves sends a media frame that
  tick even when its bytes don't.
- **The fixtures are source-derived.** The live shapes of an active `queue`
  slot and a post-processing `history` row haven't been captured yet; those
  fixtures are marked `TODO(H1)`.

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

### A second gateway subscriber: `DownloadClient.waitForJob`

The gateway now has **two** subscribers, not one. The browser store
(`apps/download/src/lib/use-job-events.ts`) is the original; `@lilnas/utils`
now also exports `DownloadClient.waitForJob`, used by tdr-bot's `/download`
command to await a job's terminal status instead of polling. Both parse
frames through the same shared module,
`@lilnas/utils/download/job-events` — moved there from the browser store —
so the two subscribers can't drift on wire-format parsing even though they
consume it from different runtimes.

`download.gateway.ts` itself is **unchanged**: it still broadcasts every job
event to every open socket, unfiltered, and each subscriber filters
client-side for the job(s) it cares about. A Node subscriber like
`waitForJob` connects with the native `WebSocket` global rather than the
`ws` package, which means it requires Node ≥ 22 (the production runtime is
`node:25.0.0-slim`, so this is a non-issue there). When the client was built
via `withForwardedIdentity()`, `waitForJob` passes the same
forwarded-identity headers on the WebSocket upgrade that authenticated HTTP
requests already send.

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
