import { DownloadType } from '@lilnas/utils/download/types'

import {
  applyDiscoveryFilters,
  collectGenreFacets,
  interleaveByRank,
  paginateDiscovery,
  rankBySourceOrder,
  type RankedDiscoveryResult,
  sortDiscoveryResults,
} from 'src/media/discovery-ranking'

function movie(
  overrides: Partial<RankedDiscoveryResult> = {},
): RankedDiscoveryResult {
  return {
    genres: [],
    sourceRank: 0,
    title: 'A Movie',
    tmdbId: 1,
    type: DownloadType.Movie,
    ...overrides,
  } as RankedDiscoveryResult
}

function show(
  overrides: Partial<RankedDiscoveryResult> = {},
): RankedDiscoveryResult {
  return {
    genres: [],
    sourceRank: 0,
    title: 'A Show',
    tvdbId: 1,
    type: DownloadType.Show,
    ...overrides,
  } as RankedDiscoveryResult
}

function discoveryId(r: RankedDiscoveryResult): number {
  return r.type === DownloadType.Movie ? r.tmdbId : r.tvdbId
}

describe('rankBySourceOrder', () => {
  it('tags each item with its 0-based position', () => {
    const result = rankBySourceOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(result.map(r => r.sourceRank)).toEqual([0, 1, 2])
  })
})

describe('interleaveByRank', () => {
  it('round-robins two equal-length arrays, preserving internal order', () => {
    const a = ['a0', 'a1', 'a2']
    const b = ['b0', 'b1', 'b2']

    expect(interleaveByRank(a, b)).toEqual(['a0', 'b0', 'a1', 'b1', 'a2', 'b2'])
  })

  it("appends the longer array's uneven tail in its own order", () => {
    const a = ['a0', 'a1', 'a2', 'a3']
    const b = ['b0']

    expect(interleaveByRank(a, b)).toEqual(['a0', 'b0', 'a1', 'a2', 'a3'])
  })

  it('handles an empty first array', () => {
    expect(interleaveByRank([], ['b0', 'b1'])).toEqual(['b0', 'b1'])
  })

  it('handles an empty second array', () => {
    expect(interleaveByRank(['a0', 'a1'], [])).toEqual(['a0', 'a1'])
  })

  it('handles both arrays empty', () => {
    expect(interleaveByRank([], [])).toEqual([])
  })
})

describe('applyDiscoveryFilters', () => {
  it('matches genres case-insensitively with OR semantics across selections', () => {
    const action = movie({ genres: ['Action'], title: 'Action Movie' })
    const comedy = movie({ genres: ['Comedy'], title: 'Comedy Movie' })
    const drama = movie({ genres: ['Drama'], title: 'Drama Movie' })

    const result = applyDiscoveryFilters([action, comedy, drama], {
      genres: ['action', 'COMEDY'],
    })

    expect(result.map(r => r.title).sort()).toEqual([
      'Action Movie',
      'Comedy Movie',
    ])
  })

  it('applies inclusive year bounds', () => {
    const y2000 = movie({ releaseYear: 2000, title: '2000' })
    const y2010 = movie({ releaseYear: 2010, title: '2010' })
    const y2020 = movie({ releaseYear: 2020, title: '2020' })

    const result = applyDiscoveryFilters([y2000, y2010, y2020], {
      yearFrom: 2000,
      yearTo: 2010,
    })

    expect(result.map(r => r.title).sort()).toEqual(['2000', '2010'])
  })

  it('excludes rows with no releaseYear when a year bound is set', () => {
    const noYear = movie({ releaseYear: undefined, title: 'no-year' })
    const withYear = movie({ releaseYear: 2015, title: 'with-year' })

    const result = applyDiscoveryFilters([noYear, withYear], {
      yearFrom: 2000,
    })

    expect(result.map(r => r.title)).toEqual(['with-year'])
  })

  it('does not filter at all when no filters are given', () => {
    const a = movie({ title: 'a' })
    const b = show({ title: 'b' })

    expect(applyDiscoveryFilters([a, b], {})).toEqual([a, b])
  })
})

describe('collectGenreFacets', () => {
  it('counts genre occurrences across results', () => {
    const a = movie({ genres: ['Action', 'Comedy'] })
    const b = movie({ genres: ['Action'] })
    const c = show({ genres: ['Drama'] })

    const facets = collectGenreFacets([a, b, c])

    expect(facets).toEqual([
      { count: 2, genre: 'Action' },
      { count: 1, genre: 'Comedy' },
      { count: 1, genre: 'Drama' },
    ])
  })

  it('survives narrowing by one genre - the other chips must not disappear', () => {
    const action = movie({ genres: ['Action'], title: 'Action Movie' })
    const comedy = movie({ genres: ['Comedy'], title: 'Comedy Movie' })
    const preFilterSet = [action, comedy]

    // Facets computed from the pre-genre-filter set...
    const facets = collectGenreFacets(preFilterSet)
    // ...then the genre filter is applied for the actual result list.
    const filtered = applyDiscoveryFilters(preFilterSet, {
      genres: ['Action'],
    })

    expect(filtered.map(r => r.title)).toEqual(['Action Movie'])
    expect(facets.map(f => f.genre).sort()).toEqual(['Action', 'Comedy'])
  })
})

describe('sortDiscoveryResults', () => {
  it('sorts by title alphabetically', () => {
    const b = movie({ title: 'Banana' })
    const a = movie({ title: 'Apple' })
    const c = movie({ title: 'Cherry' })

    const result = sortDiscoveryResults([b, a, c], 'title')

    expect(result.map(r => r.title)).toEqual(['Apple', 'Banana', 'Cherry'])
  })

  it('sorts by releaseDate descending, undefined last', () => {
    const older = movie({ releaseDate: '2019-01-01', title: 'older' })
    const newer = movie({ releaseDate: '2021-01-01', title: 'newer' })
    const noDate = movie({ releaseDate: undefined, title: 'no-date' })

    const result = sortDiscoveryResults([older, noDate, newer], 'releaseDate')

    expect(result.map(r => r.title)).toEqual(['newer', 'older', 'no-date'])
  })

  it('breaks a title tie deterministically via sourceRank, then type, then id', () => {
    const first = movie({
      sourceRank: 0,
      tmdbId: 1,
      title: 'Same Title',
    })
    const second = movie({
      sourceRank: 1,
      tmdbId: 2,
      title: 'Same Title',
    })

    const resultA = sortDiscoveryResults([second, first], 'title')
    const resultB = sortDiscoveryResults([first, second], 'title')

    // Same order regardless of input order - the tie-break makes it total.
    expect(resultA.map(discoveryId)).toEqual([1, 2])
    expect(resultB.map(discoveryId)).toEqual([1, 2])
  })

  it('breaks a cross-type tie via type (movie before show alphabetically)', () => {
    const theShow = show({ sourceRank: 0, title: 'Same Title', tvdbId: 5 })
    const theMovie = movie({ sourceRank: 0, title: 'Same Title', tmdbId: 5 })

    const result = sortDiscoveryResults([theShow, theMovie], 'title')

    expect(result.map(r => r.type)).toEqual([
      DownloadType.Movie,
      DownloadType.Show,
    ])
  })

  it('produces the same order across repeated calls (deterministic)', () => {
    const items = [
      movie({ sourceRank: 0, title: 'Same', tmdbId: 1 }),
      movie({ sourceRank: 0, title: 'Same', tmdbId: 2 }),
      show({ sourceRank: 0, title: 'Same', tvdbId: 3 }),
    ]

    const first = sortDiscoveryResults(items, 'title').map(discoveryId)
    const second = sortDiscoveryResults(items, 'title').map(discoveryId)

    expect(first).toEqual(second)
  })
})

describe('paginateDiscovery', () => {
  const items = [0, 1, 2, 3, 4]

  it('returns the first page starting at offset 0', () => {
    const page = paginateDiscovery(items, 0, 2)
    expect(page).toEqual({ hasMore: true, items: [0, 1] })
  })

  it('returns a mid-set page', () => {
    const page = paginateDiscovery(items, 2, 2)
    expect(page).toEqual({ hasMore: true, items: [2, 3] })
  })

  it('reports hasMore: false exactly at the boundary (offset + limit === total)', () => {
    const page = paginateDiscovery(items, 3, 2)
    expect(page).toEqual({ hasMore: false, items: [3, 4] })
  })

  it('returns an empty page past the end', () => {
    const page = paginateDiscovery(items, 10, 2)
    expect(page).toEqual({ hasMore: false, items: [] })
  })
})
