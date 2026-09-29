import {
  buildFlaggedTerms,
  FLAGGED_RELEASE_PROFILE_NAME,
  planFlaggedReleaseProfile,
  profileTerms,
  type ReleaseProfileLike,
} from 'src/media/flagged-release-terms.util'

/** The managed profile as Radarr/Sonarr would hand it back. */
function managed(
  id: number,
  ignored: unknown,
  overrides: Partial<ReleaseProfileLike> = {},
): ReleaseProfileLike {
  return {
    enabled: true,
    id,
    ignored,
    indexerId: 0,
    name: FLAGGED_RELEASE_PROFILE_NAME,
    required: [],
    tags: [],
    ...overrides,
  }
}

describe('FLAGGED_RELEASE_PROFILE_NAME', () => {
  it('carries the managed-profile prefix', () => {
    expect(FLAGGED_RELEASE_PROFILE_NAME).toBe('lilnas · Flagged releases')
  })
})

describe('buildFlaggedTerms', () => {
  it('trims titles and drops blanks', () => {
    expect(buildFlaggedTerms(['  Movie.2020.1080p  ', '', '   '])).toEqual({
      skipped: [],
      terms: ['Movie.2020.1080p'],
    })
  })

  it('dedupes case-insensitively, keeping the first casing seen', () => {
    expect(
      buildFlaggedTerms([
        'Movie.2020.1080p',
        'MOVIE.2020.1080P',
        ' movie.2020.1080p',
      ]),
    ).toEqual({ skipped: [], terms: ['Movie.2020.1080p'] })
  })

  it('skips a title containing a slash - it could read as a regex', () => {
    expect(
      buildFlaggedTerms(['AC/DC.Live.1080p', 'Fine.Title', 'AC/DC.Live.1080p']),
    ).toEqual({ skipped: ['AC/DC.Live.1080p'], terms: ['Fine.Title'] })
  })

  it('keeps commas inside a term', () => {
    expect(buildFlaggedTerms(['Hello, World.2020']).terms).toEqual([
      'Hello, World.2020',
    ])
  })

  it('sorts, so the same flags always build the same list', () => {
    expect(buildFlaggedTerms(['b', 'a', 'C']).terms).toEqual(['C', 'a', 'b'])
  })

  it('is empty for no titles', () => {
    expect(buildFlaggedTerms([])).toEqual({ skipped: [], terms: [] })
  })
})

describe('profileTerms', () => {
  it('reads a string array, dropping non-strings', () => {
    expect(profileTerms(['a', 1, 'b'])).toEqual(['a', 'b'])
  })

  it('reads a comma-separated string', () => {
    expect(profileTerms(' a , b,,')).toEqual(['a', 'b'])
  })

  it('reads anything else as no terms', () => {
    expect(profileTerms(null)).toEqual([])
    expect(profileTerms(undefined)).toEqual([])
  })
})

describe('planFlaggedReleaseProfile', () => {
  const expectedBody = {
    enabled: true,
    ignored: ['a', 'b'],
    indexerId: 0,
    name: FLAGGED_RELEASE_PROFILE_NAME,
    required: [],
    tags: [],
  }

  it('creates the profile when there is none', () => {
    expect(planFlaggedReleaseProfile([], ['a', 'b'])).toEqual({
      create: expectedBody,
      deleteIds: [],
    })
  })

  it('does nothing when the term set is unchanged, in any order', () => {
    expect(
      planFlaggedReleaseProfile([managed(5, ['b', 'a'])], ['a', 'b']),
    ).toEqual({ deleteIds: [] })
  })

  it('does nothing when the terms differ only in case', () => {
    expect(
      planFlaggedReleaseProfile([managed(5, ['A', 'b'])], ['a', 'B']),
    ).toEqual({ deleteIds: [] })
  })

  it('updates in place when the term set changed', () => {
    expect(planFlaggedReleaseProfile([managed(5, ['a'])], ['a', 'b'])).toEqual({
      deleteIds: [],
      update: { ...expectedBody, id: 5 },
    })
  })

  it.each<[string, Partial<ReleaseProfileLike>]>([
    ['disabled', { enabled: false }],
    ['enabled missing', { enabled: undefined }],
    ['scoped to an indexer', { indexerId: 3 }],
    ['scoped to tags', { tags: [1] }],
    ['given required terms', { required: ['x'] }],
  ])('updates when the profile was %s by hand', (_, drift) => {
    expect(
      planFlaggedReleaseProfile([managed(5, ['a', 'b'], drift)], ['a', 'b'])
        .update,
    ).toEqual({ ...expectedBody, id: 5 })
  })

  it('deletes the profile when there are no terms', () => {
    expect(planFlaggedReleaseProfile([managed(5, ['a'])], [])).toEqual({
      deleteIds: [5],
    })
  })

  it('does nothing with no terms and no profile', () => {
    expect(planFlaggedReleaseProfile([], [])).toEqual({ deleteIds: [] })
  })

  it('never touches a profile under another name', () => {
    const other = { ...managed(9, ['a']), name: 'Something else' }

    expect(planFlaggedReleaseProfile([other], ['a'])).toEqual({
      create: { ...expectedBody, ignored: ['a'] },
      deleteIds: [],
    })
    expect(planFlaggedReleaseProfile([other], [])).toEqual({ deleteIds: [] })
  })

  it('keeps the first of duplicate managed profiles and deletes the rest', () => {
    expect(
      planFlaggedReleaseProfile(
        [managed(5, ['a', 'b']), managed(6, ['a'])],
        ['a', 'b'],
      ),
    ).toEqual({ deleteIds: [6] })
  })
})
