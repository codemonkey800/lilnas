import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/radarr', () => ({
  deleteApiV3MovieById: jest.fn(),
  deleteApiV3MoviefileById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  getApiV3HistoryMovie: jest.fn(),
  getApiV3Manualimport: jest.fn(),
  getApiV3Movie: jest.fn(),
  getApiV3MovieById: jest.fn(),
  getApiV3Moviefile: jest.fn(),
  getApiV3MovieLookup: jest.fn(),
  getApiV3MovieLookupTmdb: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3Queue: jest.fn(),
  getApiV3Release: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  postApiV3Command: jest.fn(),
  postApiV3Movie: jest.fn(),
  postApiV3Release: jest.fn(),
  putApiV3MovieById: jest.fn(),
}))

import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
  getApiV3HistoryMovie,
  getApiV3Manualimport,
  getApiV3Movie,
  getApiV3MovieById,
  getApiV3Moviefile,
  getApiV3MovieLookup,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Release,
  getApiV3Rootfolder,
  postApiV3Command,
  postApiV3Movie,
  postApiV3Release,
  putApiV3MovieById,
} from '@lilnas/media/radarr'

import { RADARR_CLIENT } from 'src/media/clients'
import type { RadarrManualImportFile } from 'src/media/radarr.service'
import { RadarrService } from 'src/media/radarr.service'

const mockGetApiV3MovieLookup = getApiV3MovieLookup as jest.Mock
const mockGetApiV3MovieLookupTmdb = getApiV3MovieLookupTmdb as jest.Mock
const mockGetApiV3Qualityprofile = getApiV3Qualityprofile as jest.Mock
const mockGetApiV3Rootfolder = getApiV3Rootfolder as jest.Mock
const mockPostApiV3Movie = postApiV3Movie as jest.Mock
const mockPostApiV3Command = postApiV3Command as jest.Mock
const mockGetApiV3Movie = getApiV3Movie as jest.Mock
const mockGetApiV3MovieById = getApiV3MovieById as jest.Mock
const mockDeleteApiV3MovieById = deleteApiV3MovieById as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock
const mockDeleteApiV3QueueById = deleteApiV3QueueById as jest.Mock
const mockGetApiV3Release = getApiV3Release as jest.Mock
const mockPostApiV3Release = postApiV3Release as jest.Mock
const mockGetApiV3Moviefile = getApiV3Moviefile as jest.Mock
const mockDeleteApiV3MoviefileById = deleteApiV3MoviefileById as jest.Mock
const mockPutApiV3MovieById = putApiV3MovieById as jest.Mock
const mockGetApiV3HistoryMovie = getApiV3HistoryMovie as jest.Mock
const mockGetApiV3Manualimport = getApiV3Manualimport as jest.Mock

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
    it('maps every kept field from a fully-populated lookup result', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          {
            certification: 'PG-13',
            digitalRelease: '2020-02-01',
            genres: ['Action', 'Comedy'],
            images: [
              { coverType: 'fanart', remoteUrl: 'fanart.jpg' },
              { coverType: 'poster', remoteUrl: 'poster.jpg' },
            ],
            inCinemas: '2020-01-15',
            overview: 'A movie',
            physicalRelease: '2020-03-01',
            ratings: { imdb: { value: 7.5 }, tmdb: { value: 8.1 } },
            releaseDate: '2020-01-01',
            runtime: 120,
            title: 'Some Movie',
            tmdbId: 123,
            year: 2020,
          },
        ],
      })

      const result = await service.search('some movie')

      expect(getApiV3MovieLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'some movie' } }),
      )
      // The search endpoint used to discard genres/ratings/runtime/
      // certification even though the same response carried them - that
      // loss is what the single `toMovie()` mapper removes.
      expect(result).toEqual([
        {
          addedAt: undefined,
          certification: 'PG-13',
          filePath: undefined,
          genres: ['Action', 'Comedy'],
          id: 'tmdb:123',
          monitored: undefined,
          overview: 'A movie',
          posterUrl: 'poster.jpg',
          radarrId: undefined,
          ratingValue: 8.1,
          releaseDate: '2020-01-01',
          // Radarr reports minutes; Media.runtime is seconds.
          runtime: 7200,
          title: 'Some Movie',
          tmdbId: 123,
          type: 'movie',
          year: 2020,
        },
      ])
    })

    it('maps every optional field to a defined default when absent', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({ data: [{ tmdbId: 9 }] })

      const result = await service.search('x')

      expect(result).toEqual([
        {
          addedAt: undefined,
          certification: undefined,
          filePath: undefined,
          genres: [],
          id: 'tmdb:9',
          monitored: undefined,
          overview: undefined,
          posterUrl: undefined,
          radarrId: undefined,
          ratingValue: undefined,
          releaseDate: undefined,
          runtime: undefined,
          title: 'Unknown title',
          tmdbId: 9,
          type: 'movie',
          year: undefined,
        },
      ])
    })

    // `tmdbId` is the one field with no defensible default. `?? 0` used to
    // mint `tmdb:0`, which fails `MovieSchema`'s own
    // `z.number().int().positive()` - so the backend served a record the
    // frontend's `safeParse()` silently discarded. Dropping it here is the
    // same outcome for that record and a loud one in the logs.
    it('drops a record with no tmdbId rather than minting tmdb:0', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [{}, { tmdbId: 0 }, { tmdbId: 11, title: 'Real' }],
      })

      const result = await service.search('x')

      expect(result).toHaveLength(1)
      expect(result[0]?.tmdbId).toBe(11)
    })

    // Radarr returns `id: 0` for a lookup hit that isn't in the library.
    // Zero is falsy but not nullish, so a `??` guard would have let it
    // through as a real radarrId - and `MovieSchema` requires a *positive*
    // integer, so it would have failed validation at the boundary.
    it('leaves radarrId undefined for a lookup hit with id 0', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [{ id: 0, tmdbId: 5 }],
      })

      const [result] = await service.search('x')

      expect(result?.radarrId).toBeUndefined()
    })

    it('carries radarrId and filePath through for a library item with a file', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          {
            hasFile: true,
            id: 7,
            movieFile: { path: '/movies/a.mkv', relativePath: 'a.mkv' },
            tmdbId: 5,
          },
        ],
      })

      const [result] = await service.search('x')

      expect(result?.radarrId).toBe(7)
      // The absolute path, not the folder-relative one - Phase 6's Emby
      // match needs to compare against a real filesystem path.
      expect(result?.filePath).toBe('/movies/a.mkv')
    })

    it('omits filePath when the library item has no file yet', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          {
            hasFile: false,
            id: 7,
            movieFile: { path: '/movies/a.mkv' },
            tmdbId: 5,
          },
        ],
      })

      const [result] = await service.search('x')

      expect(result?.filePath).toBeUndefined()
    })

    it('prefers releaseDate over inCinemas, digitalRelease, and physicalRelease', () => {
      return expectReleaseDate(
        {
          digitalRelease: '2019-01-01',
          inCinemas: '2018-01-01',
          physicalRelease: '2017-01-01',
          releaseDate: '2020-06-15',
        },
        '2020-06-15',
      )
    })

    it('falls back to inCinemas when releaseDate is absent', () => {
      return expectReleaseDate(
        {
          digitalRelease: '2019-01-01',
          inCinemas: '2018-06-15',
          physicalRelease: '2017-01-01',
        },
        '2018-06-15',
      )
    })

    it('falls back to digitalRelease when releaseDate/inCinemas are absent', () => {
      return expectReleaseDate(
        { digitalRelease: '2019-06-15', physicalRelease: '2017-01-01' },
        '2019-06-15',
      )
    })

    it('falls back to physicalRelease when all other date fields are absent', () => {
      return expectReleaseDate({ physicalRelease: '2017-06-15' }, '2017-06-15')
    })

    it('leaves releaseDate undefined when no date field is present at all', () => {
      return expectReleaseDate({}, undefined)
    })

    async function expectReleaseDate(
      dateFields: Record<string, string>,
      expectedReleaseDate: string | undefined,
    ) {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [{ ...dateFields, tmdbId: 5 }],
      })

      const [result] = await service.search('x')

      expect(result?.releaseDate).toBe(expectedReleaseDate)
    }

    it('picks the poster image, not fanart', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          {
            images: [
              { coverType: 'fanart', remoteUrl: 'fanart.jpg' },
              { coverType: 'poster', remoteUrl: 'poster.jpg' },
            ],
            tmdbId: 5,
          },
        ],
      })

      const [result] = await service.search('x')

      expect(result?.posterUrl).toBe('poster.jpg')
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.search('x')).rejects.toThrow('searchMovies failed')
    })
  })

  // Plan 021: the upstream facts state derivation reads - `monitored` tells
  // `wanted` from `absent`, and `addedAt` is when the *file* landed.
  describe('getLibraryMovie', () => {
    it('asks Radarr for just that tmdbId and maps the entry', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          {
            hasFile: true,
            id: 3,
            monitored: true,
            movieFile: {
              dateAdded: '2024-03-13T06:08:15Z',
              id: 1,
              path: '/m.mkv',
            },
            tmdbId: 50546,
          },
        ],
      })

      const result = await service.getLibraryMovie(50546)

      expect(mockGetApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({ query: { tmdbId: 50546 } }),
      )
      expect(result).toMatchObject({ filePath: '/m.mkv', radarrId: 3 })
    })

    it('answers undefined when the library does not hold the title', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })

      await expect(service.getLibraryMovie(50546)).resolves.toBeUndefined()
    })
  })

  describe('getLibrary', () => {
    it('carries monitored and the file dateAdded for a library movie with a file', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          {
            added: '2024-03-13T06:00:51Z',
            hasFile: true,
            id: 3,
            monitored: true,
            movieFile: {
              dateAdded: '2024-03-13T06:08:15Z',
              id: 1,
              path: '/movies/Just Go with It (2011)/Just Go with It.mkv',
            },
            tmdbId: 50546,
          },
        ],
      })

      const [result] = await service.getLibrary()

      expect(result).toMatchObject({
        // The file's dateAdded, not the movie's `added` (library entry).
        addedAt: '2024-03-13T06:08:15.000Z',
        filePath: '/movies/Just Go with It (2011)/Just Go with It.mkv',
        monitored: true,
        radarrId: 3,
      })
    })

    it('leaves addedAt undefined for a wanted movie with no movieFile at all', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          {
            added: '2025-04-05T08:30:54Z',
            id: 171,
            monitored: true,
            tmdbId: 1158406,
          },
        ],
      })

      const [result] = await service.getLibrary()

      // Never "now", and never the library `added` standing in for it.
      expect(result?.addedAt).toBeUndefined()
      expect(result?.filePath).toBeUndefined()
      expect(result?.monitored).toBe(true)
    })

    it('leaves addedAt undefined when hasFile is false, matching filePath', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          {
            hasFile: false,
            id: 7,
            monitored: true,
            movieFile: { dateAdded: '2024-03-13T06:08:15Z', path: '/m/a.mkv' },
            tmdbId: 5,
          },
        ],
      })

      const [result] = await service.getLibrary()

      expect(result?.addedAt).toBeUndefined()
      expect(result?.filePath).toBeUndefined()
    })

    it('reports an unmonitored library movie as monitored: false, not undefined', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, monitored: false, tmdbId: 5 }],
      })

      const [result] = await service.getLibrary()

      expect(result?.monitored).toBe(false)
    })

    // A lookup hit outside the library carries Radarr's add-form default
    // for `monitored`, which says nothing about the title.
    it('leaves monitored undefined for a lookup hit outside the library', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [{ id: 0, monitored: false, tmdbId: 5 }],
      })

      const [result] = await service.search('x')

      expect(result?.monitored).toBeUndefined()
    })
  })

  describe('requestMovie', () => {
    it('triggers a search directly when the movie is already in the library', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          {
            id: 7,
            images: [],
            monitored: true,
            title: 'Existing Movie',
            tmdbId: 123,
          },
        ],
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      const result = await service.requestMovie(123)

      expect(postApiV3Movie).not.toHaveBeenCalled()
      // An already-monitored title is left strictly alone - no PUT at all.
      expect(putApiV3MovieById).not.toHaveBeenCalled()
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

  describe('ensureMovie', () => {
    it('touches nothing when the movie is already in the library and monitored', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, monitored: true, tmdbId: 123 }],
      })

      const result = await service.ensureMovie(123)

      expect(result).toMatchObject({ radarrId: 7, wasMonitored: true })
      expect(postApiV3Movie).not.toHaveBeenCalled()
      expect(putApiV3MovieById).not.toHaveBeenCalled()
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('flips monitoring on for a library movie that is unmonitored', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, monitored: false, tmdbId: 123 }],
      })
      mockGetApiV3MovieById.mockResolvedValue({
        data: { id: 7, monitored: false, qualityProfileId: 4, tmdbId: 123 },
      })
      mockPutApiV3MovieById.mockResolvedValue({ data: {} })

      const result = await service.ensureMovie(123)

      // `false` - the state *before* this call, which is what a caller
      // restoring borrowed monitoring needs.
      expect(result).toMatchObject({ radarrId: 7, wasMonitored: false })
      expect(putApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
          path: { id: '7' },
        }),
      )
      expect(postApiV3Movie).not.toHaveBeenCalled()
    })

    it('adds an absent movie monitored, without searching for it', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: { title: 'New Movie', tmdbId: 123, year: 2024 },
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 1, name: 'HD-1080p' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ accessible: true, id: 1, path: '/movies' }],
      })
      mockPostApiV3Movie.mockResolvedValue({
        data: { id: 42, monitored: true, tmdbId: 123, title: 'New Movie' },
      })

      const result = await service.ensureMovie(123)

      expect(result).toMatchObject({ radarrId: 42, wasMonitored: false })
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            addOptions: { searchForMovie: false },
            monitored: true,
          }),
        }),
      )
      // The add is the whole job - ensureMovie never searches. requestMovie
      // is what layers the command on top.
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('throws when Radarr returns a library movie with no id', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [{ tmdbId: 123 }] })

      await expect(service.ensureMovie(123)).rejects.toThrow(
        'Radarr did not return an id for movie tmdbId=123',
      )
    })

    it('throws when Radarr returns no id for the movie it just added', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: { title: 'New Movie', tmdbId: 123 },
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({ data: [{ id: 1 }] })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ accessible: true, path: '/movies' }],
      })
      mockPostApiV3Movie.mockResolvedValue({ data: { tmdbId: 123 } })

      await expect(service.ensureMovie(123)).rejects.toThrow(
        'Radarr did not return an id for movie tmdbId=123',
      )
    })
  })

  describe('setMonitored', () => {
    it('re-sends the whole resource with only `monitored` changed', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: {
          id: 7,
          monitored: true,
          qualityProfileId: 4,
          rootFolderPath: '/movies',
          tags: [1, 2],
        },
      })
      mockPutApiV3MovieById.mockResolvedValue({ data: {} })

      await service.setMonitored(7, false)

      // A PUT carrying only `{ monitored }` would blank out the profile,
      // root folder and tags - Radarr replaces the whole resource.
      expect(putApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            id: 7,
            monitored: false,
            qualityProfileId: 4,
            rootFolderPath: '/movies',
            tags: [1, 2],
          },
          path: { id: '7' },
        }),
      )
    })

    it('throws a descriptive error when the read-back fails', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        error: { message: 'not found' },
      })

      await expect(service.setMonitored(7, true)).rejects.toThrow(
        'getMovie failed',
      )
      expect(putApiV3MovieById).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when the write fails', async () => {
      mockGetApiV3MovieById.mockResolvedValue({ data: { id: 7 } })
      mockPutApiV3MovieById.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.setMonitored(7, true)).rejects.toThrow(
        'setMovieMonitored failed',
      )
    })
  })

  describe('unmonitorIfMissing', () => {
    it('unmonitors a movie with no file, re-sending the whole resource', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: {
          hasFile: false,
          id: 7,
          monitored: true,
          qualityProfileId: 4,
          rootFolderPath: '/movies',
          tags: [1, 2],
        },
      })
      mockPutApiV3MovieById.mockResolvedValue({ data: {} })

      await expect(service.unmonitorIfMissing(7)).resolves.toBe(true)

      expect(getApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 7 } }),
      )
      expect(putApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            hasFile: false,
            id: 7,
            monitored: false,
            qualityProfileId: 4,
            rootFolderPath: '/movies',
            tags: [1, 2],
          },
          path: { id: '7' },
        }),
      )
    })

    // A cancelled replacement must leave the copy already on disk monitored.
    it('leaves a movie that has a file monitored', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: { hasFile: true, id: 7, monitored: true },
      })

      await expect(service.unmonitorIfMissing(7)).resolves.toBe(false)
      expect(putApiV3MovieById).not.toHaveBeenCalled()
    })

    it('writes nothing for a movie that is already unmonitored', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: { hasFile: false, id: 7, monitored: false },
      })

      await expect(service.unmonitorIfMissing(7)).resolves.toBe(false)
      expect(putApiV3MovieById).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when the write fails', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: { hasFile: false, id: 7, monitored: true },
      })
      mockPutApiV3MovieById.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.unmonitorIfMissing(7)).rejects.toThrow(
        'setMovieMonitored failed',
      )
    })
  })

  describe('getReleases', () => {
    it('maps every kept field from a fully-populated release', async () => {
      mockGetApiV3Release.mockResolvedValue({
        data: [
          {
            age: 12,
            customFormatScore: 50,
            downloadAllowed: true,
            guid: 'indexer://abc',
            indexer: 'Some Indexer',
            indexerId: 3,
            languages: [{ id: 1, name: 'English' }, { id: 2 }],
            leechers: 2,
            protocol: 'torrent',
            publishDate: '2026-01-01T00:00:00Z',
            quality: {
              quality: { name: 'WEBDL-1080p', resolution: 1080 },
              revision: { version: 1 },
            },
            rejected: false,
            rejections: [],
            releaseGroup: 'GROUP',
            seeders: 40,
            size: 8_000_000_000,
            title: 'Some.Movie.2020.1080p',
          },
        ],
      })

      const result = await service.getReleases(7)

      expect(getApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({ query: { movieId: 7 } }),
      )
      expect(result).toEqual([
        {
          age: 12,
          customFormatScore: 50,
          downloadAllowed: true,
          // Never true out of the mapper - annotation is ReleaseService's job.
          flaggedBad: false,
          guid: 'indexer://abc',
          indexer: 'Some Indexer',
          indexerId: 3,
          // The unnamed language entry is dropped, not mapped to undefined.
          languages: ['English'],
          leechers: 2,
          protocol: 'torrent',
          publishDate: '2026-01-01T00:00:00Z',
          // Flattened out of the nested QualityModel.
          quality: { name: 'WEBDL-1080p', resolution: 1080 },
          rejected: false,
          rejections: [],
          releaseGroup: 'GROUP',
          seeders: 40,
          size: 8_000_000_000,
          title: 'Some.Movie.2020.1080p',
        },
      ])
    })

    it('maps a bare release to defined defaults rather than undefined booleans', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [{}] })

      const [result] = await service.getReleases(7)

      expect(result).toMatchObject({
        downloadAllowed: false,
        flaggedBad: false,
        guid: '',
        indexerId: 0,
        rejected: false,
        title: 'Unknown release',
      })
      // `undefined`, not `[]` - "no language data" is distinguishable from
      // "explicitly no languages".
      expect(result?.languages).toBeUndefined()
      expect(result?.quality).toBeUndefined()
    })

    it('carries a rejected release through with its reasons intact', async () => {
      mockGetApiV3Release.mockResolvedValue({
        data: [
          {
            guid: 'g',
            indexerId: 1,
            rejected: true,
            rejections: ['Not a preferred word upgrade'],
          },
        ],
      })

      const [result] = await service.getReleases(7)

      expect(result?.rejected).toBe(true)
      expect(result?.rejections).toEqual(['Not a preferred word upgrade'])
    })

    it('returns an empty list when the indexer search found nothing', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [] })

      await expect(service.getReleases(7)).resolves.toEqual([])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3Release.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getReleases(7)).rejects.toThrow('getReleases failed')
    })
  })

  describe('grabRelease', () => {
    it('posts just the release identity, not a whole ReleaseResource', async () => {
      mockPostApiV3Release.mockResolvedValue({ data: {} })

      await service.grabRelease('indexer://abc', 3)

      expect(postApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { guid: 'indexer://abc', indexerId: 3 },
        }),
      )
    })

    it('throws a descriptive error when the grab is refused', async () => {
      mockPostApiV3Release.mockResolvedValue({
        error: { message: 'Indexer unavailable' },
      })

      await expect(service.grabRelease('g', 1)).rejects.toThrow(
        'grabRelease failed',
      )
    })
  })

  describe('getMovieFiles / deleteMovieFile', () => {
    it('lists the files for one movie', async () => {
      mockGetApiV3Moviefile.mockResolvedValue({
        data: [{ id: 11, movieId: 7, path: '/movies/a.mkv' }],
      })

      const result = await service.getMovieFiles(7)

      expect(getApiV3Moviefile).toHaveBeenCalledWith(
        expect.objectContaining({ query: { movieId: [7] } }),
      )
      expect(result).toEqual([{ id: 11, movieId: 7, path: '/movies/a.mkv' }])
    })

    it('returns an empty list for a movie with no files yet', async () => {
      mockGetApiV3Moviefile.mockResolvedValue({ data: [] })

      await expect(service.getMovieFiles(7)).resolves.toEqual([])
    })

    // The replace path deletes files one at a time and leaves the movie in
    // the library - unmonitorAndDelete would take the whole title with it.
    it('deletes one file by id without touching the movie', async () => {
      mockDeleteApiV3MoviefileById.mockResolvedValue({ data: undefined })

      await service.deleteMovieFile(11)

      expect(deleteApiV3MoviefileById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 11 } }),
      )
      expect(deleteApiV3MovieById).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when the file delete fails', async () => {
      mockDeleteApiV3MoviefileById.mockResolvedValue({
        error: { message: 'not found' },
      })

      await expect(service.deleteMovieFile(11)).rejects.toThrow(
        'deleteMovieFile failed',
      )
    })
  })

  describe('getMovieHistory', () => {
    it('returns the records unfiltered and unmapped', async () => {
      const records = [
        {
          data: {
            downloadClient: 'qbit',
            guid: 'indexer://abc',
            indexerId: '3',
          },
          downloadId: 'ABC123',
          eventType: 'grabbed',
          id: 1,
          movieId: 7,
        },
        {
          data: { fileId: '11' },
          downloadId: 'ABC123',
          eventType: 'downloadFolderImported',
          id: 2,
          movieId: 7,
        },
        { eventType: 'movieFileDeleted', id: 3, movieId: 7 },
      ]
      mockGetApiV3HistoryMovie.mockResolvedValue({ data: records })

      const result = await service.getMovieHistory(7)

      // `movieId` and nothing else: no `eventType`, because the SDK's string
      // union is not positional with the numeric wire values the query param
      // takes (`downloadFolderImported` is 3, not 2), so a filter here would
      // silently fetch the wrong event type. The caller filters on the
      // string instead, which is why the deleted record survives this call.
      expect(getApiV3HistoryMovie).toHaveBeenCalledWith(
        expect.objectContaining({ query: { movieId: 7 } }),
      )
      expect(
        mockGetApiV3HistoryMovie.mock.calls[0][0].query,
      ).not.toHaveProperty('eventType')
      expect(result).toEqual(records)
    })

    it('returns an empty list for a movie with no history', async () => {
      mockGetApiV3HistoryMovie.mockResolvedValue({ data: [] })

      await expect(service.getMovieHistory(7)).resolves.toEqual([])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3HistoryMovie.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getMovieHistory(7)).rejects.toThrow(
        'getMovieHistory failed',
      )
    })

    // The endpoint is unpaged, so an absent body is a real failure rather
    // than "no records" - unwrapSdkResult is what makes that loud.
    it('throws when the SDK returns no data at all', async () => {
      mockGetApiV3HistoryMovie.mockResolvedValue({})

      await expect(service.getMovieHistory(7)).rejects.toThrow(
        'getMovieHistory returned no data',
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

  describe('getManualImportCandidates', () => {
    // Trimmed from the real stuck candidate on the production Radarr:
    // movie 434, Game Night (2018), whose folder name did not match the
    // grabbed release so the automatic import was refused.
    const candidate = {
      downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
      folderName: 'Game.Night.2018.1080p.BluRay.x265',
      id: 26454175,
      indexerFlags: 0,
      languages: [{ id: 1, name: 'English' }],
      path: '/downloads/Game.Night.2018.1080p.BluRay.x265/Game.Night.2018.1080p.BluRay.x265.mp4',
      quality: {
        quality: {
          id: 7,
          modifier: 'none',
          name: 'Bluray-1080p',
          resolution: 1080,
          source: 'bluray',
        },
        revision: { isRepack: false, real: 0, version: 1 },
      },
      rejections: [
        {
          reason:
            'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
          type: 'permanent',
        },
      ],
      relativePath: 'Game.Night.2018.1080p.BluRay.x265.mp4',
      releaseGroup: null,
      size: 1674940307,
    }

    it('queries by both ids and filters files already in the library', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [candidate] })

      await service.getManualImportCandidates(
        'ce427a39-be9f-4271-b193-f7067dd82c4a',
        434,
      )

      expect(getApiV3Manualimport).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
            filterExistingFiles: true,
            movieId: 434,
          },
        }),
      )
    })

    it('returns the raw candidates, rejections and all, unmapped', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [candidate] })

      const result = await service.getManualImportCandidates('abc', 434)

      expect(result).toEqual([candidate])
    })

    it('returns an empty array when Radarr has nothing left to import', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [] })

      await expect(
        service.getManualImportCandidates('abc', 434),
      ).resolves.toEqual([])
    })

    it('throws when the lookup fails upstream', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({
        error: { message: 'radarr exploded' },
        response: { status: 500 },
      })

      await expect(
        service.getManualImportCandidates('abc', 434),
      ).rejects.toThrow('getManualImportCandidates failed')
    })
  })

  describe('commitManualImport', () => {
    const file: RadarrManualImportFile = {
      downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
      folderName: 'Game.Night.2018.1080p.BluRay.x265',
      indexerFlags: 0,
      languages: [{ id: 1, name: 'English' }],
      movieId: 434,
      path: '/downloads/Game.Night.2018.1080p.BluRay.x265/Game.Night.2018.1080p.BluRay.x265.mp4',
      quality: {
        quality: {
          id: 7,
          modifier: 'none',
          name: 'Bluray-1080p',
          resolution: 1080,
          source: 'bluray',
        },
        revision: { isRepack: false, real: 0, version: 1 },
      },
      releaseGroup: null,
    }

    it('posts the ManualImport command with importMode auto and the files untouched', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: {} })

      await service.commitManualImport([file])

      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            name: 'ManualImport',
            importMode: 'auto',
            files: [file],
          },
        }),
      )
    })

    it('goes through the command endpoint, not the reprocess endpoint', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: {} })

      await service.commitManualImport([file])

      expect(postApiV3Command).toHaveBeenCalledTimes(1)
      expect(getApiV3Manualimport).not.toHaveBeenCalled()
    })

    it('throws without calling Radarr when handed no files', async () => {
      await expect(service.commitManualImport([])).rejects.toThrow(
        'commitManualImport requires at least one file',
      )
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('surfaces an upstream command failure with its context', async () => {
      mockPostApiV3Command.mockResolvedValue({
        error: { message: 'command rejected' },
        response: { status: 400 },
      })

      await expect(service.commitManualImport([file])).rejects.toThrow(
        'commitManualImport failed',
      )
    })
  })

  describe('removeQueueItem', () => {
    it('deletes the queue row without blocklisting or re-searching', async () => {
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })

      await service.removeQueueItem(99)

      expect(deleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 99 },
          query: {
            blocklist: false,
            removeFromClient: true,
            skipRedownload: true,
          },
        }),
      )
    })

    it('throws when Radarr refuses the removal', async () => {
      mockDeleteApiV3QueueById.mockResolvedValue({
        error: { message: 'no such queue item' },
        response: { status: 404 },
      })

      await expect(service.removeQueueItem(99)).rejects.toThrow(
        'removeQueueItem failed',
      )
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
