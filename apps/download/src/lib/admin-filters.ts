import type {
  AdminStatsQuery,
  DownloadJob,
  HistoryQuery,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

/**
 * `/admin`'s filter state, and the single definition of how it is spelled in
 * the address bar.
 *
 * Three facets plus the stats window, mirroring `HistoryQuerySchema`
 * (`cursor`/`limit`/`requester`/`status`/`type`, of which three are filters)
 * and `AdminStatsQuerySchema` (`days`).
 *
 * ⚠️ `requester` is the whole of "per-user history". Spec §12 puts one user's
 * downloads on this page as a *filter*, not on a route of their own, which is
 * why there is no `/admin/users/:email` anywhere — the leaderboard and every
 * requester cell in the table link back here with `?requester=` set.
 *
 * The filter lives in the URL rather than in component state for the same
 * reasons it does on `/gallery` and `/activity`: a filtered view is a link, and
 * the back button steps through filter changes. The page is a server component
 * that reads `searchParams`; the client islands' only job is to push a new
 * query string.
 *
 * No `'use client'` and no server-only import, deliberately: both halves of the
 * page import this module.
 */
export type AdminFilters = {
  /**
   * The stats window in whole days, or `null` for the backend's own default.
   *
   * ⚠️ This is what was *asked for*. Nothing on the page may render it — the
   * window that was actually applied comes back as `AdminStatsResponse.
   * windowDays` and is the only figure the tiles are allowed to quote. See
   * {@link ADMIN_STATS_MIN_DAYS}.
   */
  days: number | null
  /** One requester's email, or `null` for every requester. */
  requester: string | null
  /** Job statuses to include. Empty means "every status", never "none". */
  statuses: DownloadJobStatus[]
  /** Media types to include. Empty means "no type filter", never "none". */
  types: DownloadType[]
}

/** No filter at all — what `/admin` with a bare path means. */
export const EMPTY_ADMIN_FILTERS: AdminFilters = {
  days: null,
  requester: null,
  statuses: [],
  types: [],
}

/**
 * The bounds `AdminStatsQuerySchema` enforces. A `days` outside them is a 400
 * from the backend, not a clamp, so {@link parseAdminFilters} drops an
 * out-of-range value and lets the server apply its own default rather than
 * turning a hand-edited URL into an error page.
 */
export const ADMIN_STATS_MIN_DAYS = 1
export const ADMIN_STATS_MAX_DAYS = 365

/**
 * The canonical order every `type` list is normalized into, matching
 * `/gallery`'s and `/activity`'s.
 *
 * Normalizing is what makes the URL a *function* of the filter state:
 * `?type=show,video` and `?type=video,show` are one filter, and without this
 * they would be two strings, two router entries and two remount keys.
 */
export const ADMIN_TYPE_ORDER: readonly DownloadType[] = [
  DownloadType.Video,
  DownloadType.Movie,
  DownloadType.Show,
]

/** Plural, because each names a set of things rather than one thing. */
export const ADMIN_TYPE_LABELS: Record<DownloadType, string> = {
  [DownloadType.Video]: 'Videos',
  [DownloadType.Movie]: 'Movies',
  [DownloadType.Show]: 'Shows',
}

/**
 * Every job status, in the enum's own declaration order.
 *
 * Derived from the enum rather than written out, which is the same invariant
 * `TERMINAL_DOWNLOAD_JOB_STATUSES` states for itself: a status added upstream
 * becomes filterable here with no edit, instead of silently dropping out of
 * every `?status=` link.
 */
export const ADMIN_STATUS_ORDER: readonly DownloadJobStatus[] =
  Object.values(DownloadJobStatus)

/** Next.js hands a page's `searchParams` in this shape. */
export type AdminSearchParams = Record<string, string | string[] | undefined>

/**
 * Every value supplied for `key`, whether it arrived as one occurrence, several
 * occurrences, or one comma-separated occurrence — mirroring `csvRaw` in
 * `packages/utils/src/download/schema.ts`, which is what the backend's
 * `csvEnum()` runs on the other end.
 */
function readAll(
  params: AdminSearchParams | URLSearchParams,
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
  params: AdminSearchParams | URLSearchParams,
  key: string,
): string | null {
  return readAll(params, key)[0] ?? null
}

function isDownloadType(value: string): value is DownloadType {
  return (ADMIN_TYPE_ORDER as readonly string[]).includes(value)
}

function isDownloadJobStatus(value: string): value is DownloadJobStatus {
  return (ADMIN_STATUS_ORDER as readonly string[]).includes(value)
}

/**
 * A whole number of days inside the schema's bounds, or `null`.
 *
 * `Number.parseInt` is deliberately not used: it accepts `'30abc'` and
 * `'30.9'`, and a URL that means one window while displaying another is the
 * exact confusion `windowDays` exists to prevent.
 */
function parseDays(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null
  }

  const days = Number(value)

  return days >= ADMIN_STATS_MIN_DAYS && days <= ADMIN_STATS_MAX_DAYS
    ? days
    : null
}

/**
 * Reads the filter out of a URL. Total: anything unrecognized is dropped rather
 * than rejected, so the worst a mangled link can do is show an unfiltered
 * dashboard.
 */
export function parseAdminFilters(
  params: AdminSearchParams | URLSearchParams,
): AdminFilters {
  const requestedTypes = new Set(readAll(params, 'type').filter(isDownloadType))
  const requestedStatuses = new Set(
    readAll(params, 'status').filter(isDownloadJobStatus),
  )

  return {
    days: parseDays(readOne(params, 'days')),
    requester: readOne(params, 'requester'),
    statuses: ADMIN_STATUS_ORDER.filter(status =>
      requestedStatuses.has(status),
    ),
    types: ADMIN_TYPE_ORDER.filter(type => requestedTypes.has(type)),
  }
}

/**
 * The inverse of {@link parseAdminFilters}: `parse(serialize(f))` is `f` for
 * every reachable `f`, which is what makes the URL safe to treat as the state.
 *
 * `type` and `status` are written as one comma-separated parameter each rather
 * than repeated, matching `/gallery`'s spelling. The backend normalizes both
 * forms, so the choice is only about which one this app emits.
 */
export function adminFiltersToSearchParams(
  filters: AdminFilters,
): URLSearchParams {
  const params = new URLSearchParams()

  if (filters.requester) {
    params.set('requester', filters.requester)
  }

  if (filters.types.length > 0) {
    params.set('type', filters.types.join(','))
  }

  if (filters.statuses.length > 0) {
    params.set('status', filters.statuses.join(','))
  }

  if (filters.days !== null) {
    params.set('days', String(filters.days))
  }

  return params
}

/**
 * The filter as a query string with no leading `?` — the form the pagination
 * action wants, and the identity the history island is keyed by.
 */
export function adminFiltersToSearch(filters: AdminFilters): string {
  return adminFiltersToSearchParams(filters).toString()
}

/** `/admin`, or `/admin?requester=sam@lilnas.io`. */
export function adminHref(filters: AdminFilters): string {
  const search = adminFiltersToSearch(filters)

  return search ? `/admin?${search}` : '/admin'
}

/** Crosses from the URL's form to `DownloadClient.getHistory`'s. */
export function adminFiltersToHistoryQuery(
  filters: AdminFilters,
  cursor?: string,
): Partial<HistoryQuery> {
  return {
    cursor,
    requester: filters.requester ?? undefined,
    status: filters.statuses.length > 0 ? filters.statuses : undefined,
    type: filters.types.length > 0 ? filters.types : undefined,
  }
}

/**
 * Crosses from the URL's form to `DownloadClient.getStats`'s.
 *
 * `days` is omitted rather than defaulted locally when the URL asks for
 * nothing: the default belongs to `AdminStatsQuerySchema`, and echoing a
 * locally-invented 30 back as the applied window would be exactly the lie
 * `windowDays` exists to prevent.
 */
export function adminFiltersToStatsQuery(
  filters: AdminFilters,
): Partial<AdminStatsQuery> {
  return { days: filters.days ?? undefined }
}

/** Whether anything narrows the history — the empty-log / no-matches split. */
export function hasAdminFilters(filters: AdminFilters): boolean {
  return (
    filters.requester !== null ||
    filters.statuses.length > 0 ||
    filters.types.length > 0
  )
}

/**
 * One applied-filter chip: what it says, what its remove button is called, and
 * the filter state that removing it produces.
 *
 * Carrying `next` rather than a discriminated "kind" keeps the removal logic in
 * one testable place — the chip row just pushes whatever it is handed. Same
 * shape as `GalleryFilterChip`, and deliberately not shared with it: the two
 * carry different filter types and a generic over both would be a type
 * parameter in exchange for nothing.
 */
export type AdminFilterChip = {
  /** Stable React key. */
  key: string
  /** The chip's visible value. */
  label: string
  /**
   * The remove button's whole accessible name. Names the *value* rather than
   * the facet, because the row can hold three status chips at once and
   * "Remove status filter" three times over says nothing about which one.
   */
  removeLabel: string
  /** The filters that remain once this chip is removed. */
  next: AdminFilters
}

/**
 * The applied-filter chips, requester first because it is the one facet the
 * page offers a control for (every requester cell and every leaderboard row
 * sets it).
 *
 * ⚠️ `days` gets no chip. It describes the stat tiles rather than the table the
 * chips sit above, and the tile already prints the window it is describing —
 * from the response, not from here.
 */
export function adminFilterChips(filters: AdminFilters): AdminFilterChip[] {
  const chips: AdminFilterChip[] = []

  if (filters.requester) {
    chips.push({
      key: 'requester',
      label: filters.requester,
      removeLabel: `Remove requester filter ${filters.requester}`,
      next: { ...filters, requester: null },
    })
  }

  for (const type of filters.types) {
    const label = ADMIN_TYPE_LABELS[type]

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

  for (const status of filters.statuses) {
    chips.push({
      key: `status:${status}`,
      label: status,
      removeLabel: `Remove ${status} filter`,
      next: {
        ...filters,
        statuses: filters.statuses.filter(other => other !== status),
      },
    })
  }

  return chips
}

/**
 * What a non-admin — or a viewer whose identity never resolved — is told by
 * {@link loadAdminHistoryPage}, in place of rows.
 *
 * Declared here for the same reason the result type below is: a `'use server'`
 * module may export nothing but async functions, so a `const` in one is a
 * build error rather than a style choice. (And a silent one at test time: the
 * page spec mocks that module, so only the dev server catches it.)
 */
export const ADMIN_HISTORY_FORBIDDEN =
  'You do not have access to the download history'

/**
 * What {@link loadAdminHistoryPage} answers with.
 *
 * Declared here rather than beside the action because a `'use server'` module
 * may export nothing but async functions — an `export type` in one is a build
 * error, not a style choice.
 */
export type LoadAdminHistoryResult =
  | { items: DownloadJob[]; nextCursor: string | null; total: number }
  | { error: string }
