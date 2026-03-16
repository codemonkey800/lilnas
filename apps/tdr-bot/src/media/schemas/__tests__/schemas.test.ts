import { ZodError } from 'zod'

import {
  OptionalSearchQuerySchema,
  SearchQuerySchema,
} from 'src/media/schemas/media.schemas'
import {
  RadarrInputSchemas,
  RadarrOutputSchemas,
} from 'src/media/schemas/radarr.schemas'
import {
  SonarrInputSchemas,
  SonarrOutputSchemas,
} from 'src/media/schemas/sonarr.schemas'
import {
  DownloadProtocol,
  RadarrMovieStatus,
  RadarrQueueStatus,
} from 'src/media/types/radarr.types'
import {
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'

/**
 * Direct Zod schema tests covering boundary inputs and edge cases.
 *
 * These tests catch issues if the input type shapes change (e.g., during
 * migration from custom types to @lilnas/media OpenAPI types).
 */

describe('SearchQuerySchema', () => {
  it('should accept a valid 2-character query', () => {
    expect(() => SearchQuerySchema.parse({ query: 'ab' })).not.toThrow()
  })

  it('should accept a query of exactly 200 characters', () => {
    const longQuery = 'a'.repeat(200)

    expect(() => SearchQuerySchema.parse({ query: longQuery })).not.toThrow()
  })

  it('should reject a 1-character query (too short)', () => {
    expect(() => SearchQuerySchema.parse({ query: 'a' })).toThrow(ZodError)
  })

  it('should reject a 201-character query (too long)', () => {
    const tooLong = 'a'.repeat(201)

    expect(() => SearchQuerySchema.parse({ query: tooLong })).toThrow(ZodError)
  })

  it('should trim leading/trailing whitespace from query', () => {
    const result = SearchQuerySchema.parse({ query: '  fight club  ' })

    expect(result.query).toBe('fight club')
  })

  it('should reject a query that is only whitespace (trims to empty, too short)', () => {
    expect(() => SearchQuerySchema.parse({ query: '   ' })).toThrow(ZodError)
  })
})

describe('OptionalSearchQuerySchema', () => {
  it('should accept an undefined query (no search)', () => {
    const result = OptionalSearchQuerySchema.parse({ query: undefined })

    expect(result.query).toBeUndefined()
  })

  it('should accept a valid query string', () => {
    const result = OptionalSearchQuerySchema.parse({ query: 'breaking bad' })

    expect(result.query).toBe('breaking bad')
  })

  it('should accept an empty object (no query field)', () => {
    const result = OptionalSearchQuerySchema.parse({})

    expect(result.query).toBeUndefined()
  })

  it('should reject a 1-character query even when optional', () => {
    expect(() => OptionalSearchQuerySchema.parse({ query: 'x' })).toThrow(
      ZodError,
    )
  })
})

describe('RadarrInputSchemas.searchQuery', () => {
  it('should accept valid 2-character query', () => {
    const result = RadarrInputSchemas.searchQuery.parse({ query: 'bb' })

    expect(result.query).toBe('bb')
  })

  it('should reject empty string', () => {
    expect(() => RadarrInputSchemas.searchQuery.parse({ query: '' })).toThrow(
      ZodError,
    )
  })
})

describe('RadarrOutputSchemas.movieSearchResultArray', () => {
  const validMovieSearchResult = {
    tmdbId: 550,
    title: 'Fight Club',
    status: RadarrMovieStatus.RELEASED,
    genres: ['Drama'],
  }

  it('should accept a valid movie search result array', () => {
    expect(() =>
      RadarrOutputSchemas.movieSearchResultArray.parse([
        validMovieSearchResult,
      ]),
    ).not.toThrow()
  })

  it('should accept an empty array', () => {
    const result = RadarrOutputSchemas.movieSearchResultArray.parse([])

    expect(result).toHaveLength(0)
  })

  it('should reject a result with a missing required tmdbId', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tmdbId: _omitted, ...withoutTmdbId } = validMovieSearchResult

    expect(() =>
      RadarrOutputSchemas.movieSearchResultArray.parse([withoutTmdbId]),
    ).toThrow(ZodError)
  })

  it('should reject a result with an invalid status value', () => {
    expect(() =>
      RadarrOutputSchemas.movieSearchResultArray.parse([
        { ...validMovieSearchResult, status: 'not-a-status' },
      ]),
    ).toThrow(ZodError)
  })

  it('should accept optional fields as undefined', () => {
    const result = RadarrOutputSchemas.movieSearchResultArray.parse([
      validMovieSearchResult,
    ])

    expect(result[0].rating).toBeUndefined()
    expect(result[0].posterPath).toBeUndefined()
    expect(result[0].year).toBeUndefined()
  })
})

describe('RadarrOutputSchemas.downloadingMovieArray', () => {
  const validDownloadingMovie = {
    id: 1,
    size: 2000000000,
    status: RadarrQueueStatus.DOWNLOADING,
    protocol: DownloadProtocol.TORRENT,
    sizeleft: 1000000000,
    progressPercent: 50,
    downloadedBytes: 1000000000,
  }

  it('should accept a valid downloading movie', () => {
    expect(() =>
      RadarrOutputSchemas.downloadingMovieArray.parse([validDownloadingMovie]),
    ).not.toThrow()
  })

  it('should reject progressPercent > 100', () => {
    expect(() =>
      RadarrOutputSchemas.downloadingMovieArray.parse([
        { ...validDownloadingMovie, progressPercent: 101 },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject progressPercent < 0', () => {
    expect(() =>
      RadarrOutputSchemas.downloadingMovieArray.parse([
        { ...validDownloadingMovie, progressPercent: -1 },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject downloadedBytes < 0', () => {
    expect(() =>
      RadarrOutputSchemas.downloadingMovieArray.parse([
        { ...validDownloadingMovie, downloadedBytes: -1 },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject negative size', () => {
    expect(() =>
      RadarrOutputSchemas.downloadingMovieArray.parse([
        { ...validDownloadingMovie, size: -1 },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject invalid status enum value', () => {
    expect(() =>
      RadarrOutputSchemas.downloadingMovieArray.parse([
        { ...validDownloadingMovie, status: 'invalid-status' },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject invalid protocol enum value', () => {
    expect(() =>
      RadarrOutputSchemas.downloadingMovieArray.parse([
        { ...validDownloadingMovie, protocol: 'invalid-protocol' },
      ]),
    ).toThrow(ZodError)
  })
})

describe('SonarrInputSchemas.monitorSeriesOptions', () => {
  it('should accept empty options (monitor entire series)', () => {
    expect(() =>
      SonarrInputSchemas.monitorSeriesOptions.parse({}),
    ).not.toThrow()
  })

  it('should accept a selection with whole-season items', () => {
    expect(() =>
      SonarrInputSchemas.monitorSeriesOptions.parse({
        selection: [{ season: 1 }, { season: 2 }],
      }),
    ).not.toThrow()
  })

  it('should accept a selection with specific episode numbers', () => {
    expect(() =>
      SonarrInputSchemas.monitorSeriesOptions.parse({
        selection: [{ season: 1, episodes: [1, 2, 3] }],
      }),
    ).not.toThrow()
  })

  it('should reject negative season numbers', () => {
    expect(() =>
      SonarrInputSchemas.monitorSeriesOptions.parse({
        selection: [{ season: -1 }],
      }),
    ).toThrow(ZodError)
  })

  it('should reject negative episode numbers', () => {
    expect(() =>
      SonarrInputSchemas.monitorSeriesOptions.parse({
        selection: [{ season: 1, episodes: [-1] }],
      }),
    ).toThrow(ZodError)
  })
})

describe('SonarrOutputSchemas.seriesSearchResultArray', () => {
  const validSeriesSearchResult = {
    tvdbId: 81189,
    title: 'Breaking Bad',
    titleSlug: 'breaking-bad',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [],
    genres: ['Crime', 'Drama'],
    ended: true,
  }

  it('should accept a valid series search result', () => {
    expect(() =>
      SonarrOutputSchemas.seriesSearchResultArray.parse([
        validSeriesSearchResult,
      ]),
    ).not.toThrow()
  })

  it('should accept an empty array', () => {
    const result = SonarrOutputSchemas.seriesSearchResultArray.parse([])

    expect(result).toHaveLength(0)
  })

  it('should reject a result missing required tvdbId', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tvdbId: _omitted, ...withoutTvdbId } = validSeriesSearchResult

    expect(() =>
      SonarrOutputSchemas.seriesSearchResultArray.parse([withoutTvdbId]),
    ).toThrow(ZodError)
  })

  it('should reject an invalid status enum value', () => {
    expect(() =>
      SonarrOutputSchemas.seriesSearchResultArray.parse([
        { ...validSeriesSearchResult, status: 'not-a-status' },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject an invalid seriesType enum value', () => {
    expect(() =>
      SonarrOutputSchemas.seriesSearchResultArray.parse([
        { ...validSeriesSearchResult, seriesType: 'unknown-type' },
      ]),
    ).toThrow(ZodError)
  })

  it('should accept optional fields as undefined', () => {
    const result = SonarrOutputSchemas.seriesSearchResultArray.parse([
      validSeriesSearchResult,
    ])

    expect(result[0].rating).toBeUndefined()
    expect(result[0].posterPath).toBeUndefined()
    expect(result[0].year).toBeUndefined()
  })
})

describe('SonarrOutputSchemas.downloadingSeriesArray', () => {
  const validDownloadingSeries = {
    id: 1,
    size: 2000000000,
    sizeleft: 1000000000,
    status: 'downloading',
    protocol: 'torrent',
    progressPercent: 50,
    downloadedBytes: 1000000000,
    isActive: true,
  }

  it('should accept a valid downloading series object', () => {
    expect(() =>
      SonarrOutputSchemas.downloadingSeriesArray.parse([
        validDownloadingSeries,
      ]),
    ).not.toThrow()
  })

  it('should reject progressPercent > 100', () => {
    expect(() =>
      SonarrOutputSchemas.downloadingSeriesArray.parse([
        { ...validDownloadingSeries, progressPercent: 101 },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject progressPercent < 0', () => {
    expect(() =>
      SonarrOutputSchemas.downloadingSeriesArray.parse([
        { ...validDownloadingSeries, progressPercent: -1 },
      ]),
    ).toThrow(ZodError)
  })

  it('should reject negative downloadedBytes', () => {
    expect(() =>
      SonarrOutputSchemas.downloadingSeriesArray.parse([
        { ...validDownloadingSeries, downloadedBytes: -1 },
      ]),
    ).toThrow(ZodError)
  })

  it('should accept optional fields as undefined', () => {
    const result = SonarrOutputSchemas.downloadingSeriesArray.parse([
      validDownloadingSeries,
    ])

    expect(result[0].seriesTitle).toBeUndefined()
    expect(result[0].episodeTitle).toBeUndefined()
    expect(result[0].seasonNumber).toBeUndefined()
  })
})
