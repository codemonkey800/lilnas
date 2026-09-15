import type { DiscoverQuery } from '@lilnas/utils/download/types'

import { SEARCH_MIN_LENGTH } from 'src/lib/url-classify'

/**
 * ⚠️ The page's own query parameter is `q`; the API's is `query`.
 *
 * They are deliberately different names for the same string. `q` is what
 * `NavSearch` pushes at `/search` and what a user sees in the address bar;
 * `query` is what `DiscoverQuerySchema` in `packages/utils/src/download/schema.ts`
 * requires, with a `min(2)` that rejects anything shorter. {@link toDiscoverQuery}
 * is the single place the two are bridged — nothing else in this feature should
 * spell either name.
 */
export const SEARCH_PARAM_QUERY = 'q'
export const SEARCH_PARAM_GENRE = 'genre'
export const SEARCH_PARAM_YEAR_FROM = 'yearFrom'
export const SEARCH_PARAM_YEAR_TO = 'yearTo'
export const SEARCH_PARAM_SORT = 'sort'
export const SEARCH_PARAM_VIEW = 'view'

/**
 * The API's `sort` enum, verbatim. The table's column headers map onto these
 * three values rather than sorting the rows they can see: the result set is
 * cursor-paginated, so a client-side sort would only ever order the page in
 * front of you and would silently disagree with the next page.
 */
export const SEARCH_SORTS = ['relevance', 'title', 'releaseDate'] as const

export type SearchSort = (typeof SEARCH_SORTS)[number]

export const DEFAULT_SEARCH_SORT: SearchSort = 'relevance'

/**
 * `search.mjs` lists four sort options (`Relevance`, `Title A–Z`,
 * `Newest release`, `Oldest release`). The API offers three — there is no
 * ascending release order — so the mockup's fourth entry is dropped rather
 * than shipped as a control that cannot be honoured.
 */
export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Relevance',
  releaseDate: 'Newest release',
  title: 'Title A–Z',
}

/**
 * Which way each ordering runs, for the table header's chevron and the
 * `aria-sort` on its column. Read off `sortDiscoveryResults()` in
 * `apps/download/src/media/discovery-ranking.ts`: `title` is
 * `localeCompare` ascending, `releaseDate` is newest-first descending.
 *
 * `relevance` is absent on purpose — it is a positional interleave of Radarr's
 * and Sonarr's own rankings, not a comparison over any column, so no column
 * can claim it.
 */
export const SEARCH_SORT_DIRECTIONS: Record<
  Exclude<SearchSort, 'relevance'>,
  'ascending' | 'descending'
> = {
  releaseDate: 'descending',
  title: 'ascending',
}

export const SEARCH_VIEWS = ['grid', 'list'] as const

export type SearchView = (typeof SEARCH_VIEWS)[number]

export const DEFAULT_SEARCH_VIEW: SearchView = 'grid'

/** `LimitSchema`'s own default, restated so `LoadMore`'s pages are predictable. */
export const SEARCH_PAGE_SIZE = 24

/** En dash, U+2013 — the range separator `search.pug` draws between the year fields. */
export const YEAR_RANGE_SEPARATOR = '–'

/** `search.pug:107`, verbatim. */
export const YEAR_RANGE_ERROR = 'Start year must be before end year'

/** Everything `/search` reads out of its own URL. */
export interface SearchState {
  genres: string[]
  query: string
  sort: SearchSort
  view: SearchView
  yearFrom: number | null
  yearTo: number | null
}

/**
 * The read half of `URLSearchParams`, which is also all `ReadonlyURLSearchParams`
 * (what `useSearchParams()` hands back) exposes. Typing against it lets the
 * server page and the client components share one parser.
 */
export interface ReadableSearchParams {
  get(name: string): string | null
  getAll(name: string): string[]
}

function isSearchSort(value: string): value is SearchSort {
  return (SEARCH_SORTS as readonly string[]).includes(value)
}

function isSearchView(value: string): value is SearchView {
  return (SEARCH_VIEWS as readonly string[]).includes(value)
}

/**
 * Exactly four digits. Deliberately not a numeric range check: a half-typed
 * `19` in the year field is not a year yet, and treating it as one would fire
 * a request for everything since the Bronze Age on the way to `1999`.
 */
export function parseYear(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}$/.test(value.trim())) {
    return null
  }

  return Number.parseInt(value.trim(), 10)
}

/**
 * Genres come back either as repeated keys (`?genre=Action&genre=Drama`, what
 * this page writes) or as one comma-joined value (`?genre=Action,Drama`, which
 * the API also accepts and which a hand-edited URL may well use). Both are
 * read, so a link either way behaves the same.
 */
function parseGenres(params: ReadableSearchParams): string[] {
  const seen = new Set<string>()

  for (const raw of params.getAll(SEARCH_PARAM_GENRE)) {
    for (const genre of raw.split(',')) {
      const trimmed = genre.trim()

      if (trimmed) {
        seen.add(trimmed)
      }
    }
  }

  return [...seen]
}

/**
 * The URL is the only source of truth for this page's query, filters, sort and
 * view. Anything unrecognised falls back to the default rather than throwing —
 * a URL is user input, and `?sort=banana` should show relevance-ordered
 * results, not an error page.
 */
export function parseSearchState(params: ReadableSearchParams): SearchState {
  const sort = params.get(SEARCH_PARAM_SORT)
  const view = params.get(SEARCH_PARAM_VIEW)

  return {
    genres: parseGenres(params),
    query: (params.get(SEARCH_PARAM_QUERY) ?? '').trim(),
    sort: sort && isSearchSort(sort) ? sort : DEFAULT_SEARCH_SORT,
    view: view && isSearchView(view) ? view : DEFAULT_SEARCH_VIEW,
    yearFrom: parseYear(params.get(SEARCH_PARAM_YEAR_FROM)),
    yearTo: parseYear(params.get(SEARCH_PARAM_YEAR_TO)),
  }
}

/**
 * Next hands a server page `searchParams` as a plain record; every client
 * component gets a `ReadonlyURLSearchParams`. This is the adapter, and it is
 * the reason nothing in this feature ever splits a query string by hand —
 * `?q=the%20office` and `?q=the+office` decode identically through
 * `URLSearchParams`, and only through it.
 */
export function toReadableSearchParams(
  record: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) {
      continue
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item)
    }
  }

  return params
}

/** Serialises state back into the page's own URL shape. Defaults are omitted. */
export function searchStateToParams(state: SearchState): URLSearchParams {
  const params = new URLSearchParams()

  if (state.query) {
    params.set(SEARCH_PARAM_QUERY, state.query)
  }

  for (const genre of state.genres) {
    params.append(SEARCH_PARAM_GENRE, genre)
  }

  if (state.yearFrom !== null) {
    params.set(SEARCH_PARAM_YEAR_FROM, String(state.yearFrom))
  }

  if (state.yearTo !== null) {
    params.set(SEARCH_PARAM_YEAR_TO, String(state.yearTo))
  }

  if (state.sort !== DEFAULT_SEARCH_SORT) {
    params.set(SEARCH_PARAM_SORT, state.sort)
  }

  if (state.view !== DEFAULT_SEARCH_VIEW) {
    params.set(SEARCH_PARAM_VIEW, state.view)
  }

  return params
}

/** `?q=star&sort=title`, or `''` when everything is at its default. */
export function searchStateToQueryString(state: SearchState): string {
  const encoded = searchStateToParams(state).toString()

  return encoded ? `?${encoded}` : ''
}

/**
 * Identity of the *result set* — everything the API is asked for, and nothing
 * else. `view` is excluded deliberately: flipping between the grid and the
 * table is a way of looking at rows you already have, so it must not discard
 * the pages `LoadMore` appended.
 *
 * The page hands this to `<SearchResults key={…}>`, which is how the merged
 * pages reset when the query or a filter changes: a remount, rather than an
 * effect that notices and calls `setState` — which `react-hooks/set-state-in-effect`
 * rejects outright, and which would paint one frame of the previous query's
 * rows against the new query's count before correcting itself.
 */
export function searchStateKey(state: SearchState): string {
  return searchStateToParams({ ...state, view: DEFAULT_SEARCH_VIEW }).toString()
}

/**
 * The 2-character threshold, shared with `DiscoverQuerySchema`'s
 * `query: z.string().min(2)`. Below it the API answers `400 too_small`, so the
 * page does not ask.
 */
export function isSearchableQuery(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_LENGTH
}

/**
 * The API refines `yearFrom <= yearTo` and 400s otherwise, so an inverted range
 * is checked before the call rather than discovered through an error boundary.
 * A range with only one end set is always valid.
 */
export function hasValidYearRange(state: SearchState): boolean {
  return (
    state.yearFrom === null ||
    state.yearTo === null ||
    state.yearFrom <= state.yearTo
  )
}

/** What the Filters button badges: each genre, plus the year range as one. */
export function appliedFilterCount(state: SearchState): number {
  const yearRange = state.yearFrom !== null || state.yearTo !== null ? 1 : 0

  return state.genres.length + yearRange
}

export function hasAppliedFilters(state: SearchState): boolean {
  return appliedFilterCount(state) > 0
}

/**
 * `1999–2012`, `1999–`, `–2012`. Terse on purpose: it sits in an
 * `AppliedFilterChip` whose remove button is separately named
 * "Remove release year filter", so the chip itself only has to carry the
 * numbers.
 */
export function formatYearRange(
  yearFrom: number | null,
  yearTo: number | null,
): string {
  return `${yearFrom ?? ''}${YEAR_RANGE_SEPARATOR}${yearTo ?? ''}`
}

/**
 * The bridge between this page's URL and the API's contract — `q` becomes
 * `query`, and the optional halves are dropped rather than sent as empty
 * strings.
 *
 * Callers must have checked {@link isSearchableQuery} first: `query` is
 * required and `min(2)`, so there is no such thing as a discover call without
 * one.
 */
export function toDiscoverQuery(
  state: SearchState,
  cursor?: string,
): DiscoverQuery {
  return {
    ...(cursor === undefined ? {} : { cursor }),
    ...(state.genres.length > 0 ? { genre: state.genres } : {}),
    ...(state.yearFrom === null ? {} : { yearFrom: state.yearFrom }),
    ...(state.yearTo === null ? {} : { yearTo: state.yearTo }),
    limit: SEARCH_PAGE_SIZE,
    query: state.query.trim(),
    sort: state.sort,
  }
}
