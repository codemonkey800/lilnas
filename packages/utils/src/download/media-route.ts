import { mediaIdSuffix } from './media-id'
import { DownloadType, type Media } from './types'

/**
 * The download app's page for jobs in flight. Shared so a client linking
 * into the app (the Discord bot) names the same path the app routes.
 */
export const ACTIVITY_HREF = '/activity'

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
 * The single source of truth for the `DownloadType` -> route-segment
 * mapping. A `Record<DownloadType, …>` rather than a `switch`, so adding a
 * fourth `DownloadType` is a compile error here instead of a 404 at runtime.
 */
const TYPE_TO_ROUTE_KIND: Record<DownloadType, MediaRouteKind> = {
  [DownloadType.Movie]: 'movies',
  [DownloadType.Show]: 'shows',
  [DownloadType.Video]: 'videos',
}

/** The route kind a {@link DownloadType} maps to. Total, so it cannot fail. */
export function routeKindFromType(type: DownloadType): MediaRouteKind {
  return TYPE_TO_ROUTE_KIND[type]
}

/**
 * The detail-page href for a piece of media - `tmdb:438631` becomes
 * `/movies/438631`.
 *
 * Derived from `media.type` (the union discriminant, which is always
 * trustworthy) plus `mediaIdSuffix(media.id)` (the documented inverse of
 * `mediaId()`), so there is no second place that knows how a key is spelled.
 */
export function mediaHref(media: Pick<Media, 'id' | 'type'>): string {
  const kind = TYPE_TO_ROUTE_KIND[media.type]
  return `/${kind}/${encodeURIComponent(mediaIdSuffix(media.id))}`
}
