import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

/**
 * Characterization tests for RadarrService.
 *
 * These tests use the REAL radarr.utils transformation functions and REAL Zod
 * schema validation (no mocking of those layers). They document the exact output
 * shape that downstream consumers depend on.
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
  DownloadProtocol,
  RadarrImageType,
  RadarrMinimumAvailability,
  RadarrMovie,
  RadarrMovieResource,
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

// ─── Factories ────────────────────────────────────────────────────────────────

const createMockMovieResource = (
  overrides: Partial<RadarrMovieResource> = {},
): RadarrMovieResource => ({
  tmdbId: 550,
  imdbId: 'tt0137523',
  title: 'Fight Club',
  originalTitle: 'Fight Club',
  year: 1999,
  overview: 'An insomniac office worker forms an underground fight club.',
  runtime: 139,
  genres: ['Drama', 'Thriller'],
  ratings: {
    imdb: { value: 8.8, votes: 2000000, type: 'user' },
    tmdb: { value: 7.9, votes: 500000, type: 'user' },
  },
  images: [
    {
      coverType: RadarrImageType.POSTER,
      url: 'https://cdn.example.com/poster.jpg',
    },
    {
      coverType: RadarrImageType.FANART,
      url: 'https://cdn.example.com/fanart.jpg',
    },
  ],
  inCinemas: '1999-10-15T00:00:00Z',
  physicalRelease: '2000-03-01T00:00:00Z',
  digitalRelease: '2000-01-01T00:00:00Z',
  status: RadarrMovieStatus.RELEASED,
  certification: 'R',
  studio: 'Fox 2000 Pictures',
  website: 'https://www.fightclub.com',
  youTubeTrailerId: 'abc123',
  popularity: 85.5,
  hasFile: false,
  isAvailable: true,
  minimumAvailability: RadarrMinimumAvailability.RELEASED,
  cleanTitle: 'fightclub',
  titleSlug: 'fight-club',
  ...overrides,
})

const createMockLibraryMovie = (
  overrides: Partial<RadarrMovie> = {},
): RadarrMovie => ({
  id: 42,
  tmdbId: 550,
  imdbId: 'tt0137523',
  title: 'Fight Club',
  originalTitle: 'Fight Club',
  year: 1999,
  overview: 'An insomniac office worker forms an underground fight club.',
  runtime: 139,
  genres: ['Drama', 'Thriller'],
  ratings: { imdb: { value: 8.8, votes: 2000000, type: 'user' } },
  images: [
    {
      coverType: RadarrImageType.POSTER,
      url: 'https://cdn.example.com/poster.jpg',
      remoteUrl: 'https://img.radarr.video/poster.jpg',
    },
    {
      coverType: RadarrImageType.FANART,
      url: 'https://cdn.example.com/fanart.jpg',
      remoteUrl: 'https://img.radarr.video/fanart.jpg',
    },
  ],
  status: RadarrMovieStatus.RELEASED,
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
  tags: [],
  inCinemas: '1999-10-15T00:00:00Z',
  certification: 'R',
  studio: 'Fox 2000 Pictures',
  ...overrides,
})

const createMockQueueItem = (overrides: Record<string, unknown> = {}) => ({
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
  protocol: DownloadProtocol.TORRENT,
  downloadClient: 'qBittorrent',
  indexer: 'TestIndexer',
  outputPath: '/downloads/Fight Club',
  estimatedCompletionTime: '2023-01-01T01:00:00Z',
  added: '2023-01-01T00:00:00Z',
  movie: createMockLibraryMovie(),
  ...overrides,
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RadarrService (characterization)', () => {
  let service: RadarrService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarrService,
        { provide: RADARR_CLIENT, useValue: {} },
        {
          provide: RetryService,
          useValue: {
            executeWithCircuitBreaker: jest
              .fn()
              .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
          },
        },
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

    // Restore pass-through after clearAllMocks in tests
    jest.clearAllMocks()
    const retryService = module.get(RetryService)
    ;(retryService.executeWithCircuitBreaker as jest.Mock).mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    )
  })

  describe('searchMovies — output shape', () => {
    it('should return correctly transformed MovieSearchResult with all fields', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [createMockMovieResource()],
      })

      const [result] = await service.searchMovies('Fight Club')

      expect(result).toMatchObject({
        tmdbId: 550,
        imdbId: 'tt0137523',
        title: 'Fight Club',
        originalTitle: 'Fight Club',
        year: 1999,
        overview: expect.stringContaining('insomniac'),
        runtime: 139,
        genres: ['Drama', 'Thriller'],
        certification: 'R',
        studio: 'Fox 2000 Pictures',
        status: RadarrMovieStatus.RELEASED,
        youTubeTrailerId: 'abc123',
        popularity: 85.5,
      })
    })

    it('should prefer IMDB rating over TMDB when both are present', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [createMockMovieResource()],
      })

      const [result] = await service.searchMovies('Fight Club')

      expect(result.rating).toBe(8.8)
    })

    it('should fall back to TMDB rating when IMDB rating is absent', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          createMockMovieResource({
            ratings: { tmdb: { value: 7.9, votes: 500000, type: 'user' } },
          }),
        ],
      })

      const [result] = await service.searchMovies('test')

      expect(result.rating).toBe(7.9)
    })

    it('should return undefined rating when no ratings are present', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [createMockMovieResource({ ratings: undefined })],
      })

      const [result] = await service.searchMovies('test')

      expect(result.rating).toBeUndefined()
    })

    it('should extract poster URL from images array by coverType=poster', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [createMockMovieResource()],
      })

      const [result] = await service.searchMovies('test')

      expect(result.posterPath).toBe('https://cdn.example.com/poster.jpg')
    })

    it('should return undefined poster/backdrop when images array is empty', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [createMockMovieResource({ images: [] })],
      })

      const [result] = await service.searchMovies('test')

      expect(result.posterPath).toBeUndefined()
      expect(result.backdropPath).toBeUndefined()
    })

    it('should correctly transform multiple results in order', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          createMockMovieResource({ tmdbId: 1, title: 'Movie A' }),
          createMockMovieResource({ tmdbId: 2, title: 'Movie B' }),
          createMockMovieResource({ tmdbId: 3, title: 'Movie C' }),
        ],
      })

      const results = await service.searchMovies('Movie')

      expect(results).toHaveLength(3)
      expect(results.map(r => r.tmdbId)).toEqual([1, 2, 3])
      expect(results.map(r => r.title)).toEqual([
        'Movie A',
        'Movie B',
        'Movie C',
      ])
    })
  })

  describe('getLibraryMovies — output shape', () => {
    it('should return correctly transformed MovieLibrarySearchResult with all fields', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [createMockLibraryMovie()] })

      const [result] = await service.getLibraryMovies()

      expect(result).toMatchObject({
        tmdbId: 550,
        title: 'Fight Club',
        year: 1999,
        id: 42,
        monitored: true,
        path: '/movies/Fight Club (1999)',
        hasFile: true,
        sizeOnDisk: 8589934592,
        qualityProfileId: 1,
        added: '2023-01-01T00:00:00Z',
        isAvailable: true,
        minimumAvailability: RadarrMinimumAvailability.RELEASED,
      })
    })

    it('should use remoteUrl for poster (not url) in library results', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [createMockLibraryMovie()] })

      const [result] = await service.getLibraryMovies()

      expect(result.posterPath).toBe('https://img.radarr.video/poster.jpg')
      expect(result.backdropPath).toBe('https://img.radarr.video/fanart.jpg')
    })

    it('should extract rating from imdb in library results', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [createMockLibraryMovie()] })

      const [result] = await service.getLibraryMovies()

      expect(result.rating).toBe(8.8)
    })

    it('should return all movies when no query is provided', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          createMockLibraryMovie({ id: 1, tmdbId: 550 }),
          createMockLibraryMovie({ id: 2, tmdbId: 603 }),
        ],
      })

      const results = await service.getLibraryMovies()

      expect(results).toHaveLength(2)
    })

    it('should filter movies by title when query is provided (case insensitive)', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          createMockLibraryMovie({
            id: 1,
            title: 'Fight Club',
            originalTitle: 'Fight Club',
            tmdbId: 550,
          }),
          createMockLibraryMovie({
            id: 2,
            title: 'The Matrix',
            originalTitle: 'The Matrix',
            tmdbId: 603,
            overview: 'A hacker discovers the truth.',
            studio: 'Warner Bros.',
          }),
        ],
      })

      const results = await service.getLibraryMovies('fight')

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Fight Club')
    })

    it('should return empty array when no movies match the query', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [createMockLibraryMovie({ title: 'Fight Club' })],
      })

      const results = await service.getLibraryMovies('nomatch')

      expect(results).toHaveLength(0)
    })
  })

  describe('getDownloadingMovies — output shape', () => {
    it('should correctly calculate progress at 50%', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            createMockQueueItem({ size: 2000000000, sizeleft: 1000000000 }),
          ],
        },
      })

      const [result] = await service.getDownloadingMovies()

      expect(result.downloadedBytes).toBe(1000000000)
      expect(result.progressPercent).toBe(50)
    })

    it('should set progressPercent to 0 when size is 0', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [createMockQueueItem({ size: 0, sizeleft: 0 })] },
      })

      const [result] = await service.getDownloadingMovies()

      expect(result.progressPercent).toBe(0)
      expect(result.downloadedBytes).toBe(0)
    })

    it('should include only DOWNLOADING, QUEUED, and PAUSED items', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            createMockQueueItem({
              id: 1,
              status: RadarrQueueStatus.DOWNLOADING,
            }),
            createMockQueueItem({ id: 2, status: RadarrQueueStatus.QUEUED }),
            createMockQueueItem({ id: 3, status: RadarrQueueStatus.PAUSED }),
            createMockQueueItem({ id: 4, status: RadarrQueueStatus.COMPLETED }),
            createMockQueueItem({ id: 5, status: RadarrQueueStatus.FAILED }),
          ],
        },
      })

      const results = await service.getDownloadingMovies()

      expect(results).toHaveLength(3)
      expect(results.map(r => r.id)).toEqual([1, 2, 3])
    })

    it('should use movie.title from embedded movie object when available', async () => {
      const movie = createMockLibraryMovie({ title: 'Embedded Movie Title' })
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [createMockQueueItem({ title: 'Queue Item Title', movie })],
        },
      })

      const [result] = await service.getDownloadingMovies()

      expect(result.movieTitle).toBe('Embedded Movie Title')
    })

    it('should fall back to queue item title when movie is not embedded', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            createMockQueueItem({ title: 'Fallback Title', movie: undefined }),
          ],
        },
      })

      const [result] = await service.getDownloadingMovies()

      expect(result.movieTitle).toBe('Fallback Title')
    })

    it('should include all expected DownloadingMovie fields', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [createMockQueueItem()] },
      })

      const [result] = await service.getDownloadingMovies()

      expect(result).toMatchObject({
        id: 1,
        movieId: 42,
        movieTitle: 'Fight Club',
        size: 2000000000,
        sizeleft: 1000000000,
        status: RadarrQueueStatus.DOWNLOADING,
        trackedDownloadStatus: TrackedDownloadStatus.OK,
        protocol: DownloadProtocol.TORRENT,
        downloadClient: 'qBittorrent',
        indexer: 'TestIndexer',
        outputPath: '/downloads/Fight Club',
        progressPercent: 50,
        downloadedBytes: 1000000000,
      })
    })
  })

  describe('monitorAndDownloadMovie — output shape', () => {
    const commandResponse = { id: 99, name: 'MoviesSearch' }

    it('should return success result with movieAdded=true for a new movie', async () => {
      const movieResource = createMockMovieResource()
      const addedMovie = createMockLibraryMovie({ id: 42 })

      mockGetApiV3Movie.mockResolvedValue({ data: [] }) // not in library
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({ data: movieResource })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })
      mockPostApiV3Movie.mockResolvedValue({ data: addedMovie })
      mockPostApiV3Command.mockResolvedValue({ data: commandResponse })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result).toMatchObject({
        success: true,
        movieAdded: true,
        searchTriggered: true,
        commandId: 99,
      })
      expect(result.movie).toMatchObject({
        id: 42,
        tmdbId: 550,
        title: 'Fight Club',
      })
      expect(result.error).toBeUndefined()
    })

    it('should return success with searchTriggered=true for existing monitored movie', async () => {
      const existingMovie = createMockLibraryMovie({ id: 42, monitored: true })

      mockGetApiV3Movie.mockResolvedValue({ data: [existingMovie] })
      mockPostApiV3Command.mockResolvedValue({
        data: { ...commandResponse, id: 77 },
      })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result).toMatchObject({
        success: true,
        movieAdded: false,
        searchTriggered: true,
        commandId: 77,
      })
      expect(result.warnings).toContain('Movie already monitored in library')
    })

    it('should return success with movieAdded=true and warning for existing unmonitored movie', async () => {
      const existingMovie = createMockLibraryMovie({ id: 42, monitored: false })
      const movieResource = createMockMovieResource()
      const addedMovie = createMockLibraryMovie({ id: 42, monitored: true })

      mockGetApiV3Movie.mockResolvedValue({ data: [existingMovie] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({ data: movieResource })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })
      mockPostApiV3Movie.mockResolvedValue({ data: addedMovie })
      mockPostApiV3Command.mockResolvedValue({ data: commandResponse })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(true)
      expect(result.movieAdded).toBe(true)
      expect(result.warnings).toContain('Movie exists but is not monitored')
    })

    it('should return failure when movie lookup fails', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockRejectedValue(
        new Error('TMDB lookup failed'),
      )
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(false)
      expect(result.movieAdded).toBe(false)
      expect(result.searchTriggered).toBe(false)
      expect(result.error).toContain('Failed to lookup movie')
      expect(result.error).toContain('TMDB lookup failed')
    })

    it('should return failure when configuration has no quality profiles', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: createMockMovieResource(),
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({ data: [] })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Configuration error')
      expect(result.error).toContain('No quality profiles')
    })

    it('should return failure when configuration has no accessible root folders', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: createMockMovieResource(),
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: false }],
      })

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Configuration error')
      expect(result.error).toContain('No accessible root folders')
    })

    it('should return failure when adding movie to Radarr fails', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: createMockMovieResource(),
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })
      mockPostApiV3Movie.mockRejectedValue(new Error('Movie add failed'))

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(false)
      expect(result.movieAdded).toBe(false)
      expect(result.error).toContain('Failed to add movie')
      expect(result.error).toContain('Movie add failed')
    })

    it('should succeed with warning when search trigger fails after add', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: createMockMovieResource(),
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })
      mockPostApiV3Movie.mockResolvedValue({
        data: createMockLibraryMovie({ id: 42, monitored: true }),
      })
      mockPostApiV3Command.mockRejectedValue(new Error('Search failed'))

      const result = await service.monitorAndDownloadMovie(550)

      expect(result.success).toBe(true)
      expect(result.movieAdded).toBe(true)
      expect(result.searchTriggered).toBe(false)
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('search failed')]),
      )
    })

    it('should use provided qualityProfileId and rootFolderPath from options', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: createMockMovieResource(),
      })
      mockPostApiV3Movie.mockResolvedValue({
        data: createMockLibraryMovie({ id: 42, monitored: true }),
      })
      mockPostApiV3Command.mockResolvedValue({ data: commandResponse })

      await service.monitorAndDownloadMovie(550, {
        qualityProfileId: 5,
        rootFolderPath: '/custom/movies',
      })

      expect(getApiV3Qualityprofile).not.toHaveBeenCalled()
      expect(getApiV3Rootfolder).not.toHaveBeenCalled()
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            qualityProfileId: 5,
            rootFolderPath: '/custom/movies',
          }),
        }),
      )
    })
  })

  describe('unmonitorAndDeleteMovie — output shape', () => {
    it('should return success result with movieDeleted=true and filesDeleted=true', async () => {
      const libraryMovie = createMockLibraryMovie({
        id: 42,
        tmdbId: 550,
        monitored: true,
        hasFile: true,
      })

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550, {
        deleteFiles: true,
      })

      expect(result).toMatchObject({
        success: true,
        movieDeleted: true,
        filesDeleted: true,
      })
      expect(result.movie).toMatchObject({ id: 42, title: 'Fight Club' })
      expect(result.error).toBeUndefined()
    })

    it('should return filesDeleted=false when deleteFiles option is not set', async () => {
      const libraryMovie = createMockLibraryMovie({
        id: 42,
        tmdbId: 550,
        hasFile: true,
      })

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.filesDeleted).toBe(false)
    })

    it('should return failure when movie is not found in library', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })

      const result = await service.unmonitorAndDeleteMovie(999)

      expect(result).toMatchObject({
        success: false,
        movieDeleted: false,
        filesDeleted: false,
      })
      expect(result.error).toContain('999')
      expect(result.error).toContain('not found')
    })

    it('should return failure when Radarr getMovie call fails', async () => {
      const libraryMovie = createMockLibraryMovie({ id: 42, tmdbId: 550 })

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({
        data: undefined,
        error: { message: 'Not found' },
        response: { status: 404 },
      })

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.success).toBe(false)
      expect(result.movieDeleted).toBe(false)
      expect(result.error).toContain('Movie not found in Radarr')
    })

    it('should include downloadsFound and downloadsCancelled when downloads were present', async () => {
      const libraryMovie = createMockLibraryMovie({ id: 42, tmdbId: 550 })
      const queueItem = { id: 10, title: 'Fight Club download' }

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [queueItem] })
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.downloadsFound).toBe(1)
      expect(result.downloadsCancelled).toBe(1)
    })

    it('should include warning when movie was not monitored before deletion', async () => {
      const libraryMovie = createMockLibraryMovie({
        id: 42,
        tmdbId: 550,
        monitored: false,
      })

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.success).toBe(true)
      expect(result.warnings).toContain(
        'Movie was not monitored before deletion',
      )
    })

    it('should include warning when deleteFiles=true but movie has no files', async () => {
      const libraryMovie = createMockLibraryMovie({
        id: 42,
        tmdbId: 550,
        hasFile: false,
        monitored: true,
      })

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550, {
        deleteFiles: true,
      })

      expect(result.success).toBe(true)
      expect(result.filesDeleted).toBe(false)
      expect(result.warnings).toContain('Movie had no files to delete')
    })

    it('should return failure when deleteMovie API call throws', async () => {
      const libraryMovie = createMockLibraryMovie({ id: 42, tmdbId: 550 })

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockResolvedValue({ data: [] })
      mockDeleteApiV3MovieById.mockRejectedValue(
        new Error('Delete failed: permission denied'),
      )

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.success).toBe(false)
      expect(result.movieDeleted).toBe(false)
      expect(result.error).toContain('Failed to delete movie')
      expect(result.error).toContain('Delete failed: permission denied')
    })

    it('should include warning but still succeed when download cancellation fails', async () => {
      const libraryMovie = createMockLibraryMovie({ id: 42, tmdbId: 550 })

      mockGetApiV3Movie.mockResolvedValue({ data: [libraryMovie] })
      mockGetApiV3MovieById.mockResolvedValue({ data: libraryMovie })
      mockGetApiV3QueueDetails.mockRejectedValue(new Error('Queue unavailable'))
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      const result = await service.unmonitorAndDeleteMovie(550)

      expect(result.success).toBe(true)
      expect(result.movieDeleted).toBe(true)
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Failed to cancel downloads'),
        ]),
      )
    })
  })
})
