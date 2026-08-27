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
 * Nothing here is mutating: every route is a `@Get`. Two carry caveats that
 * are encoded as fields rather than left to the runner's memory —
 * `expensive` for the one route that fires a real indexer search, and
 * `bodyMode: 'headers-only'` for the one route that answers with bytes.
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
  // 404s a `tmdb:` key outright, and 404s a `tvdb:` key whose series Sonarr
  // doesn't hold.
  {
    slug: 'media-seasons',
    path: '/download/media/:id/seasons',
    needsId: 'media',
    mediaKind: 'show',
  },
  // A plain `bad_files` table lookup — any media key answers 200, with `[]`
  // when nothing is flagged. No upstream call, so no `mediaKind`.
  {
    slug: 'media-bad-files',
    path: '/download/media/:id/bad-files',
    needsId: 'media',
  },
  // Streams the file. `video:` keys specifically: a `tvdb:` key without
  // `episodeId` is a guaranteed 400 (`parseScope`), and a `tmdb:` key
  // streams a whole movie off disk. The video branch reads from MinIO, is
  // the smallest of the three, and — per the controller — deliberately does
  // not honour `Range`, which is exactly why the body must be discarded
  // rather than range-limited.
  {
    slug: 'media-file',
    path: '/download/media/:id/file',
    needsId: 'media',
    mediaKind: 'video',
    bodyMode: 'headers-only',
  },
  // Opt-in only. Despite being a GET this fires a real interactive indexer
  // search (30s+) and borrows monitoring upstream to do it
  // (`ReleaseService.withMonitoring`). Movie keys only: a movie release
  // search is one bounded search, where a series without a `seasonNumber`
  // fans out much wider.
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
