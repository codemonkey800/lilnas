/**
 * The one list of read routes that both `capture` and `check` consume, so
 * the two halves of the verification script cannot drift apart.
 *
 * Every entry was verified against the controllers on 2026-08-26:
 * `src/download/download.controller.ts` (`@Controller('/download')`),
 * `src/admin/admin.controller.ts` (`@Controller('/download/admin')`,
 * class-level `@UseGuards(AdminGuard)`),
 * `src/ytdlp-update/ytdlp-update.controller.ts`
 * (`@Controller('api/ytdlp-update')`) and
 * `src/auth/auth-debug.controller.ts` (`@Controller('auth')`).
 *
 * `bootstrap.ts` sets **no** global prefix, so the paths below are absolute
 * as written. They are the Nest paths on port 8081, not the Next.js
 * `/api/...` rewrites on 8080.
 *
 * Nothing here is mutating: every route is a `@Get`. Three carry caveats that
 * are encoded as fields rather than left to the runner's memory —
 * `expensive` for the one route that fires a real indexer search,
 * `bodyMode: 'headers-only'` for the one route that answers with bytes, and
 * `requiresLibrary` for the routes that only answer for a title the library
 * already holds.
 *
 * The second half of this file is {@link idProvenance}: which of the id-free
 * routes return **library** contents and which return **catalogue** lookups.
 * Feeding the latter to a route needing the former is what produced two of
 * E1's four failures, and neither was a fault of the backend.
 */

/**
 * One capture target.
 *
 * `path` is a literal Nest path, with at most one `:id` segment. When
 * `needsId` is set the runner substitutes a real id discovered during the
 * id-free first pass; when it cannot find one, the route is reported as
 * `SKIPPED (no fixture)` rather than being called with a guessed id.
 */
export interface RouteSpec {
  /** Filename-safe; keys `captures/<slug>.json` and `<slug>.meta.json`. */
  slug: string
  /** e.g. `/download/gallery`, `/download/media/:id/seasons`. */
  path: string
  /**
   * Query params, already stringified — these are serialised straight into
   * the query string, so every value here must survive the route's Zod
   * query schema in `packages/utils/src/download/schema.ts`. A manifest
   * that produces 400s verifies nothing.
   */
  query?: Record<string, string>
  /**
   * Which pool the `:id` in `path` is drawn from. The four pools are **not**
   * interchangeable:
   *
   * - `media` — a derived media key (`tmdb:`/`tvdb:`/`video:`), minted by
   *   `mediaId()` in `src/db/media-id.ts`. Narrow it further with
   *   `mediaKind` when the route only accepts one prefix.
   * - `video` / `movie` / `show` — a **job** id, not a media key.
   *   `GET /download/{videos,movies,shows}/:id` all resolve through
   *   `DownloadStateService.resolveJobRecord(id)` and then assert the job's
   *   media type, so a media key here is a guaranteed miss.
   */
  needsId?: 'media' | 'video' | 'movie' | 'show'
  /**
   * Narrows the `needsId: 'media'` pool to keys of one media type, for the
   * routes that reject the other two. Ignored for the job-id pools, which
   * are already type-specific.
   */
  mediaKind?: 'movie' | 'show' | 'video'
  /**
   * `true` = this route only answers for a title the **library already
   * holds**, so it may only be given a key mined from a library-backed
   * source — see {@link idProvenance}.
   *
   * This is a different axis from {@link mediaKind}. `mediaKind` says which
   * *prefix* the handler accepts; `requiresLibrary` says the handler then
   * looks the key up in Sonarr/Radarr/this app's own database and 404s when
   * it isn't there. `GET /media/:id/seasons` needs both: a `tvdb:` key
   * (`ShowService.listSeasons` 404s a `tmdb:` one) **and** a series Sonarr
   * actually holds (`resolveUpstreamId` returns null otherwise —
   * `listSeasons` deliberately does not `ensureSeries`, because adding a
   * series to the library as a side effect of a GET would be a surprise).
   *
   * When no library-backed key of the required kind exists, the runner
   * reports `SKIPPED (no library <kind>)`. It never falls back to a
   * catalogue key: a 404 from feeding `/seasons` a `tvdb:` id that only
   * `/discover` ever knew about is a bug in this manifest, not in the
   * backend, and reporting it as a `FAIL` costs a human a debugging session
   * (it cost exactly one during E1).
   *
   * Only meaningful with `needsId: 'media'` — the job-id pools are mined
   * solely from `/activity` and `/history`, which are this app's own
   * `download_jobs` rows and therefore library-backed by construction.
   */
  requiresLibrary?: boolean
  /**
   * The identity headers the route needs. Absent means the route answers
   * fine with no identity at all — `app.module.ts` registers no global
   * guard, and every unguarded route uses `@OptionalCurrentUser()`.
   *
   * - `forwarded-user` — `@UseGuards(ForwardedUserGuard)`; 401 without
   *   `X-Forwarded-User` + `X-Forwarded-User-Id`.
   * - `admin` — `@UseGuards(AdminGuard)`; needs an identity that
   *   `AdminCheckService` resolves as admin. That service is fail-closed,
   *   so a 403 means "not admin **or** the `auth` container is down".
   */
  guard?: 'forwarded-user' | 'admin'
  /** `true` = opt-in only, behind `--include-expensive`. */
  expensive?: boolean
  /**
   * How to read the response. Defaults to `'json'`. `'headers-only'` means
   * the runner must discard the body (`curl -o /dev/null`) — the route
   * streams a whole media file.
   */
  bodyMode?: 'json' | 'headers-only'
  /**
   * Marks this spec as the **page 2** of a cursor-paginated route: the slug
   * of the spec whose response body supplies the `cursor` query param.
   *
   * The runner reads `nextCursor` off the named slug's captured body and
   * sets `query.cursor` to it before issuing this request. If that capture
   * is missing, failed, or came back with `nextCursor: null` (the whole
   * result set fit on page 1), this spec is `SKIPPED (no cursor)` — never a
   * failure, and never called with a fabricated cursor.
   *
   * Every other query param is repeated verbatim from the page-1 spec on
   * purpose. Every cursor in this service is minted under the filter that
   * produced it — see `AuditLogService.listAuditLog()`, which returns a 400
   * for a cursor decoded under a different filter — so changing a filter
   * between the two pages tests the rejection path, not the round trip.
   *
   * This is what gives C3's cursor round-trip spot-check two comparable
   * pages: no overlapping ids, no gap, identical `total`.
   */
  cursorFrom?: string
}

/**
 * Page size for the paginated routes.
 *
 * Deliberately well under the library's size rather than the schema's
 * `LimitSchema` default of 24: page 1 must come back with a non-null
 * `nextCursor` for the `cursorFrom` specs below to have anything to follow,
 * and a page that swallows the entire result set never produces one. Ten
 * real items is still ample for schema validation — drift shows up on the
 * first item, not the twenty-fourth.
 */
const PAGE_LIMIT = '10'

/**
 * Search terms. Long-established titles, chosen so the routes keep
 * answering the same way years from now. Nothing downstream may pin a count
 * or an ordering on these — only "the shape came back intact".
 *
 * `DiscoverQuerySchema.query` is `z.string().min(2)` and **required**;
 * `MediaSearchQuerySchema.query` is `z.string().min(1)` and required. All
 * three are satisfied below. `Star Trek` is used for discovery specifically
 * because it exists in both Radarr's and Sonarr's lookup sources, which is
 * what makes an empty `degradedSources` meaningful there.
 */
const DISCOVER_QUERY = 'Star Trek'
const MOVIE_SEARCH_QUERY = 'The Matrix'
const SHOW_SEARCH_QUERY = 'The Simpsons'

/**
 * Non-default on purpose. `AdminStatsQuerySchema.days` defaults to 30, so
 * asking for 30 would make C3's "`windowDays` echoes the requested `days`"
 * check pass even if the handler ignored the param entirely.
 */
const ADMIN_STATS_DAYS = '14'

export const READ_ROUTES: RouteSpec[] = [
  // ---- DownloadController — list routes (no id needed) ----

  {
    slug: 'activity',
    path: '/download/activity',
    query: { limit: PAGE_LIMIT },
  },
  {
    slug: 'activity-page2',
    path: '/download/activity',
    query: { limit: PAGE_LIMIT },
    cursorFrom: 'activity',
  },
  {
    slug: 'gallery',
    path: '/download/gallery',
    query: { limit: PAGE_LIMIT },
  },
  {
    slug: 'gallery-page2',
    path: '/download/gallery',
    query: { limit: PAGE_LIMIT },
    cursorFrom: 'gallery',
  },
  // Not paginated — `GalleryFacetsQuerySchema` is `{ from?, to? }` only.
  {
    slug: 'gallery-facets',
    path: '/download/gallery/facets',
  },
  {
    slug: 'discover',
    path: '/download/discover',
    query: { limit: PAGE_LIMIT, query: DISCOVER_QUERY },
  },
  {
    slug: 'discover-page2',
    path: '/download/discover',
    query: { limit: PAGE_LIMIT, query: DISCOVER_QUERY },
    cursorFrom: 'discover',
  },
  // 401 without the forwarded headers — a service caller has no "own
  // history" to default to, so the guard is real rather than decorative.
  {
    slug: 'history',
    path: '/download/history',
    query: { limit: PAGE_LIMIT },
    guard: 'forwarded-user',
  },
  {
    slug: 'history-page2',
    path: '/download/history',
    query: { limit: PAGE_LIMIT },
    guard: 'forwarded-user',
    cursorFrom: 'history',
  },
  // Both search routes take `@Query()` with no `ZodValidationPipe`, so a
  // missing `query` would 500 in the service rather than 400 at the edge.
  // Sending a valid one keeps this measuring the upstream, not the pipe.
  {
    slug: 'movies-search',
    path: '/download/movies/search',
    query: { query: MOVIE_SEARCH_QUERY },
  },
  {
    slug: 'shows-search',
    path: '/download/shows/search',
    query: { query: SHOW_SEARCH_QUERY },
  },

  // ---- DownloadController — media-keyed routes ----

  // Accepts all three key prefixes: `mediaTypeFromKey()` maps the prefix to
  // a type and `MediaResolverService` resolves it, so no `mediaKind`.
  {
    slug: 'media-detail',
    path: '/download/media/:id',
    needsId: 'media',
  },
  // Shows only, and only shows already in the library: `ShowService`
  // 404s a `tmdb:` key outright (`listSeasons` rejects a Movie target), and
  // 404s a `tvdb:` key whose series Sonarr doesn't hold — it deliberately
  // does *not* `ensureSeries`, so browsing a catalogue show has nothing to
  // show. Hence `requiresLibrary`: a `tvdb:` key mined from `/discover` is a
  // guaranteed 404 and says nothing about the backend.
  {
    slug: 'media-seasons',
    path: '/download/media/:id/seasons',
    needsId: 'media',
    mediaKind: 'show',
    requiresLibrary: true,
  },
  // A `bad_files` table lookup with **no upstream call** — but not with no
  // key validation: `ReleaseService.listBadFiles()` calls
  // `parseReleaseTarget(mediaId)` for its side effect before touching the
  // table, and that throws `NotFoundException` for a `video:` key
  // ("Releases are only available for movies and shows"). So this needs a
  // `mediaKind` after all; `movie` because `tmdb:` keys are the most
  // reliably present of the three (both `/discover` and `/movies/search`
  // mint them, with no dependency on the library holding anything).
  //
  // No `requiresLibrary`: the lookup is `WHERE media_id = ?` against this
  // app's own table, so a catalogue key answers 200 with `[]` — which is
  // both the healthy state and by far the likeliest one.
  {
    slug: 'media-bad-files',
    path: '/download/media/:id/bad-files',
    needsId: 'media',
    mediaKind: 'movie',
  },
  // Streams the file. `video:` keys specifically: a `tvdb:` key without
  // `episodeId` is a guaranteed 400 (`parseScope`), and a `tmdb:` key
  // streams a whole movie off disk. The video branch reads from MinIO, is
  // the smallest of the three, and — per the controller — deliberately does
  // not honour `Range`, which is exactly why the body must be discarded
  // rather than range-limited.
  //
  // `requiresLibrary` is belt-and-braces here rather than a fix:
  // `resolveVideoSource()` reads `getVideoById()` out of this app's own
  // `videos` table, and no catalogue route mints a `video:` key in the first
  // place. What it does buy is the *ordering* — a video mined from
  // `/activity` is by definition an in-progress job (`listActivity` filters
  // to `IN_PROGRESS_DOWNLOAD_JOB_STATUSES`) with no `downloadUrls` yet, and
  // would answer 404 "has no file to save". The gallery's rows are
  // `Completed` only, which is why the runner prefers them.
  {
    slug: 'media-file',
    path: '/download/media/:id/file',
    needsId: 'media',
    mediaKind: 'video',
    requiresLibrary: true,
    bodyMode: 'headers-only',
  },
  // Opt-in only. Despite being a GET this fires a real interactive indexer
  // search (30s+) and borrows monitoring upstream to do it
  // (`ReleaseService.withMonitoring`). Movie keys only: a movie release
  // search is one bounded search, where a series without a `seasonNumber`
  // fans out much wider.
  //
  // Deliberately **no** `requiresLibrary`, unlike `/seasons`:
  // `listReleases()` documents browsing a not-yet-requested title as its
  // primary use case, and `withMonitoring` reaches it via `ensureMovie`
  // rather than the resolver. A catalogue key is therefore a legitimate
  // fixture. `ensureMovie` still **adds the movie to Radarr** when it isn't
  // there (`radarr.service.ts`, `postApiV3Movie` with
  // `searchForMovie: false`), but `withMonitoring` now takes that entry back
  // out on the read path (`wasAdded` -> `unmonitorAndDelete(id, false)`), so
  // a sweep over catalogue keys no longer leaves an imported library behind.
  // The runner still prefers a library-backed key when one exists: on a
  // library key `ensureMovie` finds the movie and adds nothing at all, which
  // is cheaper and touches less.
  {
    slug: 'media-releases',
    path: '/download/media/:id/releases',
    needsId: 'media',
    mediaKind: 'movie',
    expensive: true,
  },

  // ---- DownloadController — job-keyed routes ----
  //
  // `:id` is a **job** id here, not a media key. All three funnel through
  // `MediaDownloadService.getJob()` / `DownloadService`, which look the id
  // up in `DownloadStateService` and then assert the job's media type.

  {
    slug: 'video-job',
    path: '/download/videos/:id',
    needsId: 'video',
  },
  {
    slug: 'movie-job',
    path: '/download/movies/:id',
    needsId: 'movie',
  },
  {
    slug: 'show-job',
    path: '/download/shows/:id',
    needsId: 'show',
  },

  // ---- AdminController — class-level AdminGuard ----

  {
    slug: 'admin-audit-log',
    path: '/download/admin/audit-log',
    query: { limit: PAGE_LIMIT },
    guard: 'admin',
  },
  {
    slug: 'admin-audit-log-page2',
    path: '/download/admin/audit-log',
    query: { limit: PAGE_LIMIT },
    guard: 'admin',
    cursorFrom: 'admin-audit-log',
  },
  {
    slug: 'admin-stats',
    path: '/download/admin/stats',
    query: { days: ADMIN_STATS_DAYS },
    guard: 'admin',
  },

  // ---- YtdlpUpdateController ----
  //
  // `@Controller('api/ytdlp-update')` — the only controller in this app
  // whose prefix starts with `api`, and it is a Nest path on 8081, not the
  // Next.js rewrite. `POST /api/ytdlp-update/check` is the mutating sibling
  // and is deliberately absent from this manifest.

  {
    slug: 'ytdlp-status',
    path: '/api/ytdlp-update/status',
  },
  {
    slug: 'ytdlp-version',
    path: '/api/ytdlp-update/version',
  },

  // ---- AuthDebugController ----
  //
  // Guarded, contrary to the plan's route table: `whoami()` carries
  // `@UseGuards(ForwardedUserGuard)`, so it is a 401 without the forwarded
  // headers. It is also the only route that exercises `AdminCheckService`
  // on a read path, which makes it the cheapest way to tell "not admin"
  // apart from "the auth container is unreachable" when an admin route 403s.
  {
    slug: 'auth-whoami',
    path: '/auth/whoami',
    guard: 'forwarded-user',
  },
]

// ---------------------------------------------------------------------------
// Id provenance — where a mined id came from, and what may be assumed of it
// ---------------------------------------------------------------------------

/**
 * What the source of an id licenses you to assume about the thing it names.
 *
 * The distinction this exists to make is **library vs. catalogue**, and E1
 * found out the expensive way that it matters. `/download/discover` and the
 * two `/search` routes are upstream *lookups*: Radarr and Sonarr will happily
 * answer with every Star Trek series that has ever existed, whether or not
 * this library holds a single one. `/download/activity`, `/download/gallery`
 * and `/download/history` are reads of this app's own `download_jobs` table —
 * every row there is something that was actually requested, so its title is
 * in Radarr/Sonarr (or, for a video, in this app's `videos` table).
 *
 * The third value splits the library side one step further, which is what
 * keeps `/media/:id/file` off an id that has no file yet:
 *
 * - `library-completed` — a `Completed` job. `JobQueryService.listGallery()`
 *   filters `statuses: [DownloadJobStatus.Completed]`, so a gallery row's
 *   media exists **and its bytes do**.
 * - `library-any-state` — in this app's database, in any state. `/activity`
 *   is `IN_PROGRESS_DOWNLOAD_JOB_STATUSES` (so its rows are *never* settled)
 *   and `/history` is unfiltered by status. The title is real; a file for it
 *   may not be.
 * - `catalogue` — an upstream lookup result. The title is real; the library
 *   may never have heard of it.
 */
export type IdProvenance =
  | 'library-completed'
  | 'library-any-state'
  | 'catalogue'

/**
 * Provenance keyed by the slug that **mints** ids, i.e. the page-1 spec.
 * `-page2` variants inherit through `cursorFrom` in {@link idProvenance}, so
 * a follow-up page never needs an entry of its own.
 *
 * Slugs absent here — `gallery-facets`, `ytdlp-status`, the admin routes —
 * mint no media keys or job ids at all, and default to `catalogue`, which is
 * the fail-safe direction: an unclassified source can cost a route a
 * conservative skip, never a bogus `FAIL`.
 */
const ID_SOURCE_PROVENANCE: Readonly<Record<string, IdProvenance>> = {
  activity: 'library-any-state',
  discover: 'catalogue',
  gallery: 'library-completed',
  history: 'library-any-state',
  'movies-search': 'catalogue',
  'shows-search': 'catalogue',
}

/**
 * The slugs {@link ID_SOURCE_PROVENANCE} classifies, so the runner's manifest
 * validation can prove none of them has been renamed out from under it. A
 * stale entry here would silently demote a library source to `catalogue`, and
 * the symptom — routes quietly skipping instead of verifying — is exactly the
 * kind of green-looking hollow run this script exists to prevent.
 */
export const ID_SOURCE_SLUGS: readonly string[] =
  Object.keys(ID_SOURCE_PROVENANCE)

const SPECS_BY_SLUG: ReadonlyMap<string, RouteSpec> = new Map(
  READ_ROUTES.map(spec => [spec.slug, spec]),
)

/** Where ids mined from `slug` came from. Unknown slugs are `catalogue`. */
export function idProvenance(slug: string): IdProvenance {
  const spec = SPECS_BY_SLUG.get(slug)
  const source = spec?.cursorFrom ?? slug
  return ID_SOURCE_PROVENANCE[source] ?? 'catalogue'
}

/** `true` for a source backed by the app's own data rather than an upstream lookup. */
export function isLibraryBacked(slug: string): boolean {
  return idProvenance(slug) !== 'catalogue'
}

/**
 * Preference order, best first. Lower sorts earlier when the runner picks a
 * fixture, so a library key always beats a catalogue one of the same media
 * kind even where both would work — see `media-releases`, where the catalogue
 * branch has an `ensureMovie` side effect the library branch does not.
 */
const PROVENANCE_ORDER: readonly IdProvenance[] = [
  'library-completed',
  'library-any-state',
  'catalogue',
]

/** Sort key for {@link PROVENANCE_ORDER}. */
export function idProvenanceRank(provenance: IdProvenance): number {
  return PROVENANCE_ORDER.indexOf(provenance)
}
