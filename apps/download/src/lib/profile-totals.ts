import type { ProfileResponse } from '@lilnas/utils/download/types'

import type { StatusTone } from 'src/lib/format'
import { statusTone } from 'src/lib/format'
import type { ProfileFilters } from 'src/lib/profile-filters'
import {
  PROFILE_STATUS_ORDER,
  PROFILE_TYPE_ORDER,
  toggleProfileStatus,
  toggleProfileType,
} from 'src/lib/profile-filters'

/**
 * `ProfileResponse`'s two breakdowns have the same shape apart from the name of
 * their key column, which is the only thing this module needs from either.
 */
type TotalsRow = { count: number }

/**
 * One aggregate chip: a lifetime count, and the filter state clicking it
 * produces.
 *
 * ⚠️ `count` is **always** the lifetime total and never the count of what is
 * currently showing. That is the rule the whole profile turns on: the chips are
 * the vocabulary of what this person has ever downloaded, and a vocabulary that
 * shrank as you selected from it would leave no way back. `active` changes how
 * a chip looks and nothing else.
 */
export type ProfileTotalChip = {
  /** Whether this chip's value is one of the applied filters. */
  active: boolean
  /** The lifetime total. Never recomputed against the filtered history. */
  count: number
  /** Stable React key. */
  key: string
  /** `video · 41` — the whole chip text, per `profile.pug`'s `totalsGroup`. */
  label: string
  /** The filters that pressing this chip produces. */
  next: ProfileFilters
  /** The chip's tint. */
  tone: StatusTone
}

/**
 * The profile's headline figure.
 *
 * `ProfileResponse` carries no `totalJobs` on purpose — its own doc comment
 * says to sum `totalsByType` — and this is the one place that sum is spelled.
 * The breakdown is sparse, so a type that never occurred contributes nothing
 * rather than being looked up and found `undefined`; an empty profile is
 * therefore `0`, which is a true statement, not a placeholder.
 */
export function sumProfileTotals(
  rows: ProfileResponse['totalsByStatus'] | ProfileResponse['totalsByType'],
): number {
  return rows.reduce((total: number, row: TotalsRow) => total + row.count, 0)
}

/**
 * Collapses a breakdown into a lookup, summing any duplicate keys.
 *
 * Duplicates are not expected — the backend groups by the key — but summing is
 * the only merge that cannot silently lose a count if one ever appears.
 */
function byKey<Row extends TotalsRow>(
  rows: readonly Row[],
  key: (row: Row) => string,
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    const name = key(row)

    totals.set(name, (totals.get(name) ?? 0) + row.count)
  }

  return totals
}

/**
 * The `by type` chips, in the canonical type order.
 *
 * ⚠️ **Sparse in, sparse out.** A type that never occurred gets *no chip*
 * rather than a zero one, exactly as `ProfileResponse` describes its own
 * payload. A `movie · 0` chip would be a filter that is guaranteed to match
 * nothing, offered as though it were worth pressing.
 */
export function profileTypeChips(
  totalsByType: ProfileResponse['totalsByType'],
  filters: ProfileFilters,
): ProfileTotalChip[] {
  const totals = byKey(totalsByType, row => row.type)

  return PROFILE_TYPE_ORDER.flatMap(type => {
    const count = totals.get(type)

    if (count === undefined) {
      return []
    }

    return [
      {
        active: filters.types.includes(type),
        count,
        key: type,
        label: `${type} · ${count}`,
        next: toggleProfileType(filters, type),
        // `mute` for every type, matching `profile.pug`'s `item.tone || 'mute'`
        // — a media type is not a state, so it carries no state colour.
        tone: 'mute' as const,
      },
    ]
  })
}

/**
 * The `by status` chips, in lifecycle order. Sparse on the same terms as
 * {@link profileTypeChips}.
 *
 * ⚠️ The tint comes from `statusTone`, never from a table written here, so
 * `paused` is `warn` and `pending` is `mute` exactly as they are on every other
 * screen. `profile.mjs` hand-picks its own tones (and a `queued` status that
 * does not exist); those are the mockup's palette choices for a static picture.
 */
export function profileStatusChips(
  totalsByStatus: ProfileResponse['totalsByStatus'],
  filters: ProfileFilters,
): ProfileTotalChip[] {
  const totals = byKey(totalsByStatus, row => row.status)

  return PROFILE_STATUS_ORDER.flatMap(status => {
    const count = totals.get(status)

    if (count === undefined) {
      return []
    }

    return [
      {
        active: filters.statuses.includes(status),
        count,
        key: status,
        label: `${status} · ${count}`,
        next: toggleProfileStatus(filters, status),
        tone: statusTone(status),
      },
    ]
  })
}
