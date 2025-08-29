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

// Mock the utility function
jest.mock('src/media/utils/radarr.utils', () => ({
  transformToSearchResults: jest.fn(),
}))

// Import the mocked function
import { transformToSearchResults } from 'src/media/utils/radarr.utils'
const mockTransformToSearchResults =
  transformToSearchResults as jest.MockedFunction<
    typeof transformToSearchResults
  >

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
    } as unknown as jest.Mocked<RetryService>

    mockErrorClassifier = {
      classifyError: jest.fn().mockReturnValue({ isRetriable: true }),
    } as unknown as jest.Mocked<ErrorClassificationService>

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

  describe('getAllMoviesInLibrary', () => {
    beforeEach(() => {
      jest
        .spyOn(RadarrOutputSchemas.movieArray, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<typeof RadarrOutputSchemas.movieArray.parse>,
        )
    })

    it('should get all movies successfully', async () => {
      const mockMovies = [
        createMockRadarrMovie({ id: 1 }),
        createMockRadarrMovie({ id: 2 }),
      ]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200) // 200ms duration

      const result = await service.getAllMoviesInLibrary()

      expect(mockRadarrClient.getAllMovies).toHaveBeenCalled()
      expect(RadarrOutputSchemas.movieArray.parse).toHaveBeenCalledWith(
        mockMovies,
      )
      expect(result).toEqual(mockMovies)
    })

    it('should handle validation errors', async () => {
      const mockMovies = [createMockRadarrMovie()]
      mockRadarrClient.getAllMovies.mockResolvedValue(mockMovies)

      const validationError = new Error('Invalid movie array')
      jest
        .spyOn(RadarrOutputSchemas.movieArray, 'parse')
        .mockImplementation(() => {
          throw validationError
        })

      await expect(service.getAllMoviesInLibrary()).rejects.toThrow(
        'Invalid movie array',
      )
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

      const result = await service.monitorAndDownloadMovie(mockMovie)

      expect(mockRadarrClient.isMovieInLibrary).toHaveBeenCalledWith(
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

      const result = await service.monitorAndDownloadMovie(mockMovie)

      expect(mockRadarrClient.addMovie).not.toHaveBeenCalled()
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

      const result = await service.monitorAndDownloadMovie(mockMovie)

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

      const result = await service.monitorAndDownloadMovie(mockMovie, options)

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

      const result = await service.monitorAndDownloadMovie(mockMovie)

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

      const result = await service.monitorAndDownloadMovie(mockMovie)

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

      const result = await service.monitorAndDownloadMovie(mockMovie)

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

      const result = await service.monitorAndDownloadMovie(mockMovie)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error:
          'Configuration error: No accessible root folders available in Radarr',
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
      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const options: DeleteMovieOptions = { deleteFiles: true }

      const result = await service.unmonitorAndDeleteMovie(mockMovie, options)

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

      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue(mockQueueItems)
      mockRadarrClient.cancelAllQueueItemsForMovie.mockResolvedValue(2)
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(mockMovie, {
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

      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue(mockQueueItems)
      mockRadarrClient.cancelAllQueueItemsForMovie.mockResolvedValue(1) // Only 1 out of 2 cancelled
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(mockMovie, {
        deleteFiles: true,
      })

      expect(result.warnings).toContain(
        'Some downloads could not be cancelled (1/2 successful)',
      )
    })

    it('should handle movie not found error', async () => {
      mockRadarrClient.getMovie.mockRejectedValue(new Error('Movie not found'))

      const result = await service.unmonitorAndDeleteMovie(mockMovie)

      expect(result).toEqual({
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        error: 'Movie not found in Radarr: Movie not found',
      })
    })

    it('should handle download cancellation failures with warnings', async () => {
      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockRejectedValue(
        new Error('Queue access failed'),
      )
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(mockMovie, {
        deleteFiles: true,
      })

      expect(result.success).toBe(true)
      expect(result.warnings).toContain(
        'Failed to cancel downloads: Queue access failed',
      )
    })

    it('should handle deletion failures', async () => {
      mockRadarrClient.getMovie.mockResolvedValue(mockMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockRejectedValue(new Error('Delete failed'))

      const result = await service.unmonitorAndDeleteMovie(mockMovie)

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

      mockRadarrClient.getMovie.mockResolvedValue(unmonitoredMovie)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(unmonitoredMovie, {
        deleteFiles: true,
      })

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

      mockRadarrClient.getMovie.mockResolvedValue(movieWithoutFiles)
      mockRadarrClient.getQueueItemsForMovie.mockResolvedValue([])
      mockRadarrClient.deleteMovie.mockResolvedValue(undefined)

      const result = await service.unmonitorAndDeleteMovie(movieWithoutFiles, {
        deleteFiles: true,
      })

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
  })
})
