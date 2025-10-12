import {
  RadarrImageType,
  RadarrMinimumAvailability,
  RadarrMovieResource,
  RadarrMovieStatus,
} from 'src/media/types/radarr.types'
import {
  transformToSearchResult,
  transformToSearchResults,
} from 'src/media/utils/radarr.utils'

describe('radarr.utils', () => {
  describe('transformToSearchResult', () => {
    const createMockRadarrMovie = (
      overrides: Partial<RadarrMovieResource> = {},
    ): RadarrMovieResource => ({
      tmdbId: 12345,
      imdbId: 'tt1234567',
      title: 'Test Movie',
      originalTitle: 'Original Test Movie',
      year: 2023,
      overview: 'A great test movie',
      runtime: 120,
      genres: ['Action', 'Drama'],
      ratings: {
        imdb: {
          votes: 1000,
          value: 8.5,
          type: 'imdb',
        },
        tmdb: {
          votes: 500,
          value: 7.8,
          type: 'tmdb',
        },
      },
      images: [
        {
          coverType: RadarrImageType.POSTER,
          url: 'https://example.com/poster.jpg',
          remoteUrl: 'https://example.com/poster.jpg',
        },
        {
          coverType: RadarrImageType.FANART,
          url: 'https://example.com/fanart.jpg',
          remoteUrl: 'https://example.com/fanart.jpg',
        },
      ],
      inCinemas: '2023-06-15',
      physicalRelease: '2023-09-15',
      digitalRelease: '2023-08-15',
      status: RadarrMovieStatus.RELEASED,
      certification: 'PG-13',
      studio: 'Test Studios',
      website: 'https://example.com',
      youTubeTrailerId: 'dQw4w9WgXcQ',
      popularity: 85.5,
      hasFile: false,
      cleanTitle: 'testmovie',
      titleSlug: 'test-movie-2023',
      added: '2023-01-01T00:00:00Z',
      minimumAvailability: RadarrMinimumAvailability.RELEASED,
      isAvailable: true,
      path: '/movies/Test Movie (2023)',
      ...overrides,
    })

    it('should transform a complete RadarrMovieResource to MovieSearchResult', () => {
      const mockMovie = createMockRadarrMovie()

      const result = transformToSearchResult(mockMovie)

      expect(result).toEqual({
        tmdbId: 12345,
        imdbId: 'tt1234567',
        title: 'Test Movie',
        originalTitle: 'Original Test Movie',
        year: 2023,
        overview: 'A great test movie',
        runtime: 120,
        genres: ['Action', 'Drama'],
        rating: 8.5, // Should prefer IMDB rating
        posterPath: 'https://example.com/poster.jpg',
        backdropPath: 'https://example.com/fanart.jpg',
        inCinemas: '2023-06-15',
        physicalRelease: '2023-09-15',
        digitalRelease: '2023-08-15',
        status: RadarrMovieStatus.RELEASED,
        certification: 'PG-13',
        studio: 'Test Studios',
        website: 'https://example.com',
        youTubeTrailerId: 'dQw4w9WgXcQ',
        popularity: 85.5,
      })
    })

    it('should use TMDB rating when IMDB rating is not available', () => {
      const mockMovie = createMockRadarrMovie({
        ratings: {
          tmdb: {
            votes: 500,
            value: 7.8,
            type: 'tmdb',
          },
        },
      })

      const result = transformToSearchResult(mockMovie)

      expect(result.rating).toBe(7.8)
    })

    it('should handle missing or empty images gracefully', () => {
      const mockMovie = createMockRadarrMovie({
        images: [],
      })

      const result = transformToSearchResult(mockMovie)

      expect(result.posterPath).toBeUndefined()
      expect(result.backdropPath).toBeUndefined()
    })

    it('should handle images with empty URLs', () => {
      const mockMovie = createMockRadarrMovie({
        images: [
          {
            coverType: RadarrImageType.POSTER,
            url: '',
            remoteUrl: '',
          },
          {
            coverType: RadarrImageType.FANART,
            url: '   ', // whitespace only
            remoteUrl: '   ',
          },
        ],
      })

      const result = transformToSearchResult(mockMovie)

      expect(result.posterPath).toBeUndefined()
      expect(result.backdropPath).toBeUndefined()
    })

    it('should filter out invalid years', () => {
      const testCases = [
        { year: 1899, expected: undefined },
        { year: 2101, expected: undefined },
        { year: 1900, expected: 1900 },
        { year: 2100, expected: 2100 },
        { year: 2023, expected: 2023 },
      ]

      testCases.forEach(({ year, expected }) => {
        const mockMovie = createMockRadarrMovie({ year })
        const result = transformToSearchResult(mockMovie)
        expect(result.year).toBe(expected)
      })
    })

    it('should handle undefined year', () => {
      const mockMovie = createMockRadarrMovie({ year: undefined })

      const result = transformToSearchResult(mockMovie)

      expect(result.year).toBeUndefined()
    })

    it('should filter out invalid websites', () => {
      const testCases = [
        { website: '', expected: undefined },
        { website: '   ', expected: undefined },
        { website: undefined, expected: undefined },
        { website: 'https://example.com', expected: 'https://example.com' },
      ]

      testCases.forEach(({ website, expected }) => {
        const mockMovie = createMockRadarrMovie({ website })
        const result = transformToSearchResult(mockMovie)
        expect(result.website).toBe(expected)
      })
    })

    it('should handle missing optional fields', () => {
      const mockMovie = createMockRadarrMovie({
        imdbId: undefined,
        originalTitle: undefined,
        overview: undefined,
        runtime: undefined,
        inCinemas: undefined,
        physicalRelease: undefined,
        digitalRelease: undefined,
        certification: undefined,
        studio: undefined,
        website: undefined,
        youTubeTrailerId: undefined,
        popularity: undefined,
        ratings: {},
      })

      const result = transformToSearchResult(mockMovie)

      expect(result.imdbId).toBeUndefined()
      expect(result.originalTitle).toBeUndefined()
      expect(result.overview).toBeUndefined()
      expect(result.runtime).toBeUndefined()
      expect(result.inCinemas).toBeUndefined()
      expect(result.physicalRelease).toBeUndefined()
      expect(result.digitalRelease).toBeUndefined()
      expect(result.certification).toBeUndefined()
      expect(result.studio).toBeUndefined()
      expect(result.website).toBeUndefined()
      expect(result.youTubeTrailerId).toBeUndefined()
      expect(result.popularity).toBeUndefined()
      expect(result.rating).toBeUndefined()
    })

    it('should handle empty genres array', () => {
      const mockMovie = createMockRadarrMovie({ genres: [] })

      const result = transformToSearchResult(mockMovie)

      expect(result.genres).toEqual([])
    })

    it('should preserve required fields even when undefined in source', () => {
      const mockMovie: RadarrMovieResource = {
        tmdbId: 12345,
        title: 'Minimal Movie',
        status: RadarrMovieStatus.TBA,
        genres: [],
        images: [],
        hasFile: false,
        cleanTitle: 'minimalmovie',
        titleSlug: 'minimal-movie',
        added: '2023-01-01T00:00:00Z',
        minimumAvailability: RadarrMinimumAvailability.TBA,
        isAvailable: false,
        path: '/movies/Minimal Movie',
        year: 2023,
        runtime: 0,
        ratings: {},
      }

      const result = transformToSearchResult(mockMovie)

      expect(result.tmdbId).toBe(12345)
      expect(result.title).toBe('Minimal Movie')
      expect(result.status).toBe(RadarrMovieStatus.TBA)
      expect(result.genres).toEqual([])
    })
  })

  describe('transformToSearchResults', () => {
    it('should transform an array of RadarrMovieResource to MovieSearchResult array', () => {
      const mockMovies: RadarrMovieResource[] = [
        {
          tmdbId: 1,
          title: 'Movie 1',
          status: RadarrMovieStatus.RELEASED,
          genres: ['Action'],
          images: [],
          hasFile: true,
          cleanTitle: 'movie1',
          titleSlug: 'movie-1',
          added: '2023-01-01T00:00:00Z',
          minimumAvailability: RadarrMinimumAvailability.RELEASED,
          isAvailable: true,
          path: '/movies/Movie 1',
          year: 2023,
          runtime: 90,
          ratings: {},
        },
        {
          tmdbId: 2,
          title: 'Movie 2',
          status: RadarrMovieStatus.IN_CINEMAS,
          genres: ['Drama'],
          images: [],
          hasFile: false,
          cleanTitle: 'movie2',
          titleSlug: 'movie-2',
          added: '2023-01-02T00:00:00Z',
          minimumAvailability: RadarrMinimumAvailability.IN_CINEMAS,
          isAvailable: true,
          path: '/movies/Movie 2',
          year: 2023,
          runtime: 120,
          ratings: {},
        },
      ]

      const results = transformToSearchResults(mockMovies)

      expect(results).toHaveLength(2)
      expect(results[0].tmdbId).toBe(1)
      expect(results[0].title).toBe('Movie 1')
      expect(results[1].tmdbId).toBe(2)
      expect(results[1].title).toBe('Movie 2')
    })

    it('should handle empty array', () => {
      const results = transformToSearchResults([])

      expect(results).toEqual([])
    })

    it('should maintain order of input array', () => {
      const mockMovies: RadarrMovieResource[] = [
        {
          tmdbId: 3,
          title: 'Third Movie',
          status: RadarrMovieStatus.RELEASED,
          genres: [],
          images: [],
          hasFile: true,
          cleanTitle: 'thirdmovie',
          titleSlug: 'third-movie',
          added: '2023-01-03T00:00:00Z',
          minimumAvailability: RadarrMinimumAvailability.RELEASED,
          isAvailable: true,
          path: '/movies/Third Movie',
          year: 2023,
          runtime: 100,
          ratings: {},
        },
        {
          tmdbId: 1,
          title: 'First Movie',
          status: RadarrMovieStatus.RELEASED,
          genres: [],
          images: [],
          hasFile: true,
          cleanTitle: 'firstmovie',
          titleSlug: 'first-movie',
          added: '2023-01-01T00:00:00Z',
          minimumAvailability: RadarrMinimumAvailability.RELEASED,
          isAvailable: true,
          path: '/movies/First Movie',
          year: 2023,
          runtime: 80,
          ratings: {},
        },
      ]

      const results = transformToSearchResults(mockMovies)

      expect(results[0].title).toBe('Third Movie')
      expect(results[1].title).toBe('First Movie')
    })
  })
})
