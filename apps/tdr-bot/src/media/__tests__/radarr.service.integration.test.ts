import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

/**
 * Integration tests for RadarrService using @lilnas/media SDK functions.
 *
 * These tests wire up the real RadarrService with a pass-through RetryService,
 * mocking only at the SDK function level. They verify the full chain from
 * service method → SDK call → response transformation → final output, using
 * real Zod schemas and real utility transforms.
 */

// Mock SDK module BEFORE any imports
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
  getApiV3SystemStatus: jest.fn(),
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
import { RadarrService } from 'src/media/services/radarr.service'
import {
  RadarrImageType,
  RadarrMinimumAvailability,
  RadarrMovieStatus,
  RadarrQueueStatus,
  TrackedDownloadState,
  TrackedDownloadStatus,
} from 'src/media/types/radarr.types'
import { RetryService } from 'src/utils/retry.service'

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-id-123'),
}))

jest.mock('perf_hooks', () => ({
  performance: { now: jest.fn(() => 1000) },
}))

// Shorthands
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

// ─── Test data ────────────────────────────────────────────────────────────────

const movieResource = {
  tmdbId: 550,
  imdbId: 'tt0137523',
  title: 'Fight Club',
  originalTitle: 'Fight Club',
  year: 1999,
  overview: 'An insomniac office worker...',
  runtime: 139,
  genres: ['Drama', 'Thriller'],
  ratings: { imdb: { value: 8.8, votes: 2000000, type: 'user' } },
  images: [
    {
      coverType: RadarrImageType.POSTER,
      url: 'https://cdn.example.com/poster.jpg',
      remoteUrl: 'https://cdn.example.com/poster.jpg',
    },
    {
      coverType: RadarrImageType.FANART,
      url: 'https://cdn.example.com/fanart.jpg',
      remoteUrl: 'https://cdn.example.com/fanart.jpg',
    },
  ],
  status: RadarrMovieStatus.RELEASED,
  certification: 'R',
  studio: 'Fox 2000 Pictures',
  hasFile: false,
  isAvailable: true,
  minimumAvailability: RadarrMinimumAvailability.RELEASED,
  cleanTitle: 'fightclub',
  titleSlug: 'fight-club',
}

const libraryMovie = {
  id: 42,
  tmdbId: 550,
  imdbId: 'tt0137523',
  title: 'Fight Club',
  originalTitle: 'Fight Club',
  year: 1999,
  monitored: true,
  hasFile: true,
  qualityProfileId: 1,
  path: '/movies/Fight Club (1999)',
  sizeOnDisk: 8589934592,
  added: '2023-01-01T00:00:00Z',
  isAvailable: true,
  minimumAvailability: RadarrMinimumAvailability.RELEASED,
  cleanTitle: 'fightclub',
  titleSlug: 'fight-club',
  status: RadarrMovieStatus.RELEASED,
  genres: ['Drama', 'Thriller'],
  ratings: { imdb: { value: 8.8, votes: 2000000, type: 'user' } },
  images: [
    {
      coverType: RadarrImageType.POSTER,
      remoteUrl: 'https://img.radarr.video/poster.jpg',
    },
  ],
  runtime: 139,
  tags: [],
  overview: 'An insomniac office worker...',
  certification: 'R',
  studio: 'Fox 2000 Pictures',
}

const qualityProfile = {
  id: 1,
  name: 'HD-1080p',
  upgradeAllowed: true,
  cutoff: 4,
  items: [],
  minFormatScore: 0,
  cutoffFormatScore: 0,
  formatItems: [],
  language: { id: 1, name: 'English' },
}

const rootFolder = {
  id: 1,
  path: '/movies',
  accessible: true,
  freeSpace: 1000000000,
  totalSpace: 2000000000,
  unmappedFolders: [],
}

const commandResponse = { id: 99, name: 'MoviesSearch' }

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RadarrService integration (SDK mocked)', () => {
  let service: RadarrService
  let mockRetryService: { executeWithCircuitBreaker: jest.Mock }

  beforeEach(async () => {
    mockRetryService = {
      executeWithCircuitBreaker: jest
        .fn()
        .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarrService,
        { provide: RADARR_CLIENT, useValue: {} },
        { provide: RetryService, useValue: mockRetryService },
        {
          provide: RetryConfigService,
          useValue: {
            getRadarrConfig: () => ({
              maxAttempts: 1,
              baseDelay: 0,
              maxDelay: 0,
              backoffFactor: 2,
              jitter: false,
              timeout: 15000,
            }),
          },
        },
      ],
    }).compile()

    service = module.get<RadarrService>(RadarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    jest.clearAllMocks()

    // Re-apply pass-through
    mockRetryService.executeWithCircuitBreaker.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    )
  })

  describe('searchMovies', () => {
    it('should call SDK with search term and return transformed results', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({ data: [movieResource] })

      const results = await service.searchMovies('Fight Club')

      expect(getApiV3MovieLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'Fight Club' } }),
      )
      expect(results).toHaveLength(1)
      expect(results[0].tmdbId).toBe(550)
      expect(results[0].title).toBe('Fight Club')
      expect(results[0].rating).toBe(8.8)
    })

    it('should propagate SDK errors', async () => {
      mockGetApiV3MovieLookup.mockRejectedValue(new Error('Connection refused'))

      await expect(service.searchMovies('test')).rejects.toThrow(
        'Connection refused',
      )
    })

    it('should correctly map poster and fanart images', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({ data: [movieResource] })

      const results = await service.searchMovies('Fight Club')

      expect(results[0].posterPath).toContain('poster.jpg')
      expect(results[0].backdropPath).toContain('fanart.jpg')
    })
  })

  describe('getDownloadingMovies', () => {
    it('should call queue SDK and return transformed downloading movies', async () => {
      const queueResponse = {
        totalRecords: 1,
        page: 1,
        pageSize: 1000,
        records: [
          {
            id: 1,
            movieId: 42,
            title: 'Fight Club',
            size: 2000000000,
            sizeleft: 1000000000,
            status: RadarrQueueStatus.DOWNLOADING,
            trackedDownloadStatus: TrackedDownloadStatus.OK,
            trackedDownloadState: TrackedDownloadState.DOWNLOADING,
            statusMessages: [],
            errorMessage: '',
            downloadId: 'abc123',
            protocol: 'torrent',
            downloadClient: 'qBittorrent',
            indexer: 'TestIndexer',
            outputPath: '/downloads/Fight Club',
            estimatedCompletionTime: '2023-01-01T01:00:00Z',
            added: '2023-01-01T00:00:00Z',
            movie: libraryMovie,
          },
        ],
      }

      mockGetApiV3Queue.mockResolvedValue({ data: queueResponse })

      const results = await service.getDownloadingMovies()

      expect(getApiV3Queue).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { includeMovie: true, pageSize: 1000 },
        }),
      )
      expect(results).toHaveLength(1)
      expect(results[0].movieTitle).toBe('Fight Club')
      expect(results[0].progressPercent).toBe(50)
      expect(results[0].downloadedBytes).toBe(1000000000)
    })
  })

  describe('monitorAndDownloadMovie', () => {
    it('should orchestrate all SDK calls and return success for new movie', async () => {
      const addedMovie = { ...libraryMovie, id: 42, monitored: true }

      // Not in library
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      // TMDB lookup
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({ data: movieResource })
      // Config
      mockGetApiV3Qualityprofile.mockResolvedValue({ data: [qualityProfile] })
      mockGetApiV3Rootfolder.mockResolvedValue({ data: [rootFolder] })
      // Add movie
      mockPostApiV3Movie.mockResolvedValue({ data: addedMovie })
      // Trigger search
      mockPostApiV3Command.mockResolvedValue({ data: commandResponse })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(true)
      expect(result.movieAdded).toBe(true)
      expect(result.searchTriggered).toBe(true)
      expect(result.commandId).toBe(99)
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tmdbId: 550,
            title: 'Fight Club',
            qualityProfileId: 1,
            rootFolderPath: '/movies',
          }),
        }),
      )
    })

    it('should trigger search for existing monitored movie without re-adding', async () => {
      const monitoredMovie = { ...libraryMovie, tmdbId: 550, monitored: true }

      mockGetApiV3Movie.mockResolvedValue({ data: [monitoredMovie] })
      mockPostApiV3Command.mockResolvedValue({ data: commandResponse })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(true)
      expect(result.movieAdded).toBe(false)
      expect(result.searchTriggered).toBe(true)
      expect(postApiV3Movie).not.toHaveBeenCalled()
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'MoviesSearch', movieIds: [42] },
        }),
      )
    })
  })

  describe('getLibraryMovies', () => {
    it('should return all movies when no query provided', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })

      const results = await service.getLibraryMovies()

      expect(getApiV3Movie).toHaveBeenCalled()
      expect(results).toHaveLength(1)
      expect(results[0].tmdbId).toBe(550)
      expect(results[0].id).toBe(42)
      expect(results[0].monitored).toBe(true)
    })

    it('should filter library movies by title query through the full chain', async () => {
      const matrixMovie = {
        ...libraryMovie,
        id: 43,
        tmdbId: 603,
        title: 'The Matrix',
        originalTitle: 'The Matrix',
        overview: 'A computer hacker learns the truth.',
        studio: 'Warner Bros.',
      }

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie, matrixMovie] })

      const results = await service.getLibraryMovies('fight')

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Fight Club')
    })

    it('should return empty array when no library movies match the query', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })

      const results = await service.getLibraryMovies('nomatch')

      expect(results).toHaveLength(0)
    })

    it('should propagate SDK errors', async () => {
      const error = Object.assign(new Error('Internal Server Error'), {
        response: { status: 500 },
      })
      mockGetApiV3Movie.mockRejectedValue(error)

      await expect(service.getLibraryMovies()).rejects.toThrow(
        'Internal Server Error',
      )
    })
  })

  describe('error propagation', () => {
    it('should propagate connection timeout from searchMovies', async () => {
      const error = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
      mockGetApiV3MovieLookup.mockRejectedValue(error)

      await expect(service.searchMovies('test')).rejects.toThrow('ETIMEDOUT')
    })

    it('should propagate network errors from getDownloadingMovies', async () => {
      mockGetApiV3Queue.mockRejectedValue(new Error('Network Error'))

      await expect(service.getDownloadingMovies()).rejects.toThrow(
        'Network Error',
      )
    })
  })

  describe('unmonitorAndDeleteMovie', () => {
    it('should delete movie and return success when movie is found', async () => {
      // getLibraryMovies -> getAllMovies
      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      // getMovie
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      // queue details - no downloads
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      // delete
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.success).toBe(true)
      expect(result.movieDeleted).toBe(true)
      expect(deleteApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 42 } }),
      )
    })

    it('should return failure when movie is not in library', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })

      const result = await service.unmonitorAndDeleteMovie(999)

      expect(result.success).toBe(false)
      expect(result.movieDeleted).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should cancel active downloads before deleting', async () => {
      const queueItem = {
        id: 5,
        movieId: libraryMovie.id,
        title: 'Fight Club',
      }

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [queueItem] })
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.success).toBe(true)
      expect(deleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 5 } }),
      )
      expect(deleteApiV3MovieById).toHaveBeenCalled()
    })
  })
})
