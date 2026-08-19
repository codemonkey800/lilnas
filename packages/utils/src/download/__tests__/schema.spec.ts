import {
  ActivityQuerySchema,
  DiscoverQuerySchema,
  GalleryFacetsQuerySchema,
  GalleryQuerySchema,
  HistoryQuerySchema,
} from 'src/download/schema'

describe('ActivityQuerySchema', () => {
  it('defaults limit to 24 and leaves type undefined when omitted', () => {
    const result = ActivityQuerySchema.parse({})
    expect(result).toEqual({ limit: 24 })
  })

  it('coerces a numeric string limit', () => {
    expect(ActivityQuerySchema.parse({ limit: '5' }).limit).toBe(5)
  })

  it.each(['0', '101', 'abc'])('rejects an invalid limit %s', invalid => {
    expect(ActivityQuerySchema.safeParse({ limit: invalid }).success).toBe(
      false,
    )
  })

  it('accepts a single type', () => {
    const result = ActivityQuerySchema.parse({ type: 'movie' })
    expect(result.type).toEqual(['movie'])
  })

  it('accepts a comma-separated multi type', () => {
    const result = ActivityQuerySchema.parse({ type: 'movie,video' })
    expect(result.type).toEqual(['movie', 'video'])
  })

  it('accepts a repeated-param multi type (array input)', () => {
    const result = ActivityQuerySchema.parse({ type: ['movie', 'video'] })
    expect(result.type).toEqual(['movie', 'video'])
  })

  it('rejects an unknown type', () => {
    expect(ActivityQuerySchema.safeParse({ type: 'bogus' }).success).toBe(false)
  })

  it('passes cursor through untouched', () => {
    expect(ActivityQuerySchema.parse({ cursor: 'abc123' }).cursor).toBe(
      'abc123',
    )
  })
})

describe('GalleryQuerySchema', () => {
  it('parses valid ISO date-only from/to bounds', () => {
    const result = GalleryQuerySchema.parse({
      from: '2026-01-01',
      to: '2026-01-31',
    })

    expect(result.from).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(result.to).toEqual(new Date('2026-01-31T23:59:59.999Z'))
  })

  it('rejects a garbage date format', () => {
    expect(GalleryQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(
      false,
    )
    expect(GalleryQuerySchema.safeParse({ from: '2026-13-40' }).success).toBe(
      false,
    )
  })

  it('rejects an inverted date range', () => {
    const result = GalleryQuerySchema.safeParse({
      from: '2026-02-01',
      to: '2026-01-01',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a range where from equals to', () => {
    const result = GalleryQuerySchema.safeParse({
      from: '2026-01-01',
      to: '2026-01-01',
    })

    expect(result.success).toBe(true)
  })

  it('accepts a requester filter', () => {
    expect(
      GalleryQuerySchema.parse({ requester: 'alice@example.com' }).requester,
    ).toBe('alice@example.com')
  })
})

describe('GalleryFacetsQuerySchema', () => {
  it('rejects an inverted date range', () => {
    expect(
      GalleryFacetsQuerySchema.safeParse({
        from: '2026-02-01',
        to: '2026-01-01',
      }).success,
    ).toBe(false)
  })

  it('accepts no filters at all', () => {
    expect(GalleryFacetsQuerySchema.safeParse({}).success).toBe(true)
  })
})

describe('HistoryQuerySchema', () => {
  it('defaults limit and leaves requester undefined when omitted', () => {
    expect(HistoryQuerySchema.parse({})).toEqual({ limit: 24 })
  })

  it('accepts an explicit requester', () => {
    expect(
      HistoryQuerySchema.parse({ requester: 'bob@example.com' }).requester,
    ).toBe('bob@example.com')
  })
})

describe('DiscoverQuerySchema', () => {
  it('requires at least a 2-character query', () => {
    expect(DiscoverQuerySchema.safeParse({ query: 'a' }).success).toBe(false)
    expect(DiscoverQuerySchema.safeParse({ query: 'ab' }).success).toBe(true)
  })

  it('defaults sort to relevance', () => {
    expect(DiscoverQuerySchema.parse({ query: 'the office' }).sort).toBe(
      'relevance',
    )
  })

  it('rejects an unknown sort value', () => {
    expect(
      DiscoverQuerySchema.safeParse({ query: 'ab', sort: 'bogus' }).success,
    ).toBe(false)
  })

  it('accepts a multi-value genre filter', () => {
    const result = DiscoverQuerySchema.parse({
      genre: 'Action,Comedy',
      query: 'ab',
    })
    expect(result.genre).toEqual(['Action', 'Comedy'])
  })

  it('leaves genre undefined when omitted', () => {
    expect(DiscoverQuerySchema.parse({ query: 'ab' }).genre).toBeUndefined()
  })

  it('coerces yearFrom/yearTo to numbers', () => {
    const result = DiscoverQuerySchema.parse({
      query: 'ab',
      yearFrom: '2000',
      yearTo: '2010',
    })
    expect(result.yearFrom).toBe(2000)
    expect(result.yearTo).toBe(2010)
  })

  it('rejects an inverted year range', () => {
    expect(
      DiscoverQuerySchema.safeParse({
        query: 'ab',
        yearFrom: '2010',
        yearTo: '2000',
      }).success,
    ).toBe(false)
  })
})
