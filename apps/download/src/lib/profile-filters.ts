import type { DownloadJob, HistoryQuery } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

/**
 * `/profile`'s route — bare, meaning "whoever is asking".
 *
 * The one name for this path in the app. The shell's account link, the
 * activity feed's own-identity href and `profileHref`'s unfiltered case all
 * read it from here; there is deliberately no second spelling of `'/profile'`
 * to keep in step with this one.
 *
 * It lives in this module rather than beside `AccountLink` because the module
 * carries no `'use client'` and imports nothing that does, so a server
 * component and a client island can both reach it.
 */
export const PROFILE_HREF = '/profile'

/**
 * `/profile`'s URL state: whose profile, and how the history below it is
 * scoped.
 *
 * `user` is *not* a filter in the sense the other two are — it names the
 * subject of the whole page, and only an admin may name anyone but
 * themselves (the backend enforces that; see `DownloadClient.getProfile`).
 * It lives in this object anyway because every chip click has to carry it
 * forward: dropping it would silently bounce an admin off the profile they
 * were reading and onto their own.
 *
 * Everything lives in the URL rather than in component state for the same
 * reasons it does on `/gallery` and `/activity`: a filtered profile is a link,
 * and the back button steps through filter changes. The page is a server
 * component that reads `searchParams`; the client island's only job is to push
 * a new query string.
 */
export type ProfileFilters = {
  /** Job statuses to include. Empty means "no status filter", never "none". */
  statuses: DownloadJobStatus[]
  /** Media types to include. Empty means "no type filter", never "none". */
  types: DownloadType[]
  /** Whose profile — `null` means "mine", which needs no admin rights. */
  user: string | null
}

/** Your own profile, unfiltered — what `/profile` with a bare path means. */
export const EMPTY_PROFILE_FILTERS: ProfileFilters = {
  statuses: [],
  types: [],
  user: null,
}

/**
 * The canonical order every `type` list is normalized into, matching
 * `/gallery`'s and `/activity`'s left-to-right order.
 *
 * Normalizing is what makes the URL a *function* of the filter state:
 * `?type=show,video` and `?type=video,show` are one filter, and without this
 * they would be two strings, two router entries and two remount keys for one
 * view.
 */
export const PROFILE_TYPE_ORDER: readonly DownloadType[] = [
  DownloadType.Video,
  DownloadType.Movie,
  DownloadType.Show,
]

/**
 * Where each status sits in a job's life, which is the order the chips read in
 * and the order `status` is normalized into.
 *
 * A `Record` rather than a hand-written array because a `Record` keyed by the
 * enum is exhaustive by construction: adding a `DownloadJobStatus` member is a
 * compile error here instead of a status that silently sorts first.
 *
 * ⚠️ Deliberately not `Object.values(DownloadJobStatus)`, which is declaration
 * order and that enum is declared *alphabetically* — `cancelled` would lead and
 * `completed` would sit between `cleaning` and `converting`, which is not how
 * anybody reads their own download history.
 */
const STATUS_RANK: Record<DownloadJobStatus, number> = {
  [DownloadJobStatus.Requested]: 0,
  [DownloadJobStatus.Pending]: 1,
  [DownloadJobStatus.Searching]: 2,
  [DownloadJobStatus.Downloading]: 3,
  [DownloadJobStatus.Converting]: 4,
  [DownloadJobStatus.Uploading]: 5,
  [DownloadJobStatus.Importing]: 6,
  [DownloadJobStatus.NeedsAttention]: 7,
  [DownloadJobStatus.Cleaning]: 8,
  [DownloadJobStatus.Pausing]: 9,
  [DownloadJobStatus.Paused]: 10,
  [DownloadJobStatus.Cancelling]: 11,
  [DownloadJobStatus.Completed]: 12,
  [DownloadJobStatus.Failed]: 13,
  [DownloadJobStatus.Cancelled]: 14,
}

/** Every status, in lifecycle order — see {@link STATUS_RANK}. */
export const PROFILE_STATUS_ORDER: readonly DownloadJobStatus[] = Object.values(
  DownloadJobStatus,
).sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])

/** Next.js hands a page's `searchParams` in this shape. */
export type ProfileSearchParams = Record<string, string | string[] | undefined>

type ParamSource = ProfileSearchParams | URLSearchParams

/**
 * Every value supplied for `key`, whether it arrived as one occurrence, several
 * occurrences, or one comma-separated occurrence — mirroring `csvRaw` in
 * `packages/utils/src/download/schema.ts`, which is what the backend's
 * `csvEnum()` runs on the other end.
 */
function readAll(params: ParamSource, key: string): string[] {
  const raw =
    params instanceof URLSearchParams ? params.getAll(key) : params[key]

  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]

  return values
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)
}

/**
 * The first occurrence of `key`, **without** splitting on commas.
 *
 * ⚠️ Deliberately not `/gallery`'s `readOne`, which reuses the comma-splitting
 * reader above. `user` is an email, not a set, and a local part may legally
 * contain a comma (RFC 5321 permits it inside a quoted string). Splitting one
 * would hand the backend a truncated address, and — worse for a page whose
 * whole state is its URL — would break the `parse(serialize(f)) === f`
 * round trip for exactly the addresses hardest to notice.
 */
function readRaw(params: ParamSource, key: string): string | null {
  const raw = params instanceof URLSearchParams ? params.get(key) : params[key]
  const value = Array.isArray(raw) ? raw[0] : raw

  if (value === undefined || value === null) {
    return null
  }

  const trimmed = value.trim()

  return trimmed === '' ? null : trimmed
}

function isDownloadType(value: string): value is DownloadType {
  return (PROFILE_TYPE_ORDER as readonly string[]).includes(value)
}

function isDownloadJobStatus(value: string): value is DownloadJobStatus {
  return (PROFILE_STATUS_ORDER as readonly string[]).includes(value)
}

/**
 * Reads the filter out of a URL. Total: anything unrecognized is dropped rather
 * than rejected, so the worst a mangled link can do is show an unfiltered
 * profile.
 */
export function parseProfileFilters(params: ParamSource): ProfileFilters {
  const types = new Set(readAll(params, 'type').filter(isDownloadType))
  const statuses = new Set(
    readAll(params, 'status').filter(isDownloadJobStatus),
  )

  return {
    statuses: PROFILE_STATUS_ORDER.filter(status => statuses.has(status)),
    types: PROFILE_TYPE_ORDER.filter(type => types.has(type)),
    user: readRaw(params, 'user'),
  }
}

/**
 * The filter as a query string with no leading `?` — the form the pagination
 * action wants, and the identity the history list is keyed by.
 *
 * `parse(serialize(f))` is `f` for every reachable `f`, which is what makes the
 * URL safe to treat as the state.
 */
export function profileFiltersToSearch(filters: ProfileFilters): string {
  const params = new URLSearchParams()

  if (filters.user !== null) {
    params.set('user', filters.user)
  }

  if (filters.types.length > 0) {
    params.set('type', filters.types.join(','))
  }

  if (filters.statuses.length > 0) {
    params.set('status', filters.statuses.join(','))
  }

  return params.toString()
}

/** `/profile`, or `/profile?user=sam@lilnas.io&type=movie`. */
export function profileHref(filters: ProfileFilters): string {
  const search = profileFiltersToSearch(filters)

  return search ? `${PROFILE_HREF}?${search}` : PROFILE_HREF
}

/**
 * Somebody's profile, unfiltered.
 *
 * ⚠️ Says nothing about whether the caller is *allowed* there — that is
 * `canViewRequesterProfile`'s job, and the backend's. Callers pair the two.
 */
export function profileHrefForEmail(email: string): string {
  return profileHref({ ...EMPTY_PROFILE_FILTERS, user: email })
}

/**
 * Crosses from the URL's form to the backend client's.
 *
 * ⚠️ `requester` is a separate argument rather than `filters.user`, and that is
 * load-bearing: `GET /download/history` with no `requester` returns **every**
 * user's history, so a profile page that passed `filters.user` straight through
 * would show the whole system's downloads under one person's name the moment
 * the URL omitted `?user=`. The caller resolves the target first (the URL's
 * `user`, or the viewer's own email) and passes it here explicitly.
 */
export function profileHistoryQuery(
  filters: ProfileFilters,
  requester: string,
  cursor?: string,
): Partial<HistoryQuery> {
  return {
    cursor,
    requester,
    status: filters.statuses.length > 0 ? filters.statuses : undefined,
    type: filters.types.length > 0 ? filters.types : undefined,
  }
}

/**
 * Whether the history below is scoped by anything — the "no downloads yet" /
 * "nothing matches these filters" split.
 *
 * `user` deliberately does not count. It selects *whose* profile this is, not a
 * narrowing of it, and an empty profile reached through `?user=` is still an
 * empty profile rather than a filter that matched nothing.
 */
export function hasProfileFilters(filters: ProfileFilters): boolean {
  return filters.types.length > 0 || filters.statuses.length > 0
}

/** Every chip released, still on the same person's profile. */
export function clearProfileFilters(filters: ProfileFilters): ProfileFilters {
  return { ...EMPTY_PROFILE_FILTERS, user: filters.user }
}

/**
 * The filter with `type` flipped. Multi-select: a second type widens the set
 * rather than replacing the first, which is what "OR within a group" means.
 *
 * Rebuilt from the canonical order rather than appended to, so `?type=show,video`
 * and `?type=video,show` can never both exist.
 */
export function toggleProfileType(
  filters: ProfileFilters,
  type: DownloadType,
): ProfileFilters {
  const on = filters.types.includes(type)

  return {
    ...filters,
    types: PROFILE_TYPE_ORDER.filter(other =>
      other === type ? !on : filters.types.includes(other),
    ),
  }
}

/** The filter with `status` flipped. See {@link toggleProfileType}. */
export function toggleProfileStatus(
  filters: ProfileFilters,
  status: DownloadJobStatus,
): ProfileFilters {
  const on = filters.statuses.includes(status)

  return {
    ...filters,
    statuses: PROFILE_STATUS_ORDER.filter(other =>
      other === status ? !on : filters.statuses.includes(other),
    ),
  }
}

/**
 * One applied-filter chip: what it says, what its remove button is called, and
 * the filter state that removing it produces.
 *
 * Carrying `next` rather than a discriminated "kind" keeps the removal logic in
 * one testable place — the chip row just pushes whatever it is handed. Same
 * shape as `GalleryFilterChip`, for the same reason.
 */
export type ProfileFilterChip = {
  /** Stable React key. */
  key: string
  /** The chip's visible value. */
  label: string
  /** The filters that remain once this chip is removed. */
  next: ProfileFilters
  /**
   * The remove button's whole accessible name. Names the *value* rather than
   * the facet, because a profile can show three type chips at once and "Remove
   * media type filter" three times over tells a screen-reader user nothing
   * about which one they are on.
   */
  removeLabel: string
}

/**
 * The applied-filter chips, types first and then statuses — the order the two
 * groups are read in above.
 *
 * ⚠️ These are *not* the aggregate chips. An aggregate chip always carries the
 * lifetime count and never moves; this row is the removable readout of what is
 * currently scoping the table, and is absent entirely when nothing is.
 */
export function profileFilterChips(
  filters: ProfileFilters,
): ProfileFilterChip[] {
  const chips: ProfileFilterChip[] = []

  for (const type of filters.types) {
    chips.push({
      key: `type:${type}`,
      label: type,
      next: toggleProfileType(filters, type),
      removeLabel: `Remove ${type} filter`,
    })
  }

  for (const status of filters.statuses) {
    chips.push({
      key: `status:${status}`,
      label: status,
      next: toggleProfileStatus(filters, status),
      removeLabel: `Remove ${status} filter`,
    })
  }

  return chips
}

/**
 * What {@link loadProfileHistory} answers with.
 *
 * Declared here rather than beside the action because a `'use server'` module
 * may export nothing but async functions — an `export type` in one is a build
 * error, not a style choice.
 */
export type LoadProfileHistoryResult =
  | { error: string }
  | { items: DownloadJob[]; nextCursor: string | null; total: number }
