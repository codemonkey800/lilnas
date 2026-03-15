import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/radarr', () => ({
  deleteApiV3MovieById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  getApiV3Movie: jest.fn(),
  getApiV3MovieById: jest.fn(),
  getApiV3MovieLookup: jest.fn(),
  getApiV3MovieLookupTmdb: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3Queue: jest.fn(),
  getApiV3QueueDetails: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  postApiV3Command: jest.fn(),
  postApiV3Movie: jest.fn(),
}))

import {
  deleteApiV3MovieById,
  deleteApiV3QueueById,
  getApiV3Movie,
  getApiV3MovieById,
  getApiV3MovieLookup,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3QueueDetails,
  getApiV3Rootfolder,
  postApiV3Command,
  postApiV3Movie,
} from '@lilnas/media/radarr'

import { RetryConfigService } from 'src/config/retry.config'
import { RADARR_CLIENT } from 'src/media/clients'
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
  RadarrImageType,
  RadarrMinimumAvailability,
  RadarrMovie,
  RadarrMovieResource,
  RadarrMovieStatus,
  RadarrQualityProfile,
  RadarrQueueStatus,
  RadarrRootFolder,
  TrackedDownloadState,
  TrackedDownloadStatus,
} from 'src/media/types/radarr.types'
import { RetryService } from 'src/utils/retry.service'

// Mock utility functions
jest.mock('src/media/utils/radarr.utils', () => {
  // Use real toDownloadingMovie: it maps SDK QueueResource → DownloadingMovie
  // (different input/output shapes) and must run for tests to observe the
  // correct output fields (e.g. movieTitle).
  const actual = jest.requireActual('src/media/utils/radarr.utils')
  return {
    ...actual,
    transformToSearchResults: jest.fn(),
    transformToSearchResult: jest.fn(),
    toRadarrMovieResourceArray: jest.fn((arr: unknown[]) => arr),
    toRadarrMovieResource: jest.fn((r: unknown) => r),
    toRadarrMovie: jest.fn((r: unknown) => r),
    toRadarrMovieArray: jest.fn((arr: unknown[]) => arr),
  }
})

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

// Shorthands for SDK mocks
const mockGetApiV3MovieLookup = getApiV3MovieLookup as jest.Mock
const mockGetApiV3MovieLookupTmdb = getApiV3MovieLookupTmdb as jest.Mock
const mockGetApiV3Qualityprofile = getApiV3Qualityprofile as jest.Mock
const mockGetApiV3Rootfolder = getApiV3Rootfolder as jest.Mock
const mockPostApiV3Movie = postApiV3Movie as jest.Mock
const mockGetApiV3MovieById = getApiV3MovieById as jest.Mock
const mockPostApiV3Command = postApiV3Command as jest.Mock
const mockGetApiV3Movie = getApiV3Movie as jest.Mock
const mockDeleteApiV3MovieById = deleteApiV3MovieById as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock
const mockGetApiV3QueueDetails = getApiV3QueueDetails as jest.Mock
const mockDeleteApiV3QueueById = deleteApiV3QueueById as jest.Mock

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

// ─── Factories ────────────────────────────────────────────────────────────────

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

const createMockQueueItem = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  movieId: 1,
  title: 'Test Movie',
  size: 1000000000,
  sizeleft: 0,
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RadarrService', () => {
  let service: RadarrService
  let mockRetryService: jest.Mocked<RetryService>
  let mockRetryConfigService: { getRadarrConfig: jest.Mock }

  beforeEach(async () => {
    mockPerformanceNow.mockReturnValue(1000)

    mockRetryService = {
      executeWithCircuitBreaker: jest
        .fn()
        .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    } as unknown as jest.Mocked<RetryService>

    mockRetryConfigService = {
      getRadarrConfig: jest.fn().mockReturnValue({
        maxAttempts: 1,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2,
        jitter: false,
        timeout: 15000,
        logRetryAttempts: false,
        logSuccessfulRetries: false,
        logFailedRetries: false,
        logRetryDelays: false,
        logErrorDetails: false,
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarrService,
        { provide: RADARR_CLIENT, useValue: {} },
        { provide: RetryService, useValue: mockRetryService },
        { provide: RetryConfigService, useValue: mockRetryConfigService },
      ],
    }).compile()

    service = module.get<RadarrService>(RadarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()

    jest.clearAllMocks()

    // Re-apply the pass-through after clearAllMocks
    mockRetryService.executeWithCircuitBreaker.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    )
  })

  describe('searchMovies', () => {
    beforeEach(() => {
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

      mockGetApiV3MovieLookup.mockResolvedValue({ data: mockMovieResources })
      mockTransformToSearchResults.mockReturnValue(mockSearchResults)
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1100)

      const result = await service.searchMovies('test movie')

      expect(getApiV3MovieLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'test movie' } }),
      )
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

    it('should handle SDK errors', async () => {
      jest
        .spyOn(RadarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: 'test' })
      mockGetApiV3MovieLookup.mockRejectedValue(new Error('API Error'))

      await expect(service.searchMovies('test')).rejects.toThrow('API Error')
    })

    it('should handle output validation errors', async () => {
      const mockMovieResources: RadarrMovieResource[] = [
        {
          tmdbId: 123456,
          title: 'Test Movie',
          year: 2023,
          genres: [],
          ratings: {},
          images: [],
          hasFile: false,
          minimumAvailability: RadarrMinimumAvailability.RELEASED,
          isAvailable: true,
          cleanTitle: 'testmovie',
          titleSlug: 'test-movie',
          status: RadarrMovieStatus.RELEASED,
          runtime: 0,
        },
      ]

      mockGetApiV3MovieLookup.mockResolvedValue({ data: mockMovieResources })
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

  describe('getLibraryMovies', () => {
    beforeEach(() => {
      jest
        .spyOn(RadarrInputSchemas.optionalSearchQuery, 'parse')
        .mockImplementation(
          input =>
            input as ReturnType<
              typeof RadarrInputSchemas.optionalSearchQuery.parse
            >,
        )

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
      mockGetApiV3Movie.mockResolvedValue({ data: mockMovies })
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200)

      const result = await service.getLibraryMovies()

      expect(getApiV3Movie).toHaveBeenCalled()
      expect(RadarrInputSchemas.optionalSearchQuery.parse).toHaveBeenCalledWith(
        {
          query: undefined,
        },
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
      mockGetApiV3Movie.mockResolvedValue({ data: mockMovies })
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1200)

      const result = await service.getLibraryMovies('action')

      expect(getApiV3Movie).toHaveBeenCalled()
      expect(RadarrInputSchemas.optionalSearchQuery.parse).toHaveBeenCalledWith(
        {
          query: 'action',
        },
      )
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
      mockGetApiV3Movie.mockResolvedValue({ data: mockMovies })

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
      mockGetApiV3Movie.mockResolvedValue({ data: mockMovies })

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
      mockGetApiV3Movie.mockResolvedValue({ data: mockMovies })

      let result = await service.getLibraryMovies('&')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Fast & Furious')

      result = await service.getLibraryMovies(':')
      expect(result).toHaveLength(1)
      expect(result[0].title).toBe('Movie: The Sequel')
    })

    it('should return empty array for no matches', async () => {
      const mockMovies = [
        createMockRadarrMovie({ id: 1, title: 'Movie A', genres: ['Action'] }),
      ]
      mockGetApiV3Movie.mockResolvedValue({ data: mockMovies })

      const result = await service.getLibraryMovies('nonexistent')
      expect(result).toHaveLength(0)
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
      mockGetApiV3Movie.mockResolvedValue({ data: mockMovies })

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

    it('should handle API errors', async () => {
      mockGetApiV3Movie.mockRejectedValue(new Error('API Error'))

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
          status: RadarrQueueStatus.COMPLETED,
          movie: createMockRadarrMovie({ title: 'Movie 3' }),
        }),
      ]

      mockGetApiV3Queue.mockResolvedValue({ data: { records: mockQueueItems } })
      mockPerformanceNow.mockReturnValueOnce(1000).mockReturnValueOnce(1300)

      const result = await service.getDownloadingMovies()

      expect(getApiV3Queue).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { includeMovie: true, pageSize: 1000 },
        }),
      )

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
          movie: undefined,
        }),
      ]

      mockGetApiV3Queue.mockResolvedValue({ data: { records: mockQueueItems } })

      const result = await service.getDownloadingMovies()

      expect(result).toHaveLength(1)
      expect(result[0].movieTitle).toBe('Fallback Title')
      expect(result[0].movieYear).toBeUndefined()
    })

    it('should filter out completed and failed items', async () => {
      const mockQueueItems = [
        createMockQueueItem({ status: RadarrQueueStatus.DOWNLOADING }),
        createMockQueueItem({ status: RadarrQueueStatus.QUEUED }),
        createMockQueueItem({ status: RadarrQueueStatus.COMPLETED }),
        createMockQueueItem({ status: RadarrQueueStatus.FAILED }),
      ]

      mockGetApiV3Queue.mockResolvedValue({ data: { records: mockQueueItems } })

      const result = await service.getDownloadingMovies()

      expect(result).toHaveLength(2)
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
    const mockCommandResponse = { id: 1, name: 'MoviesSearch' }

    const makeLookupResult = (movie: MovieSearchResult) => ({
      tmdbId: movie.tmdbId,
      title: movie.title,
      year: movie.year,
      overview: movie.overview,
      runtime: movie.runtime,
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

    beforeEach(() => {
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: mockQualityProfiles,
      })
      mockGetApiV3Rootfolder.mockResolvedValue({ data: mockRootFolders })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: makeLookupResult(mockMovie),
      })

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

      // Not in library
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockPostApiV3Movie.mockResolvedValue({ data: addedMovie })
      mockPostApiV3Command.mockResolvedValue({ data: mockCommandResponse })

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(getApiV3Movie).toHaveBeenCalled()
      expect(getApiV3MovieLookupTmdb).toHaveBeenCalledWith(
        expect.objectContaining({ query: { tmdbId: mockMovie.tmdbId } }),
      )
      expect(getApiV3Qualityprofile).toHaveBeenCalled()
      expect(getApiV3Rootfolder).toHaveBeenCalled()
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tmdbId: mockMovie.tmdbId,
            title: mockMovie.title,
            qualityProfileId: 1,
            rootFolderPath: '/movies',
            monitored: true,
            minimumAvailability: RadarrMinimumAvailability.RELEASED,
            searchOnAdd: false,
          }),
        }),
      )
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'MoviesSearch', movieIds: [1] },
        }),
      )

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

      // In library
      mockGetApiV3Movie.mockResolvedValue({ data: [existingMovie] })
      mockPostApiV3Command.mockResolvedValue({ data: mockCommandResponse })

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(postApiV3Movie).not.toHaveBeenCalled()
      expect(getApiV3MovieLookupTmdb).not.toHaveBeenCalled()
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'MoviesSearch', movieIds: [1] },
        }),
      )

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

      mockGetApiV3Movie.mockResolvedValue({ data: [existingMovie] })
      mockPostApiV3Movie.mockResolvedValue({ data: addedMovie })
      mockPostApiV3Command.mockResolvedValue({ data: mockCommandResponse })

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(postApiV3Movie).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('should handle custom options', async () => {
      const addedMovie = createMockRadarrMovie({
        id: 1,
        tmdbId: mockMovie.tmdbId,
        monitored: false,
      })
      const options: MonitorMovieOptions = {
        qualityProfileId: 2,
        rootFolderPath: '/custom/movies',
        monitored: false,
        minimumAvailability: RadarrMinimumAvailability.IN_CINEMAS,
        searchOnAdd: true,
      }

      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockPostApiV3Movie.mockResolvedValue({
        data: { ...addedMovie, monitored: false },
      })

      const result = await service.monitorAndDownloadMovie(
        mockMovie.tmdbId,
        options,
      )

      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            qualityProfileId: 2,
            rootFolderPath: '/custom/movies',
            monitored: false,
            minimumAvailability: RadarrMinimumAvailability.IN_CINEMAS,
            searchOnAdd: true,
          }),
        }),
      )

      expect(postApiV3Command).not.toHaveBeenCalled()
      expect(result.searchTriggered).toBe(false)
    })

    it('should handle configuration failures - no quality profiles', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3Qualityprofile.mockResolvedValue({ data: [] })

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'Configuration error: No quality profiles available in Radarr',
      })
    })

    it('should handle add movie failures', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockPostApiV3Movie.mockRejectedValue(new Error('Movie already exists'))

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

      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockPostApiV3Movie.mockResolvedValue({ data: addedMovie })
      mockPostApiV3Command.mockRejectedValue(new Error('Search failed'))

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result.success).toBe(true)
      expect(result.movieAdded).toBe(true)
      expect(result.searchTriggered).toBe(false)
      expect(result.warnings).toContain(
        'Movie added but search failed: Search failed',
      )
    })

    it('should handle no accessible root folders', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [createMockRootFolder({ accessible: false })],
      })

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

      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: makeLookupResult(specialMovie),
      })
      mockPostApiV3Movie.mockResolvedValue({ data: addedMovie })
      mockPostApiV3Command.mockResolvedValue({ data: mockCommandResponse })

      const result = await service.monitorAndDownloadMovie(specialMovie.tmdbId)

      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            title: 'Fast & Furious: Tokyo Drift',
          }),
        }),
      )
      expect(result.success).toBe(true)
    })

    it('should handle isMovieInLibrary API errors gracefully', async () => {
      mockGetApiV3Movie.mockRejectedValue(new Error('API timeout'))

      const result = await service.monitorAndDownloadMovie(mockMovie.tmdbId)

      expect(result).toEqual({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'API timeout',
      })
    })

    it('should handle quality profiles API errors', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3Qualityprofile.mockRejectedValue(
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
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3Rootfolder.mockRejectedValue(
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
    const mockMovieData = createMockRadarrMovie({
      id: 1,
      title: 'Test Movie',
      hasFile: true,
    })

    it('should unmonitor and delete movie successfully', async () => {
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovieData,
          tmdbId: mockMovieData.tmdbId,
          rootFolderPath: '/movies',
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])
      mockGetApiV3MovieById.mockResolvedValue({ data: mockMovieData })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const options: DeleteMovieOptions = { deleteFiles: true }
      const result = await service.unmonitorAndDeleteMovie(
        mockMovieData.tmdbId,
        options,
      )

      expect(getApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 1 } }),
      )
      expect(getApiV3QueueDetails).toHaveBeenCalledWith(
        expect.objectContaining({ query: { movieId: 1, includeMovie: false } }),
      )
      expect(deleteApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 1 },
          query: { deleteFiles: true },
        }),
      )

      expect(result).toEqual({
        success: true,
        movieDeleted: true,
        filesDeleted: true,
        movie: mockMovieData,
        warnings: undefined,
      })
    })

    it('should cancel active downloads before deletion', async () => {
      const mockQueueItems = [
        { id: 1, title: 'Download 1' },
        { id: 2, title: 'Download 2' },
      ]

      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovieData,
          tmdbId: mockMovieData.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockGetApiV3MovieById.mockResolvedValue({ data: mockMovieData })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: mockQueueItems })
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(
        mockMovieData.tmdbId,
        { deleteFiles: true },
      )

      expect(deleteApiV3QueueById).toHaveBeenCalledTimes(2)
      expect(result.downloadsFound).toBe(2)
      expect(result.downloadsCancelled).toBe(2)
    })

    it('should handle partial download cancellation failures', async () => {
      const mockQueueItems = [
        { id: 1, title: 'Download 1' },
        { id: 2, title: 'Download 2' },
      ]

      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovieData,
          tmdbId: mockMovieData.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockGetApiV3MovieById.mockResolvedValue({ data: mockMovieData })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: mockQueueItems })
      // First cancellation succeeds, second fails
      mockDeleteApiV3QueueById
        .mockResolvedValueOnce({ data: undefined })
        .mockRejectedValueOnce(new Error('Cancel failed'))
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(
        mockMovieData.tmdbId,
        { deleteFiles: true },
      )

      expect(result.warnings).toContain(
        'Some downloads could not be cancelled (1/2 successful)',
      )
    })

    it('should handle movie not found error', async () => {
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovieData,
          tmdbId: mockMovieData.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockGetApiV3MovieById.mockResolvedValue({
        data: undefined,
        error: { message: 'Not found' },
        response: { status: 404 },
      })

      const result = await service.unmonitorAndDeleteMovie(mockMovieData.tmdbId)

      expect(result.success).toBe(false)
      expect(result.movieDeleted).toBe(false)
      expect(result.error).toContain('Movie not found in Radarr')
    })

    it('should handle download cancellation failures with warnings', async () => {
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovieData,
          tmdbId: mockMovieData.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockGetApiV3MovieById.mockResolvedValue({ data: mockMovieData })
      mockGetApiV3QueueDetails.mockRejectedValue(
        new Error('Queue access failed'),
      )
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(
        mockMovieData.tmdbId,
        { deleteFiles: true },
      )

      expect(result.success).toBe(true)
      expect(result.warnings).toContain(
        'Failed to cancel downloads: Queue access failed',
      )
    })

    it('should handle deletion failures', async () => {
      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...mockMovieData,
          tmdbId: mockMovieData.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockGetApiV3MovieById.mockResolvedValue({ data: mockMovieData })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockRejectedValue(new Error('Delete failed'))

      const result = await service.unmonitorAndDeleteMovie(mockMovieData.tmdbId)

      expect(result).toEqual({
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        movie: mockMovieData,
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

      jest.spyOn(service, 'getLibraryMovies').mockResolvedValue([
        {
          ...unmonitoredMovie,
          tmdbId: unmonitoredMovie.tmdbId,
        } as Partial<MovieLibrarySearchResult> as MovieLibrarySearchResult,
      ])

      mockGetApiV3MovieById.mockResolvedValue({ data: unmonitoredMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(
        unmonitoredMovie.tmdbId,
        { deleteFiles: true },
      )

      expect(result.warnings).toContain(
        'Movie was not monitored before deletion',
      )
      expect(result.warnings).toContain('Movie had no files to delete')
      expect(result.filesDeleted).toBe(false)
    })
  })

  describe('error handling and logging', () => {
    it('should handle network timeout errors gracefully', async () => {
      jest
        .spyOn(RadarrInputSchemas.searchQuery, 'parse')
        .mockReturnValue({ query: 'test' })

      const timeoutError = new Error('Request timeout')
      timeoutError.name = 'TimeoutError'
      mockGetApiV3MovieLookup.mockRejectedValue(timeoutError)

      await expect(service.searchMovies('test')).rejects.toThrow(
        'Request timeout',
      )
    })

    it('should handle connection refused errors gracefully', async () => {
      const connectionError = new Error('ECONNREFUSED')
      connectionError.name = 'ConnectionError'
      mockGetApiV3Movie.mockRejectedValue(connectionError)

      await expect(service.getLibraryMovies()).rejects.toThrow('ECONNREFUSED')
    })

    it('should handle malformed response errors', async () => {
      const parseError = new Error('Unexpected token < in JSON at position 0')
      parseError.name = 'SyntaxError'
      mockGetApiV3Queue.mockRejectedValue(parseError)

      await expect(service.getDownloadingMovies()).rejects.toThrow(
        'Unexpected token < in JSON at position 0',
      )
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
  })
})
