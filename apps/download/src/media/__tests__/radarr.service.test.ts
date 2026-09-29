import { QualityTier } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/radarr', () => ({
  deleteApiV3MovieById: jest.fn(),
  deleteApiV3MoviefileById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  getApiV3Command: jest.fn(),
  getApiV3CommandById: jest.fn(),
  getApiV3ConfigDownloadclient: jest.fn(),
  getApiV3Credit: jest.fn(),
  getApiV3Health: jest.fn(),
  getApiV3History: jest.fn(),
  getApiV3HistoryMovie: jest.fn(),
  getApiV3HistorySince: jest.fn(),
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
  putApiV3MovieEditor: jest.fn(),
}))

import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
  getApiV3Command,
  getApiV3CommandById,
  getApiV3ConfigDownloadclient,
  getApiV3Credit,
  getApiV3Health,
  getApiV3History,
  getApiV3HistoryMovie,
  getApiV3HistorySince,
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
  putApiV3MovieEditor,
} from '@lilnas/media/radarr'

import { RADARR_CLIENT } from 'src/media/clients'
import { defaultQualityTier } from 'src/media/quality-tier-default'
import type { RadarrManualImportFile } from 'src/media/radarr.service'
import { RadarrService } from 'src/media/radarr.service'

const mockGetApiV3MovieLookup = getApiV3MovieLookup as jest.Mock
const mockGetApiV3MovieLookupTmdb = getApiV3MovieLookupTmdb as jest.Mock
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
const mockPutApiV3MovieEditor = putApiV3MovieEditor as jest.Mock
const mockGetApiV3HistoryMovie = getApiV3HistoryMovie as jest.Mock
const mockGetApiV3Manualimport = getApiV3Manualimport as jest.Mock
const mockGetApiV3Credit = getApiV3Credit as jest.Mock
const mockGetApiV3Command = getApiV3Command as jest.Mock
const mockGetApiV3CommandById = getApiV3CommandById as jest.Mock
const mockGetApiV3ConfigDownloadclient =
  getApiV3ConfigDownloadclient as jest.Mock
const mockGetApiV3Health = getApiV3Health as jest.Mock
const mockGetApiV3History = getApiV3History as jest.Mock
const mockGetApiV3HistorySince = getApiV3HistorySince as jest.Mock

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
          digitalRelease: '2020-02-01',
          filePath: undefined,
          genres: ['Action', 'Comedy'],
          id: 'tmdb:123',
          inCinemas: '2020-01-15',
          monitored: undefined,
          overview: 'A movie',
          physicalRelease: '2020-03-01',
          posterUrl: 'poster.jpg',
          // Not in the library - no tier of its own.
          qualityTier: null,
          radarrId: undefined,
          ratingValue: 8.1,
          ratings: { imdb: { value: 7.5 }, tmdb: { value: 8.1 } },
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
          // Not in the library - no tier of its own.
          qualityTier: null,
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

    it('maps the file on disk, gated on hasFile like filePath', async () => {
      const movieFile = {
        mediaInfo: { audioCodec: 'EAC3', videoCodec: 'HEVC' },
        path: '/movies/a.mkv',
        quality: { quality: { name: 'WEBDL-2160p' } },
        size: 12_000_000_000,
      }
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          { hasFile: true, id: 7, movieFile, tmdbId: 5 },
          { hasFile: false, id: 8, movieFile, tmdbId: 6 },
        ],
      })

      const [withFile, withoutFile] = await service.search('x')

      expect(withFile?.file).toEqual({
        audio: { codec: 'EAC3' },
        quality: 'WEBDL-2160p',
        size: 12_000_000_000,
        video: { codec: 'HEVC', dynamicRange: 'SDR' },
      })
      expect(withoutFile?.file).toBeUndefined()
    })

    it('maps the movie-level metadata Radarr carries beside the file', async () => {
      mockGetApiV3MovieLookup.mockResolvedValue({
        data: [
          {
            collection: { title: 'Some Collection', tmdbId: 0 },
            imdbId: 'tt1855199',
            originalLanguage: { id: 1, name: 'English' },
            originalTitle: 'End of Watch',
            studio: '5150 Action',
            title: 'End of Watch',
            tmdbId: 77016,
            youTubeTrailerId: 'TYGXe5ggBx0',
          },
          {
            imdbId: '',
            originalLanguage: { id: 0, name: 'Unknown' },
            originalTitle: 'Le Samouraï',
            studio: '',
            title: 'The Samurai',
            tmdbId: 5511,
            youTubeTrailerId: '',
          },
        ],
      })

      const [english, french] = await service.search('x')

      expect(english).toMatchObject({
        // `tmdbId: 0` is Radarr's "none", like `id: 0`.
        collection: { title: 'Some Collection', tmdbId: undefined },
        imdbId: 'tt1855199',
        originalLanguage: 'English',
        // The same as the title, so not worth saying twice.
        originalTitle: undefined,
        studio: '5150 Action',
        trailerYouTubeId: 'TYGXe5ggBx0',
      })
      expect(french).toMatchObject({
        collection: undefined,
        imdbId: undefined,
        originalLanguage: undefined,
        originalTitle: 'Le Samouraï',
        studio: undefined,
        trailerYouTubeId: undefined,
      })
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
  describe('getCredits', () => {
    it("asks Radarr for the movie's credits by Radarr id and splits them", async () => {
      mockGetApiV3Credit.mockResolvedValue({
        data: [
          { character: 'Brian', order: 0, personName: 'Jake', type: 'cast' },
          {
            department: 'Directing',
            job: 'Director',
            personName: 'David',
            type: 'crew',
          },
        ],
      })

      const credits = await service.getCredits(42)

      expect(getApiV3Credit).toHaveBeenCalledWith(
        expect.objectContaining({ query: { movieId: 42 } }),
      )
      expect(credits).toEqual({
        cast: [{ character: 'Brian', name: 'Jake' }],
        directors: ['David'],
        writers: [],
      })
    })

    // The generated SDK types this response as `unknown`.
    it('rejects a body that is not a list', async () => {
      mockGetApiV3Credit.mockResolvedValue({ data: { message: 'nope' } })

      await expect(service.getCredits(42)).rejects.toThrow(
        'getCredits returned a non-array body',
      )
    })

    it('surfaces an upstream error', async () => {
      mockGetApiV3Credit.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.getCredits(42)).rejects.toThrow()
    })
  })

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

  describe('qualityTier on library movies', () => {
    beforeEach(() => {
      jest.spyOn(service, 'ensureTierProfiles').mockResolvedValue()
      jest
        .spyOn(service, 'tierForProfileId')
        .mockImplementation(id => (id === 11 ? QualityTier.Hd : null))
    })

    it("reports the tier of one of the app's profiles, and null for any other", async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          { id: 3, qualityProfileId: 11, tmdbId: 5 },
          { id: 4, qualityProfileId: 1, tmdbId: 6 },
        ],
      })

      const [ours, foreign] = await service.getLibrary()

      expect(ours?.qualityTier).toBe(QualityTier.Hd)
      expect(foreign?.qualityTier).toBeNull()
    })

    it('reports the tier on the one-title read the detail page refreshes from', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 3, qualityProfileId: 11, tmdbId: 5 }],
      })

      const movie = await service.getLibraryMovie(5)

      expect(movie?.qualityTier).toBe(QualityTier.Hd)
    })

    it('reports null for a movie outside the library', async () => {
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: { id: 0, qualityProfileId: 11, tmdbId: 5 },
      })

      const movie = await service.lookupByTmdbId(5)

      expect(movie.qualityTier).toBeNull()
    })

    // The cache is filled at boot; a library read only tops it up, once.
    it('warms a cold tier cache once, and never again from a read', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })

      await service.getLibrary()
      await service.getLibraryMovie(5)
      await service.getLibrary()

      expect(service.ensureTierProfiles).toHaveBeenCalledTimes(1)
    })

    it('still serves the library when the warm fails, with no tiers', async () => {
      jest
        .spyOn(service, 'ensureTierProfiles')
        .mockRejectedValue(new Error('unreachable'))
      jest.spyOn(service, 'tierForProfileId').mockReturnValue(null)
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 3, qualityProfileId: 11, tmdbId: 5 }],
      })

      const [movie] = await service.getLibrary()
      await service.getLibrary()

      expect(movie?.qualityTier).toBeNull()
      expect(service.ensureTierProfiles).toHaveBeenCalledTimes(1)
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

    it("carries Radarr's isAvailable, and leaves it undefined when omitted", async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [
          { id: 7, isAvailable: false, monitored: true, tmdbId: 5 },
          { id: 8, isAvailable: true, monitored: true, tmdbId: 6 },
          { id: 9, monitored: true, tmdbId: 7 },
        ],
      })

      const [notYet, out, unknown] = await service.getLibrary()

      expect(notYet?.isAvailable).toBe(false)
      expect(out?.isAvailable).toBe(true)
      expect(unknown?.isAvailable).toBeUndefined()
    })
  })

  describe('ensureMovie', () => {
    /** The default tier's profile id, as `tierProfileId()` serves it. */
    const DEFAULT_TIER_PROFILE_ID = 11

    /**
     * The lookup + root-folder reads an add needs, and the tier profile
     * cache already warm - the profile sync itself is covered in
     * `arr-tier-profiles.test.ts`.
     */
    function stubAddPrerequisites() {
      mockGetApiV3MovieLookupTmdb.mockResolvedValue({
        data: { title: 'New Movie', tmdbId: 123, year: 2024 },
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ accessible: true, id: 1, path: '/movies' }],
      })
      return jest
        .spyOn(service, 'tierProfileId')
        .mockResolvedValue(DEFAULT_TIER_PROFILE_ID)
    }

    /** Radarr's 400 for an add that lost the race to another add. */
    function alreadyAdded() {
      return {
        error: [
          {
            errorCode: 'MovieExistsValidator',
            errorMessage: 'This movie has already been added',
            propertyName: 'TmdbId',
          },
        ],
        response: new Response(null, { status: 400 }),
      }
    }

    it('reads the library filtered to the one tmdbId', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, monitored: true, tmdbId: 123 }],
      })

      await service.ensureMovie(123, { monitored: true })

      expect(getApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({ query: { tmdbId: 123 } }),
      )
    })

    it('touches nothing when the movie is already in the library and monitored', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, monitored: true, tmdbId: 123 }],
      })

      const result = await service.ensureMovie(123, { monitored: true })

      expect(result).toMatchObject({
        radarrId: 7,
        wasAdded: false,
        wasMonitored: true,
      })
      expect(postApiV3Movie).not.toHaveBeenCalled()
      expect(putApiV3MovieEditor).not.toHaveBeenCalled()
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('flips monitoring on for an unmonitored library movie when asked to monitor', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, monitored: false, tmdbId: 123 }],
      })
      mockPutApiV3MovieEditor.mockResolvedValue({ data: {} })

      const result = await service.ensureMovie(123, { monitored: true })

      // `false` - the state *before* this call.
      expect(result).toMatchObject({ radarrId: 7, wasMonitored: false })
      expect(putApiV3MovieEditor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { monitored: true, movieIds: [7] },
        }),
      )
      expect(postApiV3Movie).not.toHaveBeenCalled()
    })

    // Browsing: a library title is never written, monitored or not.
    it.each([true, false])(
      'writes nothing to a library movie (monitored=%s) when not asked to monitor',
      async monitored => {
        mockGetApiV3Movie.mockResolvedValue({
          data: [{ id: 7, monitored, tmdbId: 123 }],
        })

        const result = await service.ensureMovie(123, { monitored: false })

        expect(result).toMatchObject({
          radarrId: 7,
          wasAdded: false,
          wasMonitored: monitored,
        })
        expect(putApiV3MovieEditor).not.toHaveBeenCalled()
        expect(postApiV3Movie).not.toHaveBeenCalled()
        expect(postApiV3Command).not.toHaveBeenCalled()
      },
    )

    it('adds an absent movie monitored for a request, without searching for it', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue({
        data: { id: 42, monitored: true, tmdbId: 123, title: 'New Movie' },
      })

      const result = await service.ensureMovie(123, { monitored: true })

      expect(result).toMatchObject({
        radarrId: 42,
        wasAdded: true,
        wasMonitored: false,
      })
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            addOptions: { searchForMovie: false },
            monitored: true,
            qualityProfileId: DEFAULT_TIER_PROFILE_ID,
            rootFolderPath: '/movies',
          }),
        }),
      )
      // The add is the whole job - ensureMovie never searches; the caller
      // layers the command on top.
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it("adds with the caller's quality profile when given one", async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      const tierProfileId = stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue({
        data: { id: 42, monitored: true, tmdbId: 123, title: 'New Movie' },
      })

      await service.ensureMovie(123, { monitored: true, qualityProfileId: 13 })

      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ qualityProfileId: 13 }),
        }),
      )
      expect(tierProfileId).not.toHaveBeenCalled()
    })

    // A browse add names no profile: it gets the default tier's, never
    // whatever Radarr happens to list first.
    it("adds with the default tier's profile when given none", async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      const tierProfileId = stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue({
        data: { id: 42, monitored: false, tmdbId: 123, title: 'New Movie' },
      })

      await service.ensureMovie(123, { monitored: false })

      expect(tierProfileId).toHaveBeenCalledWith(defaultQualityTier())
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            qualityProfileId: DEFAULT_TIER_PROFILE_ID,
          }),
        }),
      )
      // The default configuration is the root folder alone now.
      expect(getApiV3Qualityprofile).not.toHaveBeenCalled()
    })

    it('fails the add, writing nothing, when the tier profile cannot be had', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      stubAddPrerequisites().mockRejectedValue(
        new Error('Could not set up Radarr\'s "lilnas · HD" quality profile'),
      )

      await expect(
        service.ensureMovie(123, { monitored: false }),
      ).rejects.toThrow('quality profile')
      expect(postApiV3Movie).not.toHaveBeenCalled()
    })

    // Re-profiling a library movie is the request path's call, not ensure's.
    it('leaves a library movie on its own profile', async () => {
      mockGetApiV3Movie.mockResolvedValue({
        data: [{ id: 7, monitored: true, qualityProfileId: 1, tmdbId: 123 }],
      })
      const tierProfileId = jest.spyOn(service, 'tierProfileId')

      await service.ensureMovie(123, { monitored: true, qualityProfileId: 13 })

      expect(putApiV3MovieEditor).not.toHaveBeenCalled()
      expect(tierProfileId).not.toHaveBeenCalled()
    })

    it('adds an absent movie unmonitored for a browse', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue({
        data: { id: 42, monitored: false, tmdbId: 123, title: 'New Movie' },
      })

      const result = await service.ensureMovie(123, { monitored: false })

      expect(result).toMatchObject({ radarrId: 42, wasAdded: true })
      expect(postApiV3Movie).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            addOptions: { searchForMovie: false },
            monitored: false,
          }),
        }),
      )
      expect(putApiV3MovieEditor).not.toHaveBeenCalled()
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    // Two adds raced: the loser re-reads and carries on as "exists".
    it('treats a 400 "already been added" as the movie existing', async () => {
      mockGetApiV3Movie
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [{ id: 9, monitored: false, tmdbId: 123 }],
        })
      stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue(alreadyAdded())

      const result = await service.ensureMovie(123, { monitored: false })

      expect(result).toMatchObject({
        radarrId: 9,
        wasAdded: false,
        wasMonitored: false,
      })
      expect(getApiV3Movie).toHaveBeenCalledTimes(2)
      expect(putApiV3MovieEditor).not.toHaveBeenCalled()
    })

    it('still monitors a raced movie when the caller asked to monitor', async () => {
      mockGetApiV3Movie
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [{ id: 9, monitored: false, tmdbId: 123 }],
        })
      stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue(alreadyAdded())
      mockPutApiV3MovieEditor.mockResolvedValue({ data: {} })

      await service.ensureMovie(123, { monitored: true })

      expect(putApiV3MovieEditor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { monitored: true, movieIds: [9] },
        }),
      )
    })

    it('rethrows an "already added" 400 when the re-read still cannot find the movie', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue(alreadyAdded())

      await expect(
        service.ensureMovie(123, { monitored: false }),
      ).rejects.toThrow('already been added')
    })

    it('rethrows any other add failure without re-reading', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue({
        error: [{ errorMessage: 'Root folder does not exist' }],
        response: new Response(null, { status: 400 }),
      })

      await expect(
        service.ensureMovie(123, { monitored: false }),
      ).rejects.toThrow('Root folder does not exist')
      expect(getApiV3Movie).toHaveBeenCalledTimes(1)
    })

    it('throws when Radarr returns a library movie with no id', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [{ tmdbId: 123 }] })

      await expect(
        service.ensureMovie(123, { monitored: true }),
      ).rejects.toThrow('Radarr did not return an id for movie tmdbId=123')
    })

    it('throws when Radarr returns no id for the movie it just added', async () => {
      mockGetApiV3Movie.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Movie.mockResolvedValue({ data: { tmdbId: 123 } })

      await expect(
        service.ensureMovie(123, { monitored: true }),
      ).rejects.toThrow('Radarr did not return an id for movie tmdbId=123')
    })
  })

  describe('setMonitored', () => {
    it('flips only `monitored`, through the bulk editor', async () => {
      mockPutApiV3MovieEditor.mockResolvedValue({ data: {} })

      await service.setMonitored(7, false)

      // No read-back and no full-resource PUT - the editor changes only the
      // fields it is sent.
      expect(getApiV3MovieById).not.toHaveBeenCalled()
      expect(putApiV3MovieEditor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { monitored: false, movieIds: [7] },
        }),
      )
    })

    it('throws a descriptive error when the write fails', async () => {
      mockPutApiV3MovieEditor.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.setMonitored(7, true)).rejects.toThrow(
        'editMovies failed',
      )
    })
  })

  describe('editMovies', () => {
    it('sends the ids and only the changes that were given', async () => {
      mockPutApiV3MovieEditor.mockResolvedValue({ data: {} })

      await service.editMovies([7, 8], { qualityProfileId: 4 })

      // `monitored` absent, not `undefined`/`null` - an absent key is what
      // tells Radarr to leave the field alone.
      const call = mockPutApiV3MovieEditor.mock.calls[0][0]
      expect(call.body).toEqual({ movieIds: [7, 8], qualityProfileId: 4 })
      expect(call.body).not.toHaveProperty('monitored')
    })

    it('sends both changes together', async () => {
      mockPutApiV3MovieEditor.mockResolvedValue({ data: {} })

      await service.editMovies([7], { monitored: true, qualityProfileId: 4 })

      expect(putApiV3MovieEditor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { monitored: true, movieIds: [7], qualityProfileId: 4 },
        }),
      )
    })

    it('makes no request for an empty id list', async () => {
      await service.editMovies([], { monitored: false })

      expect(putApiV3MovieEditor).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when Radarr rejects the edit', async () => {
      mockPutApiV3MovieEditor.mockResolvedValue({ error: { message: 'boom' } })

      await expect(
        service.editMovies([7], { monitored: false }),
      ).rejects.toThrow('editMovies failed: {"message":"boom"}')
    })
  })

  describe('unmonitorIfMissing', () => {
    it('unmonitors a movie with no file, through the bulk editor', async () => {
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
      mockPutApiV3MovieEditor.mockResolvedValue({ data: {} })

      await expect(service.unmonitorIfMissing(7)).resolves.toBe(true)

      expect(getApiV3MovieById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 7 } }),
      )
      expect(putApiV3MovieEditor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { monitored: false, movieIds: [7] },
        }),
      )
    })

    // A cancelled replacement must leave the copy already on disk monitored.
    it('leaves a movie that has a file monitored', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: { hasFile: true, id: 7, monitored: true },
      })

      await expect(service.unmonitorIfMissing(7)).resolves.toBe(false)
      expect(putApiV3MovieEditor).not.toHaveBeenCalled()
    })

    it('writes nothing for a movie that is already unmonitored', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: { hasFile: false, id: 7, monitored: false },
      })

      await expect(service.unmonitorIfMissing(7)).resolves.toBe(false)
      expect(putApiV3MovieEditor).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when the write fails', async () => {
      mockGetApiV3MovieById.mockResolvedValue({
        data: { hasFile: false, id: 7, monitored: true },
      })
      mockPutApiV3MovieEditor.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.unmonitorIfMissing(7)).rejects.toThrow(
        'editMovies failed',
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

    // A filtered read must not pull in unknown items: unmonitorAndDelete
    // cancels every row it gets back.
    it('does not ask for unknown items on a filtered read', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })

      await service.getQueue([7])

      const call = mockGetApiV3Queue.mock.calls[0][0]
      expect(call.query).not.toHaveProperty('includeUnknownMovieItems')
    })

    it('omits the movieIds filter and includes unknown items when unfiltered', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })

      await service.getQueue()

      const call = mockGetApiV3Queue.mock.calls[0][0]
      expect(call.query).not.toHaveProperty('movieIds')
      expect(call.query).toMatchObject({
        includeMovie: false,
        includeUnknownMovieItems: true,
        page: 1,
        pageSize: 1000,
      })
    })

    it('reads every page until totalRecords is covered', async () => {
      mockGetApiV3Queue
        .mockResolvedValueOnce({
          data: {
            page: 1,
            pageSize: 1000,
            records: [{ id: 1, movieId: 7 }],
            totalRecords: 2500,
          },
        })
        .mockResolvedValueOnce({
          data: {
            page: 2,
            pageSize: 1000,
            records: [{ id: 2, movieId: 8 }],
            totalRecords: 2500,
          },
        })
        .mockResolvedValueOnce({
          data: {
            page: 3,
            pageSize: 1000,
            records: [{ id: 3, movieId: 9 }],
            totalRecords: 2500,
          },
        })

      const result = await service.getQueue()

      expect(result.map(item => item.id)).toEqual([1, 2, 3])
      expect(getApiV3Queue).toHaveBeenCalledTimes(3)
      expect(
        mockGetApiV3Queue.mock.calls.map(([call]) => call.query.page),
      ).toEqual([1, 2, 3])
      for (const [call] of mockGetApiV3Queue.mock.calls) {
        expect(call.query.includeUnknownMovieItems).toBe(true)
      }
    })

    it('keeps pending and unknown rows, errorMessage included', async () => {
      const records = [
        // A pending release: no downloadId until it is actually sent.
        { id: 1, movieId: 7, status: 'delay' },
        // An unknown item: nothing in the library it maps to.
        { downloadId: 'SAB_1', id: 2, status: 'completed' },
        {
          downloadId: 'SAB_2',
          errorMessage: 'Unpacking failed',
          id: 3,
          movieId: 8,
          status: 'failed',
        },
      ]
      mockGetApiV3Queue.mockResolvedValue({
        data: { page: 1, pageSize: 1000, records, totalRecords: 3 },
      })

      await expect(service.getQueue()).resolves.toEqual(records)
    })

    it('stops on an empty page even if totalRecords claims more', async () => {
      mockGetApiV3Queue
        .mockResolvedValueOnce({
          data: {
            page: 1,
            pageSize: 1000,
            records: [{ id: 1 }],
            totalRecords: 5000,
          },
        })
        .mockResolvedValueOnce({
          data: { page: 2, pageSize: 1000, records: [], totalRecords: 5000 },
        })

      await expect(service.getQueue()).resolves.toEqual([{ id: 1 }])
      expect(getApiV3Queue).toHaveBeenCalledTimes(2)
    })

    it('returns an empty array when the queue has no records', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: {} })

      const result = await service.getQueue()

      expect(result).toEqual([])
    })

    it('throws a descriptive error when a page fails', async () => {
      mockGetApiV3Queue
        .mockResolvedValueOnce({
          data: {
            page: 1,
            pageSize: 1000,
            records: [{ id: 1 }],
            totalRecords: 2000,
          },
        })
        .mockResolvedValueOnce({ error: { message: 'boom' } })

      await expect(service.getQueue()).rejects.toThrow('getQueue failed')
    })
  })

  describe('triggerSearch', () => {
    it('posts MoviesSearch and returns a reference to the queued command', async () => {
      mockPostApiV3Command.mockResolvedValue({
        data: {
          id: 91,
          name: 'MoviesSearch',
          queued: '2026-09-28T10:00:00Z',
          status: 'queued',
        },
      })

      await expect(service.triggerSearch(7)).resolves.toEqual({
        id: 91,
        name: 'MoviesSearch',
        queuedAt: '2026-09-28T10:00:00Z',
      })
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { movieIds: [7], name: 'MoviesSearch' },
        }),
      )
    })

    it('throws a descriptive error when Radarr rejects the command', async () => {
      mockPostApiV3Command.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.triggerSearch(7)).rejects.toThrow(
        'triggerMovieSearch failed',
      )
    })

    it('throws when the command comes back without an id', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { name: 'MoviesSearch' } })

      await expect(service.triggerSearch(7)).rejects.toThrow(
        'triggerMovieSearch returned a command without an id',
      )
    })
  })

  describe('refreshMovie', () => {
    beforeEach(() => {
      mockPostApiV3Command.mockResolvedValue({
        data: { id: 12, name: 'RefreshMovie', queued: '2026-09-28T10:00:00Z' },
      })
    })

    it('omits isNewMovie by default', async () => {
      await expect(service.refreshMovie(7)).resolves.toEqual({
        id: 12,
        name: 'RefreshMovie',
        queuedAt: '2026-09-28T10:00:00Z',
      })

      const call = mockPostApiV3Command.mock.calls[0][0]
      expect(call.body).toEqual({ movieIds: [7], name: 'RefreshMovie' })
    })

    // Must match the add-time refresh's body exactly, so Radarr de-dupes to
    // (and hands back the id of) the command it already queued.
    it('sends isNewMovie: true when isNew is set', async () => {
      await service.refreshMovie(7, { isNew: true })

      const call = mockPostApiV3Command.mock.calls[0][0]
      expect(call.body).toEqual({
        isNewMovie: true,
        movieIds: [7],
        name: 'RefreshMovie',
      })
    })

    it('omits isNewMovie when isNew is false', async () => {
      await service.refreshMovie(7, { isNew: false })

      const call = mockPostApiV3Command.mock.calls[0][0]
      expect(call.body).not.toHaveProperty('isNewMovie')
    })
  })

  describe('getCommand', () => {
    it('maps a command, leaving omitted fields undefined', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        data: {
          body: { isNewMovie: true, movieIds: [7] },
          commandName: 'Refresh Movie',
          ended: '2026-09-28T10:00:02Z',
          id: 12,
          name: 'RefreshMovie',
          priority: 'normal',
          queued: '2026-09-28T10:00:00Z',
          result: 'unknown',
          started: '2026-09-28T10:00:01Z',
          status: 'completed',
          trigger: 'manual',
        },
      })

      await expect(service.getCommand(12)).resolves.toEqual({
        body: { isNewMovie: true, movieIds: [7] },
        ended: '2026-09-28T10:00:02Z',
        id: 12,
        message: undefined,
        name: 'RefreshMovie',
        queued: '2026-09-28T10:00:00Z',
        result: 'unknown',
        started: '2026-09-28T10:00:01Z',
        status: 'completed',
        trigger: 'manual',
      })
      expect(getApiV3CommandById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 12 } }),
      )
    })

    it('returns null when Radarr has no such command', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        error: { message: 'NotFound' },
        response: { status: 404 },
      })

      await expect(service.getCommand(999)).resolves.toBeNull()
    })

    it('throws on any other failure', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.getCommand(12)).rejects.toThrow('getCommand failed')
    })

    it('throws on a command missing its status', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        data: { id: 12, name: 'RefreshMovie' },
      })

      await expect(service.getCommand(12)).rejects.toThrow(
        'getCommand returned a malformed command (id=12)',
      )
    })
  })

  describe('listCommands', () => {
    it('maps every command and skips malformed ones', async () => {
      mockGetApiV3Command.mockResolvedValue({
        data: [
          {
            body: { movieIds: [7] },
            id: 1,
            message: 'Completed',
            name: 'MoviesSearch',
            result: 'successful',
            status: 'completed',
          },
          { id: 2, name: 'RefreshMovie', status: 'started' },
          { name: 'Broken' },
        ],
      })

      const result = await service.listCommands()

      expect(result).toEqual([
        expect.objectContaining({
          body: { movieIds: [7] },
          id: 1,
          message: 'Completed',
          result: 'successful',
          status: 'completed',
        }),
        expect.objectContaining({ body: {}, id: 2, status: 'started' }),
      ])
      expect(Logger.prototype.warn).toHaveBeenCalledTimes(1)
    })

    it('throws a descriptive error when the call fails', async () => {
      mockGetApiV3Command.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.listCommands()).rejects.toThrow(
        'listCommands failed',
      )
    })
  })

  describe('getHistorySince', () => {
    it('sends the date as ISO and returns the list as-is', async () => {
      const records = [
        { eventType: 'grabbed', id: 1 },
        { eventType: 'downloadFolderImported', id: 2 },
      ]
      mockGetApiV3HistorySince.mockResolvedValue({ data: records })

      const result = await service.getHistorySince(
        new Date('2026-09-28T10:00:00Z'),
      )

      expect(result).toEqual(records)
      const call = mockGetApiV3HistorySince.mock.calls[0][0]
      // Exactly `date` - no includeMovie, no eventType.
      expect(call.query).toEqual({ date: '2026-09-28T10:00:00.000Z' })
    })

    it('throws a descriptive error when the call fails', async () => {
      mockGetApiV3HistorySince.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getHistorySince(new Date())).rejects.toThrow(
        'getHistorySince failed',
      )
    })
  })

  describe('getHistoryByDownloadId', () => {
    it('reads every page for the download', async () => {
      mockGetApiV3History
        .mockResolvedValueOnce({
          data: {
            page: 1,
            pageSize: 100,
            records: [{ eventType: 'downloadFailed', id: 3 }],
            totalRecords: 150,
          },
        })
        .mockResolvedValueOnce({
          data: {
            page: 2,
            pageSize: 100,
            records: [{ eventType: 'grabbed', id: 1 }],
            totalRecords: 150,
          },
        })

      const result = await service.getHistoryByDownloadId('SAB_1')

      expect(result.map(record => record.id)).toEqual([3, 1])
      expect(
        mockGetApiV3History.mock.calls.map(([call]) => call.query),
      ).toEqual([
        { downloadId: 'SAB_1', page: 1, pageSize: 100 },
        { downloadId: 'SAB_1', page: 2, pageSize: 100 },
      ])
    })

    it('stops after one page when it holds everything', async () => {
      mockGetApiV3History.mockResolvedValue({
        data: { page: 1, pageSize: 100, records: [{ id: 1 }], totalRecords: 1 },
      })

      await expect(service.getHistoryByDownloadId('SAB_1')).resolves.toEqual([
        { id: 1 },
      ])
      expect(getApiV3History).toHaveBeenCalledTimes(1)
    })

    it('throws a descriptive error when the call fails', async () => {
      mockGetApiV3History.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getHistoryByDownloadId('SAB_1')).rejects.toThrow(
        'getHistoryByDownloadId failed',
      )
    })
  })

  describe('isDownloadClientHealthy', () => {
    it('is healthy with no health entries at all', async () => {
      mockGetApiV3Health.mockResolvedValue({ data: [] })

      await expect(service.isDownloadClientHealthy()).resolves.toBe(true)
    })

    it.each([
      ['DownloadClientCheck', 'warning'],
      ['DownloadClientCheck', 'error'],
      ['DownloadClientStatusCheck', 'warning'],
      ['DownloadClientStatusCheck', 'error'],
    ])('is unhealthy on a %s %s', async (source, type) => {
      mockGetApiV3Health.mockResolvedValue({
        data: [{ message: 'Unable to communicate', source, type }],
      })

      await expect(service.isDownloadClientHealthy()).resolves.toBe(false)
    })

    it.each([
      ['DownloadClientCheck', 'ok'],
      ['DownloadClientStatusCheck', 'notice'],
    ])('stays healthy on a %s %s', async (source, type) => {
      mockGetApiV3Health.mockResolvedValue({ data: [{ source, type }] })

      await expect(service.isDownloadClientHealthy()).resolves.toBe(true)
    })

    it('ignores unrelated sources, however bad', async () => {
      mockGetApiV3Health.mockResolvedValue({
        data: [
          { source: 'IndexerStatusCheck', type: 'error' },
          { source: 'RootFolderCheck', type: 'warning' },
          { type: 'error' },
        ],
      })

      await expect(service.isDownloadClientHealthy()).resolves.toBe(true)
    })

    it('throws a descriptive error when the call fails', async () => {
      mockGetApiV3Health.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.isDownloadClientHealthy()).rejects.toThrow(
        'getHealth failed',
      )
    })
  })

  describe('getFailedDownloadConfig', () => {
    it('maps both redownload settings', async () => {
      mockGetApiV3ConfigDownloadclient.mockResolvedValue({
        data: {
          autoRedownloadFailed: true,
          autoRedownloadFailedFromInteractiveSearch: false,
          enableCompletedDownloadHandling: true,
          id: 1,
        },
      })

      await expect(service.getFailedDownloadConfig()).resolves.toEqual({
        autoRedownloadFailed: true,
        fromInteractive: false,
      })
    })

    it("falls back to Radarr's default (true) for a missing key", async () => {
      mockGetApiV3ConfigDownloadclient.mockResolvedValue({
        data: { autoRedownloadFailed: false, id: 1 },
      })

      await expect(service.getFailedDownloadConfig()).resolves.toEqual({
        autoRedownloadFailed: false,
        fromInteractive: true,
      })
    })

    it('throws a descriptive error when the call fails', async () => {
      mockGetApiV3ConfigDownloadclient.mockResolvedValue({
        error: { message: 'boom' },
      })

      await expect(service.getFailedDownloadConfig()).rejects.toThrow(
        'getDownloadClientConfig failed',
      )
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
