# Download App — Backend Plan

Companion to [`spec.md`](spec.md) and [`user-stories.md`](user-stories.md).
Covers what the backend needs to build to support the full spec — the
frontend is being rebuilt against the spec in parallel. This is a design/
sequencing document, not a build log — nothing below has been implemented
yet.

## Context

Today's backend only covers a fraction of the spec: a yt-dlp pipeline and
Radarr/Sonarr request/delete, both tracked in a single **in-memory `Map`**
(`DownloadStateService`) with no persistence, no user identity, and no list
endpoints — every read is `GET /:id` by a known ID. Almost every remaining
spec section (gallery, search, activity feed, per-user stats, audit log)
requires durable, queryable history that doesn't exist yet. That gap, plus
identity (nothing reads who's asking), is what most of this plan builds.

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

- `jobs` table: id, type, requester user id/email, hidden-attribution flag
  (video only), status, title, timestamps, file location(s) (including the
  Phase-6 Emby-match path for movies/shows), source metadata (poster,
  overview — currently re-fetched from Radarr/Sonarr on every request).
- Write to `jobs` from the two existing choke points that already centralize
  every job mutation — `DownloadStateService.addJob()` / `updateJob()`
  (confirmed these are the *only* two places job state changes anywhere
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
  requester to every socket (even if the frontend only *renders* it for
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

## Phase 3 — File selection, replacement, bad-file reporting

The generated SDK already exposes the primitives, just unwired:
`getApiV3Release`/`postApiV3Release` (Radarr) and their Sonarr equivalents
exist in `packages/media` today but aren't called anywhere in
`RadarrService`/`SonarrService`.
- New endpoints: list available releases for a movie/episode; download a
  specific chosen release (not just trigger the existing generic
  `MoviesSearch`/`SeriesSearch` command).
- Replace flow: one action — delete old file, download the new release.
- `bad_files` table: which release was flagged, by whom, when. Checked
  before auto-selecting a release on re-download — enforced only inside the
  app, per spec (doesn't touch Radarr/Sonarr's own selection logic).

---

## Phase 4 — Per-episode/season granularity (shows)

Today's Sonarr wrapper only requests/deletes at the whole-series level.
Confirmed the SDK already has what's needed: `getApiV3Episode`/
`getApiV3EpisodeById`, `getApiV3Episodefile`/`deleteApiV3EpisodefileById`
(per-episode file resource), `putApiV3EpisodeMonitor` (bulk monitor toggle
by episode IDs — how you'd scope a search to specific episodes/a season
before triggering it). Sonarr's command API also supports `EpisodeSearch`/
`SeasonSearch` command names (well-documented Sonarr behavior, same shape as
the already-used `SeriesSearch`/`MoviesSearch` — extend locally the same way
`SeriesSearchCommand`/`MoviesSearchCommand` already do); verify the exact
name against a running instance during implementation.
- New endpoints: download/delete a single episode, a full season, or the
  whole series (series-level already exists).

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
of it is streaming/HLS-proxy/subtitle plumbing for an *embedded* player.
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

**Indexed-check**: once Radarr/Sonarr report the imported file's on-disk
path, store it on the `jobs` row (Phase 1 schema), then poll Emby's
`GET /Items` for an entry whose `Path` matches. No match yet → "Indexing…";
match found → "Watch" with a deep link built from the matched item's ID.
This is entirely new logic — the old theater code never had an
indexed/pending concept (confirmed: it assumed the whole library was
already present). Path-based matching was chosen over title/year matching
for reliability — Emby can render/sanitize titles differently than
Radarr/Sonarr, risking a missed match even after indexing.

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
  + `target_id` (nullable), `metadata` (JSON), `timestamp`.
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
