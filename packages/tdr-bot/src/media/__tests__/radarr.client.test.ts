import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { RetryConfigService } from 'src/config/retry.config'
import { RadarrClient } from 'src/media/clients/radarr.client'
import {
  AddMovieRequest,
  AddMovieResponse,
  DeleteMovieOptions,
  DownloadProtocol,
  RadarrCommandResponse,
  RadarrImageType,
  RadarrMinimumAvailability,
  RadarrMovie,
  RadarrMovieResource,
  RadarrMovieStatus,
  RadarrQualityProfile,
  RadarrQueueItem,
  RadarrQueuePaginatedResponse,
  RadarrQueueStatus,
  RadarrRootFolder,
  RadarrSystemStatus,
  TrackedDownloadState,
  TrackedDownloadStatus,
} from 'src/media/types/radarr.types'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock the env utility
jest.mock('@lilnas/utils/env', () => ({
  env: jest.fn((key: string) => {
    if (key === 'RADARR_URL') return 'http://localhost:7878'
    if (key === 'RADARR_API_KEY') return 'test-api-key'
    return undefined
  }),
}))

// Mock the base client methods
const mockGet = jest.fn()
const mockPost = jest.fn()
const mockDelete = jest.fn()

jest.mock('src/media/clients/base-media-api.client', () => ({
  BaseMediaApiClient: class {
    protected logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() }
    protected get = mockGet
    protected post = mockPost
    protected delete = mockDelete
  },
}))

describe('RadarrClient', () => {
  let client: RadarrClient
  let mockRetryService: jest.Mocked<RetryService>
  let mockErrorClassifier: jest.Mocked<ErrorClassificationService>
  let mockRetryConfigService: jest.Mocked<RetryConfigService>

  // Simplified test data factories
  const createMockMovieResource = (
    overrides: Partial<RadarrMovieResource> = {},
  ): RadarrMovieResource => ({
    tmdbId: 123456,
    imdbId: 'tt1234567',
    title: 'Test Movie',
    originalTitle: 'Test Movie Original',
    year: 2023,
    overview: 'A test movie overview',
    runtime: 120,
    genres: ['Action'],
    ratings: {
      imdb: { value: 8.5, votes: 1000, type: 'user' },
    },
    images: [
      {
        coverType: RadarrImageType.POSTER,
        url: 'https://example.com/poster.jpg',
      },
      {
        coverType: RadarrImageType.FANART,
        url: 'https://example.com/fanart.jpg',
      },
    ],
    inCinemas: '2023-06-01T00:00:00Z',
    physicalRelease: '2023-08-01T00:00:00Z',
    digitalRelease: '2023-07-01T00:00:00Z',
    status: RadarrMovieStatus.RELEASED,
    certification: 'PG-13',
    studio: 'Test Studio',
    hasFile: false,
    isAvailable: true,
    minimumAvailability: RadarrMinimumAvailability.RELEASED,
    cleanTitle: 'testmovie',
    titleSlug: 'test-movie',
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

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks()
    mockGet.mockReset()
    mockPost.mockReset()
    mockDelete.mockReset()

    // Create mocked services
    mockRetryService = {
      execute: jest.fn().mockImplementation(async fn => fn()),
    } as unknown as jest.Mocked<RetryService>

    mockErrorClassifier = {
      classifyError: jest.fn().mockReturnValue({ isRetriable: true }),
    } as unknown as jest.Mocked<ErrorClassificationService>

    mockRetryConfigService = {
      getRadarrConfig: jest.fn().mockReturnValue({
        maxRetries: 3,
        baseDelay: 1000,
      }),
    } as unknown as jest.Mocked<RetryConfigService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarrClient,
        { provide: RetryService, useValue: mockRetryService },
        { provide: ErrorClassificationService, useValue: mockErrorClassifier },
        { provide: RetryConfigService, useValue: mockRetryConfigService },
      ],
    }).compile()

    client = module.get<RadarrClient>(RadarrClient)

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  describe('constructor', () => {
    it.each([
      ['http://localhost:7878', 'http://localhost:7878/api/v3'],
      ['http://localhost:7878/', 'http://localhost:7878/api/v3'],
      ['http://localhost:7878/api/v3', 'http://localhost:7878/api/v3'],
    ])('should correctly format base URL from %s to %s', (input, expected) => {
      const { env: envMock } = jest.requireMock('@lilnas/utils/env') as {
        env: jest.Mock
      }
      envMock.mockReturnValueOnce(input)

      const newClient = new RadarrClient(
        mockRetryService,
        mockErrorClassifier,
        mockRetryConfigService,
      )
      expect(newClient['baseUrl']).toBe(expected)
    })

    it('should initialize with correct API key', () => {
      expect(client['apiKey']).toBe('test-api-key')
    })
  })

  describe('searchMovies', () => {
    it('should search movies successfully', async () => {
      const mockMovies = [createMockMovieResource()]
      mockGet.mockResolvedValue(mockMovies)

      const result = await client.searchMovies('test movie')

      expect(mockGet).toHaveBeenCalledWith('/movie/lookup?term=test+movie')
      expect(result).toEqual(mockMovies)
    })

    it('should throw error for empty query', async () => {
      await expect(client.searchMovies('')).rejects.toThrow(
        'Search query is required',
      )
      await expect(client.searchMovies('   ')).rejects.toThrow(
        'Search query is required',
      )
    })

    it('should throw error for query less than 2 characters', async () => {
      await expect(client.searchMovies('a')).rejects.toThrow(
        'Search query must be at least 2 characters',
      )
    })

    it('should trim query whitespace', async () => {
      const mockMovies = [createMockMovieResource()]
      mockGet.mockResolvedValue(mockMovies)

      await client.searchMovies('  test movie  ')

      expect(mockGet).toHaveBeenCalledWith('/movie/lookup?term=test+movie')
    })

    it('should handle API errors', async () => {
      const error = new Error('API Error')
      mockGet.mockRejectedValue(error)

      await expect(client.searchMovies('test')).rejects.toThrow('API Error')
    })

    it('should handle special characters in query', async () => {
      const mockMovies = [createMockMovieResource()]
      mockGet.mockResolvedValue(mockMovies)

      await client.searchMovies('test & movie: part 1')

      expect(mockGet).toHaveBeenCalledWith(
        '/movie/lookup?term=test+%26+movie%3A+part+1',
      )
    })
  })

  describe('getSystemStatus', () => {
    it('should get system status successfully', async () => {
      const mockStatus = createMockSystemStatus()
      mockGet.mockResolvedValue(mockStatus)

      const result = await client.getSystemStatus()

      expect(mockGet).toHaveBeenCalledWith('/system/status')
      expect(result).toEqual(mockStatus)
    })

    it('should handle system status API errors', async () => {
      const error = new Error('System unavailable')
      mockGet.mockRejectedValue(error)

      await expect(client.getSystemStatus()).rejects.toThrow(
        'System unavailable',
      )
    })
  })

  describe('checkHealth', () => {
    it('should return true when system status is accessible', async () => {
      const mockStatus = createMockSystemStatus()
      mockGet.mockResolvedValue(mockStatus)

      const result = await client.checkHealth()

      expect(result).toBe(true)
    })

    it('should return false when system status fails', async () => {
      mockGet.mockRejectedValue(new Error('Connection failed'))

      const result = await client.checkHealth()

      expect(result).toBe(false)
    })
  })

  describe('getQualityProfiles', () => {
    it('should get quality profiles successfully', async () => {
      const mockProfiles: RadarrQualityProfile[] = [
        {
          id: 1,
          name: 'HD-1080p',
          upgradeAllowed: true,
          cutoff: 4,
          items: [],
          minFormatScore: 0,
          cutoffFormatScore: 0,
          formatItems: [],
          language: { id: 1, name: 'English' },
        },
        {
          id: 2,
          name: '4K',
          upgradeAllowed: true,
          cutoff: 7,
          items: [],
          minFormatScore: 0,
          cutoffFormatScore: 0,
          formatItems: [],
          language: { id: 1, name: 'English' },
        },
      ]
      mockGet.mockResolvedValue(mockProfiles)

      const result = await client.getQualityProfiles()

      expect(mockGet).toHaveBeenCalledWith('/qualityprofile')
      expect(result).toEqual(mockProfiles)
    })

    it('should handle quality profiles API errors', async () => {
      mockGet.mockRejectedValue(new Error('Profiles not found'))

      await expect(client.getQualityProfiles()).rejects.toThrow(
        'Profiles not found',
      )
    })
  })

  describe('getRootFolders', () => {
    it('should get root folders successfully', async () => {
      const mockFolders: RadarrRootFolder[] = [
        {
          id: 1,
          path: '/movies',
          accessible: true,
          freeSpace: 1000000000,
          totalSpace: 2000000000,
          unmappedFolders: [],
        },
        {
          id: 2,
          path: '/movies2',
          accessible: false,
          freeSpace: 0,
          totalSpace: 1000000000,
          unmappedFolders: [],
        },
      ]
      mockGet.mockResolvedValue(mockFolders)

      const result = await client.getRootFolders()

      expect(mockGet).toHaveBeenCalledWith('/rootfolder')
      expect(result).toEqual(mockFolders)
    })
  })

  describe('addMovie', () => {
    it('should add movie successfully', async () => {
      const movieRequest: AddMovieRequest = {
        tmdbId: 123456,
        title: 'Test Movie',
        titleSlug: 'test-movie',
        year: 2023,
        qualityProfileId: 1,
        rootFolderPath: '/movies',
        monitored: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        searchOnAdd: false,
      }

      const mockResponse: AddMovieResponse = createMockRadarrMovie({
        id: 1,
        tmdbId: 123456,
        title: 'Test Movie',
        year: 2023,
        monitored: true,
        qualityProfileId: 1,
      })

      mockPost.mockResolvedValue(mockResponse)

      const result = await client.addMovie(movieRequest)

      expect(mockPost).toHaveBeenCalledWith('/movie', movieRequest)
      expect(result).toEqual(mockResponse)
    })

    it('should handle add movie API errors', async () => {
      const movieRequest: AddMovieRequest = {
        tmdbId: 123456,
        title: 'Test Movie',
        titleSlug: 'test-movie',
        year: 2023,
        qualityProfileId: 1,
        rootFolderPath: '/movies',
        monitored: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
        searchOnAdd: false,
      }

      mockPost.mockRejectedValue(new Error('Movie already exists'))

      await expect(client.addMovie(movieRequest)).rejects.toThrow(
        'Movie already exists',
      )
    })
  })

  describe('getMovie', () => {
    it('should get movie by ID successfully', async () => {
      const mockMovie = createMockRadarrMovie({ id: 123 })
      mockGet.mockResolvedValue(mockMovie)

      const result = await client.getMovie(123)

      expect(mockGet).toHaveBeenCalledWith('/movie/123')
      expect(result).toEqual(mockMovie)
    })

    it('should handle get movie not found', async () => {
      mockGet.mockRejectedValue(new Error('Movie not found'))

      await expect(client.getMovie(999)).rejects.toThrow('Movie not found')
    })
  })

  describe('triggerMovieSearch', () => {
    it('should trigger movie search successfully', async () => {
      const mockCommand: RadarrCommandResponse = {
        id: 1,
        name: 'MoviesSearch',
        commandName: 'MoviesSearch',
        message: 'Search started',
        body: {
          movieIds: [123],
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

      mockPost.mockResolvedValue(mockCommand)

      const result = await client.triggerMovieSearch(123)

      expect(mockPost).toHaveBeenCalledWith('/command', {
        name: 'MoviesSearch',
        movieIds: [123],
      })
      expect(result).toEqual(mockCommand)
    })
  })

  describe('isMovieInLibrary', () => {
    it('should find movie in library', async () => {
      const mockMovies = [
        createMockRadarrMovie({ tmdbId: 123456, id: 1 }),
        createMockRadarrMovie({ tmdbId: 789012, id: 2 }),
      ]
      mockGet.mockResolvedValue(mockMovies)

      const result = await client.isMovieInLibrary(123456)

      expect(mockGet).toHaveBeenCalledWith('/movie')
      expect(result).toEqual(mockMovies[0])
    })

    it('should return null when movie not in library', async () => {
      const mockMovies = [createMockRadarrMovie({ tmdbId: 789012 })]
      mockGet.mockResolvedValue(mockMovies)

      const result = await client.isMovieInLibrary(123456)

      expect(result).toBeNull()
    })

    it('should handle empty library', async () => {
      mockGet.mockResolvedValue([])

      const result = await client.isMovieInLibrary(123456)

      expect(result).toBeNull()
    })
  })

  describe('getAllMovies', () => {
    it('should get all movies successfully', async () => {
      const mockMovies = [
        createMockRadarrMovie({ id: 1 }),
        createMockRadarrMovie({ id: 2 }),
      ]
      mockGet.mockResolvedValue(mockMovies)

      const result = await client.getAllMovies()

      expect(mockGet).toHaveBeenCalledWith('/movie')
      expect(result).toEqual(mockMovies)
    })
  })

  describe('deleteMovie', () => {
    it('should delete movie without files', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.deleteMovie(123)

      expect(mockDelete).toHaveBeenCalledWith('/movie/123')
    })

    it('should delete movie with files', async () => {
      const options: DeleteMovieOptions = { deleteFiles: true }
      mockDelete.mockResolvedValue(undefined)

      await client.deleteMovie(123, options)

      expect(mockDelete).toHaveBeenCalledWith('/movie/123?deleteFiles=true')
    })
  })

  describe('getAllQueueItems', () => {
    it('should get all queue items with default options', async () => {
      const mockResponse: RadarrQueuePaginatedResponse = {
        page: 1,
        pageSize: 20,
        sortKey: 'timeleft',
        sortDirection: 'ascending',
        totalRecords: 2,
        records: [
          createMockQueueItem({ id: 1 }),
          createMockQueueItem({ id: 2 }),
        ],
      }
      mockGet.mockResolvedValue(mockResponse)

      const result = await client.getAllQueueItems()

      expect(mockGet).toHaveBeenCalledWith('/queue')
      expect(result).toEqual(mockResponse.records)
    })

    it('should get queue items with pagination options', async () => {
      const mockResponse: RadarrQueuePaginatedResponse = {
        page: 2,
        pageSize: 10,
        sortKey: 'progress',
        sortDirection: 'descending',
        totalRecords: 25,
        records: [createMockQueueItem()],
      }
      mockGet.mockResolvedValue(mockResponse)

      const options = {
        page: 2,
        pageSize: 10,
        sortKey: 'progress',
        sortDirection: 'descending' as const,
        includeMovie: true,
      }

      const result = await client.getAllQueueItems(options)

      expect(mockGet).toHaveBeenCalledWith(
        '/queue?page=2&pageSize=10&sortKey=progress&sortDirection=descending&includeMovie=true',
      )
      expect(result).toEqual(mockResponse.records)
    })

    it('should handle invalid queue response structure', async () => {
      mockGet.mockResolvedValue({ invalid: 'response' })

      await expect(client.getAllQueueItems()).rejects.toThrow(
        'Invalid queue response',
      )
    })

    it('should handle queue response with null records', async () => {
      mockGet.mockResolvedValue({ records: null })

      await expect(client.getAllQueueItems()).rejects.toThrow(
        'Invalid queue response',
      )
    })
  })

  describe('getQueueItemsForMovie', () => {
    it('should get queue items for specific movie', async () => {
      const mockQueueItems = [
        createMockQueueItem({ id: 1, movieId: 123 }),
        createMockQueueItem({ id: 2, movieId: 123 }),
      ]
      mockGet.mockResolvedValue(mockQueueItems)

      const result = await client.getQueueItemsForMovie(123)

      expect(mockGet).toHaveBeenCalledWith(
        '/queue/details?movieId=123&includeMovie=false',
      )
      expect(result).toEqual(mockQueueItems)
    })
  })

  describe('cancelQueueItem', () => {
    it('should cancel queue item with default options', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.cancelQueueItem(123)

      expect(mockDelete).toHaveBeenCalledWith('/queue/123')
    })

    it('should cancel queue item with options', async () => {
      mockDelete.mockResolvedValue(undefined)

      await client.cancelQueueItem(123, {
        removeFromClient: true,
        blocklist: false,
      })

      expect(mockDelete).toHaveBeenCalledWith(
        '/queue/123?removeFromClient=true&blocklist=false',
      )
    })
  })

  describe('cancelAllQueueItemsForMovie', () => {
    it('should cancel all queue items for movie', async () => {
      const mockQueueItems = [
        createMockQueueItem({ id: 1, movieId: 123 }),
        createMockQueueItem({ id: 2, movieId: 123 }),
      ]

      // First call to get queue items
      mockGet.mockResolvedValueOnce(mockQueueItems)
      // Delete calls for each item
      mockDelete.mockResolvedValue(undefined)

      const result = await client.cancelAllQueueItemsForMovie(123)

      expect(mockGet).toHaveBeenCalledWith(
        '/queue/details?movieId=123&includeMovie=false',
      )
      expect(mockDelete).toHaveBeenCalledTimes(2)
      expect(mockDelete).toHaveBeenCalledWith('/queue/1?removeFromClient=true')
      expect(mockDelete).toHaveBeenCalledWith('/queue/2?removeFromClient=true')
      expect(result).toBe(2)
    })

    it('should return 0 when no queue items exist', async () => {
      mockGet.mockResolvedValue([])

      const result = await client.cancelAllQueueItemsForMovie(123)

      expect(result).toBe(0)
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('should handle partial cancellation failures', async () => {
      const mockQueueItems = [
        createMockQueueItem({ id: 1, movieId: 123 }),
        createMockQueueItem({ id: 2, movieId: 123 }),
      ]

      mockGet.mockResolvedValue(mockQueueItems)
      mockDelete.mockResolvedValueOnce(undefined) // First succeeds
      mockDelete.mockRejectedValueOnce(new Error('Cancel failed')) // Second fails

      const result = await client.cancelAllQueueItemsForMovie(123)

      expect(result).toBe(1) // Only one successfully cancelled
    })
  })

  describe('getRetryConfig', () => {
    it('should get retry configuration', () => {
      const result = client['getRetryConfig']()

      expect(mockRetryConfigService.getRadarrConfig).toHaveBeenCalled()
      expect(result).toEqual({ maxRetries: 3, baseDelay: 1000 })
    })
  })

  describe('error handling and logging', () => {
    it('should handle and re-throw errors appropriately', async () => {
      const error = new Error('Test error')
      mockGet.mockRejectedValue(error)

      await expect(client.searchMovies('test')).rejects.toThrow('Test error')
    })
  })
})
