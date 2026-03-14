jest.mock('@lilnas/media/radarr-next', () => ({
  deleteApiV3MovieById: jest.fn(),
  deleteApiV3MoviefileById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  getApiV3MovieById: jest.fn(),
  getApiV3MovieLookupTmdb: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  postApiV3Movie: jest.fn(),
  postApiV3Release: jest.fn(),
  putApiV3MovieById: jest.fn(),
}))

jest.mock('src/media/movies.server', () => ({
  getMovie: jest.fn(),
}))

jest.mock('src/media/movies', () => ({
  searchMovieReleases: jest.fn(),
}))

import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
  getApiV3MovieById,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Rootfolder,
  postApiV3Movie,
  postApiV3Release,
  putApiV3MovieById,
} from '@lilnas/media/radarr-next'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { searchMovieReleases } from 'src/media/movies'
import { getMovie } from 'src/media/movies.server'
import { MoviesService } from 'src/media/movies.service'

describe('MoviesService', () => {
  let service: MoviesService

  beforeEach(() => {
    service = new MoviesService()
    ;(getMovie as jest.Mock).mockResolvedValue({
      id: 10,
      tmdbId: 456,
      title: 'Test Movie',
    })
    ;(searchMovieReleases as jest.Mock).mockResolvedValue([
      { guid: 'abc', title: 'Release' },
    ])
    ;(deleteApiV3QueueById as jest.Mock).mockResolvedValue({})
    ;(deleteApiV3MoviefileById as jest.Mock).mockResolvedValue({})
    ;(deleteApiV3MovieById as jest.Mock).mockResolvedValue({})
    ;(getApiV3MovieById as jest.Mock).mockResolvedValue({
      data: { id: 10, monitored: true },
    })
    ;(putApiV3MovieById as jest.Mock).mockResolvedValue({})
    ;(postApiV3Release as jest.Mock).mockResolvedValue({})
    ;(getApiV3MovieLookupTmdb as jest.Mock).mockResolvedValue({
      data: { id: 10, tmdbId: 456, title: 'Test Movie' },
    })
    ;(getApiV3Rootfolder as jest.Mock).mockResolvedValue({
      data: [{ path: '/movies' }],
    })
    ;(getApiV3Qualityprofile as jest.Mock).mockResolvedValue({
      data: [{ id: 1 }],
    })
    ;(postApiV3Movie as jest.Mock).mockResolvedValue({ data: { id: 10 } })
  })

  // ---------------------------------------------------------------------------
  // getMovie
  // ---------------------------------------------------------------------------

  describe('getMovie', () => {
    it('returns the movie detail from the server', async () => {
      const movie = { id: 10, tmdbId: 456, title: 'Test Movie' }
      ;(getMovie as jest.Mock).mockResolvedValue(movie)
      const result = await service.getMovie(456)
      expect(result).toEqual(movie)
    })

    it('throws NotFoundException when getMovie throws', async () => {
      ;(getMovie as jest.Mock).mockRejectedValue(new Error('Not found'))
      await expect(service.getMovie(999)).rejects.toThrow(NotFoundException)
    })
  })

  // ---------------------------------------------------------------------------
  // cancelDownload
  // ---------------------------------------------------------------------------

  describe('cancelDownload', () => {
    it('calls deleteApiV3QueueById with removeFromClient=true', async () => {
      await service.cancelDownload(77)
      expect(deleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 77 },
          query: { removeFromClient: true, blocklist: false },
        }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(deleteApiV3QueueById as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      )
      await expect(service.cancelDownload(77)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // deleteMovieFile
  // ---------------------------------------------------------------------------

  describe('deleteMovieFile', () => {
    it('calls deleteApiV3MoviefileById with the file id', async () => {
      await service.deleteMovieFile(5)
      expect(deleteApiV3MoviefileById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 5 } }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(deleteApiV3MoviefileById as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      )
      await expect(service.deleteMovieFile(5)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // searchReleases
  // ---------------------------------------------------------------------------

  describe('searchReleases', () => {
    it('returns the list of available releases', async () => {
      const releases = [
        { guid: 'abc', title: 'Movie.2023.BluRay.mkv' },
        { guid: 'def', title: 'Movie.2023.WEB-DL.mkv' },
      ]
      ;(searchMovieReleases as jest.Mock).mockResolvedValue(releases)
      const result = await service.searchReleases(10)
      expect(result).toEqual(releases)
    })

    it('throws NotFoundException on error', async () => {
      ;(searchMovieReleases as jest.Mock).mockRejectedValue(
        new Error('Radarr error'),
      )
      await expect(service.searchReleases(10)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // grabRelease
  // ---------------------------------------------------------------------------

  describe('grabRelease', () => {
    it('posts release with guid and indexerId', async () => {
      await service.grabRelease('abc-guid', 7)
      expect(postApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ guid: 'abc-guid', indexerId: 7 }),
        }),
      )
    })

    it('throws BadRequestException on API error', async () => {
      ;(postApiV3Release as jest.Mock).mockRejectedValue(
        new Error('Grab failed'),
      )
      await expect(service.grabRelease('abc', 1)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // setMonitored
  // ---------------------------------------------------------------------------

  describe('setMonitored', () => {
    it('fetches movie then updates monitored flag', async () => {
      await service.setMonitored(10, false)
      expect(getApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 10 } }),
      )
      expect(putApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: false }),
        }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(getApiV3MovieById as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      )
      await expect(service.setMonitored(999, true)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // addToLibrary
  // ---------------------------------------------------------------------------

  describe('addToLibrary', () => {
    it('looks up movie, root folder, and quality profile in parallel', async () => {
      await service.addToLibrary(456)
      expect(getApiV3MovieLookupTmdb).toHaveBeenCalledWith(
        expect.objectContaining({ query: { tmdbId: 456 } }),
      )
      expect(getApiV3Rootfolder).toHaveBeenCalled()
      expect(getApiV3Qualityprofile).toHaveBeenCalled()
    })

    it('posts movie with root folder path and quality profile', async () => {
      await service.addToLibrary(456)
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            rootFolderPath: '/movies',
            qualityProfileId: 1,
            monitored: false,
          }),
        }),
      )
    })

    it('returns the created movie ID', async () => {
      ;(postApiV3Movie as jest.Mock).mockResolvedValue({ data: { id: 42 } })
      const result = await service.addToLibrary(456)
      expect(result.movieId).toBe(42)
    })

    it('uses defaults when root folder and quality profile are empty', async () => {
      ;(getApiV3Rootfolder as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3Qualityprofile as jest.Mock).mockResolvedValue({ data: [] })
      await service.addToLibrary(456)
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            rootFolderPath: '/movies',
            qualityProfileId: 1,
          }),
        }),
      )
    })

    it('throws BadRequestException on API error', async () => {
      ;(postApiV3Movie as jest.Mock).mockRejectedValue(
        new Error('Already exists'),
      )
      await expect(service.addToLibrary(456)).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // removeFromLibrary
  // ---------------------------------------------------------------------------

  describe('removeFromLibrary', () => {
    it('deletes movie by id with deleteFiles=true', async () => {
      await service.removeFromLibrary(10)
      expect(deleteApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 10 },
          query: { deleteFiles: true, addImportExclusion: false },
        }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(deleteApiV3MovieById as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      )
      await expect(service.removeFromLibrary(10)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // addToLibrary – edge case
  // ---------------------------------------------------------------------------

  describe('addToLibrary edge cases', () => {
    it('throws BadRequestException when movie lookup API rejects', async () => {
      ;(getApiV3MovieLookupTmdb as jest.Mock).mockRejectedValue(
        new Error('TMDB lookup failed'),
      )
      await expect(service.addToLibrary(999)).rejects.toThrow(
        BadRequestException,
      )
    })
  })
})
