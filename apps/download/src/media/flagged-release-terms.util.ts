import { TIER_PROFILE_PREFIX } from 'src/media/quality-tiers'

/**
 * Plan 024. The release profile this app manages in each of Radarr and
 * Sonarr to mirror `bad_files`: every flagged release title becomes one of
 * its `ignored` terms, so Radarr's/Sonarr's own RSS sync, automatic search
 * and retry-after-failure reject a release the user flagged here, not just
 * this app's own pickers. Everything in this file is pure; the services do
 * the HTTP.
 *
 * Facts the builder and planner rely on (Radarr 6.4 / Sonarr 4.0):
 *
 * - A term is a case-insensitive substring of the release title - unless it
 *   contains two slashes, in which case it's read as a .NET regex. A title
 *   can't be escaped out of that, so a title with a `/` is skipped.
 * - `required`/`ignored` go over the wire as string arrays - never
 *   comma-joined, titles can hold commas.
 * - At least one of `required`/`ignored` must be non-empty, and no term may
 *   be blank. So an empty flag set is a deleted profile, not an empty one.
 * - `enabled` defaults to `false` on the resource; it's always sent.
 * - `indexerId: 0` is every indexer, `tags: []` every movie/series.
 */
export const FLAGGED_RELEASE_PROFILE_NAME = `${TIER_PROFILE_PREFIX}Flagged releases`

export interface FlaggedTerms {
  /** The `ignored` terms, deduped and sorted. */
  terms: string[]
  /** Titles left out because they can't be a plain substring term. */
  skipped: string[]
}

/**
 * Flagged release titles -> `ignored` terms: trimmed, blanks dropped,
 * deduped case-insensitively (Radarr/Sonarr match that way, so two casings
 * are one term - the first seen wins), and any title containing `/` skipped.
 * Sorted, so the same flags always build the same list.
 */
export function buildFlaggedTerms(titles: readonly string[]): FlaggedTerms {
  const byKey = new Map<string, string>()
  const skipped: string[] = []

  for (const raw of titles) {
    const title = raw.trim()
    if (title === '') continue

    if (title.includes('/')) {
      if (!skipped.includes(title)) skipped.push(title)
      continue
    }

    const key = title.toLowerCase()
    if (!byKey.has(key)) byKey.set(key, title)
  }

  return { terms: [...byKey.values()].sort(compareStrings), skipped }
}

/** The subset of a release profile resource this planner reads. */
export interface ReleaseProfileLike {
  id?: number
  name?: string | null
  enabled?: boolean
  required?: unknown
  ignored?: unknown
  indexerId?: number
  tags?: number[] | null
}

/** The managed profile's body, as created or updated. */
export interface FlaggedReleaseProfileBody {
  id?: number
  name: string
  enabled: true
  required: string[]
  ignored: string[]
  indexerId: 0
  tags: number[]
}

/**
 * What to send to bring the managed profile in line with `terms`. Deletes
 * run for every extra profile under the managed name - only ever one, unless
 * someone made a copy by hand.
 */
export interface FlaggedReleaseProfilePlan {
  create?: FlaggedReleaseProfileBody
  update?: FlaggedReleaseProfileBody & { id: number }
  deleteIds: number[]
}

/**
 * Plans the managed profile against what Radarr/Sonarr hold now, matched by
 * name - a profile under any other name is never touched.
 *
 * - No terms: delete it (there's no valid empty profile to keep).
 * - No profile: create it.
 * - Otherwise update it only if the term set or its shape (`enabled`,
 *   `required`, `indexerId`, `tags`) has drifted. Terms compare ignoring
 *   order and case - Radarr/Sonarr match them case-insensitively, so a
 *   case-only difference changes nothing worth a write.
 */
export function planFlaggedReleaseProfile(
  existing: readonly ReleaseProfileLike[],
  terms: readonly string[],
): FlaggedReleaseProfilePlan {
  const managed = existing.filter(
    (profile): profile is ReleaseProfileLike & { id: number } =>
      profile.name === FLAGGED_RELEASE_PROFILE_NAME && profile.id != null,
  )

  if (terms.length === 0) {
    return { deleteIds: managed.map(profile => profile.id) }
  }

  const body: FlaggedReleaseProfileBody = {
    name: FLAGGED_RELEASE_PROFILE_NAME,
    enabled: true,
    required: [],
    ignored: [...terms],
    indexerId: 0,
    tags: [],
  }
  const [current, ...extras] = managed
  const deleteIds = extras.map(profile => profile.id)

  if (current == null) {
    return { create: body, deleteIds }
  }

  if (profileMatches(current, terms)) {
    return { deleteIds }
  }

  return { update: { ...body, id: current.id }, deleteIds }
}

/**
 * The terms a profile's `required`/`ignored` holds. Emitted as a string
 * array; a comma-separated string (what older versions sent) is read too.
 */
export function profileTerms(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((term): term is string => typeof term === 'string')
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(term => term.trim())
      .filter(term => term !== '')
  }

  return []
}

function profileMatches(
  profile: ReleaseProfileLike,
  terms: readonly string[],
): boolean {
  return (
    profile.enabled === true &&
    (profile.indexerId ?? 0) === 0 &&
    (profile.tags ?? []).length === 0 &&
    profileTerms(profile.required).length === 0 &&
    sameTermSet(profileTerms(profile.ignored), terms)
  )
}

function sameTermSet(a: readonly string[], b: readonly string[]): boolean {
  const left = termKeys(a)
  const right = termKeys(b)

  return (
    left.length === right.length &&
    left.every((term, index) => term === right[index])
  )
}

function termKeys(terms: readonly string[]): string[] {
  return [...new Set(terms.map(term => term.toLowerCase()))].sort(
    compareStrings,
  )
}

// - Code-unit order, not locale order: the same input sorts the same on
//   every host
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
