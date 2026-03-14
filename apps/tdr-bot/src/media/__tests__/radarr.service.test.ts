import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { RadarrClient } from 'src/media/clients/radarr.client'
import {
  RadarrInputSchemas,
  RadarrOutputSchemas,
} from 'src/media/schemas/radarr.schemas'
import { RadarrService } from 'src/media/services/radarr.service'
import {
  DeleteMovieOptions,
  DownloadProtocol,
  MonitorMovieOptions,
  MovieLibrarySearchResult,
  MovieSearchResult,
  RadarrCommandResponse,
  RadarrImageType,
  RadarrMinimumAvailability,
  RadarrMovie,
  RadarrMovieResource,
  RadarrMovieStatus,
  RadarrQualityProfile,
  RadarrQueueItem,
  RadarrQueueStatus,
  RadarrRootFolder,
  RadarrSystemStatus,
  TrackedDownloadState,
  TrackedDownloadStatus,
} from 'src/media/types/radarr.types'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock the utility functions
jest.mock('src/media/utils/radarr.utils', () => ({
  transformToSearchResults: jest.fn(),
  transformToSearchResult: jest.fn(),
}))

// Import the mocked functions
import {
  transformToSearchResult,
  transformToSearchResults,
} from 'src/media/utils/radarr.utils'
const mockTransformToSearchResults =
  transformToSearchResults as jest.MockedFunction<
    typeof transformToSearchResults
  >
const mockTransformToSearchResult =
  transformToSearchResult as jest.MockedFunction<typeof transformToSearchResult>

// Mock nanoid
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-id-123'),
}))

// Mock performance
const mockPerformanceNow = jest.fn()
Object.defineProperty(global, 'performance', {
  value: { now: mockPerformanceNow },
  writable: true,
})

describe('RadarrService', () => {
  let service: RadarrService
  let mockRadarrClient: jest.Mocked<RadarrClient>
  let mockRetryService: jest.Mocked<RetryService>
  let mockErrorClassifier: jest.Mocked<ErrorClassificationService>

  // Simplified test data factories
  const createMockMovieSearchResult = (
    overrides: Partial<MovieSearchResult> = {},
  ): MovieSearchResult => ({
    tmdbId: 123456,
    imdbId: 'tt1234567',
    title: 'Test Movie',
    originalTitle: 'Test Movie Original',
    year: 2023,
    overview: 'A test movie overview',
    runtime: 120,
    genres: ['Action'],
    rating: 8.5,
    posterPath: 'https://example.com/poster.jpg',
    backdropPath: 'https://example.com/fanart.jpg',
    inCinemas: '2023-06-01T00:00:00Z',
    physicalRelease: '2023-08-01T00:00:00Z',
    digitalRelease: '2023-07-01T00:00:00Z',
    status: RadarrMovieStatus.RELEASED,
    certification: 'PG-13',
    studio: 'Test Studio',
    ...overrides,
  })

  const createMockRadarrMovie = (
    overrides: Partial<RadarrMovie> = {},
  ): RadarrMovie => ({
    id: 1,
    tmdbId: 123456,
    title: 'Test Movie',
    year: 2023,
    monitored: true,
    hasFile: false,
    qualityProfileId: 1,
    path: '/movies/Test Movie (2023)',
    genres: ['Action'],
    runtime: 120,
    overview: 'Test overview',
    status: RadarrMovieStatus.ANNOUNCED,
    isAvailable: false,
    minimumAvailability: RadarrMinimumAvailability.RELEASED,
    cleanTitle: 'testmovie',
    titleSlug: 'test-movie',
    images: [],
    ratings: { imdb: { value: 8.0, votes: 1000, type: 'user' } },
    tags: [],
    added: '2023-01-01T00:00:00Z',
    ...overrides,
  })

  const createMockSystemStatus = (
    overrides: Partial<RadarrSystemStatus> = {},
  ): RadarrSystemStatus => ({
    appName: 'Radarr',
    version: '4.0.0.0',
    buildTime: '2023-01-01T00:00:00Z',
    isDebug: false,
    isProduction: true,
    isAdmin: true,
    isUserInteractive: false,
    startupPath: '/app',
    appData: '/config',
    osName: 'Linux',
    osVersion: '5.4.0',
    isMonoRuntime: false,
    isMono: false,
    isLinux: true,
    isOsx: false,
    isWindows: false,
    branch: 'master',
    authentication: 'none',
    sqliteVersion: '3.36.0',
    urlBase: '',
    runtimeVersion: '6.0.0',
    runtimeName: '.NET',
    migrationVersion: 200,
    startTime: '2023-01-01T00:00:00Z',
    ...overrides,
  })

  const createMockQueueItem = (
    overrides: Partial<RadarrQueueItem> = {},
  ): RadarrQueueItem => ({
    id: 1,
    movieId: 1,
    title: 'Test Movie',
    size: 1000000000,
    status: RadarrQueueStatus.DOWNLOADING,
    trackedDownloadStatus: TrackedDownloadStatus.OK,
    trackedDownloadState: TrackedDownloadState.DOWNLOADING,
    statusMessages: [],
    errorMessage: '',
    downloadId: 'download123',
    protocol: DownloadProtocol.TORRENT,
    downloadClient: 'qBittorrent',
    indexer: 'TestIndexer',
    outputPath: '/downloads/Test Movie',
    estimatedCompletionTime: new Date(Date.now() + 3600000).toISOString(),
    added: new Date().toISOString(),
    movie: createMockRadarrMovie(),
    ...overrides,
  })

  const createMockQualityProfile = (
    overrides: Partial<RadarrQualityProfile> = {},
  ): RadarrQualityProfile => ({
    id: 1,
    name: 'HD-1080p',
    upgradeAllowed: true,
    cutoff: 4,
    items: [],
    minFormatScore: 0,
    cutoffFormatScore: 0,
    formatItems: [],
    language: { id: 1, name: 'English' },
    ...overrides,
  })

  const createMockRootFolder = (
    overrides: Partial<RadarrRootFolder> = {},
  ): RadarrRootFolder => ({
    id: 1,
    path: '/movies',
    accessible: true,
    freeSpace: 1000000000,
    totalSpace: 2000000000,
    unmappedFolders: [],
    ...overrides,
  })

  beforeEach(async () => {
    // Reset performance mock
    mockPerformanceNow.mockReturnValue(1000)

    // Create comprehensive mocked RadarrClient
    mockRadarrClient = {
      searchMovies: jest.fn(),
      lookupMovieByTmdbId: jest.fn(),
      getSystemStatus: jest.fn(),
      checkHealth: jest.fn(),
      getAllMovies: jest.fn(),
      getAllQueueItems: jest.fn(),
      getQualityProfiles: jest.fn(),
      getRootFolders: jest.fn(),
      isMovieInLibrary: jest.fn(),
      addMovie: jest.fn(),
      triggerMovieSearch: jest.fn(),
      getMovie: jest.fn(),
      deleteMovie: jest.fn(),
      getQueueItemsForMovie: jest.fn(),
      cancelAllQueueItemsForMovie: jest.fn(),
      cancelQueueItem: jest.fn(),
    } as unknown as jest.Mocked<RadarrClient>

    mockRetryService = {
      execute: jest.fn().mockImplementation(async fn => fn()),
    } as unknown as jest.Mocked<never>

    mockErrorClassifier = {
      classifyError: jest.fn().mockReturnValue({ isRetriable: true }),
    } as unknown as jest.Mocked<never>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarrService,
        { provide: RadarrClient, useValue: mockRadarrClient },
        { provide: RetryService, useValue: mockRetryService },
        { provide: ErrorClassificationService, useValue: mockErrorClassifier },
      ],
    }).compile()

    service = module.get<RadarrService>(RadarrService)

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()

    // Reset all mocks
    jest.clearAllMocks()
  })

  describe('searchMovies', () => {
    beforeEach(() => {
      // Mock Zod validation to pass through
      jest
        .spyOn(RadarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<typeof RadarrInputSchemas.searchQuery.parse>,
        )
      jest
        .spyOn(RadarrOutputSchemas.movieSearchResultArray, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof RadarrOutputSchemas.movieSearchResultArray.parse
            >,
        )
    })

    it('should search movies successfully', async () => {
      const mockMovieResources: RadarrMovieResource[] = [
        {
          tmdbId: 123456,
          imdbId: 'tt1234567',
          title: 'Test Movie',
          originalTitle: 'Test Movie',
          year: 2023,
          overview: 'Test overview',
          runtime: 120,
          genres: ['Action'],
          ratings: { imdb: { value: 8.5, votes: 1000, type: 'user' } },
          images: [{ coverType: RadarrImageType.POSTER, url: 'poster.jpg' }],
          inCinemas: '2023-01-01',
          physicalRelease: '2023-02-01',
          digitalRelease: '2023-01-15',
          status: RadarrMovieStatus.RELEASED,
          certification: 'PG-13',
          studio: 'Studio',
          website: 'website.com',
          youTubeTrailerId: 'trailer123',
          popularity: 85.2,
          hasFile: false,
          minimumAvailability: RadarrMinimumAvailability.RELEASED,
          isAvailable: true,
          cleanTitle: 'testmovie',
          titleSlug: 'test-movie',
        },
      ]

      const mockSearchResults = [createMockMovieSearchResult()]

      mockRadarrClient.searchMovies.mockResolvedValue(mockMovieResources)
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1100) // 100ms duration

      const result = await service.searchMovies('test movie')

      expect(mockRadarrClient.searchMovies).toHaveBeenCalledWith('test movie')
      expect(mockTransformToSearchResults).toHaveBeenCalledWith(
        mockMovieResources,
      )
      expect(RadarrInputSchemas.searchQuery.parse).toHaveBeenCalledWith({
        query: 'test movie',
      })
      expect(
        RadarrOutputSchemas.movieSearchResultArray.parse,
      ).toHaveBeenCalledWith(mockSearchResults)
      expect(result).toEqual(mockSearchResults)
    })

    it('should handle input validation errors', async () => {
      const validationError = new Error('Invalid input')
      jest
        .spyOn(RadarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.searchMovies('')).rejects.toThrow(
        'Invalid search query: Invalid input',
      )
    })

    it('should handle client errors', async () => {
      jest
        .spyOn(RadarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: 'test' })
      mockRadarrClient.searchMovies.mockRejectedValue(new Error('API Error'))

      await expect(service.searchMovies('test')).rejects.toThrow('API Error')
    })

    it('should handle output validation errors', async () => {
      const mockMovieResources: RadarrMovieResource[] = [
        {
          tmdbId: 123456,
          imdbId: 'tt1234567',
          title: 'Test Movie',
          originalTitle: 'Test Movie',
          year: 2023,
          overview: 'Test overview',
          runtime: 120,
          genres: ['Action'],
          ratings: { imdb: { value: 8.5, votes: 1000, type: 'user' } },
          images: [{ coverType: RadarrImageType.POSTER, url: 'poster.jpg' }],
          inCinemas: '2023-01-01',
          physicalRelease: '2023-02-01',
          digitalRelease: '2023-01-15',
          status: RadarrMovieStatus.RELEASED,
          certification: 'PG-13',
          studio: 'Studio',
          website: 'website.com',
          youTubeTrailerId: 'trailer123',
          popularity: 85.2,
          hasFile: false,
          minimumAvailability: RadarrMinimumAvailability.RELEASED,
          isAvailable: true,
          cleanTitle: 'testmovie',
          titleSlug: 'test-movie',
        },
      ]

      mockRadarrClient.searchMovies.mockResolvedValue(mockMovieResources)
      mockTransformToSearchResults.mockReturnValue([
        createMockMovieSearchResult(),
      ])

      const validationError = new Error('Invalid output')
      jest
        .spyOn(RadarrOutputSchemas.movieSearchResultArray, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.searchMovies('test')).rejects.toThrow(
        'Invalid output',
      )
    })
  })

  describe('getSystemStatus', () => {
    beforeEach(() => {
      jest
        .spyOn(RadarrOutputSchemas.systemStatus, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<typeof RadarrOutputSchemas.systemStatus.parse>,
        )
    })

    it('should get system status successfully', async () => {
      const mockStatus = createMockSystemStatus()
      mockRadarrClient.getSystemStatus.mockResolvedValue(mockStatus)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1050) // 50ms duration

      const result = await service.getSystemStatus()

      expect(mockRadarrClient.getSystemStatus).toHaveBeenCalled()
      expect(RadarrOutputSchemas.systemStatus.parse).toHaveBeenCalledWith(
        mockStatus,
      )
      expect(result).toEqual(mockStatus)
    })

    it('should handle system status errors', async () => {
      mockRadarrClient.getSystemStatus.mockRejectedValue(
        new Error('System unavailable'),
      )

      await expect(service.getSystemStatus()).rejects.toThrow(
        'System unavailable',
      )
    })

    it('should handle validation errors', async () => {
      const mockStatus = createMockSystemStatus()
      mockRadarrClient.getSystemStatus.mockResolvedValue(mockStatus)

      const validationError = new Error('Invalid status format')
      jest
        .spyOn(RadarrOutputSchemas.systemStatus, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.getSystemStatus()).rejects.toThrow(
        'Invalid status format',
      )
    })
  })

  describe('checkHealth', () => {
    it('should return true when health check passes', async () => {
      mockRadarrClient.checkHealth.mockResolvedValue(true)

      const result = await service.checkHealth()

      expect(mockRadarrClient.checkHealth).toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('should return false when health check fails', async () => {
      mockRadarrClient.checkHealth.mockResolvedValue(false)

      const result = await service.checkHealth()

      expect(result).toBe(false)
    })

    it('should return false when health check throws exception', async () => {
      mockRadarrClient.checkHealth.mockRejectedValue(
        new Error('Connection failed'),
      )

      const result = await service.checkHealth()

      expect(result).toBe(false)
    })
  })

  describe('getLibraryMovies', () => {
    beforeEach(() => {
      // Mock input validation
      jest
        .spyOn(RadarrInputSchemas.optionalSearchQuery, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof RadarrInputSchemas.optionalSearchQuery.parse
            >,
        )

      // Mock output validation
      jest
        .spyOn(RadarrOutputSchemas.movieLibrarySearchResultArray, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof RadarrOutputSchemas.movieLibrarySearchResultArray.parse
            >,
        )
    })

    it('should get all library movies successfully without query', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Action Movie',
          genres: ['Action', 'Adventure'],
        }),
        createMockRadarrMovie({
          id: 2,
          title: 'Comedy Movie',
          genres: ['Comedy'],
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200) // 200ms duration

      const result = await service.getLibraryMovies()

      expect(mockRadarrClient.getAllMovies).toHaveBeenCalled()
      expect(RadarrInputSchemas.optionalSearchQuery.parse).toHaveBeenCalledWith(
        { query: undefined },
      )
      expect(
        RadarrOutputSchemas.movieLibrarySearchResultArray.parse,
      ).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        id: 1,
        title: 'Action Movie',
        monitored: true,
        hasFile: false,
      })
    })

    it('should get filtered library movies successfully with query', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Action Movie',
          genres: ['Action', 'Adventure'],
        }),
        createMockRadarrMovie({
          id: 2,
          title: 'Comedy Movie',
          genres: ['Comedy'],
        }),
        createMockRadarrMovie({
          id: 3,
          title: 'Action Hero',
          genres: ['Action'],
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200) // 200ms duration

      const result = await service.getLibraryMovies('action')

      expect(mockRadarrClient.getAllMovies).toHaveBeenCalled()
      expect(RadarrInputSchemas.optionalSearchQuery.parse).toHaveBeenCalledWith(
        { query: 'action' },
      )
      expect(
        RadarrOutputSchemas.movieLibrarySearchResultArray.parse,
      ).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0].title).toBe('Action Movie')
      expect(result[1].title).toBe('Action Hero')
    })

    it('should filter movies by title, genre, and other fields', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'The Dark Knight',
          originalTitle: 'Batman Movie',
          year: 2008,
          genres: ['Action', 'Crime', 'Drama'],
          overview: 'Batman fights Joker',
          certification: 'PG-13',
          studio: 'Warner Bros',
        }),
        createMockRadarrMovie({
          id: 2,
          title: 'Comedy Central',
          year: 2020,
          genres: ['Comedy'],
          studio: 'Comedy Studios',
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      // Test filtering by different fields
      let result = await service.getLibraryMovies('batman')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('The Dark Knight')

      result = await service.getLibraryMovies('2008')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('crime')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('joker')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('pg-13')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('warner')
      expect(result).toHaveLength(1)
    })

    it('should handle case insensitive filtering', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'The Dark Knight',
          genres: ['Action', 'CRIME'],
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      let result = await service.getLibraryMovies('DARK')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('knight')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('action')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('Crime')
      expect(result).toHaveLength(1)
    })

    it('should handle special characters in search queries', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Fast & Furious',
          overview: 'Cars, action & family',
        }),
        createMockRadarrMovie({
          id: 2,
          title: 'Movie: The Sequel',
          overview: 'Part 2 of the saga',
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      let result = await service.getLibraryMovies('&')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Fast & Furious')

      result = await service.getLibraryMovies(':')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Movie: The Sequel')
    })

    it('should handle Unicode characters in search queries', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Amélie',
          studio: 'Café Films',
        }),
        createMockRadarrMovie({
          id: 2,
          title: 'Naïve Movie',
          overview: 'A story about naïveté',
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      let result = await service.getLibraryMovies('amélie')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Amélie')

      result = await service.getLibraryMovies('café')
      expect(result).toHaveLength(1)

      result = await service.getLibraryMovies('naïve')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Naïve Movie')
    })

    it('should handle partial word matching', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Transformers',
          genres: ['Action', 'Sci-Fi'],
        }),
        createMockRadarrMovie({
          id: 2,
          title: 'Transformer',
          genres: ['Drama'],
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      let result = await service.getLibraryMovies('transform')
      expect(result).toHaveLength(2)

      result = await service.getLibraryMovies('former')
      expect(result).toHaveLength(2)
    })

    it('should return empty array for no matches', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Movie A',
          genres: ['Action'],
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      const result = await service.getLibraryMovies('nonexistent')
      expect(result).toHaveLength(0)
    })

    it('should handle whitespace-only queries', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Test Movie',
        }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      const result = await service.getLibraryMovies('   ')
      // Should return all movies when query is effectively empty after trimming
      expect(result).toHaveLength(1)
    })

    it('should handle movies with null/undefined fields', async () => {
      const mockMovies = [
        createMockRadarrMovie({
          id: 1,
          title: 'Movie with nulls',
          originalTitle: undefined,
          overview: undefined,
          certification: undefined,
          studio: undefined,
        }) as RadarrMovie,
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      const result = await service.getLibraryMovies('movie')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Movie with nulls')
    })

    it('should handle input validation errors', async () => {
      const validationError = new Error('Query too short')
      jest
        .spyOn(RadarrInputSchemas.optionalSearchQuery, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.getLibraryMovies('x')).rejects.toThrow(
        'Invalid search query: Query too short',
      )
    })

    it('should handle output validation errors', async () => {
      const mockMovies = [createMockRadarrMovie()]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      const validationError = new Error('Invalid library search result array')
      jest
        .spyOn(RadarrOutputSchemas.movieLibrarySearchResultArray, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.getLibraryMovies()).rejects.toThrow(
        'Invalid library search result array',
      )
    })

    it('should handle API errors', async () => {
      mockRadarrClient.getAllMovies.mockRejectedValue(new Error('API Error'))

      await expect(service.getLibraryMovies()).rejects.toThrow('API Error')
    })
  })

  describe('getDownloadingMovies', () => {
    beforeEach(() => {
      jest
        .spyOn(RadarrOutputSchemas.downloadingMovieArray, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof RadarrOutputSchemas.downloadingMovieArray.parse
            >,
        )
    })

    it('should get downloading movies successfully', async () => {
      const mockQueueItems = [
        createMockQueueItem({
          id: 1,
          movieId: 1,
          status: RadarrQueueStatus.DOWNLOADING,
          movie: createMockRadarrMovie({ title: 'Movie 1' }),
        }),
        createMockQueueItem({
          id: 2,
          movieId: 2,
          status: RadarrQueueStatus.QUEUED,
          movie: createMockRadarrMovie({ title: 'Movie 2' }),
        }),
        createMockQueueItem({
          id: 3,
          movieId: 3,
          status: RadarrQueueStatus.COMPLETED, // Should be filtered out
          movie: createMockRadarrMovie({ title: 'Movie 3' }),
        }),
      ]

      mockRadarrClient.getAllQueueItems.mockResolvedValue(mockQueueItems)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1300) // 300ms duration

      const result = await service.getDownloadingMovies()

      expect(mockRadarrClient.getAllQueueItems).toHaveBeenCalledWith({
        includeMovie: true,
        pageSize: 1000,
      })

      // Should only include downloading and queued items (2 out of 3)
      expect(result).toHaveLength(2)
      expect(result[0].status).toBe(RadarrQueueStatus.DOWNLOADING)
      expect(result[1].status).toBe(RadarrQueueStatus.QUEUED)
      expect(result[0].movieTitle).toBe('Movie 1')
      expect(result[1].movieTitle).toBe('Movie 2')
    })

    it('should handle queue items without movie data', async () => {
      const mockQueueItems = [
        createMockQueueItem({
          id: 1,
          movieId: 1,
          title: 'Fallback Title',
          status: RadarrQueueStatus.DOWNLOADING,
          movie: undefined, // No movie data
        }),
      ]

      mockRadarrClient.getAllQueueItems.mockResolvedValue(mockQueueItems)

      const result = await service.getDownloadingMovies()

      expect(result).toHaveLength(1)
      expect(result[0].movieTitle).toBe('Fallback Title')
      expect(result[0].movieYear).toBeUndefined()
    })

    it('should filter out completed and failed items', async () => {
      const mockQueueItems = [
        createMockQueueItem({ status: RadarrQueueStatus.DOWNLOADING }), // Include
        createMockQueueItem({ status: RadarrQueueStatus.QUEUED }), // Include
        createMockQueueItem({ status: RadarrQueueStatus.COMPLETED }), // Exclude
        createMockQueueItem({ status: RadarrQueueStatus.FAILED }), // Exclude
      ]

      mockRadarrClient.getAllQueueItems.mockResolvedValue(mockQueueItems)

      const result = await service.getDownloadingMovies()

      expect(result).toHaveLength(2) // Only downloading and queued
    })
  })

  describe('monitorAndDownloadMovie', () => {
    const mockMovie = createMockMovieSearchResult()
    const mockQualityProfiles = [
      createMockQualityProfile({ id: 1, name: 'HD-1080p' }),
    ]
    const mockRootFolders = [
      createMockRootFolder({ id: 1, path: '/movies', accessible: true }),
    ]
    const mockCommand: RadarrCommandResponse = {
      id: 1,
      name: 'MoviesSearch',
      commandName: 'MoviesSearch',
      message: 'Search started',
      body: {
        movieIds: [1],
        sendUpdatesToClient: true,
        updateScheduledTask: true,
        completionMessage: 'Search completed',
        requiresDiskAccess: false,
        isExclusive: false,
        isTypeExclusive: false,
        isLongRunning: false,
        name: 'MoviesSearch',
        trigger: 'manual',
      },
      priority: 'normal',
      status: 'queued',
      queued: new Date().toISOString(),
      trigger: 'manual',
      sendUpdatesToClient: true,
      updateScheduledTask: true,
    }

    beforeEach(() => {
      mockRadarrClient.getQualityProfiles.mockResolvedValue(mockQualityProfiles)
      mockRadarrClient.getRootFolders.mockResolvedValue(mockRootFolders)
      // Mock lookupMovieByTmdbId to return a movie resource that transforms to mockMovie
      mockRadarrClient.lookupMovieByTmdbId = jest.fn().mockResolvedValue({
        tmdbId: mockMovie.tmdbId,
        title: mockMovie.title,
        year: mockMovie.year,
        overview: mockMovie.overview,
        runtime: mockMovie.runtime,
        genres: mockMovie.genres,
        inCinemas: mockMovie.inCinemas,
        physicalRelease: mockMovie.physicalRelease,
        digitalRelease: mockMovie.digitalRelease,
        certification: mockMovie.certification,
        studio: mockMovie.studio,
        website: mockMovie.website,
        youTubeTrailerId: mockMovie.youTubeTrailerId,
        popularity: mockMovie.popularity,
        imdbId: mockMovie.imdbId,
        originalTitle: mockMovie.originalTitle,
        ratings: {
          imdb: { value: mockMovie.rating || 0, votes: 1000, type: 'user' },
        },
        images: [
          {
            coverType: RadarrImageType.POSTER,
            url: mockMovie.posterPath || '',
          },
          {
            coverType: RadarrImageType.FANART,
            url: mockMovie.backdropPath || '',
          },
        ],
        status: mockMovie.status,
        hasFile: false,
        isAvailable: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        cleanTitle: 'testmovie',
        titleSlug: 'test-movie',
      })

      // Mock transformToSearchResult to return a proper MovieSearchResult
      mockTransformToSearchResult.mockImplementation(movieResource => ({
        tmdbId: movieResource.tmdbId,
        imdbId: movieResource.imdbId,
        title: movieResource.title,
        originalTitle: movieResource.originalTitle,
        year: movieResource.year,
        overview: movieResource.overview,
        runtime: movieResource.runtime,
        genres: movieResource.genres,
        rating: movieResource.ratings?.imdb?.value,
        posterPath: movieResource.images?.find(
          img => img.coverType === 'poster',
        )?.url,
        backdropPath: movieResource.images?.find(
          img => img.coverType === 'fanart',
        )?.url,
        inCinemas: movieResource.inCinemas,
        physicalRelease: movieResource.physicalRelease,
        digitalRelease: movieResource.digitalRelease,
        status: movieResource.status,
        certification: movieResource.certification,
        studio: movieResource.studio,
        website: movieResource.website,
        youTubeTrailerId: movieResource.youTubeTrailerId,
        popularity: movieResource.popularity,
      }))
    })

    it('should monitor and download movie successfully with new movie', async () => {
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: mockMovie.tmdbId,
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null) // Movie not in library
      mockRadarrClient.addMovie.mockResolvedValue(addedMovie)
      mockRadarrClient.triggerMovieSearch.mockResolvedValue(mockCommand)

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(mockRadarrClient.isMovieInLibrary).toHaveBeenCalledWith(
        mockMovie.tmdbId,
      )
      expect(mockRadarrClient.lookupMovieByTmdbId).toHaveBeenCalledWith(
        mockMovie.tmdbId,
      )
      expect(mockRadarrClient.getQualityProfiles).toHaveBeenCalled()
      expect(mockRadarrClient.getRootFolders).toHaveBeenCalled()
      expect(mockRadarrClient.addMovie).toHaveBeenCalledWith(
        expect.objectContaining({
          tmdbId: mockMovie.tmdbId,
          title: mockMovie.title,
          qualityProfileId: 1,
          rootFolderPath: '/movies',
          monitored: true,
          minimumAvailability: RadarrMinimumAvailability.RELEASED,
          searchOnAdd: false,
        }),
      )
      expect(mockRadarrClient.triggerMovieSearch).toHaveBeenCalledWith(1)

      expect(result).toEqual({
        success: true,
        movieAdded: true,
        searchTriggered: true,
        movie: addedMovie,
        commandId: 1,
        warnings: undefined,
      })
    })

    it('should handle movie already in library and monitored', async () => {
      const existingMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: mockMovie.tmdbId,
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(existingMovie)
      mockRadarrClient.triggerMovieSearch.mockResolvedValue(mockCommand)

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(mockRadarrClient.addMovie).not.toHaveBeenCalled()
      expect(mockRadarrClient.lookupMovieByTmdbId).not.toHaveBeenCalled() // Should not lookup if already in library
      expect(mockRadarrClient.triggerMovieSearch).toHaveBeenCalledWith(1)

      expect(result).toEqual({
        success: true,
        movieAdded: false,
        searchTriggered: true,
        movie: existingMovie,
        commandId: 1,
        warnings: ['Movie already monitored in library'],
      })
    })

    it('should handle movie already in library but not monitored', async () => {
      const existingMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: mockMovie.tmdbId,
        monitored: false,
      })
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: mockMovie.tmdbId,
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(existingMovie)
      mockRadarrClient.addMovie.mockResolvedValue(addedMovie)
      mockRadarrClient.triggerMovieSearch.mockResolvedValue(mockCommand)

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(mockRadarrClient.addMovie).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should handle custom options', async () => {
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: mockMovie.tmdbId,
        monitored: true,
      })
      const options: MonitorMovieOptions = {
        qualityProfileId: 2,
        rootFolderPath: '/custom/movies',
        monitored: false,
        minimumAvailability: RadarrMinimumAvailability.IN_CINEMAS,
        searchOnAdd: true,
      }

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.addMovie.mockResolvedValue({
        ...addedMovie,
        monitored: false,
      })

      const result = await service.monitorAndDownloadMovie(
        mockMovie.tmdbId,
        options,
      )

      expect(mockRadarrClient.addMovie).toHaveBeenCalledWith(
        expect.objectContaining({
          qualityProfileId: 2,
          rootFolderPath: '/custom/movies',
          monitored: false,
          minimumAvailability: RadarrMinimumAvailability.IN_CINEMAS,
          searchOnAdd: true,
        }),
      )

      expect(mockRadarrClient.triggerMovieSearch).not.toHaveBeenCalled()
      expect(result.searchTriggered).toBe(false)
    })

    it('should handle configuration failures', async () => {
      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.getQualityProfiles.mockResolvedValue([])

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'Configuration error: No quality profiles available in Radarr',
      })
    })

    it('should handle add movie failures', async () => {
      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.addMovie.mockRejectedValue(
        new Error('Movie already exists'),
      )

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'Failed to add movie: Movie already exists',
      })
    })

    it('should handle search trigger failures with warnings', async () => {
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: mockMovie.tmdbId,
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.addMovie.mockResolvedValue(addedMovie)
      mockRadarrClient.triggerMovieSearch.mockRejectedValue(
        new Error('Search failed'),
      )

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result.success).toBe(true)
      expect(result.movieAdded).toBe(true)
      expect(result.searchTriggered).toBe(false)
      expect(result.warnings).toContain(
        'Movie added but search failed: Search failed',
      )
    })

    it('should handle no accessible root folders', async () => {
      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.getRootFolders.mockResolvedValue([
        createMockRootFolder({ accessible: false }),
      ])

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error:
          'Configuration error: No accessible root folders available in Radarr',
      })
    })

    it('should handle movie with special characters in title', async () => {
      const specialMovie = createMockMovieSearchResult({
        title: 'Fast & Furious: Tokyo Drift',
        tmdbId: 999999,
      })
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: 999999,
        title: 'Fast & Furious: Tokyo Drift',
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.lookupMovieByTmdbId.mockResolvedValueOnce({
        tmdbId: specialMovie.tmdbId,
        title: specialMovie.title,
        year: specialMovie.year || 2023,
        overview: specialMovie.overview,
        runtime: specialMovie.runtime || 120,
        genres: specialMovie.genres,
        inCinemas: specialMovie.inCinemas,
        physicalRelease: specialMovie.physicalRelease,
        digitalRelease: specialMovie.digitalRelease,
        certification: specialMovie.certification,
        studio: specialMovie.studio,
        website: specialMovie.website,
        youTubeTrailerId: specialMovie.youTubeTrailerId,
        popularity: specialMovie.popularity,
        imdbId: specialMovie.imdbId,
        originalTitle: specialMovie.originalTitle,
        ratings: {
          imdb: { value: specialMovie.rating || 0, votes: 1000, type: 'user' },
        },
        images: [
          {
            coverType: RadarrImageType.POSTER,
            url: specialMovie.posterPath || '',
          },
          {
            coverType: RadarrImageType.FANART,
            url: specialMovie.backdropPath || '',
          },
        ],
        status: specialMovie.status,
        hasFile: false,
        isAvailable: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        cleanTitle: 'testmovie',
        titleSlug: 'test-movie',
      })
      mockRadarrClient.addMovie.mockResolvedValue(addedMovie)
      mockRadarrClient.triggerMovieSearch.mockResolvedValue(mockCommand)

      const result = await service.monitorAndDownloadMovie(specialMovie.tmdbId)

      expect(mockRadarrClient.addMovie).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fast & Furious: Tokyo Drift',
          titleSlug: 'fast-furious-tokyo-drift',
        }),
      )
      expect(result.success).toBe(true)
    })

    it('should handle movie with Unicode characters in title', async () => {
      const unicodeMovie = createMockMovieSearchResult({
        title: 'Amélie: Café Dreams',
        tmdbId: 888888,
      })
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: 888888,
        title: 'Amélie: Café Dreams',
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.addMovie.mockResolvedValue(addedMovie)
      mockRadarrClient.triggerMovieSearch.mockResolvedValue(mockCommand)

      // Mock lookup for Unicode movie
      mockRadarrClient.lookupMovieByTmdbId.mockResolvedValueOnce({
        tmdbId: unicodeMovie.tmdbId,
        title: unicodeMovie.title,
        year: unicodeMovie.year || 2023,
        overview: unicodeMovie.overview,
        runtime: unicodeMovie.runtime || 120,
        genres: unicodeMovie.genres,
        inCinemas: unicodeMovie.inCinemas,
        physicalRelease: unicodeMovie.physicalRelease,
        digitalRelease: unicodeMovie.digitalRelease,
        certification: unicodeMovie.certification,
        studio: unicodeMovie.studio,
        website: unicodeMovie.website,
        youTubeTrailerId: unicodeMovie.youTubeTrailerId,
        popularity: unicodeMovie.popularity,
        imdbId: unicodeMovie.imdbId,
        originalTitle: unicodeMovie.originalTitle,
        ratings: {
          imdb: { value: unicodeMovie.rating || 0, votes: 1000, type: 'user' },
        },
        images: [
          {
            coverType: RadarrImageType.POSTER,
            url: unicodeMovie.posterPath || '',
          },
          {
            coverType: RadarrImageType.FANART,
            url: unicodeMovie.backdropPath || '',
          },
        ],
        status: unicodeMovie.status,
        hasFile: false,
        isAvailable: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        cleanTitle: 'testmovie',
        titleSlug: 'test-movie',
      })

      const result = await service.monitorAndDownloadMovie(unicodeMovie.tmdbId)

      expect(mockRadarrClient.addMovie).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Amélie: Café Dreams',
          titleSlug: 'amlie-caf-dreams',
        }),
      )
      expect(result.success).toBe(true)
    })

    it('should handle movie with only special characters in title', async () => {
      const weirdMovie = createMockMovieSearchResult({
        title: '!!!@#$%^&*()',
        tmdbId: 777777,
      })
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: 777777,
        title: '!!!@#$%^&*()',
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      // Mock lookup for weird movie
      mockRadarrClient.lookupMovieByTmdbId.mockResolvedValueOnce({
        tmdbId: weirdMovie.tmdbId,
        title: weirdMovie.title,
        year: weirdMovie.year || 2023,
        overview: weirdMovie.overview,
        runtime: weirdMovie.runtime || 120,
        genres: weirdMovie.genres,
        inCinemas: weirdMovie.inCinemas,
        physicalRelease: weirdMovie.physicalRelease,
        digitalRelease: weirdMovie.digitalRelease,
        certification: weirdMovie.certification,
        studio: weirdMovie.studio,
        website: weirdMovie.website,
        youTubeTrailerId: weirdMovie.youTubeTrailerId,
        popularity: weirdMovie.popularity,
        imdbId: weirdMovie.imdbId,
        originalTitle: weirdMovie.originalTitle,
        ratings: {
          imdb: { value: weirdMovie.rating || 0, votes: 1000, type: 'user' },
        },
        images: [
          {
            coverType: RadarrImageType.POSTER,
            url: weirdMovie.posterPath || '',
          },
          {
            coverType: RadarrImageType.FANART,
            url: weirdMovie.backdropPath || '',
          },
        ],
        status: weirdMovie.status,
        hasFile: false,
        isAvailable: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        cleanTitle: 'testmovie',
        titleSlug: 'test-movie',
      })
      mockRadarrClient.addMovie.mockResolvedValue(addedMovie)
      mockRadarrClient.triggerMovieSearch.mockResolvedValue(mockCommand)

      const result = await service.monitorAndDownloadMovie(weirdMovie.tmdbId)

      expect(mockRadarrClient.addMovie).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '!!!@#$%^&*()',
          titleSlug: '', // Should result in empty slug
        }),
      )
      expect(result.success).toBe(true)
    })

    it('should handle movie with very long title', async () => {
      const longTitle = 'A'.repeat(500) // Very long title
      const longTitleMovie = createMockMovieSearchResult({
        title: longTitle,
        tmdbId: 666666,
      })
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: 666666,
        title: longTitle,
        monitored: true,
      })

      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      // Mock lookup for long title movie
      mockRadarrClient.lookupMovieByTmdbId.mockResolvedValueOnce({
        tmdbId: longTitleMovie.tmdbId,
        title: longTitleMovie.title,
        year: longTitleMovie.year || 2023,
        overview: longTitleMovie.overview,
        runtime: longTitleMovie.runtime || 120,
        genres: longTitleMovie.genres,
        inCinemas: longTitleMovie.inCinemas,
        physicalRelease: longTitleMovie.physicalRelease,
        digitalRelease: longTitleMovie.digitalRelease,
        certification: longTitleMovie.certification,
        studio: longTitleMovie.studio,
        website: longTitleMovie.website,
        youTubeTrailerId: longTitleMovie.youTubeTrailerId,
        popularity: longTitleMovie.popularity,
        imdbId: longTitleMovie.imdbId,
        originalTitle: longTitleMovie.originalTitle,
        ratings: {
          imdb: {
            value: longTitleMovie.rating || 0,
            votes: 1000,
            type: 'user',
          },
        },
        images: [
          {
            coverType: RadarrImageType.POSTER,
            url: longTitleMovie.posterPath || '',
          },
          {
            coverType: RadarrImageType.FANART,
            url: longTitleMovie.backdropPath || '',
          },
        ],
        status: longTitleMovie.status,
        hasFile: false,
        isAvailable: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        cleanTitle: 'testmovie',
        titleSlug: 'test-movie',
      })
      mockRadarrClient.addMovie.mockResolvedValue(addedMovie)
      mockRadarrClient.triggerMovieSearch.mockResolvedValue(mockCommand)

      const result = await service.monitorAndDownloadMovie(
        longTitleMovie.tmdbId,
      )

      expect(result.success).toBe(true)
      expect(mockRadarrClient.addMovie).toHaveBeenCalledWith(
        expect.objectContaining({
          title: longTitle,
          titleSlug: 'a'.repeat(500).toLowerCase(),
        }),
      )
    })

    it('should handle isMovieInLibrary API errors gracefully', async () => {
      mockRadarrClient.isMovieInLibrary.mockRejectedValue(
        new Error('API timeout'),
      )

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'API timeout',
      })
    })

    it('should handle quality profiles API errors', async () => {
      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.getQualityProfiles.mockRejectedValue(
        new Error('Quality profiles unavailable'),
      )

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'Configuration error: Quality profiles unavailable',
      })
    })

    it('should handle root folders API errors', async () => {
      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      mockRadarrClient.getRootFolders.mockRejectedValue(
        new Error('Root folders unavailable'),
      )

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'Configuration error: Root folders unavailable',
      })
    })
  })

  describe('unmonitorAndDeleteMovie', () => {
    const mockMovie = createMockRadarrMovie({
      id: 1,
      title: 'Test Movie',
      hasFile: true,
    })

    it('should unmonitor and delete movie successfully', async () => {
      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovie,
          tmdbId: mockMovie.tmdbId,
          monitored: mockMovie.monitored,
          hasFile: mockMovie.hasFile,
          path: mockMovie.path,
          added: mockMovie.added,
          qualityProfileId: mockMovie.qualityProfileId,
          rootFolderPath: '/movies',
          isAvailable: mockMovie.isAvailable,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])
      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const options: DeleteMovieOptions = { deleteFiles: true }

      const result = await service.unmonitorAndDeleteMovie(
        mockMovie.tmdbId,
        options,
      )

      expect(mockRadarrClient.getMovie).toHaveBeenCalledWith(1)
      expect(mockRadarrClient.getQueueItemsForMovie).toHaveBeenCalledWith(1)
      expect(mockRadarrClient.deleteMovie).toHaveBeenCalledWith(1, options)

      expect(result).toEqual({
        success: true,
        movieDeleted: true,
        filesDeleted: true,
        movie: mockMovie,
        warnings: undefined,
      })
    })

    it('should cancel active downloads before deletion', async () => {
      const mockQueueItems = [
        createMockQueueItem({ id: 1, movieId: 1 }),
        createMockQueueItem({ id: 2, movieId: 1 }),
      ]

      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovie,
          tmdbId: mockMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue(mockQueueItems)
      mockRadarrClient.cancelAllQueueItemsForMovie.mockResolvedValue(2)
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(mockMovie.tmdbId, {
        deleteFiles: true,
      })

      expect(mockRadarrClient.cancelAllQueueItemsForMovie).toHaveBeenCalledWith(
        1,
      )
      expect(result.downloadsFound).toBe(2)
      expect(result.downloadsCancelled).toBe(2)
    })

    it('should handle partial download cancellation failures', async () => {
      const mockQueueItems = [
        createMockQueueItem({ id: 1, movieId: 1 }),
        createMockQueueItem({ id: 2, movieId: 1 }),
      ]

      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovie,
          tmdbId: mockMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue(mockQueueItems)
      mockRadarrClient.cancelAllQueueItemsForMovie.mockResolvedValue(1) // Only 1 out of 2 cancelled
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(mockMovie.tmdbId, {
        deleteFiles: true,
      })

      expect(result.warnings).toContain(
        'Some downloads could not be cancelled (1/2 successful)',
      )
    })

    it('should handle movie not found error', async () => {
      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovie,
          tmdbId: mockMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockRejectedValue(new Error('Movie not found'))

      const result = await service.unmonitorAndDeleteMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        error: 'Movie not found in Radarr: Movie not found',
      })
    })

    it('should handle download cancellation failures with warnings', async () => {
      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovie,
          tmdbId: mockMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockRejectedValue(
        new Error('Queue access failed'),
      )
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(mockMovie.tmdbId, {
        deleteFiles: true,
      })

      expect(result.success).toBe(true)
      expect(result.warnings).toContain(
        'Failed to cancel downloads: Queue access failed',
      )
    })

    it('should handle deletion failures', async () => {
      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovie,
          tmdbId: mockMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockRejectedValue(new Error('Delete failed'))

      const result = await service.unmonitorAndDeleteMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        movie: mockMovie,
        error: 'Failed to delete movie: Delete failed',
        warnings: undefined,
      })
    })

    it('should add warnings for informational cases', async () => {
      const unmonitoredMovie = createMockRadarrMovie({
        id: 1,
        title: 'Test Movie',
        monitored: false,
        hasFile: false,
      })

      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...unmonitoredMovie,
          tmdbId: unmonitoredMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockResolvedValue(unmonitoredMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(
        unmonitoredMovie.tmdbId,
        {
          deleteFiles: true,
        },
      )

      expect(result.warnings).toContain(
        'Movie was not monitored before deletion',
      )
      expect(result.warnings).toContain('Movie had no files to delete')
      expect(result.filesDeleted).toBe(false)
    })

    it('should not delete files when hasFile is false', async () => {
      const movieWithoutFiles = createMockRadarrMovie({
        id: 1,
        title: 'Test Movie',
        hasFile: false,
      })

      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...movieWithoutFiles,
          tmdbId: movieWithoutFiles.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockResolvedValue(movieWithoutFiles)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(
        movieWithoutFiles.tmdbId,
        {
          deleteFiles: true,
        },
      )

      expect(result.filesDeleted).toBe(false)
    })
  })

  describe('error handling and logging', () => {
    it('should handle and re-throw service errors appropriately', async () => {
      mockRadarrClient.getSystemStatus.mockRejectedValue(
        new Error('Test error'),
      )

      await expect(service.getSystemStatus()).rejects.toThrow('Test error')
      expect(mockRadarrClient.getSystemStatus).toHaveBeenCalled()
    })

    it('should handle network timeout errors gracefully', async () => {
      const timeoutError = new Error('Request timeout')
      timeoutError.name = 'TimeoutError'

      mockRadarrClient.searchMovies.mockRejectedValue(timeoutError)

      await expect(service.searchMovies('test')).rejects.toThrow(
        'Request timeout',
      )
    })

    it('should handle connection refused errors gracefully', async () => {
      const connectionError = new Error('ECONNREFUSED')
      connectionError.name = 'ConnectionError'

      mockRadarrClient.getAllMovies.mockRejectedValue(connectionError)

      await expect(service.getLibraryMovies()).rejects.toThrow('ECONNREFUSED')
    })

    it('should handle malformed response errors', async () => {
      const parseError = new Error('Unexpected token < in JSON at position 0')
      parseError.name = 'SyntaxError'

      mockRadarrClient.getAllQueueItems.mockRejectedValue(parseError)

      await expect(service.getDownloadingMovies()).rejects.toThrow(
        'Unexpected token < in JSON at position 0',
      )
    })

    it('should handle HTTP 500 errors gracefully', async () => {
      const serverError = new Error('Internal Server Error')
      serverError.name = 'HTTPError'

      mockRadarrClient.getSystemStatus.mockRejectedValue(serverError)

      await expect(service.getSystemStatus()).rejects.toThrow(
        'Internal Server Error',
      )
    })

    it('should handle HTTP 401 authentication errors', async () => {
      const authError = new Error('Unauthorized')
      authError.name = 'HTTPError'

      const movie = createMockMovieSearchResult()
      mockRadarrClient.isMovieInLibrary.mockResolvedValue(null)
      // Mock successful lookup since we want to test the getQualityProfiles failure
      mockRadarrClient.lookupMovieByTmdbId.mockResolvedValue({
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.year || 2023,
        overview: movie.overview,
        runtime: movie.runtime || 120,
        genres: movie.genres,
        inCinemas: movie.inCinemas,
        physicalRelease: movie.physicalRelease,
        digitalRelease: movie.digitalRelease,
        certification: movie.certification,
        studio: movie.studio,
        website: movie.website,
        youTubeTrailerId: movie.youTubeTrailerId,
        popularity: movie.popularity,
        imdbId: movie.imdbId,
        originalTitle: movie.originalTitle,
        ratings: {
          imdb: { value: movie.rating || 0, votes: 1000, type: 'user' },
        },
        images: [
          { coverType: RadarrImageType.POSTER, url: movie.posterPath || '' },
          { coverType: RadarrImageType.FANART, url: movie.backdropPath || '' },
        ],
        status: movie.status,
        hasFile: false,
        isAvailable: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        cleanTitle: 'testmovie',
        titleSlug: 'test-movie',
      })
      mockRadarrClient.getQualityProfiles.mockRejectedValue(authError)

      const result = await service.monitorAndDownloadMovie(movie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'Configuration error: Unauthorized',
      })
    })

    it('should handle HTTP 404 not found errors', async () => {
      const notFoundError = new Error('Not Found')
      notFoundError.name = 'HTTPError'

      const mockMovie = createMockRadarrMovie()

      // Mock getLibraryMovies to return the movie we want to delete
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovie,
          tmdbId: mockMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockRadarrClient.getMovie.mockRejectedValue(notFoundError)

      const result = await service.unmonitorAndDeleteMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        error: 'Movie not found in Radarr: Not Found',
      })
    })

    it('should handle validation errors with detailed messages', async () => {
      const validationError = new Error('Invalid input: title is required')
      validationError.name = 'ValidationError'

      jest
        .spyOn(RadarrInputSchemas.searchQuery, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.searchMovies('')).rejects.toThrow(
        'Invalid search query: Invalid input: title is required',
      )
    })

    it('should handle unknown error types gracefully', async () => {
      const unknownError = { message: 'Something weird happened' }

      jest
        .spyOn(RadarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: 'test' })

      mockRadarrClient.searchMovies.mockRejectedValue(unknownError)

      await expect(service.searchMovies('test')).rejects.toMatchObject(
        unknownError,
      )
    })
  })
})
