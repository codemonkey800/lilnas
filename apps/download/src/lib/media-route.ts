import type { MediaRouteKind } from '@lilnas/utils/download/media-route'
import { DownloadType } from '@lilnas/utils/download/types'

// The outbound half (`DownloadType` -> href) lives in `@lilnas/utils` so the
// Discord bot links to the same paths this app routes; re-exported so pages
// keep importing from one place.
export {
  mediaHref,
  type MediaRouteKind,
  routeKindFromType,
} from '@lilnas/utils/download/media-route'

/**
 * The inbound half of the kind map in `@lilnas/utils/download/media-route`.
 */
const ROUTE_KIND_TO_TYPE: Record<MediaRouteKind, DownloadType> = {
  movies: DownloadType.Movie,
  shows: DownloadType.Show,
  videos: DownloadType.Video,
}

/**
 * The `mediaId()` prefix each route kind reattaches. Kept beside the kind
 * map rather than re-deriving through `mediaId()`, which needs a whole
 * `Movie`/`Show`/`Video`-shaped input just to produce a string.
 */
const ROUTE_KIND_TO_PREFIX: Record<MediaRouteKind, string> = {
  movies: 'tmdb:',
  shows: 'tvdb:',
  videos: 'video:',
}

/**
 * A tmdb/tvdb id: digits only, no leading zero, so exactly one URL spells
 * any given title. `RequestMovieInputSchema`/`RequestShowInputSchema` both
 * require `.int().positive()`, so `0` is not a real id either.
 */
const EXTERNAL_ID_PATTERN = /^[1-9][0-9]*$/

/**
 * A `videos.id`: a nanoid, whose alphabet is `A-Za-z0-9_-`. Notably it can
 * never contain `:` (the same fact `db/list-cursor.ts` relies on), which is
 * what stops `mediaIdFromRoute('videos', 'tmdb:438631')` from smuggling a
 * movie key through the video route.
 */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function isValidSegment(kind: MediaRouteKind, segment: string): boolean {
  return kind === 'videos'
    ? VIDEO_ID_PATTERN.test(segment)
    : EXTERNAL_ID_PATTERN.test(segment) && Number.isSafeInteger(Number(segment))
}

/**
 * The inverse of `mediaHref`: reattaches the prefix a route segment
 * dropped, yielding the `mediaId()` key every backend endpoint is addressed
 * by.
 *
 * Returns `null` - rather than throwing - for a segment that is not a plain
 * id of the right shape, so a page can answer `notFound()` instead of
 * wrapping every call in a `try`. The validation is the security boundary
 * for this mapping: without it `/videos/tmdb%3A438631` would concatenate to
 * `video:tmdb:438631`, and a crafted segment could aim a `videos`-scoped
 * route at a different id space.
 */
export function mediaIdFromRoute(
  kind: MediaRouteKind,
  segment: string,
): string | null {
  if (!isValidSegment(kind, segment)) {
    return null
  }

  return `${ROUTE_KIND_TO_PREFIX[kind]}${segment}`
}

/** The {@link DownloadType} a route kind names. Total, so it cannot fail. */
export function mediaTypeFromRoute(kind: MediaRouteKind): DownloadType {
  return ROUTE_KIND_TO_TYPE[kind]
}

/**
 * Narrows an arbitrary path segment to a {@link MediaRouteKind}. Next.js
 * types a catch-all `params` entry as `string`, so something has to do this
 * check before the segment can index either map.
 */
export function isMediaRouteKind(value: string): value is MediaRouteKind {
  // `Object.keys` rather than `value in …`: `in` walks the prototype chain,
  // so `isMediaRouteKind('toString')` would answer true.
  return (Object.keys(ROUTE_KIND_TO_TYPE) as string[]).includes(value)
}
