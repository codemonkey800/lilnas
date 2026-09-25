import {
  appliedFilterCount,
  DEFAULT_SEARCH_SORT,
  DEFAULT_SEARCH_VIEW,
  formatYearRange,
  hasAppliedFilters,
  hasValidYearRange,
  isSearchableQuery,
  parseSearchState,
  parseYear,
  SEARCH_PAGE_SIZE,
  SEARCH_SORT_DIRECTIONS,
  searchStateKey,
  searchStateToQueryString,
  toDiscoverQuery,
  toReadableSearchParams,
} from 'src/components/search/search-params'

function state(search: string) {
  return parseSearchState(new URLSearchParams(search))
}

describe('parseSearchState', () => {
  it('reads an empty URL as the defaults', () => {
    expect(state('')).toEqual({
      genres: [],
      query: '',
      sort: DEFAULT_SEARCH_SORT,
      view: DEFAULT_SEARCH_VIEW,
      yearFrom: null,
      yearTo: null,
    })
  })

  // ⚠️ The nav bar pushes `?q=the%20office`; Next then normalises the
  // *displayed* URL to `?q=the+office`. Both have to mean the same thing, and
  // they do precisely because nothing here splits a query string by hand.
  it.each([
    ['percent-encoded space', 'q=the%20office'],
    ['plus-encoded space', 'q=the+office'],
  ])('decodes a %s the same way', (_label, search) => {
    expect(state(search).query).toBe('the office')
  })

  it('trims the query', () => {
    expect(state('q=%20%20star%20%20').query).toBe('star')
  })

  it('reads repeated genre keys', () => {
    expect(state('genre=Action&genre=Drama').genres).toEqual([
      'Action',
      'Drama',
    ])
  })

  it('reads a comma-joined genre value, which the API also accepts', () => {
    expect(state('genre=Action,Drama').genres).toEqual(['Action', 'Drama'])
  })

  it('de-duplicates genres and drops blanks', () => {
    expect(state('genre=Action,,Action&genre=Drama').genres).toEqual([
      'Action',
      'Drama',
    ])
  })

  it('falls back rather than throwing on an unknown sort or view', () => {
    const parsed = state('sort=banana&view=carousel')

    expect(parsed.sort).toBe('relevance')
    expect(parsed.view).toBe('grid')
  })

  it('keeps a recognised sort and view', () => {
    expect(state('sort=releaseDate&view=list')).toMatchObject({
      sort: 'releaseDate',
      view: 'list',
    })
  })

  it('reads a year range', () => {
    expect(state('yearFrom=1999&yearTo=2012')).toMatchObject({
      yearFrom: 1999,
      yearTo: 2012,
    })
  })
})

describe('parseYear', () => {
  it.each([
    ['1999', 1999],
    [' 2012 ', 2012],
  ])('accepts %s', (input, expected) => {
    expect(parseYear(input)).toBe(expected)
  })

  // A half-typed year is not a year. Accepting `19` would fire a request for
  // everything since the Bronze Age on the way to `1999`.
  it.each([['19'], ['199'], ['19999'], ['19a9'], [''], ['abcd']])(
    'rejects %p',
    input => {
      expect(parseYear(input)).toBeNull()
    },
  )

  it('rejects null and undefined', () => {
    expect(parseYear(null)).toBeNull()
    expect(parseYear(undefined)).toBeNull()
  })
})

describe('toReadableSearchParams', () => {
  it("adapts Next's server record, including repeated keys", () => {
    const params = toReadableSearchParams({
      genre: ['Action', 'Drama'],
      missing: undefined,
      q: 'star',
    })

    expect(params.get('q')).toBe('star')
    expect(params.getAll('genre')).toEqual(['Action', 'Drama'])
    expect(params.has('missing')).toBe(false)
  })
})

describe('searchStateToQueryString', () => {
  it('omits everything at its default', () => {
    expect(searchStateToQueryString(state('q=star'))).toBe('?q=star')
  })

  it('round-trips a fully specified state', () => {
    const original = state(
      'q=star&genre=Action&genre=Drama&yearFrom=1999&yearTo=2012&sort=title&view=list',
    )

    expect(
      parseSearchState(new URLSearchParams(searchStateToQueryString(original))),
    ).toEqual(original)
  })

  it('is empty when nothing is set', () => {
    expect(searchStateToQueryString(state(''))).toBe('')
  })
})

describe('searchStateKey', () => {
  // The key drives `<SearchResults key={…}>`. Switching view must not throw
  // away the pages `LoadMore` appended, so it is excluded.
  it('ignores the view', () => {
    expect(searchStateKey(state('q=star&view=list'))).toBe(
      searchStateKey(state('q=star')),
    )
  })

  it.each([
    ['query', 'q=other'],
    ['genre', 'q=star&genre=Action'],
    ['year', 'q=star&yearFrom=1999'],
    ['sort', 'q=star&sort=title'],
  ])('changes with the %s', (_label, search) => {
    expect(searchStateKey(state(search))).not.toBe(
      searchStateKey(state('q=star')),
    )
  })
})

describe('isSearchableQuery', () => {
  it.each([
    ['', false],
    ['s', false],
    [' s ', false],
    ['st', true],
    ['star', true],
  ])('reads %p as %p', (query, expected) => {
    expect(isSearchableQuery(query)).toBe(expected)
  })
})

describe('hasValidYearRange', () => {
  it('accepts an open-ended range', () => {
    expect(hasValidYearRange(state('yearFrom=1999'))).toBe(true)
    expect(hasValidYearRange(state('yearTo=2012'))).toBe(true)
  })

  it('accepts an ordered range, including a single year', () => {
    expect(hasValidYearRange(state('yearFrom=1999&yearTo=2012'))).toBe(true)
    expect(hasValidYearRange(state('yearFrom=1999&yearTo=1999'))).toBe(true)
  })

  it('rejects an inverted range, which the API 400s on', () => {
    expect(hasValidYearRange(state('yearFrom=2012&yearTo=1999'))).toBe(false)
  })
})

describe('appliedFilterCount', () => {
  it('counts each genre, and the whole year range as one', () => {
    expect(appliedFilterCount(state('q=star'))).toBe(0)
    expect(appliedFilterCount(state('genre=Action&genre=Drama'))).toBe(2)
    expect(appliedFilterCount(state('yearFrom=1999&yearTo=2012'))).toBe(1)
    expect(appliedFilterCount(state('yearFrom=1999'))).toBe(1)
    expect(
      appliedFilterCount(state('genre=Action&yearFrom=1999&yearTo=2012')),
    ).toBe(2)
  })

  it('does not count sort or view as filters', () => {
    expect(hasAppliedFilters(state('q=star&sort=title&view=list'))).toBe(false)
  })
})

describe('formatYearRange', () => {
  it.each([
    [1999, 2012, '1999–2012'],
    [1999, null, '1999–'],
    [null, 2012, '–2012'],
  ])('renders %p to %p as %p', (from, to, expected) => {
    expect(formatYearRange(from, to)).toBe(expected)
  })
})

describe('toDiscoverQuery', () => {
  // ⚠️ The page's parameter is `q`; the API's is `query`, and it is required.
  // `?q=` alone answers `400 invalid_type` upstream.
  it('renames the page-level `q` to the API-level `query`', () => {
    const query = toDiscoverQuery(state('q=star'))

    expect(query.query).toBe('star')
    expect(query).not.toHaveProperty('q')
  })

  it('sends the page size and the sort, always', () => {
    expect(toDiscoverQuery(state('q=star'))).toEqual({
      limit: SEARCH_PAGE_SIZE,
      query: 'star',
      sort: 'relevance',
    })
  })

  it('omits absent filters rather than sending empty values', () => {
    const query = toDiscoverQuery(state('q=star'))

    expect(query).not.toHaveProperty('genre')
    expect(query).not.toHaveProperty('yearFrom')
    expect(query).not.toHaveProperty('yearTo')
    expect(query).not.toHaveProperty('cursor')
  })

  it('carries the filters and the cursor when they are set', () => {
    expect(
      toDiscoverQuery(
        state(
          'q=star&genre=Action&genre=Drama&yearFrom=1999&yearTo=2012&sort=title',
        ),
        'cursor-2',
      ),
    ).toEqual({
      cursor: 'cursor-2',
      genre: ['Action', 'Drama'],
      limit: SEARCH_PAGE_SIZE,
      query: 'star',
      sort: 'title',
      yearFrom: 1999,
      yearTo: 2012,
    })
  })
})

describe('SEARCH_SORT_DIRECTIONS', () => {
  // Read off `sortDiscoveryResults()` in the backend's discovery-ranking
  // module. If those ever diverge the table's chevron and `aria-sort` lie.
  it('matches how the API actually orders each column', () => {
    expect(SEARCH_SORT_DIRECTIONS).toEqual({
      releaseDate: 'descending',
      title: 'ascending',
    })
  })
})
