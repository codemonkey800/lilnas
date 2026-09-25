import { DownloadType } from '@lilnas/utils/download/types'

import {
  ACTIVITY_ALL_TYPES_TAB,
  ACTIVITY_MIXED_TYPES_TAB,
  activityFiltersForTab,
  activityFiltersToQuery,
  activityFiltersToSearch,
  activityHref,
  activityTabValue,
  EMPTY_ACTIVITY_FILTERS,
  hasActivityFilters,
  parseActivityFilters,
} from 'src/lib/activity-filters'

describe('parseActivityFilters', () => {
  it('reads no filter out of a bare path', () => {
    expect(parseActivityFilters({})).toEqual(EMPTY_ACTIVITY_FILTERS)
  })

  it('reads a comma-separated list, a repeated key, and a mix of both', () => {
    expect(parseActivityFilters({ type: 'movie,show' }).types).toEqual([
      DownloadType.Movie,
      DownloadType.Show,
    ])
    expect(parseActivityFilters({ type: ['movie', 'show'] }).types).toEqual([
      DownloadType.Movie,
      DownloadType.Show,
    ])
    expect(
      parseActivityFilters(new URLSearchParams('type=video&type=movie,show'))
        .types,
    ).toEqual([DownloadType.Video, DownloadType.Movie, DownloadType.Show])
  })

  it('normalizes into the canonical order, so one filter is one URL', () => {
    expect(parseActivityFilters({ type: 'show,video' }).types).toEqual(
      parseActivityFilters({ type: 'video,show' }).types,
    )
  })

  it('drops an unrecognized type rather than rejecting the whole URL', () => {
    expect(parseActivityFilters({ type: 'movie,podcast' }).types).toEqual([
      DownloadType.Movie,
    ])
  })

  it('de-duplicates a type asked for twice', () => {
    expect(parseActivityFilters({ type: 'movie,movie' }).types).toEqual([
      DownloadType.Movie,
    ])
  })
})

describe('activityFiltersToSearch', () => {
  it('round-trips every reachable filter', () => {
    for (const types of [
      [],
      [DownloadType.Video],
      [DownloadType.Video, DownloadType.Movie],
      [DownloadType.Video, DownloadType.Movie, DownloadType.Show],
    ]) {
      const search = activityFiltersToSearch({ types })

      expect(parseActivityFilters(new URLSearchParams(search)).types).toEqual(
        types,
      )
    }
  })

  it('writes the types as one comma-separated parameter', () => {
    expect(
      activityFiltersToSearch({
        types: [DownloadType.Video, DownloadType.Movie],
      }),
    ).toBe('type=video%2Cmovie')
  })
})

describe('activityHref', () => {
  it('drops the question mark when nothing is filtered', () => {
    expect(activityHref(EMPTY_ACTIVITY_FILTERS)).toBe('/activity')
  })

  it('carries the filter otherwise', () => {
    expect(activityHref({ types: [DownloadType.Movie] })).toBe(
      '/activity?type=movie',
    )
  })
})

describe('activityFiltersToQuery', () => {
  it('omits the type entirely rather than sending an empty list', () => {
    expect(activityFiltersToQuery(EMPTY_ACTIVITY_FILTERS)).toEqual({
      cursor: undefined,
      type: undefined,
    })
  })

  it('passes the cursor through for an appended page', () => {
    expect(
      activityFiltersToQuery({ types: [DownloadType.Show] }, 'cur_1'),
    ).toEqual({ cursor: 'cur_1', type: [DownloadType.Show] })
  })
})

describe('hasActivityFilters', () => {
  it('splits the "nothing running" and "none of these" empty states', () => {
    expect(hasActivityFilters(EMPTY_ACTIVITY_FILTERS)).toBe(false)
    expect(hasActivityFilters({ types: [DownloadType.Video] })).toBe(true)
  })
})

describe('activityTabValue', () => {
  it('selects All when nothing is filtered', () => {
    expect(activityTabValue(EMPTY_ACTIVITY_FILTERS)).toBe(
      ACTIVITY_ALL_TYPES_TAB,
    )
  })

  it('selects the one type when exactly one is filtered', () => {
    expect(activityTabValue({ types: [DownloadType.Show] })).toBe('show')
  })

  // No tab can report a two-type selection, so none of them claims to.
  it('selects no tab at all for a two-type selection', () => {
    expect(
      activityTabValue({ types: [DownloadType.Video, DownloadType.Movie] }),
    ).toBe(ACTIVITY_MIXED_TYPES_TAB)
  })
})

describe('activityFiltersForTab', () => {
  it('clears the filter for the All tab', () => {
    expect(activityFiltersForTab(ACTIVITY_ALL_TYPES_TAB)).toEqual(
      EMPTY_ACTIVITY_FILTERS,
    )
  })

  it('selects one type for a type tab', () => {
    expect(activityFiltersForTab('movie')).toEqual({
      types: [DownloadType.Movie],
    })
  })

  // A cast from the tab's string would be the only thing between a typo and a
  // filter nobody can clear.
  it('clears the filter for a value that is not a type', () => {
    expect(activityFiltersForTab('podcast')).toEqual(EMPTY_ACTIVITY_FILTERS)
  })
})
