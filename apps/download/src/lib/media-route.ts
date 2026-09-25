import { DownloadType, type Media } from '@lilnas/utils/download/types'

import { mediaIdSuffix } from 'src/db/media-id'

/**
 * The first path segment of a media detail route - one per
 * {@link DownloadType}, and the thing that tells the router which of the
 * three detail layouts to render.
 *
 * Routes are `/movies/<tmdbId>`, `/shows/<tvdbId>`, `/videos/<videoId>`: the
 * `tmdb:`/`tvdb:`/`video:` prefix a `mediaId()` key carries is *dropped* on
 * the way out and reattached server-side on the way in. A colon in a path
 * segment would otherwise have to be percent-encoded in every `<Link>`, and
 * the encoded form leaks into the address bar.
 */
export type MediaRouteKind = 'movies' | 'shows' | 'videos'

/**
 * The single source of truth for the `DownloadType` <-> route-segment
 * mapping, in the one direction; {@link ROUTE_KIND_TO_TYPE} inverts it. A
 * `Record<DownloadType, …>` rather than a `switch`, so adding a fourth
 * `DownloadType` is a compile error here instead of a 404 at runtime.
 */
const TYPE_TO_ROUTE_KIND: Record<DownloadType, MediaRouteKind> = {
  [DownloadType.Movie]: 'movies',
  [DownloadType.Show]: 'shows',
  [DownloadType.Video]: 'videos',
}

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
 * The detail-page href for a piece of media - `tmdb:438631` becomes
 * `/movies/438631`.
 *
 * Derived from `media.type` (the union discriminant, which is always
 * trustworthy) plus `mediaIdSuffix(media.id)` (the documented inverse of
 * `mediaId()`), so there is no second place that knows how a key is spelled.
 */
export function mediaHref(media: Media): string {
  const kind = TYPE_TO_ROUTE_KIND[media.type]
  return `/${kind}/${encodeURIComponent(mediaIdSuffix(media.id))}`
}

/**
 * The inverse of {@link mediaHref}: reattaches the prefix a route segment
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

/** The route kind a {@link DownloadType} maps to. Total, so it cannot fail. */
export function routeKindFromType(type: DownloadType): MediaRouteKind {
  return TYPE_TO_ROUTE_KIND[type]
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
