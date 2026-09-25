import type { ActivityQuery, DownloadJob } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'

/**
 * `/activity`'s filter state, and the single definition of how it is spelled in
 * the address bar.
 *
 * One facet, because `ActivityQuerySchema` has one — `cursor`, `limit` and
 * `type`, of which only `type` is a filter. There is deliberately no requester
 * filter here even though `/gallery` has one: the activity feed is the
 * cross-user, in-progress-only view (`JobQueryService.listActivity` takes no
 * `requesterEmail` at all), and a requester parameter the backend ignores would
 * be a control that silently does nothing.
 *
 * The filter lives in the URL rather than in component state for the same
 * reasons it does on `/gallery`: a filtered feed is a link, and the back button
 * steps through filter changes. The page is a server component that reads
 * `searchParams`; the client island's only job is to push a new query string.
 */
export type ActivityFilters = {
  /** Media types to include. Empty means "no type filter", never "none". */
  types: DownloadType[]
}

/** No filter at all — what `/activity` with a bare path means. */
export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = { types: [] }

/**
 * The canonical order every `type` list is normalized into, matching the tab
 * strip's left-to-right order and `/gallery`'s.
 *
 * Normalizing is what makes the URL a *function* of the filter state:
 * `?type=show,video` and `?type=video,show` are one filter, and without this
 * they would be two strings, two router entries and two remount keys for one
 * view.
 */
export const ACTIVITY_TYPE_ORDER: readonly DownloadType[] = [
  DownloadType.Video,
  DownloadType.Movie,
  DownloadType.Show,
]

/** Plural, because each names a set of things rather than one thing. */
export const ACTIVITY_TYPE_LABELS: Record<DownloadType, string> = {
  [DownloadType.Video]: 'Videos',
  [DownloadType.Movie]: 'Movies',
  [DownloadType.Show]: 'Shows',
}

/** The tab standing for "every type" — deliberately not a `DownloadType`. */
export const ACTIVITY_ALL_TYPES_TAB = 'all'

/**
 * What `Tabs` is given when the URL asks for two of the three types, which no
 * single tab can represent. Empty rather than a made-up value, so no tab
 * reports `aria-selected` — which is the truth.
 */
export const ACTIVITY_MIXED_TYPES_TAB = ''

/** Next.js hands a page's `searchParams` in this shape. */
export type ActivitySearchParams = Record<string, string | string[] | undefined>

/**
 * Every value supplied for `key`, whether it arrived as one occurrence, several
 * occurrences, or one comma-separated occurrence — mirroring `csvRaw` in
 * `packages/utils/src/download/schema.ts`, which is what the backend's
 * `csvEnum()` runs on the other end.
 */
function readAll(
  params: ActivitySearchParams | URLSearchParams,
  key: string,
): string[] {
  const raw =
    params instanceof URLSearchParams ? params.getAll(key) : params[key]

  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]

  return values
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
}

function isDownloadType(value: string): value is DownloadType {
  return (ACTIVITY_TYPE_ORDER as readonly string[]).includes(value)
}

/**
 * Reads the filter out of a URL. Total: anything unrecognized is dropped rather
 * than rejected, so the worst a mangled link can do is show an unfiltered feed.
 */
export function parseActivityFilters(
  params: ActivitySearchParams | URLSearchParams,
): ActivityFilters {
  const requested = new Set(readAll(params, 'type').filter(isDownloadType))

  return { types: ACTIVITY_TYPE_ORDER.filter(type => requested.has(type)) }
}

/**
 * The filter as a query string with no leading `?` — the form the pagination
 * action wants, and the identity the feed is keyed by.
 *
 * `parse(serialize(f))` is `f` for every reachable `f`, which is what makes the
 * URL safe to treat as the state.
 */
export function activityFiltersToSearch(filters: ActivityFilters): string {
  const params = new URLSearchParams()

  if (filters.types.length > 0) {
    params.set('type', filters.types.join(','))
  }

  return params.toString()
}

/** `/activity`, or `/activity?type=movie`. */
export function activityHref(filters: ActivityFilters): string {
  const search = activityFiltersToSearch(filters)

  return search ? `/activity?${search}` : '/activity'
}

/** Crosses from the URL's form to the backend client's. */
export function activityFiltersToQuery(
  filters: ActivityFilters,
  cursor?: string,
): Partial<ActivityQuery> {
  return {
    cursor,
    type: filters.types.length > 0 ? filters.types : undefined,
  }
}

/** Whether anything is filtered — the "nothing running" / "none of these" split. */
export function hasActivityFilters(filters: ActivityFilters): boolean {
  return filters.types.length > 0
}

/**
 * Which tab the current filter selects.
 *
 * A two-type selection is reachable from a shared link and no single tab can
 * report it, so none of them is selected — see {@link ACTIVITY_MIXED_TYPES_TAB}.
 */
export function activityTabValue(filters: ActivityFilters): string {
  if (filters.types.length === 0) {
    return ACTIVITY_ALL_TYPES_TAB
  }

  return filters.types.length === 1
    ? (filters.types[0] ?? ACTIVITY_ALL_TYPES_TAB)
    : ACTIVITY_MIXED_TYPES_TAB
}

/**
 * The filter a tab selects. `null` for the "All" tab, which is not a
 * `DownloadType` and must not be cast into one — that cast would be the only
 * thing between a typo and a filter nobody can clear.
 */
export function activityFiltersForTab(value: string): ActivityFilters {
  return { types: isDownloadType(value) ? [value] : [] }
}

/**
 * What {@link loadActivityPage} answers with.
 *
 * Declared here rather than beside the action because a `'use server'` module
 * may export nothing but async functions — an `export type` in one is a build
 * error, not a style choice.
 */
export type LoadActivityPageResult =
  | { items: DownloadJob[]; nextCursor: string | null; total: number }
  | { error: string }
