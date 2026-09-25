import { DownloadType } from '@lilnas/utils/download/types'

import type {
  GalleryFilters,
  GallerySearchParams,
} from 'src/lib/gallery-filters'
import {
  countGalleryFilters,
  EMPTY_GALLERY_FILTERS,
  formatGalleryRangeLabel,
  galleryFilterChips,
  galleryFiltersToQuery,
  galleryFiltersToSearch,
  galleryFiltersToSearchParams,
  galleryHref,
  hasGalleryFilters,
  isInvertedGalleryRange,
  parseGalleryFilters,
} from 'src/lib/gallery-filters'

const { Movie, Show, Video } = DownloadType

/** Every reachable filter state, which the round-trip below is exhaustive over. */
const TYPE_COMBINATIONS: DownloadType[][] = [
  [],
  [Video],
  [Movie],
  [Show],
  [Video, Movie],
  [Video, Show],
  [Movie, Show],
  [Video, Movie, Show],
]

const REQUESTERS = [null, 'jeremy@lilnas.io']
const RANGES: Array<[string | null, string | null]> = [
  [null, null],
  ['2026-01-01', null],
  [null, '2026-03-31'],
  ['2026-01-01', '2026-03-31'],
]

function everyFilterCombination(): GalleryFilters[] {
  return TYPE_COMBINATIONS.flatMap(types =>
    REQUESTERS.flatMap(requester =>
      RANGES.map(([from, to]) => ({ types, requester, from, to })),
    ),
  )
}

describe('parseGalleryFilters', () => {
  it('reads nothing out of an empty query', () => {
    expect(parseGalleryFilters({})).toEqual(EMPTY_GALLERY_FILTERS)
  })

  it('accepts a comma-separated type list', () => {
    expect(parseGalleryFilters({ type: 'movie,show' }).types).toEqual([
      Movie,
      Show,
    ])
  })

  it('accepts a repeated type parameter', () => {
    expect(parseGalleryFilters({ type: ['movie', 'show'] }).types).toEqual([
      Movie,
      Show,
    ])
  })

  it('accepts a mix of repeated and comma-separated values', () => {
    expect(
      parseGalleryFilters({ type: ['video,movie', 'show'] }).types,
    ).toEqual([Video, Movie, Show])
  })

  it('normalizes type order so one filter has exactly one spelling', () => {
    expect(parseGalleryFilters({ type: 'show,video' }).types).toEqual(
      parseGalleryFilters({ type: 'video,show' }).types,
    )
  })

  it('de-duplicates a repeated type', () => {
    expect(parseGalleryFilters({ type: 'movie,movie' }).types).toEqual([Movie])
  })

  it('drops an unrecognized type rather than rejecting the whole query', () => {
    expect(parseGalleryFilters({ type: 'movie,album' }).types).toEqual([Movie])
  })

  it('reads a requester', () => {
    expect(parseGalleryFilters({ requester: 'a@b.c' }).requester).toBe('a@b.c')
  })

  it('takes the first of a repeated requester, since the API takes one', () => {
    expect(
      parseGalleryFilters({ requester: ['a@b.c', 'd@e.f'] }).requester,
    ).toBe('a@b.c')
  })

  it('reads a date range', () => {
    expect(
      parseGalleryFilters({ from: '2026-01-01', to: '2026-03-31' }),
    ).toEqual({
      types: [],
      requester: null,
      from: '2026-01-01',
      to: '2026-03-31',
    })
  })

  it('drops a malformed date', () => {
    expect(parseGalleryFilters({ from: '01/01/2026' }).from).toBeNull()
  })

  it('drops a date that names a day which does not exist', () => {
    expect(parseGalleryFilters({ from: '2026-02-31' }).from).toBeNull()
  })

  it('keeps an inverted range, because the API is what rejects it', () => {
    const filters = parseGalleryFilters({
      from: '2026-05-01',
      to: '2026-01-01',
    })

    expect(filters.from).toBe('2026-05-01')
    expect(filters.to).toBe('2026-01-01')
  })

  it('reads a URLSearchParams exactly as it reads a params object', () => {
    const search = '?type=movie,show&requester=a@b.c&from=2026-01-01'

    expect(parseGalleryFilters(new URLSearchParams(search))).toEqual(
      parseGalleryFilters({
        type: 'movie,show',
        requester: 'a@b.c',
        from: '2026-01-01',
      } satisfies GallerySearchParams),
    )
  })
})

describe('galleryFiltersToSearchParams', () => {
  it('writes nothing for an unfiltered gallery', () => {
    expect(galleryFiltersToSearch(EMPTY_GALLERY_FILTERS)).toBe('')
  })

  it('writes the type list as one comma-separated parameter', () => {
    expect(
      galleryFiltersToSearchParams({
        ...EMPTY_GALLERY_FILTERS,
        types: [Movie, Show],
      }).get('type'),
    ).toBe('movie,show')
  })

  it('round-trips every reachable filter combination', () => {
    for (const filters of everyFilterCombination()) {
      expect(
        parseGalleryFilters(galleryFiltersToSearchParams(filters)),
      ).toEqual(filters)
    }
  })

  it('round-trips through the serialized string a router would push', () => {
    for (const filters of everyFilterCombination()) {
      const search = galleryFiltersToSearch(filters)

      expect(parseGalleryFilters(new URLSearchParams(search))).toEqual(filters)
    }
  })
})

describe('galleryHref', () => {
  it('drops the question mark entirely when nothing is filtered', () => {
    expect(galleryHref(EMPTY_GALLERY_FILTERS)).toBe('/gallery')
  })

  it('carries the query when something is', () => {
    expect(galleryHref({ ...EMPTY_GALLERY_FILTERS, types: [Video] })).toBe(
      '/gallery?type=video',
    )
  })
})

describe('galleryFiltersToQuery', () => {
  it('leaves every absent filter undefined rather than empty', () => {
    expect(galleryFiltersToQuery(EMPTY_GALLERY_FILTERS)).toEqual({
      type: undefined,
      requester: undefined,
      from: undefined,
      to: undefined,
      cursor: undefined,
    })
  })

  it('hands the client an array of types', () => {
    expect(
      galleryFiltersToQuery({ ...EMPTY_GALLERY_FILTERS, types: [Movie, Show] })
        .type,
    ).toEqual([Movie, Show])
  })

  it('builds UTC dates, so the day the client serializes is the day typed', () => {
    const query = galleryFiltersToQuery({
      ...EMPTY_GALLERY_FILTERS,
      from: '2026-01-01',
      to: '2026-03-31',
    })

    // The same slice `DownloadClient.toQueryString` takes.
    expect(query.from?.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(query.to?.toISOString().slice(0, 10)).toBe('2026-03-31')
  })

  it('passes the cursor through untouched', () => {
    expect(galleryFiltersToQuery(EMPTY_GALLERY_FILTERS, 'abc').cursor).toBe(
      'abc',
    )
  })
})

describe('hasGalleryFilters / countGalleryFilters', () => {
  it('reports an unfiltered gallery', () => {
    expect(hasGalleryFilters(EMPTY_GALLERY_FILTERS)).toBe(false)
    expect(countGalleryFilters(EMPTY_GALLERY_FILTERS)).toBe(0)
  })

  it('counts facets rather than selected values', () => {
    expect(
      countGalleryFilters({
        ...EMPTY_GALLERY_FILTERS,
        types: [Video, Movie, Show],
      }),
    ).toBe(1)
  })

  it('counts a date range as one filter with two ends', () => {
    expect(
      countGalleryFilters({
        ...EMPTY_GALLERY_FILTERS,
        from: '2026-01-01',
        to: '2026-03-31',
      }),
    ).toBe(1)
  })

  it('counts an open-ended range', () => {
    expect(
      countGalleryFilters({ ...EMPTY_GALLERY_FILTERS, to: '2026-03-31' }),
    ).toBe(1)
  })

  it('counts every facet that is narrowed', () => {
    expect(
      countGalleryFilters({
        types: [Movie],
        requester: 'a@b.c',
        from: '2026-01-01',
        to: '2026-03-31',
      }),
    ).toBe(3)
  })
})

describe('isInvertedGalleryRange', () => {
  it('is false for an ordered range', () => {
    expect(
      isInvertedGalleryRange({
        ...EMPTY_GALLERY_FILTERS,
        from: '2026-01-01',
        to: '2026-03-31',
      }),
    ).toBe(false)
  })

  it('is false for the same day at both ends', () => {
    expect(
      isInvertedGalleryRange({
        ...EMPTY_GALLERY_FILTERS,
        from: '2026-01-01',
        to: '2026-01-01',
      }),
    ).toBe(false)
  })

  it('is false for an open-ended range, which cannot be inverted', () => {
    expect(
      isInvertedGalleryRange({ ...EMPTY_GALLERY_FILTERS, from: '2026-05-01' }),
    ).toBe(false)
  })

  it('is true when the start is after the end', () => {
    expect(
      isInvertedGalleryRange({
        ...EMPTY_GALLERY_FILTERS,
        from: '2026-05-01',
        to: '2026-01-01',
      }),
    ).toBe(true)
  })
})

describe('formatGalleryRangeLabel', () => {
  it('renders a closed range with an en dash', () => {
    expect(formatGalleryRangeLabel('2026-01-01', '2026-03-31')).toBe(
      '2026-01-01 – 2026-03-31',
    )
  })

  it('renders an open upper bound', () => {
    expect(formatGalleryRangeLabel('2026-01-01', null)).toBe('From 2026-01-01')
  })

  it('renders an open lower bound', () => {
    expect(formatGalleryRangeLabel(null, '2026-03-31')).toBe('Until 2026-03-31')
  })
})

describe('galleryFilterChips', () => {
  it('produces no chips for an unfiltered gallery', () => {
    expect(galleryFilterChips(EMPTY_GALLERY_FILTERS)).toEqual([])
  })

  it('produces one chip per selected type, named by its value', () => {
    const chips = galleryFilterChips({
      ...EMPTY_GALLERY_FILTERS,
      types: [Movie, Show],
    })

    expect(chips.map(chip => chip.label)).toEqual(['Movies', 'Shows'])
    expect(chips.map(chip => chip.removeLabel)).toEqual([
      'Remove Movies filter',
      'Remove Shows filter',
    ])
  })

  it('removes only the type its chip names', () => {
    const chips = galleryFilterChips({
      ...EMPTY_GALLERY_FILTERS,
      types: [Movie, Show],
    })

    expect(chips[0]?.next.types).toEqual([Show])
    expect(chips[1]?.next.types).toEqual([Movie])
  })

  it('names the uploader chip by the uploader, never just "Remove"', () => {
    const [chip] = galleryFilterChips({
      ...EMPTY_GALLERY_FILTERS,
      requester: 'jeremy@lilnas.io',
    })

    expect(chip?.label).toBe('jeremy@lilnas.io')
    expect(chip?.removeLabel).toBe('Remove uploader filter jeremy@lilnas.io')
    expect(chip?.next.requester).toBeNull()
  })

  it('collapses the date range into one chip that removes both ends', () => {
    const chips = galleryFilterChips({
      ...EMPTY_GALLERY_FILTERS,
      from: '2026-01-01',
      to: '2026-03-31',
    })

    expect(chips).toHaveLength(1)
    expect(chips[0]?.label).toBe('2026-01-01 – 2026-03-31')
    expect(chips[0]?.next.from).toBeNull()
    expect(chips[0]?.next.to).toBeNull()
  })

  it('leaves every other facet alone when one chip is removed', () => {
    const filters: GalleryFilters = {
      types: [Movie],
      requester: 'a@b.c',
      from: '2026-01-01',
      to: '2026-03-31',
    }

    const chips = galleryFilterChips(filters)
    const range = chips.find(chip => chip.key === 'range')

    expect(range?.next.types).toEqual([Movie])
    expect(range?.next.requester).toBe('a@b.c')
  })

  it('gives every chip a distinct key', () => {
    const chips = galleryFilterChips({
      types: [Video, Movie, Show],
      requester: 'a@b.c',
      from: '2026-01-01',
      to: null,
    })

    expect(new Set(chips.map(chip => chip.key)).size).toBe(chips.length)
  })
})
