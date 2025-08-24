/**
 * @fileoverview Tests for Search Result Converter Utilities
 */

import { Logger } from '@nestjs/common'

import type { MediaSearchResult } from 'src/commands/media-search.types'
import type { RadarrMovie as RadarrMovieInterface } from 'src/media/clients/radarr.client'
import {
  convertRadarrMovieToSearchResult,
  validateSearchResultConsistency,
} from 'src/media/utils/search-result-converter'
import { MediaType } from 'src/types/enums'

// Mock dependencies
jest.mock('src/media/utils/image-url-extractor', () => ({
  extractPosterUrl: jest.fn(),
  getRadarrBaseUrl: jest.fn(),
}))

// Extended RadarrMovie interface to include optional properties
type RadarrMovie = RadarrMovieInterface & {
  hasFile?: boolean
  runtime?: number
  genres?: string[]
}

describe('Search Result Converter', () => {
  let mockLogger: jest.Mocked<Logger>
  let mockImageExtractor: {
    extractPosterUrl: jest.Mock
    getRadarrBaseUrl: jest.Mock
  }

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
      verbose: jest.fn(),
      fatal: jest.fn(),
      setContext: jest.fn(),
      localInstance: jest.fn(),
      registerLocalInstanceRef: jest.fn(),
      options: {},
    } as unknown as jest.Mocked<Logger>

    // Reset all mocks
    jest.clearAllMocks()

    // Get the mocked image extractor
    mockImageExtractor = jest.requireMock('src/media/utils/image-url-extractor')

    // Mock image extractor default behavior
    mockImageExtractor.extractPosterUrl.mockReturnValue({
      imageUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
      source: 'remotePoster',
    })
    mockImageExtractor.getRadarrBaseUrl.mockReturnValue(
      'http://radarr.localhost',
    )
  })

  describe('convertRadarrMovieToSearchResult', () => {
    const baseMovie: RadarrMovie = {
      id: 1,
      title: 'Test Movie',
      titleSlug: 'test-movie',
      year: 2023,
      tmdbId: 12345,
      monitored: true,
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      downloaded: false,
      status: 'wanted' as const,
    }

    describe('Normal Movies with Radarr ID', () => {
      it('should convert movie with radarrId properly', () => {
        const result = convertRadarrMovieToSearchResult(baseMovie, mockLogger)

        expect(result).toMatchObject({
          id: '12345', // TMDB ID as string
          title: 'Test Movie',
          year: 2023,
          tmdbId: 12345,
          radarrId: 1, // Radarr internal ID
          mediaType: MediaType.MOVIE,
          inLibrary: true, // Has Radarr ID
          monitored: true,
        })
        expect(result.hasFile).toBe(false) // Explicitly check false (not undefined)

        // Debug logging only occurs in development mode, so we expect it not to be called in test mode
        expect(mockLogger.debug).not.toHaveBeenCalledWith(
          expect.stringContaining('Converted Radarr movie to search result'),
          expect.any(Object),
        )
      })

      it('should handle movie with hasFile property', () => {
        const movieWithFile: RadarrMovie = {
          ...baseMovie,
          hasFile: true,
        }

        const result = convertRadarrMovieToSearchResult(
          movieWithFile,
          mockLogger,
        )

        expect(result.hasFile).toBe(true)
        expect(result.inLibrary).toBe(true)
        expect(result.radarrId).toBe(1)
      })

      it('should handle movie with downloaded property', () => {
        const movieDownloaded: RadarrMovie = {
          ...baseMovie,
          downloaded: true,
        }

        const result = convertRadarrMovieToSearchResult(
          movieDownloaded,
          mockLogger,
        )

        expect(result.hasFile).toBe(true)
        expect(result.inLibrary).toBe(true)
        expect(result.radarrId).toBe(1)
      })

      it('should handle movie with additional properties', () => {
        const movieWithExtras: RadarrMovie = {
          ...baseMovie,
          runtime: 120,
          genres: ['Action', 'Adventure'],
          overview: 'A test movie overview',
          imdbId: 'tt1234567',
        }

        const result = convertRadarrMovieToSearchResult(
          movieWithExtras,
          mockLogger,
        )

        expect(result).toMatchObject({
          runtime: 120,
          genres: ['Action', 'Adventure'],
          overview: 'A test movie overview',
          imdbId: 'tt1234567',
          inLibrary: true,
          radarrId: 1,
        })
      })
    })

    describe('External Movies without Radarr ID', () => {
      it('should convert external movie without radarrId', () => {
        const externalMovie: RadarrMovie = {
          ...baseMovie,
          id: undefined as unknown as number, // External movie has no Radarr ID
        }

        const result = convertRadarrMovieToSearchResult(
          externalMovie,
          mockLogger,
        )

        expect(result).toMatchObject({
          id: '12345', // Still uses TMDB ID for display
          title: 'Test Movie',
          tmdbId: 12345,
          radarrId: undefined, // No Radarr ID
          inLibrary: false, // Not in library
          monitored: true,
        })

        // Debug logging only occurs in development mode
        expect(mockLogger.debug).not.toHaveBeenCalledWith(
          expect.stringContaining('Converted Radarr movie to search result'),
          expect.any(Object),
        )
      })

      it('should handle external movie without TMDB ID', () => {
        const externalMovieNoTmdb: RadarrMovie = {
          ...baseMovie,
          id: undefined as unknown as number,
          tmdbId: undefined as unknown as number,
        }

        const result = convertRadarrMovieToSearchResult(
          externalMovieNoTmdb,
          mockLogger,
        )

        expect(result.id).toBe('unknown') // Fallback when no IDs available
        expect(result.tmdbId).toBeUndefined()
        expect(result.radarrId).toBeUndefined()
        expect(result.inLibrary).toBe(false)

        // Should log warning about missing essential data
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Movie missing essential data'),
          expect.objectContaining({
            title: 'Test Movie',
            tmdbId: undefined,
            warning: expect.stringContaining('missing title or TMDB ID'),
          }),
        )
      })
    })

    describe('Edge Cases', () => {
      it('should handle movie with radarrId = 0 (valid but falsy)', () => {
        const movieWithZeroId: RadarrMovie = {
          ...baseMovie,
          id: 0, // Valid Radarr ID but falsy
        }

        const result = convertRadarrMovieToSearchResult(
          movieWithZeroId,
          mockLogger,
        )

        expect(result).toMatchObject({
          radarrId: 0,
          inLibrary: true, // Should still be considered in library
          id: '12345', // Uses TMDB ID for display
        })

        // Should log debug message about edge case
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Edge case detected: movie has radarrId = 0'),
          expect.objectContaining({
            title: 'Test Movie',
            radarrId: 0,
            note: expect.stringContaining(
              'radarrId=0 is a valid Radarr ID but falsy',
            ),
          }),
        )
      })

      it('should handle movie missing title', () => {
        const movieWithoutTitle: RadarrMovie = {
          ...baseMovie,
          title: '',
        }

        const result = convertRadarrMovieToSearchResult(
          movieWithoutTitle,
          mockLogger,
        )

        expect(result.title).toBe('')
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Movie missing essential data'),
          expect.objectContaining({
            title: '',
            warning: expect.stringContaining('missing title or TMDB ID'),
          }),
        )
      })

      it('should use fallback ID when TMDB ID is missing', () => {
        const movieWithoutTmdbId: RadarrMovie = {
          ...baseMovie,
          tmdbId: undefined as unknown as number,
        }

        const result = convertRadarrMovieToSearchResult(
          movieWithoutTmdbId,
          mockLogger,
        )

        expect(result.id).toBe('1') // Falls back to Radarr ID
        expect(result.tmdbId).toBeUndefined()
        expect(result.radarrId).toBe(1)
      })
    })

    describe('Data Consistency Validation', () => {
      it('should perform validation on converted results', () => {
        // Test that validation is called on the result
        // We can't easily mock the internal validation call, but we can test
        // that the validation logic itself works correctly (tested in other sections)

        const normalMovie: RadarrMovie = {
          ...baseMovie,
          id: 1,
        }

        const result = convertRadarrMovieToSearchResult(normalMovie, mockLogger)

        // Ensure the result passes our validation function directly
        expect(validateSearchResultConsistency(result, mockLogger)).toBe(true)

        // Ensure no validation errors were logged for this valid result
        expect(mockLogger.error).not.toHaveBeenCalledWith(
          expect.stringContaining('Search result validation failed'),
          expect.anything(),
        )
      })
    })

    describe('Logging Functionality', () => {
      it('should work without logger', () => {
        const result = convertRadarrMovieToSearchResult(baseMovie)

        expect(result).toMatchObject({
          inLibrary: true,
          radarrId: 1,
        })
        // No logger calls should be made
      })

      it('should handle development mode debug logging', () => {
        const originalEnv = process.env.NODE_ENV
        Object.defineProperty(process.env, 'NODE_ENV', {
          value: 'development',
          writable: true,
          configurable: true,
        })

        // Use the already mocked image extractor
        mockImageExtractor.extractPosterUrl.mockReturnValue({
          imageUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
          source: 'remotePoster',
          debug: {
            remotePosterUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
          },
        })

        convertRadarrMovieToSearchResult(baseMovie, mockLogger)

        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Poster URL extraction result'),
          expect.objectContaining({
            title: 'Test Movie',
            source: 'remotePoster',
          }),
        )

        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining('Converted Radarr movie to search result'),
          expect.objectContaining({
            movieTitle: 'Test Movie',
            dataConsistent: true,
          }),
        )

        Object.defineProperty(process.env, 'NODE_ENV', {
          value: originalEnv,
          writable: true,
          configurable: true,
        })
      })
    })
  })

  describe('validateSearchResultConsistency', () => {
    const createTestResult = (overrides: Partial<MediaSearchResult> = {}) => ({
      id: '12345',
      title: 'Test Movie',
      year: 2023,
      tmdbId: 12345,
      mediaType: MediaType.MOVIE,
      inLibrary: true,
      radarrId: 1,
      monitored: true,
      hasFile: false,
      // Add missing required properties
      overview: 'Test overview',
      posterUrl: undefined,
      imdbId: undefined,
      status: 'wanted' as const,
      runtime: undefined,
      genres: undefined,
      ...overrides,
    })

    describe('Valid Consistency Cases', () => {
      it('should validate movie in library with radarrId', () => {
        const result = createTestResult({
          inLibrary: true,
          radarrId: 1,
        })

        expect(validateSearchResultConsistency(result, mockLogger)).toBe(true)
        expect(mockLogger.warn).not.toHaveBeenCalled()
      })

      it('should validate external movie without radarrId', () => {
        const result = createTestResult({
          inLibrary: false,
          radarrId: undefined,
        })

        expect(validateSearchResultConsistency(result, mockLogger)).toBe(true)
        expect(mockLogger.warn).not.toHaveBeenCalled()
      })

      it('should validate movie with radarrId = 0 (edge case)', () => {
        const result = createTestResult({
          inLibrary: true,
          radarrId: 0,
        })

        expect(validateSearchResultConsistency(result, mockLogger)).toBe(true)
        expect(mockLogger.warn).not.toHaveBeenCalled()
      })
    })

    describe('Invalid Consistency Cases', () => {
      it('should detect movie in library without radarrId', () => {
        const result = createTestResult({
          inLibrary: true,
          radarrId: undefined,
        })

        expect(validateSearchResultConsistency(result, mockLogger)).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'Consistency validation failed: movie in library without radarrId',
          ),
          expect.objectContaining({
            title: 'Test Movie',
            inLibrary: true,
            radarrId: undefined,
            issue: 'inLibrary=true but radarrId=undefined',
          }),
        )
      })

      it('should detect external movie with radarrId', () => {
        const result = createTestResult({
          inLibrary: false,
          radarrId: 1,
        })

        expect(validateSearchResultConsistency(result, mockLogger)).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'Consistency validation failed: external movie with radarrId',
          ),
          expect.objectContaining({
            title: 'Test Movie',
            inLibrary: false,
            radarrId: 1,
            issue: 'inLibrary=false but radarrId is set',
          }),
        )
      })

      it('should detect invalid radarrId format (negative number)', () => {
        const result = createTestResult({
          inLibrary: true,
          radarrId: -1,
        })

        expect(validateSearchResultConsistency(result, mockLogger)).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'Consistency validation failed: invalid radarrId format',
          ),
          expect.objectContaining({
            title: 'Test Movie',
            radarrId: -1,
            radarrIdType: 'number',
            issue: 'radarrId is not a non-negative number',
          }),
        )
      })

      it('should detect invalid radarrId format (string)', () => {
        const result = createTestResult({
          inLibrary: true,
          radarrId: 'invalid' as unknown as number,
        })

        expect(validateSearchResultConsistency(result, mockLogger)).toBe(false)
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            'Consistency validation failed: invalid radarrId format',
          ),
          expect.objectContaining({
            title: 'Test Movie',
            radarrId: 'invalid',
            radarrIdType: 'string',
            issue: 'radarrId is not a non-negative number',
          }),
        )
      })
    })

    describe('Without Logger', () => {
      it('should work without logger for valid data', () => {
        const result = createTestResult()
        expect(validateSearchResultConsistency(result)).toBe(true)
      })

      it('should work without logger for invalid data', () => {
        const result = createTestResult({
          inLibrary: true,
          radarrId: undefined,
        })
        expect(validateSearchResultConsistency(result)).toBe(false)
      })
    })
  })

  describe('Integration Tests', () => {
    it('should handle complete workflow from Radarr movie to validated search result', () => {
      // Use the already mocked image extractor
      mockImageExtractor.extractPosterUrl.mockReturnValue({
        imageUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
        source: 'remotePoster',
        debug: {
          remotePosterUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
        },
      })

      const originalEnv = process.env.NODE_ENV
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'development',
        writable: true,
        configurable: true,
      })

      const complexMovie: RadarrMovie = {
        id: 42,
        title: 'Complex Test Movie',
        titleSlug: 'complex-test-movie',
        year: 2023,
        tmdbId: 67890,
        imdbId: 'tt1234567',
        monitored: true,
        qualityProfileId: 1,
        rootFolderPath: '/movies',
        downloaded: false,
        hasFile: true,
        status: 'downloaded',
        runtime: 135,
        genres: ['Action', 'Adventure', 'Sci-Fi'],
        overview: 'A complex movie for testing all features.',
      }

      const result = convertRadarrMovieToSearchResult(complexMovie, mockLogger)

      // Verify all properties are correctly mapped
      expect(result).toMatchObject({
        id: '67890', // TMDB ID as string
        title: 'Complex Test Movie',
        year: 2023,
        tmdbId: 67890,
        imdbId: 'tt1234567',
        radarrId: 42,
        mediaType: MediaType.MOVIE,
        inLibrary: true,
        monitored: true,
        hasFile: true,
        status: 'downloaded',
        runtime: 135,
        genres: ['Action', 'Adventure', 'Sci-Fi'],
        overview: 'A complex movie for testing all features.',
        posterUrl: 'https://image.tmdb.org/t/p/original/poster.jpg',
      })

      // Verify validation passes
      expect(validateSearchResultConsistency(result, mockLogger)).toBe(true)

      // Verify appropriate logging occurred
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Poster URL extraction result'),
        expect.any(Object),
      )

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Converted Radarr movie to search result'),
        expect.objectContaining({
          dataConsistent: true,
        }),
      )

      expect(mockLogger.warn).not.toHaveBeenCalled()
      expect(mockLogger.error).not.toHaveBeenCalled()

      Object.defineProperty(process.env, 'NODE_ENV', {
        value: originalEnv,
        writable: true,
        configurable: true,
      })
    })

    it('should handle problematic movie data with appropriate error handling', () => {
      const problematicMovie: RadarrMovie = {
        id: 1,
        title: '', // Missing title
        titleSlug: 'problematic-movie',
        year: 2023,
        tmdbId: undefined as unknown as number, // Missing TMDB ID
        monitored: true,
        qualityProfileId: 1,
        rootFolderPath: '/movies',
        downloaded: false,
        status: 'wanted' as const,
      }

      const result = convertRadarrMovieToSearchResult(
        problematicMovie,
        mockLogger,
      )

      expect(result).toMatchObject({
        id: '1', // Falls back to Radarr ID
        title: '',
        tmdbId: undefined,
        radarrId: 1,
        inLibrary: true,
      })

      // Should log warning about missing data
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Movie missing essential data'),
        expect.objectContaining({
          title: '',
          tmdbId: undefined,
        }),
      )

      // Data should still be consistent
      expect(validateSearchResultConsistency(result, mockLogger)).toBe(true)
    })
  })
})
