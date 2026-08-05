import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/radarr', () => ({
  deleteApiV3MovieById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  getApiV3Movie: jest.fn(),
  getApiV3MovieLookup: jest.fn(),
  getApiV3MovieLookupTmdb: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3Queue: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  postApiV3Command: jest.fn(),
  postApiV3Movie: jest.fn(),
}))

import {
  deleteApiV3MovieById,
  deleteApiV3QueueById,
  getApiV3Movie,
  getApiV3MovieLookup,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Rootfolder,
  postApiV3Command,
  postApiV3Movie,
} from '@lilnas/media/radarr'

import { RADARR_CLIENT } from 'src/media/clients'
import { RadarrService } from 'src/media/radarr.service'

const mockGetApiV3MovieLookup = getApiV3MovieLookup as jest.Mock
const mockGetApiV3MovieLookupTmdb = getApiV3MovieLookupTmdb as jest.Mock
const mockGetApiV3Qualityprofile = getApiV3Qualityprofile as jest.Mock
const mockGetApiV3Rootfolder = getApiV3Rootfolder as jest.Mock
const mockPostApiV3Movie = postApiV3Movie as jest.Mock
const mockPostApiV3Command = postApiV3Command as jest.Mock
const mockGetApiV3Movie = getApiV3Movie as jest.Mock
const mockDeleteApiV3MovieById = deleteApiV3MovieById as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock
const mockDeleteApiV3QueueById = deleteApiV3QueueById as jest.Mock

describe('RadarrService', () => {
  let service: RadarrService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RadarrService, { provide: RADARR_CLIENT, useValue: {} }],
    }).compile()

    service = module.get<RadarrService>(RadarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  describe('search', () => {
    it('maps lookup results to MovieSearchResult', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          {
            tmdbId: 123,
            title: 'Some Movie',
            year: 2020,
            overview: 'A movie',
            images: [{ coverType: 'poster', url: 'poster.jpg' }],
          },
        ],
      })

      const result = await service.search('some movie')

      expect(getApiV3MovieLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'some movie' } }),
      )
      expect(result).toEqual([
        {
          overview: 'A movie',
          posterUrl: 'poster.jpg',
          title: 'Some Movie',
          tmdbId: 123,
          year: 2020,
        },
      ])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.search('x')).rejects.toThrow('searchMovies failed')
    })
  })

  describe('requestMovie', () => {
    it('triggers a search directly when the movie is already in the library', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, tmdbId: 123, title: 'Existing Movie', images: [] }],
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      const result = await service.requestMovie(123)

      expect(postApiV3Movie).not.toHaveBeenCalled()
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'MoviesSearch', movieIds: [7] },
        }),
      )
      expect(result).toEqual({
        posterUrl: undefined,
        radarrId: 7,
        title: 'Existing Movie',
      })
    })

    it('looks up, adds, and triggers a search for a new movie', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: { tmdbId: 123, title: 'New Movie', year: 2024 },
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })
      mockPostApiV3Movie.mockResolvedValue({
        data: {
          id: 42,
          tmdbId: 123,
          title: 'New Movie',
          images: [{ coverType: 'poster', remoteUrl: 'remote-poster.jpg' }],
        },
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      const result = await service.requestMovie(123)

      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tmdbId: 123,
            title: 'New Movie',
            titleSlug: 'new-movie',
            qualityProfileId: 1,
            rootFolderPath: '/movies',
            monitored: true,
            minimumAvailability: 'released',
          }),
        }),
      )
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'MoviesSearch', movieIds: [42] },
        }),
      )
      expect(result).toEqual({
        posterUrl: 'remote-poster.jpg',
        radarrId: 42,
        title: 'New Movie',
      })
    })

    it('throws when no quality profiles are available', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: { tmdbId: 123, title: 'New Movie' },
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({ data: [] })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: true }],
      })

      await expect(service.requestMovie(123)).rejects.toThrow(
        'No quality profiles available in Radarr',
      )
      expect(postApiV3Movie).not.toHaveBeenCalled()
    })

    it('throws when no accessible root folders are available', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: { tmdbId: 123, title: 'New Movie' },
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/movies', accessible: false }],
      })

      await expect(service.requestMovie(123)).rejects.toThrow(
        'No accessible root folders available in Radarr',
      )
    })
  })

  describe('getQueue', () => {
    it('returns queue records, filtered by movieIds when provided', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [{ id: 1, movieId: 7, status: 'downloading' }] },
      })

      const result = await service.getQueue([7])

      expect(getApiV3Queue).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ movieIds: [7] }),
        }),
      )
      expect(result).toEqual([{ id: 1, movieId: 7, status: 'downloading' }])
    })

    it('omits the movieIds filter when none are provided', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })

      await service.getQueue()

      const call = mockGetApiV3Queue.mock.calls[0][0]
      expect(call.query).not.toHaveProperty('movieIds')
    })

    it('returns an empty array when the queue has no records', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: {} })

      const result = await service.getQueue()

      expect(result).toEqual([])
    })
  })

  describe('unmonitorAndDelete', () => {
    it('cancels in-progress queue items then deletes the movie', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [{ id: 1 }, { id: 2 }] },
      })
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      await service.unmonitorAndDelete(7, true)

      expect(deleteApiV3QueueById).toHaveBeenCalledTimes(2)
      expect(deleteApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 7 },
          query: { deleteFiles: true },
        }),
      )
    })

    it('still deletes the movie when a queue-item cancellation fails', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [{ id: 1 }] } })
      mockDeleteApiV3QueueById.mockRejectedValue(new Error('cancel failed'))
      mockDeleteApiV3MovieById.mockResolvedValue({ data: undefined })

      await expect(service.unmonitorAndDelete(7)).resolves.toBeUndefined()
      expect(deleteApiV3MovieById).toHaveBeenCalled()
    })

    it('throws when the delete call itself fails', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockDeleteApiV3MovieById.mockResolvedValue({
        error: { message: 'not found' },
        response: { status: 404 },
      })

      await expect(service.unmonitorAndDelete(7)).rejects.toThrow(
        'deleteMovie failed',
      )
    })
  })
})
