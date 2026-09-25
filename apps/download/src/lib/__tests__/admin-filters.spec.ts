import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { AdminFilters } from 'src/lib/admin-filters'
import {
  ADMIN_STATS_MAX_DAYS,
  ADMIN_STATS_MIN_DAYS,
  ADMIN_STATUS_ORDER,
  ADMIN_TYPE_ORDER,
  adminFilterChips,
  adminFiltersToHistoryQuery,
  adminFiltersToSearch,
  adminFiltersToStatsQuery,
  adminHref,
  EMPTY_ADMIN_FILTERS,
  hasAdminFilters,
  parseAdminFilters,
} from 'src/lib/admin-filters'

/** Every subset of the three media types, in canonical order. */
function typeSubsets(): DownloadType[][] {
  const subsets: DownloadType[][] = []

  for (let mask = 0; mask < 1 << ADMIN_TYPE_ORDER.length; mask++) {
    subsets.push(ADMIN_TYPE_ORDER.filter((_type, index) => mask & (1 << index)))
  }

  return subsets
}

/**
 * A representative spread of status subsets. The full power set of fourteen
 * statuses is 16,384 combinations against four type subsets and four days —
 * more than the round-trip property needs to be convincing, since the
 * serializer treats the list uniformly.
 */
function statusSubsets(): DownloadJobStatus[][] {
  const all = [...ADMIN_STATUS_ORDER]

  return [
    [],
    ...all.map(status => [status]),
    all.filter((_status, index) => index % 2 === 0),
    all.filter((_status, index) => index % 3 === 0),
    all,
  ]
}

describe('parseAdminFilters / adminFiltersToSearch', () => {
  // The property that makes the URL safe to treat as the state. Proven over
  // every reachable filter rather than over a handful of examples, which is
  // what caught two ordering bugs in `gallery-filters.spec.ts`.
  it('round-trips every reachable filter state', () => {
    const requesters = [null, 'jeremy@lilnas.io', 'a+b@example.com']
    const days = [null, ADMIN_STATS_MIN_DAYS, 30, ADMIN_STATS_MAX_DAYS]

    for (const types of typeSubsets()) {
      for (const statuses of statusSubsets()) {
        for (const requester of requesters) {
          for (const day of days) {
            const filters: AdminFilters = {
              days: day,
              requester,
              statuses,
              types,
            }

            expect(
              parseAdminFilters(
                new URLSearchParams(adminFiltersToSearch(filters)),
              ),
            ).toEqual(filters)
          }
        }
      }
    }
  })

  it('normalizes type and status order, so one filter is one URL', () => {
    const shuffled = parseAdminFilters({
      type: 'show,video',
      status: 'failed,pending',
    })
    const canonical = parseAdminFilters({
      type: 'video,show',
      status: 'pending,failed',
    })

    expect(shuffled).toEqual(canonical)
    expect(adminFiltersToSearch(shuffled)).toBe(adminFiltersToSearch(canonical))
  })

  it('reads repeated and comma-separated parameters identically', () => {
    expect(parseAdminFilters({ type: ['movie', 'video'] })).toEqual(
      parseAdminFilters({ type: 'video,movie' }),
    )
  })

  it('drops values outside the vocabulary rather than rejecting the URL', () => {
    expect(parseAdminFilters({ type: 'movie,nonsense', status: 'ok' })).toEqual(
      {
        ...EMPTY_ADMIN_FILTERS,
        types: [DownloadType.Movie],
      },
    )
  })

  it('drops a days outside the schema bounds instead of sending a 400', () => {
    for (const days of ['0', '366', '-5', '30.5', '30abc', '', 'thirty']) {
      expect(parseAdminFilters({ days }).days).toBeNull()
    }

    expect(parseAdminFilters({ days: '365' }).days).toBe(365)
    expect(parseAdminFilters({ days: '1' }).days).toBe(1)
  })

  it('keeps every status in the enum filterable', () => {
    for (const status of ADMIN_STATUS_ORDER) {
      expect(parseAdminFilters({ status }).statuses).toEqual([status])
    }
  })
})

describe('adminHref', () => {
  it('is the bare path when nothing is applied', () => {
    expect(adminHref(EMPTY_ADMIN_FILTERS)).toBe('/admin')
  })

  it('carries the requester, which is what a per-user history is', () => {
    expect(
      adminHref({ ...EMPTY_ADMIN_FILTERS, requester: 'sam@lilnas.io' }),
    ).toBe('/admin?requester=sam%40lilnas.io')
  })
})

describe('adminFiltersToHistoryQuery', () => {
  it('omits an unset facet rather than sending an empty list', () => {
    expect(adminFiltersToHistoryQuery(EMPTY_ADMIN_FILTERS)).toEqual({
      cursor: undefined,
      requester: undefined,
      status: undefined,
      type: undefined,
    })
  })

  it('passes what is applied straight through', () => {
    expect(
      adminFiltersToHistoryQuery(
        {
          days: 7,
          requester: 'sam@lilnas.io',
          statuses: [DownloadJobStatus.Failed],
          types: [DownloadType.Movie],
        },
        'cursor-1',
      ),
    ).toEqual({
      cursor: 'cursor-1',
      requester: 'sam@lilnas.io',
      status: [DownloadJobStatus.Failed],
      type: [DownloadType.Movie],
    })
  })
})

describe('adminFiltersToStatsQuery', () => {
  // The default belongs to `AdminStatsQuerySchema`. Inventing a 30 here would
  // make the page able to print a window the backend never applied.
  it('omits days entirely when the URL asks for no window', () => {
    expect(adminFiltersToStatsQuery(EMPTY_ADMIN_FILTERS)).toEqual({
      days: undefined,
    })
  })

  it('passes a requested window through', () => {
    expect(
      adminFiltersToStatsQuery({ ...EMPTY_ADMIN_FILTERS, days: 90 }),
    ).toEqual({ days: 90 })
  })
})

describe('hasAdminFilters', () => {
  it('ignores days, which narrows nothing in the table', () => {
    expect(hasAdminFilters({ ...EMPTY_ADMIN_FILTERS, days: 7 })).toBe(false)
    expect(
      hasAdminFilters({ ...EMPTY_ADMIN_FILTERS, requester: 'a@b.c' }),
    ).toBe(true)
  })
})

describe('adminFilterChips', () => {
  it('gives the requester a chip that removes only itself', () => {
    const filters: AdminFilters = {
      days: 7,
      requester: 'sam@lilnas.io',
      statuses: [DownloadJobStatus.Failed],
      types: [DownloadType.Movie],
    }

    const [requesterChip] = adminFilterChips(filters)

    expect(requesterChip?.label).toBe('sam@lilnas.io')
    expect(requesterChip?.next).toEqual({ ...filters, requester: null })
  })

  it('draws no chip for the stats window', () => {
    expect(adminFilterChips({ ...EMPTY_ADMIN_FILTERS, days: 90 })).toEqual([])
  })

  it('names the value on each remove button, not the facet', () => {
    const chips = adminFilterChips({
      ...EMPTY_ADMIN_FILTERS,
      types: [DownloadType.Video, DownloadType.Movie],
    })

    expect(chips.map(chip => chip.removeLabel)).toEqual([
      'Remove Videos filter',
      'Remove Movies filter',
    ])
  })
})
