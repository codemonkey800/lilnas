import type { ProfileResponse } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { ProfileFilters } from 'src/lib/profile-filters'
import { EMPTY_PROFILE_FILTERS } from 'src/lib/profile-filters'
import {
  profileStatusChips,
  profileTypeChips,
  sumProfileTotals,
} from 'src/lib/profile-totals'

const BY_TYPE: ProfileResponse['totalsByType'] = [
  { count: 41, type: DownloadType.Video },
  { count: 9, type: DownloadType.Movie },
]

const BY_STATUS: ProfileResponse['totalsByStatus'] = [
  { count: 46, status: DownloadJobStatus.Completed },
  { count: 2, status: DownloadJobStatus.Failed },
  { count: 1, status: DownloadJobStatus.Downloading },
]

function filters(overrides: Partial<ProfileFilters> = {}): ProfileFilters {
  return { ...EMPTY_PROFILE_FILTERS, ...overrides }
}

describe('sumProfileTotals', () => {
  // `ProfileResponse` has no `totalJobs`; the headline figure is this sum.
  it('is the headline figure `ProfileResponse` declines to carry', () => {
    expect(sumProfileTotals(BY_TYPE)).toBe(50)
  })

  it('renders a zero rather than a gap for a profile with no jobs at all', () => {
    expect(sumProfileTotals([])).toBe(0)
  })

  it('counts a sparse breakdown correctly — an absent key is worth zero', () => {
    // `show` never occurred and is simply absent. Looking it up and adding
    // `undefined` is how this becomes `NaN` on screen.
    expect(sumProfileTotals([{ count: 7, type: DownloadType.Show }])).toBe(7)
    expect(Number.isNaN(sumProfileTotals(BY_TYPE))).toBe(false)
  })
})

describe('profileTypeChips', () => {
  it('emits no chip at all for a type that never occurred', () => {
    const chips = profileTypeChips(BY_TYPE, EMPTY_PROFILE_FILTERS)

    expect(chips.map(chip => chip.key)).toEqual([
      DownloadType.Video,
      DownloadType.Movie,
    ])
    expect(chips.some(chip => chip.label.startsWith('show'))).toBe(false)
  })

  it('reads each chip as `name · lifetime count`', () => {
    expect(
      profileTypeChips(BY_TYPE, EMPTY_PROFILE_FILTERS).map(chip => chip.label),
    ).toEqual(['video · 41', 'movie · 9'])
  })

  // The rule the whole profile turns on.
  it('keeps every count at its lifetime total when a filter is applied', () => {
    const unfiltered = profileTypeChips(BY_TYPE, EMPTY_PROFILE_FILTERS)
    const filtered = profileTypeChips(
      BY_TYPE,
      filters({
        statuses: [DownloadJobStatus.Failed],
        types: [DownloadType.Movie],
      }),
    )

    expect(filtered.map(chip => chip.count)).toEqual(
      unfiltered.map(chip => chip.count),
    )
    expect(filtered.map(chip => chip.label)).toEqual(
      unfiltered.map(chip => chip.label),
    )
  })

  it('marks only the applied values active', () => {
    const chips = profileTypeChips(
      BY_TYPE,
      filters({ types: [DownloadType.Movie] }),
    )

    expect(chips.map(chip => [chip.key, chip.active])).toEqual([
      [DownloadType.Video, false],
      [DownloadType.Movie, true],
    ])
  })

  it('offers the toggled filter as `next`, widening rather than replacing', () => {
    const chips = profileTypeChips(
      BY_TYPE,
      filters({ types: [DownloadType.Movie] }),
    )

    expect(chips[0]?.next.types).toEqual([
      DownloadType.Video,
      DownloadType.Movie,
    ])
    expect(chips[1]?.next.types).toEqual([])
  })

  it('tints every type the same, because a media type is not a state', () => {
    expect(
      profileTypeChips(BY_TYPE, EMPTY_PROFILE_FILTERS).map(chip => chip.tone),
    ).toEqual(['mute', 'mute'])
  })

  it('has nothing to render for an empty profile', () => {
    expect(profileTypeChips([], EMPTY_PROFILE_FILTERS)).toEqual([])
  })
})

describe('profileStatusChips', () => {
  it('reads in lifecycle order, not the enum’s alphabetical declaration order', () => {
    expect(
      profileStatusChips(BY_STATUS, EMPTY_PROFILE_FILTERS).map(
        chip => chip.key,
      ),
    ).toEqual([
      DownloadJobStatus.Downloading,
      DownloadJobStatus.Completed,
      DownloadJobStatus.Failed,
    ])
  })

  it('takes its tint from `statusTone`, not from the mockup’s palette', () => {
    expect(
      profileStatusChips(BY_STATUS, EMPTY_PROFILE_FILTERS).map(
        chip => chip.tone,
      ),
    ).toEqual(['uv', 'ok', 'bad'])
  })

  it('emits no chip for a status that never occurred', () => {
    const chips = profileStatusChips(BY_STATUS, EMPTY_PROFILE_FILTERS)

    expect(chips).toHaveLength(3)
    expect(chips.some(chip => chip.key === DownloadJobStatus.Paused)).toBe(
      false,
    )
  })

  it('keeps lifetime counts through a type filter, and vice versa', () => {
    const chips = profileStatusChips(
      BY_STATUS,
      filters({
        statuses: [DownloadJobStatus.Failed],
        types: [DownloadType.Movie],
      }),
    )

    expect(chips.map(chip => chip.label)).toEqual([
      'downloading · 1',
      'completed · 46',
      'failed · 2',
    ])
  })

  it('composes with the type facet rather than replacing it', () => {
    const applied = filters({ types: [DownloadType.Movie] })
    const failed = profileStatusChips(BY_STATUS, applied).find(
      chip => chip.key === DownloadJobStatus.Failed,
    )

    // AND across groups: pressing a status keeps the type already applied.
    expect(failed?.next).toEqual({
      statuses: [DownloadJobStatus.Failed],
      types: [DownloadType.Movie],
      user: null,
    })
  })
})
