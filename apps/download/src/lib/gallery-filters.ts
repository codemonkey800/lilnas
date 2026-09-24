import type { GalleryItem, GalleryQuery } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'

/**
 * The gallery's filter state, and the single definition of how it is spelled
 * in the address bar.
 *
 * Every filter lives in the URL rather than in component state, so a filtered
 * view is a link you can send someone and the browser's back button steps
 * through filter changes the way a user already expects it to. The page is a
 * server component that reads `searchParams`; the client island's only job is
 * to push a new query string at the router.
 *
 * The shape is deliberately *not* `GalleryQuery`. `GalleryQuery` is the
 * backend's parsed form — `from`/`to` are already `Date`s there — while this is
 * the URL's form, where a date is the `YYYY-MM-DD` string the user sees and the
 * `<input type="date">` speaks. {@link galleryFiltersToQuery} is the one
 * crossing between them.
 */
export type GalleryFilters = {
  /** Media types to include. Empty means "no type filter", never "none". */
  types: DownloadType[]
  /**
   * One uploader's email, or `null`.
   *
   * ⚠️ Single-valued, and not by choice: `GalleryQuerySchema.requester` is
   * `z.string()` and `JobQueryService` takes a scalar `requesterEmail`, so the
   * backend has no multi-uploader query. Sending `?requester=a&requester=b`
   * makes the schema reject the request outright, and sending `a,b` matches an
   * uploader literally named `a,b`. Selecting a second uploader therefore
   * replaces the first.
   */
  requester: string | null
  /** Inclusive lower bound on `addedAt`, as `YYYY-MM-DD`. */
  from: string | null
  /** Inclusive upper bound on `addedAt`, as `YYYY-MM-DD`. */
  to: string | null
}

/**
 * What the gallery says when the date range is inverted.
 *
 * The backend's own wording is "`from` must not be after `to`" — accurate, and
 * written for whoever is reading a 400 body. The two controls on screen are
 * labelled "Start date" and "End date", so this says that instead.
 *
 * Lives in this module rather than beside the fetch that catches the 400
 * because both ends need it and only this one is importable from a client
 * component: `src/lib/gallery-data.ts` reaches `next/headers` through
 * `getIdentifiedDownloadClient`. Sharing the string is what keeps the message
 * the filter panel shows the instant a range is typed identical to the one it
 * shows once the server has rejected it — a message that rewords itself
 * mid-round-trip reads as two different complaints.
 */
export const INVALID_RANGE_MESSAGE =
  'The start date must not be after the end date.'

/** No filters at all — what `/gallery` with a bare path means. */
export const EMPTY_GALLERY_FILTERS: GalleryFilters = {
  types: [],
  requester: null,
  from: null,
  to: null,
}

/**
 * The canonical order every `type` list is normalized into, matching the tab
 * strip's left-to-right order.
 *
 * Normalizing the order is what makes the URL a *function* of the filter state:
 * `?type=show,video` and `?type=video,show` are the same filter, and without
 * this they would be two different strings, two different router entries and
 * two different cache keys for one view.
 */
export const GALLERY_TYPE_ORDER: readonly DownloadType[] = [
  DownloadType.Video,
  DownloadType.Movie,
  DownloadType.Show,
]

/** Plural, because each one names a set of things rather than one thing. */
export const GALLERY_TYPE_LABELS: Record<DownloadType, string> = {
  [DownloadType.Video]: 'Videos',
  [DownloadType.Movie]: 'Movies',
  [DownloadType.Show]: 'Shows',
}

/** The tab value standing for "every type" — deliberately not a `DownloadType`. */
export const GALLERY_ALL_TYPES_TAB = 'all'

/**
 * What `Tabs` is given when the current selection is two of the three types,
 * which no single tab can represent.
 *
 * Empty rather than a made-up value so that no tab reports `aria-selected`,
 * which is the truth: none of them is what is showing.
 */
export const GALLERY_MIXED_TYPES_TAB = ''

/** Next.js hands a page's `searchParams` in this shape. */
export type GallerySearchParams = Record<string, string | string[] | undefined>

/**
 * Every value supplied for `key`, whether it arrived as one occurrence, several
 * occurrences, or one comma-separated occurrence.
 *
 * Mirrors `csvRaw` in `packages/utils/src/download/schema.ts`, which is what
 * the backend's `csvEnum()` runs on the other end — `?type=movie,show` and
 * `?type=movie&type=show` have to mean the same thing on both sides of the
 * request or a link that works in the address bar would stop working after a
 * round trip through the router.
 */
function readAll(
  params: GallerySearchParams | URLSearchParams,
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

function readOne(
  params: GallerySearchParams | URLSearchParams,
  key: string,
): string | null {
  return readAll(params, key)[0] ?? null
}

function isDownloadType(value: string): value is DownloadType {
  return (GALLERY_TYPE_ORDER as readonly string[]).includes(value)
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * A `YYYY-MM-DD` that names a day that exists, or `null`.
 *
 * `2026-02-31` matches the pattern and is not a date, and `new Date()` would
 * quietly roll it forward to March 3rd. An unparseable bound is dropped rather
 * than passed on: the alternative is a 400 from the backend for a URL the user
 * never typed, e.g. one truncated by a chat client.
 */
function parseDateOnly(value: string | null): string | null {
  if (!value || !DATE_ONLY_PATTERN.test(value)) {
    return null
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)

  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString().slice(0, 10) === value ? value : null
}

/**
 * Reads the filter state out of a URL.
 *
 * Total: anything unrecognized is dropped rather than rejected, so the worst a
 * mangled link can do is show an unfiltered gallery. The one thing this does
 * *not* validate is whether `from` precedes `to` — an inverted range is a real
 * 400 from the API and is surfaced as a validation message on the filter panel,
 * which it cannot be if it never reaches the request.
 */
export function parseGalleryFilters(
  params: GallerySearchParams | URLSearchParams,
): GalleryFilters {
  const requested = new Set(readAll(params, 'type').filter(isDownloadType))

  return {
    types: GALLERY_TYPE_ORDER.filter(type => requested.has(type)),
    requester: readOne(params, 'requester'),
    from: parseDateOnly(readOne(params, 'from')),
    to: parseDateOnly(readOne(params, 'to')),
  }
}

/**
 * The inverse of {@link parseGalleryFilters}: `parse(serialize(f))` is `f` for
 * every reachable `f`, which is what makes the URL safe to treat as the state.
 *
 * `type` is written as one comma-separated parameter rather than repeated,
 * because that is the form the mockups' links use and it keeps a three-type
 * filter to a single short parameter. The backend normalizes both.
 */
export function galleryFiltersToSearchParams(
  filters: GalleryFilters,
): URLSearchParams {
  const params = new URLSearchParams()

  if (filters.types.length > 0) {
    params.set('type', filters.types.join(','))
  }

  if (filters.requester) {
    params.set('requester', filters.requester)
  }

  if (filters.from) {
    params.set('from', filters.from)
  }

  if (filters.to) {
    params.set('to', filters.to)
  }

  return params
}

/**
 * The filters as a query string with no leading `?` — the form the router and
 * the pagination action both want, and the identity this view is keyed by.
 */
export function galleryFiltersToSearch(filters: GalleryFilters): string {
  return galleryFiltersToSearchParams(filters).toString()
}

/** `/gallery`, or `/gallery?type=movie`. */
export function galleryHref(filters: GalleryFilters): string {
  const search = galleryFiltersToSearch(filters)

  return search ? `/gallery?${search}` : '/gallery'
}

/**
 * Crosses from the URL's form to the backend client's.
 *
 * The bounds become UTC-midnight `Date`s because `DownloadClient`'s
 * `toQueryString` serializes a `Date` with `toISOString().slice(0, 10)`, which
 * is exactly the `YYYY-MM-DD` that went in — constructing them at local
 * midnight instead would shift the date by a day for anyone west of UTC.
 */
export function galleryFiltersToQuery(
  filters: GalleryFilters,
  cursor?: string,
): Partial<GalleryQuery> {
  return {
    type: filters.types.length > 0 ? filters.types : undefined,
    requester: filters.requester ?? undefined,
    from: filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : undefined,
    to: filters.to ? new Date(`${filters.to}T00:00:00.000Z`) : undefined,
    cursor,
  }
}

/** Whether anything is filtered at all — the empty library / no matches split. */
export function hasGalleryFilters(filters: GalleryFilters): boolean {
  return (
    filters.types.length > 0 ||
    filters.requester !== null ||
    filters.from !== null ||
    filters.to !== null
  )
}

/**
 * How many *facets* are narrowed, which is what the Filters badge counts — not
 * how many values are selected. Picking two types is still one thing you did to
 * the gallery, and the date range is one filter with two ends.
 */
export function countGalleryFilters(filters: GalleryFilters): number {
  return (
    (filters.types.length > 0 ? 1 : 0) +
    (filters.requester ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0)
  )
}

/**
 * Whether the range is the one thing the API answers 400 for.
 *
 * Both bounds are `YYYY-MM-DD`, which sorts lexicographically the same way it
 * sorts chronologically, so this needs no `Date`. Used to mark the date inputs
 * invalid the moment they are typed; the message itself is still driven by the
 * backend's actual rejection, so the two can't disagree about what is legal.
 */
export function isInvertedGalleryRange(filters: GalleryFilters): boolean {
  return Boolean(filters.from && filters.to && filters.from > filters.to)
}

/** En dash, the way the mockups write a range (`2019–2024`). */
const RANGE_DASH = '–'

/**
 * The date range as one readable value: `2026-01-01 – 2026-03-01`, or an
 * open-ended `From 2026-01-01` / `Until 2026-03-01`.
 */
export function formatGalleryRangeLabel(
  from: string | null,
  to: string | null,
): string {
  if (from && to) {
    return `${from} ${RANGE_DASH} ${to}`
  }

  if (from) {
    return `From ${from}`
  }

  return to ? `Until ${to}` : ''
}

/**
 * One applied-filter chip: what it says, what its remove button is called, and
 * the filter state that removing it produces.
 *
 * Carrying `next` rather than a discriminated "kind" keeps the removal logic in
 * one testable place — the chip row just pushes whatever it is handed.
 */
export type GalleryFilterChip = {
  /** Stable React key. */
  key: string
  /** The chip's visible value. */
  label: string
  /**
   * The remove button's whole accessible name. Names the *value* rather than
   * the facet, because a gallery can show three type chips at once and
   * "Remove media type filter" three times over tells a screen-reader user
   * nothing about which one they are on.
   */
  removeLabel: string
  /** The filters that remain once this chip is removed. */
  next: GalleryFilters
}

/**
 * The applied-filter chips, in the order the panel lists their facets.
 *
 * The whole date range is one chip with one remove button: the two bounds are
 * one decision ("March"), and splitting them would let a user leave behind
 * half a range they did not mean to keep.
 */
export function galleryFilterChips(
  filters: GalleryFilters,
): GalleryFilterChip[] {
  const chips: GalleryFilterChip[] = []

  for (const type of filters.types) {
    const label = GALLERY_TYPE_LABELS[type]

    chips.push({
      key: `type:${type}`,
      label,
      removeLabel: `Remove ${label} filter`,
      next: {
        ...filters,
        types: filters.types.filter(other => other !== type),
      },
    })
  }

  if (filters.requester) {
    chips.push({
      key: 'requester',
      label: filters.requester,
      removeLabel: `Remove uploader filter ${filters.requester}`,
      next: { ...filters, requester: null },
    })
  }

  if (filters.from || filters.to) {
    chips.push({
      key: 'range',
      label: formatGalleryRangeLabel(filters.from, filters.to),
      removeLabel: 'Remove date added filter',
      next: { ...filters, from: null, to: null },
    })
  }

  return chips
}

/**
 * What {@link loadGalleryPage} answers with.
 *
 * Declared here rather than beside the action because a `'use server'` module
 * may export nothing but async functions — a `export type` in one is a build
 * error, not a style choice.
 */
export type LoadGalleryPageResult =
  | { items: GalleryItem[]; nextCursor: string | null; total: number }
  | { error: string }
