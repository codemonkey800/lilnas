/**
 * Runtime Zod validators for the response *envelopes* of `apps/download`'s
 * read surface.
 *
 * The *element* schemas already exist and are the real wire contract -
 * `MediaSchema`, `DownloadJobSchema`, `ReleaseSchema`, `SeasonSchema`,
 * `BadFileSchema`, `AuditLogEntrySchema`, `GalleryItemSchema`. What has never
 * had a runtime validator is the wrapper each route puts around them, because
 * those live in `packages/utils/src/download/types.ts` as plain TypeScript
 * `interface`s that vanish at compile time. Nothing here restates a field list
 * that an element schema already owns; every envelope composes one.
 *
 * Two conventions run through the whole file:
 *
 * 1. **`z.strictObject`, everywhere.** An *extra* field the interface doesn't
 *    declare is precisely the drift this script exists to catch, and zod's
 *    default `.strip()` would swallow it silently. `z.strictObject` is used
 *    rather than `z.object().strict()` so strictness is stated up front and
 *    can't be lost by a later `.extend()`.
 * 2. **Element schemas are imported by relative path**, not by the
 *    `@lilnas/utils/download/schema` specifier. `packages/utils/package.json`
 *    exports `./dist/*.js`, so the package specifier needs the package built
 *    first; the relative path is the same resolution `jest.config.js`'s
 *    `moduleNameMapper` applies for the test suite.
 */
import { z } from 'zod'

import {
  AuditLogEntrySchema,
  BadFileSchema,
  DownloadJobSchema,
  DownloadJobStatus,
  DownloadType,
  GalleryItemSchema,
  JobRequesterSchema,
  MediaSchema,
  ReleaseSchema,
  SeasonSchema,
  TimeRangeSchema,
} from '../../../../packages/utils/src/download/schema'

/**
 * Every `count`/`total` on this surface comes out of a SQL `COUNT(*)` or a
 * `.length`, so a non-integer or a negative one is a real defect rather than
 * an over-strict expectation.
 */
const CountSchema = z.number().int().nonnegative()

// ---- The shared list envelope ----

/**
 * `DownloadPage<T>` (`packages/utils/src/download/types.ts:258`) - the
 * envelope every cursor-paginated list endpoint shares: activity, gallery,
 * history, discovery, and the admin audit log.
 *
 * `nextCursor` is `string | null` and never `undefined`: every producer
 * (`JobQueryService`, `AuditLogService`, `DiscoveryService`) writes an
 * explicit `: null` on the last page rather than omitting the key, so
 * `.nullable()` is right and `.nullish()` would be looser than the code.
 *
 * `total` is the size of the *filtered* set, not of what remains after the
 * cursor - so it is identical on every page of one query, which is what makes
 * C3's cursor round-trip check possible.
 */
export const downloadPage = <T extends z.ZodTypeAny>(item: T) =>
  z.strictObject(downloadPageShape(item))

/**
 * The raw shape behind {@link downloadPage}, exposed only so `DiscoveryPage`
 * can spread it. Spreading the shape rather than `.extend()`-ing a built
 * schema keeps `z.strictObject` as the single place strictness is decided.
 */
function downloadPageShape<T extends z.ZodTypeAny>(item: T) {
  return {
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: CountSchema,
  }
}

/** `GET /download/activity` - `DownloadPage<DownloadJob>`. */
export const ActivityPageSchema = downloadPage(DownloadJobSchema)

/** `GET /download/gallery` - `DownloadPage<GalleryItem>`. */
export const GalleryPageSchema = downloadPage(GalleryItemSchema)

/** `GET /download/history` - `DownloadPage<DownloadJob>`. */
export const HistoryPageSchema = downloadPage(DownloadJobSchema)

/**
 * `GET /download/admin/audit-log` - `DownloadPage<AuditLogEntry>`. There is
 * no audit-specific response interface on purpose (see the comment at
 * `types.ts:408`); it is the same envelope as every other list route.
 */
export const AuditLogPageSchema = downloadPage(AuditLogEntrySchema)

// ---- Discovery ----

/** `DiscoverySource` - `'movies' | 'shows'`. */
export const DiscoverySourceSchema = z.enum(['movies', 'shows'])

/** `DiscoveryFacets` - the genre chip vocabulary, computed server-side. */
export const DiscoveryFacetsSchema = z.strictObject({
  genres: z.array(z.strictObject({ count: CountSchema, genre: z.string() })),
})

/**
 * `GET /download/discover` - `DiscoveryPage` (`types.ts:273`), the shared
 * `DownloadPage<Media>` envelope plus two discovery-only fields.
 *
 * `degradedSources` is **permitted to be non-empty** here. An empty array is
 * the healthy case - the explicit signal that both Radarr and Sonarr
 * answered - but a degraded page is still a structurally valid response, so
 * flagging it is a semantic spot-check (task C3), not a parse failure. A
 * schema that rejected it would report "the contract drifted" for what is
 * actually "an upstream was down."
 */
export const DiscoveryPageSchema = z.strictObject({
  ...downloadPageShape(MediaSchema),
  degradedSources: z.array(DiscoverySourceSchema),
  facets: DiscoveryFacetsSchema,
})

/**
 * `GET /download/movies/search` and `GET /download/shows/search` -
 * `SearchMediaResponse`. Both search routes answer with a `{ results }`
 * wrapper, **not** a bare array and not a `DownloadPage`: they are the two
 * read routes on this surface with no cursor at all.
 */
export const SearchMediaResponseSchema = z.strictObject({
  results: z.array(MediaSchema),
})

// ---- Media detail and its sub-resources ----

/**
 * `GET /download/media/:id` - `MediaDetailResponse` (`types.ts:165`).
 *
 * `jobs: []` is a legitimate, fully-valid response: a movie has a detail page
 * whether or not anyone has ever requested it. C2's "empty list, nothing to
 * validate" rule applies to `jobs` here the same way it applies to `items` on
 * a page.
 */
export const MediaDetailResponseSchema = z.strictObject({
  jobs: z.array(DownloadJobSchema),
  media: MediaSchema,
})

/** `GET /download/media/:id/seasons` - `ListSeasonsResponse`. */
export const ListSeasonsResponseSchema = z.strictObject({
  seasons: z.array(SeasonSchema),
})

/** `GET /download/media/:id/bad-files` - `ListBadFilesResponse`. */
export const ListBadFilesResponseSchema = z.strictObject({
  badFiles: z.array(BadFileSchema),
})

/**
 * `GET /download/media/:id/releases` - `ListReleasesResponse`. The expensive
 * one: it fires a real interactive indexer search, so it is opt-in only.
 */
export const ListReleasesResponseSchema = z.strictObject({
  releases: z.array(ReleaseSchema),
})

// ---- Job-by-id routes ----

/**
 * `GET /download/videos/:id`, `GET /download/movies/:id` and
 * `GET /download/shows/:id`.
 *
 * ⚠️ **All three answer with a bare `DownloadJob`** - verified against
 * `DownloadController.getVideoJob()` / `getMovieJob()` / `getShowJob()`,
 * which are typed `Promise<DownloadJob>` and return
 * `projectJobForViewer(job, isAdmin)`. They are *not*
 * {@link GetDownloadJobResponseSchema}; see that schema's own note.
 *
 * Aliased rather than re-declared, so the route table can name the wire shape
 * these routes return without implying there is a separate envelope to
 * validate. There is no wrapper here at all - the job *is* the body.
 */
export const DownloadJobResponseSchema = DownloadJobSchema

/**
 * `GetDownloadJobResponse` (`types.ts:210`).
 *
 * ⚠️ **This is not a backend response shape.** Despite the name, no route
 * emits it: it is the deprecated pre-`Media` *client-side* projection that
 * `flattenToLegacyVideoResponse()` (`packages/utils/src/download/client.ts:26`)
 * builds from a `DownloadJob` after the fetch, retained solely for
 * `apps/tdr-bot`'s three legacy `DownloadClient` methods. The three job-by-id
 * routes return {@link DownloadJobResponseSchema}.
 *
 * Modelled here anyway, and hand-rolled because the flattened shape has no
 * element schema behind it, so that a check of the *client's* contract has
 * something to parse against - and so the route table is forced to say out
 * loud which of the two it means.
 */
export const GetDownloadJobResponseSchema = z.strictObject({
  description: z.string().optional(),
  downloadUrls: z.array(z.string()).optional(),
  error: z.string().optional(),
  hiddenAttribution: z.boolean(),
  id: z.string(),
  requester: JobRequesterSchema.nullable(),
  status: z.enum(DownloadJobStatus),
  timeRange: TimeRangeSchema.optional(),
  title: z.string().optional(),
  type: z.literal(DownloadType.Video),
  url: z.string(),
})

// ---- Gallery facets ----

/**
 * `GET /download/gallery/facets` - `DownloadGalleryFacets` (`types.ts:330`).
 *
 * `uploaders` keys on `email`, not `requesterEmail` - that rename happens
 * only in `AdminStatsService.rankRequesters()`, so the two facet-ish surfaces
 * genuinely disagree on the field name and this must not be "harmonised."
 */
export const GalleryFacetsSchema = z.strictObject({
  types: z.array(
    z.strictObject({ count: CountSchema, type: z.enum(DownloadType) }),
  ),
  uploaders: z.array(z.strictObject({ count: CountSchema, email: z.string() })),
})

// ---- Admin ----

/**
 * `GET /download/admin/stats` - `AdminStatsResponse` (`types.ts:422`).
 *
 * ⚠️ **Every breakdown is sparse by design.** `AdminStatsService.getStats()`
 * returns the four aggregates exactly as the `GROUP BY` repos produce them,
 * never zero-filled: a status nobody has hit, or a `(day, type)` pair with no
 * jobs, is *absent* rather than `{ count: 0 }`. So none of these arrays may
 * carry a completeness expectation - no `.length` floor, no "one row per
 * `DownloadType`", no dense day series. Callers that want a continuous x-axis
 * fill their own gaps.
 *
 * The bounds that *are* asserted come straight from the code:
 * - `day` is `date(created_at / 1000, 'unixepoch')` - a UTC `YYYY-MM-DD`.
 * - `windowDays` echoes the applied window, which `AdminStatsQuerySchema`
 *   has already clamped to 1..365.
 *
 * `topRequesters.length <= TOP_REQUESTERS_LIMIT` is deliberately *not*
 * encoded here: it is a semantic invariant of `rankRequesters()`'s `.slice()`
 * and belongs in C3, where a violation can be reported as "the limit stopped
 * being applied" rather than as an opaque schema failure.
 */
export const AdminStatsResponseSchema = z.strictObject({
  jobsPerDay: z.array(
    z.strictObject({
      count: CountSchema,
      day: z.iso.date(),
      type: z.enum(DownloadType),
    }),
  ),
  topRequesters: z.array(
    z.strictObject({ count: CountSchema, requesterEmail: z.string() }),
  ),
  totalJobs: CountSchema,
  totalsByStatus: z.array(
    z.strictObject({ count: CountSchema, status: z.enum(DownloadJobStatus) }),
  ),
  totalsByType: z.array(
    z.strictObject({ count: CountSchema, type: z.enum(DownloadType) }),
  ),
  windowDays: z.number().int().min(1).max(365),
})

// ---- Hand-rolled: no shared schema exists for these ----

/**
 * `GET /auth/whoami` - `AuthDebugController.whoami()`'s local
 * `WhoamiResponse`, which is `ForwardedUser & { isAdmin: boolean }`.
 *
 * Hand-rolled rather than composed from `JobRequesterSchema`: the two happen
 * to share `{ email, userId }` today, but one is a forwarded identity off the
 * request headers and the other is a persisted attribution record, and
 * coupling them would make a future change to either silently retarget this
 * check.
 *
 * ⚠️ `isAdmin` is **fail-closed** - `AdminCheckService` resolves an
 * unreachable `auth` container to `false`, so `isAdmin: false` means "not an
 * admin, *or* `auth` is down." Structurally valid either way; distinguishing
 * them is the runner's job.
 */
export const WhoamiSchema = z.strictObject({
  email: z.string(),
  isAdmin: z.boolean(),
  userId: z.string(),
})

/**
 * `GET /api/ytdlp-update/status` - `YtdlpUpdateService.getUpdateStatus()`.
 *
 * `lastCheck`/`lastAttempt` are `Date | null` in the service and cross the
 * wire as whatever `Date.prototype.toJSON()` produces, so they validate as
 * ISO datetimes here rather than as `z.date()`. Both are `null` on a process
 * that has not run a check since boot - the normal state, not a fault.
 */
export const YtdlpStatusSchema = z.strictObject({
  isUpdating: z.boolean(),
  lastAttempt: z.iso.datetime().nullable(),
  lastCheck: z.iso.datetime().nullable(),
  retryCount: CountSchema,
})

/**
 * `GET /api/ytdlp-update/version`.
 *
 * Plain `z.string()`, deliberately not a semver pattern: the handler catches
 * its own failure and answers `{ version: 'error' }` with a 200. Rejecting
 * that here would report a *successful* request as a contract violation, when
 * what it actually means is that the yt-dlp binary could not be interrogated
 * - a fact worth surfacing as a spot-check, not as a parse error.
 */
export const YtdlpVersionSchema = z.strictObject({ version: z.string() })
