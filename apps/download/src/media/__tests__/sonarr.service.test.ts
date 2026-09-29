import { QualityTier } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3EpisodefileById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Command: jest.fn(),
  getApiV3CommandById: jest.fn(),
  getApiV3ConfigDownloadclient: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3EpisodeById: jest.fn(),
  getApiV3Episodefile: jest.fn(),
  getApiV3Health: jest.fn(),
  getApiV3History: jest.fn(),
  getApiV3HistorySeries: jest.fn(),
  getApiV3HistorySince: jest.fn(),
  getApiV3Indexer: jest.fn(),
  getApiV3Manualimport: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3Queue: jest.fn(),
  getApiV3Release: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  getApiV3Series: jest.fn(),
  getApiV3SeriesById: jest.fn(),
  getApiV3SeriesLookup: jest.fn(),
  postApiV3Command: jest.fn(),
  postApiV3Release: jest.fn(),
  postApiV3Series: jest.fn(),
  putApiV3EpisodeMonitor: jest.fn(),
  putApiV3SeriesById: jest.fn(),
  putApiV3SeriesEditor: jest.fn(),
}))

import type { EpisodeResource, SeriesResource } from '@lilnas/media/sonarr'
import {
  deleteApiV3EpisodefileById,
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  getApiV3Command,
  getApiV3CommandById,
  getApiV3ConfigDownloadclient,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3Episodefile,
  getApiV3Health,
  getApiV3History,
  getApiV3HistorySeries,
  getApiV3HistorySince,
  getApiV3Indexer,
  getApiV3Manualimport,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Release,
  getApiV3Rootfolder,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Release,
  postApiV3Series,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
  putApiV3SeriesEditor,
} from '@lilnas/media/sonarr'

import { SONARR_CLIENT } from 'src/media/clients'
import { defaultQualityTier } from 'src/media/quality-tier-default'
import {
  type SonarrManualImportFile,
  SonarrService,
  toEpisode,
  toLookupShow,
  toRelease,
  toShow,
  toSonarrReleaseScope,
} from 'src/media/sonarr.service'

const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.Mock
const mockGetApiV3Rootfolder = getApiV3Rootfolder as jest.Mock
const mockPostApiV3Series = postApiV3Series as jest.Mock
const mockPostApiV3Command = postApiV3Command as jest.Mock
const mockGetApiV3Series = getApiV3Series as jest.Mock
const mockGetApiV3SeriesById = getApiV3SeriesById as jest.Mock
const mockDeleteApiV3SeriesById = deleteApiV3SeriesById as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock
const mockDeleteApiV3QueueById = deleteApiV3QueueById as jest.Mock
const mockGetApiV3Release = getApiV3Release as jest.Mock
const mockPostApiV3Release = postApiV3Release as jest.Mock
const mockGetApiV3Episode = getApiV3Episode as jest.Mock
const mockGetApiV3EpisodeById = getApiV3EpisodeById as jest.Mock
const mockGetApiV3Episodefile = getApiV3Episodefile as jest.Mock
const mockDeleteApiV3EpisodefileById = deleteApiV3EpisodefileById as jest.Mock
const mockGetApiV3HistorySeries = getApiV3HistorySeries as jest.Mock
const mockGetApiV3Indexer = getApiV3Indexer as jest.Mock
const mockPutApiV3SeriesById = putApiV3SeriesById as jest.Mock
const mockPutApiV3EpisodeMonitor = putApiV3EpisodeMonitor as jest.Mock
const mockGetApiV3Manualimport = getApiV3Manualimport as jest.Mock
const mockGetApiV3Command = getApiV3Command as jest.Mock
const mockGetApiV3CommandById = getApiV3CommandById as jest.Mock
const mockGetApiV3ConfigDownloadclient =
  getApiV3ConfigDownloadclient as jest.Mock
const mockGetApiV3Health = getApiV3Health as jest.Mock
const mockGetApiV3History = getApiV3History as jest.Mock
const mockGetApiV3HistorySince = getApiV3HistorySince as jest.Mock
const mockPutApiV3SeriesEditor = putApiV3SeriesEditor as jest.Mock

describe('SonarrService', () => {
  let service: SonarrService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SonarrService, { provide: SONARR_CLIENT, useValue: {} }],
    }).compile()

    service = module.get<SonarrService>(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  describe('search', () => {
    it('maps every kept field from a fully-populated lookup result', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          {
            certification: 'TV-14',
            firstAired: '2019-01-01',
            genres: ['Drama', 'Mystery'],
            images: [
              { coverType: 'fanart', remoteUrl: 'fanart.jpg' },
              { coverType: 'poster', remoteUrl: 'poster.jpg' },
            ],
            overview: 'A show',
            ratings: { value: 8.4, votes: 100 },
            runtime: 45,
            title: 'Some Show',
            tvdbId: 456,
            year: 2019,
          },
        ],
      })

      const result = await service.search('some show')

      expect(getApiV3SeriesLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'some show' } }),
      )
      expect(result).toEqual([
        {
          addedAt: undefined,
          certification: 'TV-14',
          episodeCount: undefined,
          episodeFileCount: undefined,
          filePath: undefined,
          genres: ['Drama', 'Mystery'],
          id: 'tvdb:456',
          monitored: undefined,
          overview: 'A show',
          posterUrl: 'poster.jpg',
          // Not in the library - no tier of its own.
          qualityTier: null,
          // Sonarr's ratings are already a flat { votes, value } pair,
          // unlike Radarr's per-provider breakdown.
          ratingValue: 8.4,
          releaseDate: '2019-01-01',
          // Sonarr reports minutes; Media.runtime is seconds.
          runtime: 2700,
          sonarrId: undefined,
          title: 'Some Show',
          tvdbId: 456,
          type: 'show',
          year: 2019,
        },
      ])
    })

    it('maps every optional field to a defined default when absent', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [{ tvdbId: 9 }] })

      const result = await service.search('x')

      expect(result).toEqual([
        {
          addedAt: undefined,
          certification: undefined,
          episodeCount: undefined,
          episodeFileCount: undefined,
          filePath: undefined,
          genres: [],
          id: 'tvdb:9',
          monitored: undefined,
          overview: undefined,
          posterUrl: undefined,
          // Not in the library - no tier of its own.
          qualityTier: null,
          ratingValue: undefined,
          releaseDate: undefined,
          runtime: undefined,
          sonarrId: undefined,
          title: 'Unknown title',
          tvdbId: 9,
          type: 'show',
          year: undefined,
        },
      ])
    })

    // See RadarrService.search()'s equivalent test - `tvdb:0` fails
    // `ShowSchema`'s own positive-integer check, so the frontend used to
    // drop the record with no error anywhere.
    it('drops a record with no tvdbId rather than minting tvdb:0', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{}, { tvdbId: 0 }, { title: 'Real', tvdbId: 11 }],
      })

      const result = await service.search('x')

      expect(result).toHaveLength(1)
      expect(result[0]?.tvdbId).toBe(11)
    })

    // See RadarrService.search()'s equivalent test: Sonarr returns `id: 0`
    // for a lookup hit that isn't in the library, and zero is falsy but not
    // nullish.
    it('leaves sonarrId undefined for a lookup hit with id 0', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{ id: 0, tvdbId: 5 }],
      })

      const [result] = await service.search('x')

      expect(result?.sonarrId).toBeUndefined()
    })

    // `SeriesResource.path` is the series *folder*, not a per-episode file
    // (unlike Radarr's movieFile.path) - Phase 4's episode work needs
    // `episodeFile` separately.
    it('carries sonarrId and the series folder through for a library item', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{ id: 9, path: '/shows/some-show', tvdbId: 5 }],
      })

      const [result] = await service.search('x')

      expect(result?.sonarrId).toBe(9)
      expect(result?.filePath).toBe('/shows/some-show')
    })

    it('picks the poster image, not fanart', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          {
            images: [
              { coverType: 'fanart', remoteUrl: 'fanart.jpg' },
              { coverType: 'poster', remoteUrl: 'poster.jpg' },
            ],
            tvdbId: 5,
          },
        ],
      })

      const [result] = await service.search('x')

      expect(result?.posterUrl).toBe('poster.jpg')
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.search('x')).rejects.toThrow('searchShows failed')
    })

    // Sonarr v5's lookup throws `InvalidSearchTermException` (a 400) for a
    // term that reads as a path on any OS, where v4 just found nothing.
    describe('Sonarr v5 path-like terms', () => {
      it.each(['/foo', '\\foo', 'C:\\foo', 'c:\\Shows\\Some Show'])(
        'returns no results for %j without calling the lookup',
        async term => {
          const result = await service.search(term)

          expect(result).toEqual([])
          expect(mockGetApiV3SeriesLookup).not.toHaveBeenCalled()
        },
      )

      it.each(['foo/bar', 'AC/DC', 'C: the show', 'tvdb:123'])(
        'still looks up %j, which only contains a slash or colon',
        async term => {
          mockGetApiV3SeriesLookup.mockResolvedValue({
            data: [{ title: 'Some Show', tvdbId: 5 }],
          })

          const result = await service.search(term)

          expect(mockGetApiV3SeriesLookup).toHaveBeenCalledWith(
            expect.objectContaining({ query: { term } }),
          )
          expect(result).toHaveLength(1)
        },
      )

      it('maps a lookup 400 to no results instead of throwing', async () => {
        mockGetApiV3SeriesLookup.mockResolvedValue({
          error: { message: "Invalid search term '//foo'" },
          response: { status: 400 },
        })

        await expect(service.search('some term')).resolves.toEqual([])
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'searchShows', status: 400 }),
          expect.any(String),
        )
      })

      it('keeps the term out of the rejected-lookup log line', async () => {
        mockGetApiV3SeriesLookup.mockResolvedValue({
          error: { message: 'Invalid search term' },
          response: { status: 400 },
        })

        await service.search('secret-ish term')

        const logged = JSON.stringify(
          (Logger.prototype.warn as jest.Mock).mock.calls,
        )
        expect(logged).not.toContain('secret-ish term')
      })

      it('still throws for a non-400 lookup failure', async () => {
        mockGetApiV3SeriesLookup.mockResolvedValue({
          error: { message: 'unavailable' },
          response: { status: 503 },
        })

        await expect(service.search('x')).rejects.toThrow('searchShows failed')
      })
    })
  })

  // Plan 021: the upstream facts state derivation reads. `filePath` is the
  // series folder and is set for every library series, files or not - so
  // "has files" for a show is `episodeFileCount > 0`, never `filePath`.
  describe('getLibraryShow', () => {
    it('asks Sonarr for just that tvdbId and maps the entry', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          {
            id: 3,
            monitored: true,
            statistics: { episodeCount: 45, episodeFileCount: 44 },
            tvdbId: 74413,
          },
        ],
      })

      const result = await service.getLibraryShow(74413)

      expect(mockGetApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({ query: { tvdbId: 74413 } }),
      )
      expect(result).toMatchObject({ episodeFileCount: 44, sonarrId: 3 })
    })

    it('answers undefined when the library does not hold the series', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })

      await expect(service.getLibraryShow(74413)).resolves.toBeUndefined()
    })
  })

  describe('qualityTier on library series', () => {
    beforeEach(() => {
      jest.spyOn(service, 'ensureTierProfiles').mockResolvedValue()
      jest
        .spyOn(service, 'tierForProfileId')
        .mockImplementation(id => (id === 21 ? QualityTier.UpTo720p : null))
    })

    it("reports the tier of one of the app's profiles, and null for any other", async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          { id: 3, qualityProfileId: 21, tvdbId: 5 },
          { id: 4, qualityProfileId: 1, tvdbId: 6 },
        ],
      })

      const [ours, foreign] = await service.getLibrary()

      expect(ours?.qualityTier).toBe(QualityTier.UpTo720p)
      expect(foreign?.qualityTier).toBeNull()
    })

    it('reports the tier on the one-series read the detail page refreshes from', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 3, qualityProfileId: 21, tvdbId: 5 }],
      })

      const show = await service.getLibraryShow(5)

      expect(show?.qualityTier).toBe(QualityTier.UpTo720p)
    })

    it('reports null for a series outside the library', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{ id: 0, qualityProfileId: 21, tvdbId: 5 }],
      })

      const show = await service.lookupByTvdbId(5)

      expect(show.qualityTier).toBeNull()
    })

    // The cache is filled at boot; a library read only tops it up, once.
    it('warms a cold tier cache once, and never again from a read', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })

      await service.getLibrary()
      await service.getLibraryShow(5)
      await service.getLibrary()

      expect(service.ensureTierProfiles).toHaveBeenCalledTimes(1)
    })
  })

  describe('getLibrary', () => {
    it('carries monitored, added and the statistics counts for a library series', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          {
            added: '2024-03-13T17:24:00Z',
            id: 3,
            monitored: true,
            path: '/tv/The Boondocks',
            statistics: {
              episodeCount: 45,
              episodeFileCount: 45,
              percentOfEpisodes: 100,
              seasonCount: 4,
              sizeOnDisk: 67477969060,
              totalEpisodeCount: 98,
            },
            tvdbId: 74413,
          },
        ],
      })

      const [result] = await service.getLibrary()

      expect(result).toMatchObject({
        addedAt: '2024-03-13T17:24:00.000Z',
        episodeCount: 45,
        episodeFileCount: 45,
        filePath: '/tv/The Boondocks',
        monitored: true,
        sonarrId: 3,
      })
    })

    it('reports a monitored series with nothing on disk as episodeFileCount 0, folder and all', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          {
            added: '2025-04-05T03:19:59Z',
            id: 40,
            monitored: true,
            path: '/tv/Some Show',
            statistics: { episodeCount: 10, episodeFileCount: 0 },
            tvdbId: 5,
          },
        ],
      })

      const [result] = await service.getLibrary()

      // The folder is there regardless; the count is the file signal.
      expect(result?.filePath).toBe('/tv/Some Show')
      expect(result?.episodeFileCount).toBe(0)
      expect(result?.episodeCount).toBe(10)
    })

    it('leaves the counts undefined, not 0, when statistics is absent', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 3, monitored: false, tvdbId: 5 }],
      })

      const [result] = await service.getLibrary()

      expect(result?.episodeCount).toBeUndefined()
      expect(result?.episodeFileCount).toBeUndefined()
      // Never "now" for a missing `added`.
      expect(result?.addedAt).toBeUndefined()
      expect(result?.monitored).toBe(false)
    })
  })

  describe('lookup hits (search / lookupByTvdbId)', () => {
    // Live Sonarr: a non-library hit comes back `monitored: true`, `added`
    // as .NET's DateTime.MinValue and zeroed statistics - none of it about
    // this title.
    it('leaves every library-only fact undefined for a hit outside the library', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          {
            added: '0001-01-01T07:53:00Z',
            monitored: true,
            statistics: { episodeCount: 0, episodeFileCount: 0 },
            tvdbId: 5,
          },
        ],
      })

      const [result] = await service.search('x')

      expect(result?.addedAt).toBeUndefined()
      expect(result?.monitored).toBeUndefined()
      expect(result?.episodeCount).toBeUndefined()
      expect(result?.episodeFileCount).toBeUndefined()
    })

    // Live Sonarr: the lookup zeroes statistics even for a library series
    // (a fully downloaded one reads `episodeFileCount: 0`), so a lookup hit
    // reports no counts rather than a false "nothing on disk".
    it('drops the lookup statistics for a library hit but keeps monitored and added', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          {
            added: '2025-04-05T03:19:59Z',
            id: 40,
            monitored: true,
            statistics: { episodeCount: 0, episodeFileCount: 0 },
            tvdbId: 371980,
          },
        ],
      })

      const [searched] = await service.search('x')
      const looked = await service.lookupByTvdbId(371980)

      for (const result of [searched, looked]) {
        expect(result).toMatchObject({
          addedAt: '2025-04-05T03:19:59.000Z',
          monitored: true,
          sonarrId: 40,
        })
        expect(result?.episodeCount).toBeUndefined()
        expect(result?.episodeFileCount).toBeUndefined()
      }
    })
  })

  describe('ensureSeries', () => {
    /** The default tier's profile id, as `tierProfileId()` serves it. */
    const DEFAULT_TIER_PROFILE_ID = 21

    /**
     * The lookup + root-folder reads an add needs, and the tier profile
     * cache already warm - the profile sync itself is covered in
     * `arr-tier-profiles.test.ts`.
     */
    function stubAddPrerequisites() {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{ title: 'New Show', titleSlug: 'new-show', tvdbId: 456 }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ accessible: true, id: 1, path: '/tv' }],
      })
      return jest
        .spyOn(service, 'tierProfileId')
        .mockResolvedValue(DEFAULT_TIER_PROFILE_ID)
    }

    /** Sonarr's 400 for an add that lost the race to another add. */
    function alreadyAdded() {
      return {
        error: [
          {
            errorCode: 'SeriesExistsValidator',
            errorMessage: 'This series has already been added',
            propertyName: 'TvdbId',
          },
        ],
        response: new Response(null, { status: 400 }),
      }
    }

    it('reads the library filtered to the one tvdbId', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })

      await service.ensureSeries(456, { monitored: true })

      expect(getApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({ query: { tvdbId: 456 } }),
      )
    })

    it('touches nothing when the series is already in the library and monitored', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })

      const result = await service.ensureSeries(456, { monitored: true })

      expect(result).toMatchObject({
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: true,
      })
      expect(postApiV3Series).not.toHaveBeenCalled()
      expect(putApiV3SeriesById).not.toHaveBeenCalled()
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('flips series-level monitoring on for an unmonitored library series, and re-monitors every regular episode', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: false, tvdbId: 456 }],
      })
      mockGetApiV3SeriesById.mockResolvedValue({
        data: { id: 9, monitored: false, qualityProfileId: 2, tvdbId: 456 },
      })
      mockPutApiV3SeriesById.mockResolvedValue({ data: {} })
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 50, monitored: false, seasonNumber: 0 },
          { id: 100, monitored: false, seasonNumber: 1 },
          { id: 101, monitored: false, seasonNumber: 2 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      const result = await service.ensureSeries(456, { monitored: true })

      expect(result).toMatchObject({ sonarrId: 9, wasMonitored: false })
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
          path: { id: '9' },
        }),
      )
      // No `monitorEpisodes` scope was given, so this must widen to the
      // whole series the same way an empty scope does everywhere else -
      // otherwise the row is re-monitored but every episode still off, and
      // Sonarr's `SeriesSearch` finds nothing to grab. The specials (50)
      // stay off, as Sonarr's own `MonitorTypes.All` leaves them.
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [100, 101], monitored: true },
        }),
      )
    })

    // Browsing: a library title is never written, even when a scope rides
    // along - `monitorEpisodes` only counts when monitoring was asked for.
    it.each([true, false])(
      'writes nothing to a library series (monitored=%s) when not asked to monitor',
      async monitored => {
        mockGetApiV3Series.mockResolvedValue({
          data: [{ id: 9, monitored, tvdbId: 456 }],
        })

        const result = await service.ensureSeries(456, {
          monitored: false,
          monitorEpisodes: { seasonNumber: 2 },
        })

        expect(result).toMatchObject({
          sonarrId: 9,
          wasAdded: false,
          wasMonitored: monitored,
        })
        expect(getApiV3Episode).not.toHaveBeenCalled()
        expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
        expect(putApiV3SeriesById).not.toHaveBeenCalled()
        expect(putApiV3SeriesEditor).not.toHaveBeenCalled()
        expect(postApiV3Series).not.toHaveBeenCalled()
      },
    )

    it('adds an absent series monitored for a request, without searching for it', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, monitored: true, title: 'New Show', tvdbId: 456 },
      })

      const result = await service.ensureSeries(456, { monitored: true })

      expect(result).toMatchObject({
        sonarrId: 77,
        wasAdded: true,
        wasMonitored: false,
      })
      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            addOptions: {
              monitor: 'all',
              searchForCutoffUnmetEpisodes: false,
              searchForMissingEpisodes: false,
            },
            monitored: true,
          }),
        }),
      )
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    // A fresh narrow add would otherwise arm every regular episode for RSS;
    // `startSearch` monitors the scope once the add-time refresh is done.
    it.each([
      ['a season', { seasonNumber: 2 }],
      ['season 0', { seasonNumber: 0 }],
      ['an episode', { episodeId: 201, seasonNumber: 2 }],
      ['an episode by number', { episodeNumber: 5, seasonNumber: 2 }],
    ])(
      "adds a series requested for %s with monitor 'none', the series flag on",
      async (_label, monitorEpisodes) => {
        mockGetApiV3Series.mockResolvedValue({ data: [] })
        stubAddPrerequisites()
        mockPostApiV3Series.mockResolvedValue({
          data: { id: 77, monitored: true, title: 'New Show', tvdbId: 456 },
        })

        const result = await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes,
        })

        expect(result).toMatchObject({ sonarrId: 77, wasAdded: true })
        expect(postApiV3Series).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              addOptions: expect.objectContaining({ monitor: 'none' }),
              monitored: true,
            }),
          }),
        )
        // Nothing written to the episodes: they don't exist until the
        // add-time refresh has run.
        expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
        expect(putApiV3SeriesById).not.toHaveBeenCalled()
      },
    )

    it("adds a whole-series request with monitor 'all'", async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, monitored: true, title: 'New Show', tvdbId: 456 },
      })

      await service.ensureSeries(456, { monitored: true, monitorEpisodes: {} })

      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            addOptions: expect.objectContaining({ monitor: 'all' }),
          }),
        }),
      )
    })

    it('adds an absent series unmonitored, with no episodes monitored, for a browse', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, monitored: false, title: 'New Show', tvdbId: 456 },
      })

      const result = await service.ensureSeries(456, { monitored: false })

      expect(result).toMatchObject({ sonarrId: 77, wasAdded: true })
      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            addOptions: {
              monitor: 'none',
              searchForCutoffUnmetEpisodes: false,
              searchForMissingEpisodes: false,
            },
            monitored: false,
          }),
        }),
      )
      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it.each([
      ['daily', 'daily'],
      ['anime', 'anime'],
      ['standard', 'standard'],
      [undefined, 'standard'],
    ] as const)(
      'adds a lookup with seriesType=%s as %s',
      async (seriesType, expected) => {
        mockGetApiV3Series.mockResolvedValue({ data: [] })
        stubAddPrerequisites()
        mockGetApiV3SeriesLookup.mockResolvedValue({
          data: [
            {
              seriesType,
              title: 'New Show',
              titleSlug: 'new-show',
              tvdbId: 456,
            },
          ],
        })
        mockPostApiV3Series.mockResolvedValue({
          data: { id: 77, title: 'New Show', tvdbId: 456 },
        })

        await service.ensureSeries(456, { monitored: true })

        expect(postApiV3Series).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              seriesType: expected,
            }),
          }),
        )
      },
    )

    it("adds with the caller's quality profile when given one", async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      const tierProfileId = stubAddPrerequisites()
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, title: 'New Show', tvdbId: 456 },
      })

      await service.ensureSeries(456, { monitored: true, qualityProfileId: 23 })

      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ qualityProfileId: 23 }),
        }),
      )
      expect(tierProfileId).not.toHaveBeenCalled()
    })

    // A browse add names no profile: it gets the default tier's, not the
    // "Any" profile the add used to go looking for.
    it("adds with the default tier's profile when given none", async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      const tierProfileId = stubAddPrerequisites()
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, title: 'New Show', tvdbId: 456 },
      })

      await service.ensureSeries(456, { monitored: false })

      expect(tierProfileId).toHaveBeenCalledWith(defaultQualityTier())
      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            qualityProfileId: DEFAULT_TIER_PROFILE_ID,
            rootFolderPath: '/tv',
          }),
        }),
      )
      // The default configuration is the root folder alone now.
      expect(getApiV3Qualityprofile).not.toHaveBeenCalled()
    })

    it('fails the add, writing nothing, when the tier profile cannot be had', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      stubAddPrerequisites().mockRejectedValue(
        new Error('Could not set up Sonarr\'s "lilnas · HD" quality profile'),
      )

      await expect(
        service.ensureSeries(456, { monitored: false }),
      ).rejects.toThrow('quality profile')
      expect(postApiV3Series).not.toHaveBeenCalled()
    })

    // Re-profiling a library series is the request path's call, not ensure's.
    it('leaves a library series on its own profile', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, qualityProfileId: 1, tvdbId: 456 }],
      })
      const tierProfileId = jest.spyOn(service, 'tierProfileId')

      await service.ensureSeries(456, { monitored: true, qualityProfileId: 23 })

      expect(putApiV3SeriesEditor).not.toHaveBeenCalled()
      expect(tierProfileId).not.toHaveBeenCalled()
    })

    it('treats a 400 "already been added" as the series existing', async () => {
      mockGetApiV3Series
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: [{ id: 12, monitored: false, tvdbId: 456 }],
        })
      stubAddPrerequisites()
      mockPostApiV3Series.mockResolvedValue(alreadyAdded())

      const result = await service.ensureSeries(456, { monitored: false })

      expect(result).toMatchObject({
        sonarrId: 12,
        wasAdded: false,
        wasMonitored: false,
      })
      expect(getApiV3Series).toHaveBeenCalledTimes(2)
      expect(putApiV3SeriesById).not.toHaveBeenCalled()
    })

    it('rethrows an "already added" 400 when the re-read still cannot find the series', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      stubAddPrerequisites()
      mockPostApiV3Series.mockResolvedValue(alreadyAdded())

      await expect(
        service.ensureSeries(456, { monitored: false }),
      ).rejects.toThrow('already been added')
    })

    it('monitors only the unmonitored episodes in the requested season', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 100, monitored: true, seasonNumber: 2 },
          { id: 101, monitored: false, seasonNumber: 2 },
          { id: 102, monitored: false, seasonNumber: 2 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await service.ensureSeries(456, {
        monitored: true,
        monitorEpisodes: { seasonNumber: 2 },
      })

      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seasonNumber: 2, seriesId: 9 } }),
      )
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [101, 102], monitored: true },
        }),
      )
    })

    it('narrows to a single episode when the scope names one', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 100, monitored: false, seasonNumber: 2 },
          { id: 101, monitored: false, seasonNumber: 2 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await service.ensureSeries(456, {
        monitored: true,
        monitorEpisodes: { episodeId: 101, seasonNumber: 2 },
      })

      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [101], monitored: true },
        }),
      )
    })

    // A bare request is not a request for the specials - Sonarr's own
    // `MonitorTypes.All` is `SeasonNumber > 0`.
    it('leaves season 0 alone for an unscoped (whole-series) request', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 50, monitored: false, seasonNumber: 0 },
          { id: 51, monitored: false, seasonNumber: 0 },
          { id: 100, monitored: false, seasonNumber: 1 },
          { id: 101, monitored: true, seasonNumber: 1 },
          { id: 200, monitored: false, seasonNumber: 2 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await service.ensureSeries(456, { monitored: true, monitorEpisodes: {} })

      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seriesId: 9 } }),
      )
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledTimes(1)
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [100, 200], monitored: true },
        }),
      )
    })

    it('makes no monitor call for an unscoped request when only specials are off', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 50, monitored: false, seasonNumber: 0 },
          { id: 100, monitored: true, seasonNumber: 1 },
        ],
      })

      await service.ensureSeries(456, { monitored: true, monitorEpisodes: {} })

      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
    })

    // `!= null`, not truthiness: a truthy check would read season 0 as "no
    // season" and fall into the whole-series branch, which skips specials.
    it('monitors the specials when the scope names season 0', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 50, monitored: false, seasonNumber: 0 },
          { id: 51, monitored: true, seasonNumber: 0 },
          { id: 52, monitored: false, seasonNumber: 0 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await service.ensureSeries(456, {
        monitored: true,
        monitorEpisodes: { seasonNumber: 0 },
      })

      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seasonNumber: 0, seriesId: 9 } }),
      )
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [50, 52], monitored: true },
        }),
      )
    })

    it.each([
      ['with its season', { episodeId: 51, seasonNumber: 0 }],
      ['by episode id alone', { episodeId: 51 }],
    ])(
      'monitors a season-0 episode requested %s',
      async (_label, monitorEpisodes) => {
        mockGetApiV3Series.mockResolvedValue({
          data: [{ id: 9, monitored: true, tvdbId: 456 }],
        })
        mockGetApiV3Episode.mockResolvedValue({
          data: [
            { id: 50, monitored: false, seasonNumber: 0 },
            { id: 51, monitored: false, seasonNumber: 0 },
            { id: 100, monitored: false, seasonNumber: 1 },
          ],
        })
        mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

        await service.ensureSeries(456, { monitored: true, monitorEpisodes })

        expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
          expect.objectContaining({
            body: { episodeIds: [51], monitored: true },
          }),
        )
      },
    )

    it('makes no monitor call when every scoped episode is already monitored', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })
      mockGetApiV3Episode.mockResolvedValue({
        data: [{ id: 100, monitored: true, seasonNumber: 2 }],
      })

      await service.ensureSeries(456, {
        monitored: true,
        monitorEpisodes: { seasonNumber: 2 },
      })

      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
    })

    // Sonarr's RSS sync grabs any monitored, fileless episode of a monitored
    // series, so a narrow request that turns the series flag on must first
    // turn off what's armed outside its scope.
    describe('a narrow request on an unmonitored series', () => {
      /**
       * Seasons 0-3 of an unmonitored library series. Outside a season-2
       * scope: 50/100/300 are armed (monitored, no file), 101 has a file,
       * 102 is already off. Inside it: 200 is on, 201 is off.
       */
      function stubUnmonitoredSeries(
        episodes: EpisodeResource[] = [
          { hasFile: false, id: 50, monitored: true, seasonNumber: 0 },
          { hasFile: false, id: 100, monitored: true, seasonNumber: 1 },
          { hasFile: true, id: 101, monitored: true, seasonNumber: 1 },
          { hasFile: false, id: 102, monitored: false, seasonNumber: 1 },
          { hasFile: false, id: 200, monitored: true, seasonNumber: 2 },
          { hasFile: false, id: 201, monitored: false, seasonNumber: 2 },
          { hasFile: false, id: 300, monitored: true, seasonNumber: 3 },
        ],
      ) {
        mockGetApiV3Series.mockResolvedValue({
          data: [{ id: 9, monitored: false, tvdbId: 456 }],
        })
        mockGetApiV3SeriesById.mockResolvedValue({
          data: { id: 9, monitored: false, tvdbId: 456 },
        })
        mockPutApiV3SeriesById.mockResolvedValue({ data: {} })
        mockGetApiV3Episode.mockResolvedValue({ data: episodes })
        mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })
      }

      /** The `episodeIds` of every `PUT /episode/monitor` with `monitored`. */
      function monitorCalls(monitored: boolean): number[][] {
        return mockPutApiV3EpisodeMonitor.mock.calls
          .map(
            ([arg]) => arg.body as { episodeIds: number[]; monitored: boolean },
          )
          .filter(body => body.monitored === monitored)
          .map(body => body.episodeIds)
      }

      it('turns off the fileless episodes outside a season scope', async () => {
        stubUnmonitoredSeries()

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: { seasonNumber: 2 },
        })

        // One read of the whole series feeds both passes.
        expect(getApiV3Episode).toHaveBeenCalledTimes(1)
        expect(getApiV3Episode).toHaveBeenCalledWith(
          expect.objectContaining({ query: { seriesId: 9 } }),
        )
        // 101 has a file and keeps its flag; 102 is already off.
        expect(monitorCalls(false)).toEqual([[50, 100, 300]])
        expect(monitorCalls(true)).toEqual([[201]])
      })

      it('turns off the fileless episodes outside an episode scope, its own season included', async () => {
        stubUnmonitoredSeries()

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: { episodeId: 201, seasonNumber: 2 },
        })

        expect(monitorCalls(false)).toEqual([[50, 100, 200, 300]])
        expect(monitorCalls(true)).toEqual([[201]])
      })

      it('narrows to one episode asked for by number', async () => {
        stubUnmonitoredSeries([
          { hasFile: false, id: 100, monitored: true, seasonNumber: 1 },
          {
            episodeNumber: 1,
            hasFile: false,
            id: 200,
            monitored: true,
            seasonNumber: 2,
          },
          {
            episodeNumber: 2,
            hasFile: false,
            id: 201,
            monitored: false,
            seasonNumber: 2,
          },
          // Same episode number, another season.
          {
            episodeNumber: 2,
            hasFile: false,
            id: 300,
            monitored: false,
            seasonNumber: 3,
          },
        ])

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: { episodeNumber: 2, seasonNumber: 2 },
        })

        expect(monitorCalls(false)).toEqual([[100, 200]])
        expect(monitorCalls(true)).toEqual([[201]])
      })

      // `!= null`, not truthiness: season 0 is a narrow scope, not "no season".
      it('treats a season-0 scope as narrow', async () => {
        stubUnmonitoredSeries()

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: { seasonNumber: 0 },
        })

        expect(monitorCalls(false)).toEqual([[100, 200, 300]])
        expect(monitorCalls(true)).toEqual([])
      })

      it('turns the outside episodes off before the series flag goes on', async () => {
        stubUnmonitoredSeries()

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: { seasonNumber: 2 },
        })

        const unmonitorIndex = mockPutApiV3EpisodeMonitor.mock.calls.findIndex(
          ([arg]) => arg.body.monitored === false,
        )
        const unmonitorOrder =
          mockPutApiV3EpisodeMonitor.mock.invocationCallOrder[unmonitorIndex]
        const seriesFlagOrder =
          mockPutApiV3SeriesById.mock.invocationCallOrder[0]

        expect(putApiV3SeriesById).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({ monitored: true }),
          }),
        )
        expect(unmonitorOrder).toBeLessThan(seriesFlagOrder ?? 0)
      })

      it('makes no unmonitor call when nothing outside the scope is armed', async () => {
        stubUnmonitoredSeries([
          { hasFile: true, id: 100, monitored: true, seasonNumber: 1 },
          { hasFile: false, id: 102, monitored: false, seasonNumber: 1 },
          { hasFile: false, id: 201, monitored: false, seasonNumber: 2 },
        ])

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: { seasonNumber: 2 },
        })

        expect(monitorCalls(false)).toEqual([])
        expect(monitorCalls(true)).toEqual([[201]])
      })

      it('leaves every episode flag on for a whole-series request', async () => {
        stubUnmonitoredSeries()

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: {},
        })

        expect(monitorCalls(false)).toEqual([])
        expect(monitorCalls(true)).toEqual([[102, 201]])
      })

      it('leaves an already-monitored series alone outside the scope', async () => {
        mockGetApiV3Series.mockResolvedValue({
          data: [{ id: 9, monitored: true, tvdbId: 456 }],
        })
        mockGetApiV3Episode.mockResolvedValue({
          data: [
            { hasFile: false, id: 200, monitored: true, seasonNumber: 2 },
            { hasFile: false, id: 201, monitored: false, seasonNumber: 2 },
          ],
        })
        mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

        await service.ensureSeries(456, {
          monitored: true,
          monitorEpisodes: { seasonNumber: 2 },
        })

        // Only the season is read, so nothing outside it can be touched.
        expect(getApiV3Episode).toHaveBeenCalledWith(
          expect.objectContaining({ query: { seasonNumber: 2, seriesId: 9 } }),
        )
        expect(monitorCalls(false)).toEqual([])
        expect(monitorCalls(true)).toEqual([[201]])
        expect(putApiV3SeriesById).not.toHaveBeenCalled()
      })
    })

    it('skips the episode pass entirely when no scope is given', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })

      await service.ensureSeries(456, { monitored: true })

      expect(getApiV3Episode).not.toHaveBeenCalled()
    })

    it('throws when Sonarr returns a library series with no id', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [{ tvdbId: 456 }] })

      await expect(
        service.ensureSeries(456, { monitored: true }),
      ).rejects.toThrow('Sonarr did not return an id for series tvdbId=456')
    })

    it('throws when the series cannot be found in Sonarr search results', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [] })

      await expect(
        service.ensureSeries(456, { monitored: true }),
      ).rejects.toThrow('Series with TVDB ID 456 not found')
    })
  })

  describe('setSeriesMonitored / setEpisodesMonitored', () => {
    it('re-sends the whole series resource with only `monitored` changed', async () => {
      mockGetApiV3SeriesById.mockResolvedValue({
        data: {
          id: 9,
          monitored: true,
          qualityProfileId: 2,
          rootFolderPath: '/tv',
          tags: [3],
        },
      })
      mockPutApiV3SeriesById.mockResolvedValue({ data: {} })

      await service.setSeriesMonitored(9, false)

      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            id: 9,
            monitored: false,
            qualityProfileId: 2,
            rootFolderPath: '/tv',
            tags: [3],
          },
          path: { id: '9' },
        }),
      )
    })

    it('throws a descriptive error when the series write fails', async () => {
      mockGetApiV3SeriesById.mockResolvedValue({ data: { id: 9 } })
      mockPutApiV3SeriesById.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.setSeriesMonitored(9, true)).rejects.toThrow(
        'setSeriesMonitored failed',
      )
    })

    it('bulk-sets episode monitoring', async () => {
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await service.setEpisodesMonitored([1, 2, 3], false)

      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [1, 2, 3], monitored: false },
        }),
      )
    })

    // The restore path hits this with an empty list whenever it had nothing
    // to turn on, which is the common case.
    it('makes no call at all for an empty episode list', async () => {
      await service.setEpisodesMonitored([], true)

      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
    })
  })

  describe('monitorScope', () => {
    const series = {
      id: 9,
      monitored: true,
      seasons: [
        { monitored: false, seasonNumber: 0 },
        { monitored: false, seasonNumber: 1 },
        { monitored: false, seasonNumber: 2 },
      ],
    }
    const episodes = [
      { episodeNumber: 1, id: 50, monitored: false, seasonNumber: 0 },
      { episodeNumber: 1, id: 100, monitored: false, seasonNumber: 1 },
      { episodeNumber: 1, id: 200, monitored: false, seasonNumber: 2 },
      { episodeNumber: 2, id: 201, monitored: true, seasonNumber: 2 },
      { episodeNumber: 3, id: 202, monitored: false, seasonNumber: 2 },
    ]

    /** Serves `episodes`, narrowed by the season the read asks for. */
    beforeEach(() => {
      mockGetApiV3Episode.mockImplementation(
        async ({ query }: { query: { seasonNumber?: number } }) => ({
          data: episodes.filter(
            episode =>
              query.seasonNumber == null ||
              episode.seasonNumber === query.seasonNumber,
          ),
        }),
      )
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })
      mockGetApiV3SeriesById.mockResolvedValue({ data: series })
      mockPutApiV3SeriesById.mockResolvedValue({ data: {} })
    })

    function monitoredSeasons(): number[] {
      const body = mockPutApiV3SeriesById.mock.calls[0]?.[0].body as
        | { seasons: Array<{ monitored: boolean; seasonNumber: number }> }
        | undefined
      return (body?.seasons ?? [])
        .filter(season => season.monitored)
        .map(season => season.seasonNumber)
    }

    it("monitors a season's episodes, then its season flag", async () => {
      await service.monitorScope(9, { seasonNumber: 2 })

      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [200, 202],
        monitored: true,
      })
      expect(monitoredSeasons()).toEqual([2])
      // Episodes first: a changed season flag may cascade to its episodes.
      expect(
        mockPutApiV3EpisodeMonitor.mock.invocationCallOrder[0],
      ).toBeLessThan(mockPutApiV3SeriesById.mock.invocationCallOrder[0] ?? 0)
    })

    it('monitors every regular season, never the specials, for the whole series', async () => {
      await service.monitorScope(9, {})

      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [100, 200, 202],
        monitored: true,
      })
      expect(monitoredSeasons()).toEqual([1, 2])
    })

    it('monitors the specials when season 0 is named', async () => {
      await service.monitorScope(9, { seasonNumber: 0 })

      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [50],
        monitored: true,
      })
      expect(monitoredSeasons()).toEqual([0])
    })

    it.each([
      ['by id', { episodeId: 202, seasonNumber: 2 }],
      ['by number', { episodeNumber: 3, seasonNumber: 2 }],
    ])(
      "monitors one episode named %s and leaves its season's flag alone",
      async (_label, scope) => {
        await service.monitorScope(9, scope)

        expect(mockPutApiV3EpisodeMonitor.mock.calls).toEqual([
          [
            expect.objectContaining({
              body: { episodeIds: [202], monitored: true },
            }),
          ],
        ])
        expect(putApiV3SeriesById).not.toHaveBeenCalled()
      },
    )
  })

  describe('setSeasonsMonitored', () => {
    const seasons = [
      { monitored: false, seasonNumber: 0, statistics: { episodeCount: 2 } },
      { monitored: false, seasonNumber: 1, statistics: { episodeCount: 10 } },
      { monitored: true, seasonNumber: 2, statistics: { episodeCount: 8 } },
      { monitored: false, seasonNumber: 3, statistics: { episodeCount: 6 } },
    ]

    const series = {
      id: 9,
      monitored: true,
      qualityProfileId: 2,
      rootFolderPath: '/tv',
      seasons,
      tags: [3],
    }

    beforeEach(() => {
      mockGetApiV3SeriesById.mockResolvedValue({ data: series })
      mockPutApiV3SeriesById.mockResolvedValue({ data: {} })
    })

    it('re-sends the whole resource with only the named seasons changed', async () => {
      const changed = await service.setSeasonsMonitored(9, [1, 3], true)

      expect(changed).toEqual([1, 3])
      expect(getApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 9 } }),
      )
      expect(putApiV3SeriesById).toHaveBeenCalledTimes(1)
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            id: 9,
            monitored: true,
            qualityProfileId: 2,
            rootFolderPath: '/tv',
            seasons: [
              seasons[0],
              { ...seasons[1], monitored: true },
              seasons[2],
              { ...seasons[3], monitored: true },
            ],
            tags: [3],
          },
          path: { id: '9' },
        }),
      )
    })

    // Sonarr's own `MonitorTypes.All` is `SeasonNumber > 0`: the specials
    // are never part of "all".
    it("'all' turns on every regular season and leaves the specials off", async () => {
      const changed = await service.setSeasonsMonitored(9, 'all', true)

      expect(changed).toEqual([1, 3])
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            seasons: [
              seasons[0],
              { ...seasons[1], monitored: true },
              seasons[2],
              { ...seasons[3], monitored: true },
            ],
          }),
        }),
      )
    })

    it("'all' never turns monitored specials off either", async () => {
      mockGetApiV3SeriesById.mockResolvedValue({
        data: {
          ...series,
          seasons: seasons.map(season => ({ ...season, monitored: true })),
        },
      })

      const changed = await service.setSeasonsMonitored(9, 'all', false)

      expect(changed).toEqual([1, 2, 3])
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            seasons: [
              { ...seasons[0], monitored: true },
              { ...seasons[1], monitored: false },
              { ...seasons[2], monitored: false },
              { ...seasons[3], monitored: false },
            ],
          }),
        }),
      )
    })

    it("'all' skips the PUT when only the specials differ", async () => {
      mockGetApiV3SeriesById.mockResolvedValue({
        data: {
          ...series,
          seasons: seasons.map(season => ({
            ...season,
            monitored: season.seasonNumber > 0,
          })),
        },
      })

      const changed = await service.setSeasonsMonitored(9, 'all', true)

      expect(changed).toEqual([])
      expect(putApiV3SeriesById).not.toHaveBeenCalled()
    })

    // Specials are season `0`: every scope check has to be a `!= null` /
    // set-membership test, never a truthy one.
    it('monitors specials when season 0 is named explicitly', async () => {
      const changed = await service.setSeasonsMonitored(9, [0], true)

      expect(changed).toEqual([0])
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            seasons: [
              { ...seasons[0], monitored: true },
              seasons[1],
              seasons[2],
              seasons[3],
            ],
          }),
        }),
      )
    })

    it('skips the PUT and returns [] when every season is already at the target', async () => {
      const changed = await service.setSeasonsMonitored(9, [0, 1, 3], false)

      expect(changed).toEqual([])
      expect(getApiV3SeriesById).toHaveBeenCalledTimes(1)
      expect(putApiV3SeriesById).not.toHaveBeenCalled()
    })

    it('returns only the seasons it actually changed', async () => {
      const changed = await service.setSeasonsMonitored(9, [1, 2], true)

      // Season 2 was already monitored, so it is neither re-sent changed nor
      // reported.
      expect(changed).toEqual([1])
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            seasons: [
              seasons[0],
              { ...seasons[1], monitored: true },
              seasons[2],
              seasons[3],
            ],
          }),
        }),
      )
    })

    // The delete side may name a season Sonarr has since dropped; that must
    // not stop the seasons it does still have from being written.
    it('warns and skips a season Sonarr does not list, still writing the rest', async () => {
      const changed = await service.setSeasonsMonitored(9, [3, 7], true)

      expect(changed).toEqual([3])
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ seasonNumber: 7, sonarrId: 9 }),
        expect.any(String),
      )
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            seasons: [
              seasons[0],
              seasons[1],
              seasons[2],
              { ...seasons[3], monitored: true },
            ],
          }),
        }),
      )
    })

    it('makes no call at all for an empty season list', async () => {
      const changed = await service.setSeasonsMonitored(9, [], true)

      expect(changed).toEqual([])
      expect(getApiV3SeriesById).not.toHaveBeenCalled()
      expect(putApiV3SeriesById).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when the series write fails', async () => {
      mockPutApiV3SeriesById.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.setSeasonsMonitored(9, [1], true)).rejects.toThrow(
        'setSeasonsMonitored failed',
      )
    })
  })

  describe('getEpisodes', () => {
    it('scopes to one season when a season number is given', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: [{ id: 100 }] })

      await service.getEpisodes(9, { seasonNumber: 2 })

      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seasonNumber: 2, seriesId: 9 } }),
      )
    })

    it('omits the season filter when none is given', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: [] })

      await service.getEpisodes(9)

      expect(mockGetApiV3Episode.mock.calls[0][0].query).not.toHaveProperty(
        'seasonNumber',
      )
    })

    // Season 0 is Sonarr's specials season - a truthiness check here would
    // silently widen the scope to the whole series.
    it('keeps season 0 (specials) as a real filter', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: [] })

      await service.getEpisodes(9, { seasonNumber: 0 })

      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seasonNumber: 0, seriesId: 9 } }),
      )
    })
  })

  describe('listSeasons', () => {
    // One series call + one *unscoped* episode call, grouped client-side.
    const seedSeries = (
      seasons: unknown[],
      episodes: Record<string, unknown>[],
    ) => {
      mockGetApiV3SeriesById.mockResolvedValue({ data: { id: 9, seasons } })
      mockGetApiV3Episode.mockResolvedValue({ data: episodes })
    }

    it('groups episodes under their season and maps every kept field', async () => {
      seedSeries(
        [
          {
            monitored: true,
            seasonNumber: 1,
            statistics: {
              episodeCount: 2,
              episodeFileCount: 1,
              sizeOnDisk: 5000,
            },
          },
        ],
        [
          {
            absoluteEpisodeNumber: 12,
            airDate: '2004-12-18',
            airDateUtc: '2004-12-19T02:00:00Z',
            episodeFileId: 991,
            episodeNumber: 1,
            finaleType: 'season',
            hasFile: true,
            id: 4400,
            monitored: true,
            overview: 'An episode',
            runtime: 59,
            seasonNumber: 1,
            title: 'Time After Time',
          },
        ],
      )

      const seasons = await service.listSeasons(9)

      expect(seasons).toEqual([
        {
          episodeCount: 2,
          episodeFileCount: 1,
          episodes: [
            {
              absoluteEpisodeNumber: 12,
              // The broadcast-local day, not `airDateUtc`'s next one.
              airDate: '2004-12-18',
              episodeFileId: 991,
              episodeNumber: 1,
              finaleType: 'season',
              hasFile: true,
              id: 4400,
              monitored: true,
              overview: 'An episode',
              // Sonarr reports minutes; Episode.runtime is seconds.
              runtime: 3540,
              seasonNumber: 1,
              title: 'Time After Time',
            },
          ],
          monitored: true,
          seasonNumber: 1,
          sizeOnDisk: 5000,
        },
      ])
    })

    // Two calls total for a ten-season show, not eleven.
    it('makes exactly two upstream calls regardless of season count', async () => {
      seedSeries(
        Array.from({ length: 10 }, (_, i) => ({ seasonNumber: i + 1 })),
        [],
      )

      await service.listSeasons(9)

      expect(mockGetApiV3SeriesById).toHaveBeenCalledTimes(1)
      expect(mockGetApiV3Episode).toHaveBeenCalledTimes(1)
      expect(mockGetApiV3Episode.mock.calls[0][0].query).not.toHaveProperty(
        'seasonNumber',
      )
    })

    it('sorts seasons ascending and keeps season 0 (specials) first', async () => {
      seedSeries(
        [
          { seasonNumber: 2 },
          { seasonNumber: 0 },
          { seasonNumber: 10 },
          { seasonNumber: 1 },
        ],
        [],
      )

      const seasons = await service.listSeasons(9)

      expect(seasons.map(s => s.seasonNumber)).toEqual([0, 1, 2, 10])
    })

    it('sorts episodes within a season ascending', async () => {
      seedSeries(
        [{ seasonNumber: 1 }],
        [
          { episodeNumber: 10, id: 3, seasonNumber: 1 },
          { episodeNumber: 2, id: 1, seasonNumber: 1 },
          { episodeNumber: 9, id: 2, seasonNumber: 1 },
        ],
      )

      const [season] = await service.listSeasons(9)

      expect(season?.episodes.map(e => e.episodeNumber)).toEqual([2, 9, 10])
    })

    // Dropping it would hide episodes rather than report the inconsistency.
    it('synthesizes a season for an episode whose season Sonarr did not list', async () => {
      seedSeries(
        [{ monitored: true, seasonNumber: 1 }],
        [
          { episodeNumber: 1, hasFile: true, id: 1, seasonNumber: 1 },
          { episodeNumber: 1, hasFile: true, id: 2, seasonNumber: 4 },
        ],
      )

      const seasons = await service.listSeasons(9)

      expect(seasons.map(s => s.seasonNumber)).toEqual([1, 4])
      expect(seasons[1]).toMatchObject({
        // No statistics on a synthesized season, so the counts fall back to
        // the episodes it was handed.
        episodeCount: 1,
        episodeFileCount: 1,
        monitored: false,
      })
    })

    // Announced but not aired: a real season with nothing in it.
    it('keeps a season with no episodes, as `episodes: []`', async () => {
      seedSeries(
        [{ seasonNumber: 1 }, { seasonNumber: 2 }],
        [{ episodeNumber: 1, id: 1, seasonNumber: 1 }],
      )

      const seasons = await service.listSeasons(9)

      expect(seasons).toHaveLength(2)
      expect(seasons[1]?.episodes).toEqual([])
    })

    it('omits episodeFileId and reports hasFile false for Sonarr’s `episodeFileId: 0`', async () => {
      seedSeries(
        [{ seasonNumber: 1 }],
        [{ episodeFileId: 0, episodeNumber: 1, id: 1, seasonNumber: 1 }],
      )

      const [season] = await service.listSeasons(9)

      expect(season?.episodes[0]).toMatchObject({ hasFile: false })
      expect(season?.episodes[0]).not.toHaveProperty('episodeFileId', 0)
      expect(season?.episodes[0]?.episodeFileId).toBeUndefined()
    })

    it('defaults monitored/hasFile to false and leaves optional fields undefined', async () => {
      seedSeries(
        [{ seasonNumber: 1 }],
        [{ episodeNumber: 1, id: 1, seasonNumber: 1 }],
      )

      const [season] = await service.listSeasons(9)

      expect(season?.episodes[0]).toEqual({
        airDate: undefined,
        episodeFileId: undefined,
        episodeNumber: 1,
        hasFile: false,
        id: 1,
        monitored: false,
        overview: undefined,
        runtime: undefined,
        seasonNumber: 1,
        title: undefined,
      })
      expect(season?.sizeOnDisk).toBeUndefined()
    })

    // Structural fields, unlike monitored/hasFile - an episode without them
    // could not be searched, grabbed or rendered.
    it.each(['id', 'seasonNumber', 'episodeNumber'])(
      'throws when an episode is missing its %s',
      async field => {
        const episode: Record<string, unknown> = {
          episodeNumber: 1,
          id: 1,
          seasonNumber: 1,
        }
        delete episode[field]
        seedSeries([{ seasonNumber: 1 }], [episode])

        await expect(service.listSeasons(9)).rejects.toThrow(
          /without an id\/seasonNumber\/episodeNumber/,
        )
      },
    )

    it('handles a series with no seasons array at all', async () => {
      mockGetApiV3SeriesById.mockResolvedValue({ data: { id: 9 } })
      mockGetApiV3Episode.mockResolvedValue({ data: [] })

      await expect(service.listSeasons(9)).resolves.toEqual([])
    })
  })

  describe('triggerEpisodeSearch / triggerSeasonSearch', () => {
    it('posts an EpisodeSearch command carrying just the episode ids', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      await service.triggerEpisodeSearch([4412])

      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [4412], name: 'EpisodeSearch' },
        }),
      )
    })

    it('posts a SeasonSearch command carrying the series and season', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      await service.triggerSeasonSearch(9, 3)

      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'SeasonSearch', seasonNumber: 3, seriesId: 9 },
        }),
      )
    })

    // Season 0 is specials - a falsy season number that must still be sent.
    it('sends season 0 as a real season number', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      await service.triggerSeasonSearch(9, 0)

      expect(mockPostApiV3Command.mock.calls[0][0].body).toEqual({
        name: 'SeasonSearch',
        seasonNumber: 0,
        seriesId: 9,
      })
    })

    it.each([
      ['triggerEpisodeSearch', () => service.triggerEpisodeSearch([1])],
      ['triggerSeasonSearch', () => service.triggerSeasonSearch(9, 1)],
    ])('surfaces a rejected %s command as an error', async (name, run) => {
      mockPostApiV3Command.mockResolvedValue({ error: { message: 'boom' } })

      await expect(run()).rejects.toThrow(`${name} failed`)
    })

    it.each([
      ['SeriesSearch', () => service.triggerSearch(9)],
      ['EpisodeSearch', () => service.triggerEpisodeSearch([1])],
      ['SeasonSearch', () => service.triggerSeasonSearch(9, 1)],
    ])('resolves %s to a ref for the queued command', async (name, run) => {
      mockPostApiV3Command.mockResolvedValue({
        data: {
          id: 41,
          name,
          queued: '2026-09-28T10:00:00Z',
          status: 'queued',
        },
      })

      await expect(run()).resolves.toEqual({
        id: 41,
        name,
        queuedAt: '2026-09-28T10:00:00Z',
      })
    })

    it('throws when Sonarr answers a command without an id', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { name: 'SeriesSearch' } })

      await expect(service.triggerSearch(9)).rejects.toThrow(
        'Sonarr did not return an id for the SeriesSearch command',
      )
    })
  })

  describe('triggerSearch', () => {
    it('posts a SeriesSearch command for the series', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      await service.triggerSearch(9)

      expect(mockPostApiV3Command.mock.calls[0][0].body).toEqual({
        name: 'SeriesSearch',
        seriesId: 9,
      })
    })
  })

  describe('refreshSeries', () => {
    it('posts a RefreshSeries command for the one series', async () => {
      mockPostApiV3Command.mockResolvedValue({
        data: { id: 5, name: 'RefreshSeries', queued: '2026-09-28T10:00:00Z' },
      })

      await expect(service.refreshSeries(9)).resolves.toEqual({
        id: 5,
        name: 'RefreshSeries',
        queuedAt: '2026-09-28T10:00:00Z',
      })

      expect(mockPostApiV3Command.mock.calls[0][0].body).toEqual({
        name: 'RefreshSeries',
        seriesIds: [9],
      })
    })

    // Identical to Sonarr's own add-time refresh, so its dedupe hands that
    // command back rather than queueing a second.
    it('marks the add-time refresh with isNewSeries', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { id: 5 } })

      await service.refreshSeries(9, { isNew: true })

      expect(mockPostApiV3Command.mock.calls[0][0].body).toEqual({
        isNewSeries: true,
        name: 'RefreshSeries',
        seriesIds: [9],
      })
    })

    it('surfaces a rejected command as an error', async () => {
      mockPostApiV3Command.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.refreshSeries(9)).rejects.toThrow(
        'refreshSeries failed',
      )
    })
  })

  describe('getCommand / listCommands', () => {
    const inMemory = {
      body: { isNewSeries: true, seriesIds: [9], trigger: 'manual' },
      commandName: 'Refresh Series',
      duration: '00:00:01.2',
      ended: '2026-09-28T10:00:02Z',
      id: 41,
      message: 'Completed',
      name: 'RefreshSeries',
      priority: 'normal',
      queued: '2026-09-28T10:00:00Z',
      result: 'successful',
      started: '2026-09-28T10:00:01Z',
      status: 'completed',
      trigger: 'manual',
    }

    it('reads one command by id and maps it to a snapshot', async () => {
      mockGetApiV3CommandById.mockResolvedValue({ data: inMemory })

      await expect(service.getCommand(41)).resolves.toEqual({
        body: { isNewSeries: true, seriesIds: [9], trigger: 'manual' },
        ended: '2026-09-28T10:00:02Z',
        id: 41,
        message: 'Completed',
        name: 'RefreshSeries',
        queued: '2026-09-28T10:00:00Z',
        result: 'successful',
        started: '2026-09-28T10:00:01Z',
        status: 'completed',
        trigger: 'manual',
      })
      expect(mockGetApiV3CommandById.mock.calls[0][0].path).toEqual({
        id: 41,
      })
    })

    // The database fallback: `result: 'unknown'`, no message, nulls omitted.
    it('maps a database-backed command with no message', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        data: {
          body: {},
          id: 41,
          name: 'SeriesSearch',
          queued: '2026-09-28T10:00:00Z',
          result: 'unknown',
          status: 'completed',
          trigger: 'unspecified',
        },
      })

      const snapshot = await service.getCommand(41)

      expect(snapshot).toMatchObject({ result: 'unknown', status: 'completed' })
      expect(snapshot?.message).toBeUndefined()
      expect(snapshot?.started).toBeUndefined()
      expect(snapshot?.ended).toBeUndefined()
    })

    it('answers null for an id Sonarr no longer knows (404)', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        error: { message: 'Not Found' },
        response: { status: 404 },
      })

      await expect(service.getCommand(41)).resolves.toBeNull()
    })

    it('throws on any other failure', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.getCommand(41)).rejects.toThrow('getCommand failed')
    })

    it('throws for a command missing its status', async () => {
      mockGetApiV3CommandById.mockResolvedValue({
        data: { id: 41, name: 'RefreshSeries' },
      })

      await expect(service.getCommand(41)).rejects.toThrow(
        'Sonarr returned a command without an id/name/status',
      )
    })

    it('lists every in-memory command as snapshots', async () => {
      mockGetApiV3Command.mockResolvedValue({
        data: [
          inMemory,
          { body: {}, id: 42, name: 'SeriesSearch', status: 'queued' },
        ],
      })

      const commands = await service.listCommands()

      expect(commands.map(command => [command.id, command.status])).toEqual([
        [41, 'completed'],
        [42, 'queued'],
      ])
      expect(mockGetApiV3Command).toHaveBeenCalledWith({ client: {} })
    })
  })

  describe('getHistorySince', () => {
    it('asks for records since the date with each episode included', async () => {
      const records = [
        {
          date: '2026-09-28T10:00:00Z',
          downloadId: 'SABnzbd_1',
          episode: { episodeNumber: 1, seasonNumber: 0 },
          eventType: 'grabbed',
        },
      ]
      mockGetApiV3HistorySince.mockResolvedValue({ data: records })

      await expect(
        service.getHistorySince(new Date('2026-09-28T09:00:00Z')),
      ).resolves.toEqual(records)

      expect(mockGetApiV3HistorySince.mock.calls[0][0].query).toEqual({
        date: '2026-09-28T09:00:00.000Z',
        includeEpisode: true,
      })
    })

    it('passes a string date through untouched', async () => {
      mockGetApiV3HistorySince.mockResolvedValue({ data: [] })

      await service.getHistorySince('2026-09-28T09:00:00Z')

      expect(mockGetApiV3HistorySince.mock.calls[0][0].query.date).toBe(
        '2026-09-28T09:00:00Z',
      )
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3HistorySince.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getHistorySince(new Date())).rejects.toThrow(
        'getHistorySince failed',
      )
    })
  })

  describe('getHistoryByDownloadId', () => {
    it('reads page after page until every record is in', async () => {
      mockGetApiV3History
        .mockResolvedValueOnce({
          data: { page: 1, records: [{ id: 3 }, { id: 2 }], totalRecords: 3 },
        })
        .mockResolvedValueOnce({
          data: { page: 2, records: [{ id: 1 }], totalRecords: 3 },
        })

      await expect(
        service.getHistoryByDownloadId('SABnzbd_1'),
      ).resolves.toEqual([{ id: 3 }, { id: 2 }, { id: 1 }])

      expect(mockGetApiV3History).toHaveBeenCalledTimes(2)
      expect(mockGetApiV3History.mock.calls[0][0].query).toEqual({
        downloadId: 'SABnzbd_1',
        page: 1,
        pageSize: 1000,
      })
      expect(mockGetApiV3History.mock.calls[1][0].query).toMatchObject({
        page: 2,
      })
    })

    it('stops on an empty page even if the total says otherwise', async () => {
      mockGetApiV3History
        .mockResolvedValueOnce({
          data: { records: [{ id: 1 }], totalRecords: 5 },
        })
        .mockResolvedValueOnce({ data: { records: [], totalRecords: 5 } })

      await expect(service.getHistoryByDownloadId('x')).resolves.toEqual([
        { id: 1 },
      ])
      expect(mockGetApiV3History).toHaveBeenCalledTimes(2)
    })

    it('returns an empty list for a download with no history', async () => {
      mockGetApiV3History.mockResolvedValue({
        data: { records: [], totalRecords: 0 },
      })

      await expect(service.getHistoryByDownloadId('x')).resolves.toEqual([])
      expect(mockGetApiV3History).toHaveBeenCalledTimes(1)
    })
  })

  describe('isDownloadClientHealthy', () => {
    it('is healthy with no health entries at all', async () => {
      mockGetApiV3Health.mockResolvedValue({ data: [] })

      await expect(service.isDownloadClientHealthy()).resolves.toBe(true)
    })

    it.each([
      ['DownloadClientCheck', 'error'],
      ['DownloadClientCheck', 'warning'],
      ['DownloadClientStatusCheck', 'error'],
      ['DownloadClientStatusCheck', 'warning'],
    ])('is unhealthy on a %s %s', async (source, type) => {
      mockGetApiV3Health.mockResolvedValue({
        data: [{ message: 'Unable to communicate', source, type }],
      })

      await expect(service.isDownloadClientHealthy()).resolves.toBe(false)
    })

    it('ignores notices and every other check', async () => {
      mockGetApiV3Health.mockResolvedValue({
        data: [
          { source: 'DownloadClientCheck', type: 'notice' },
          { source: 'IndexerStatusCheck', type: 'error' },
          { source: 'UpdateCheck', type: 'warning' },
        ],
      })

      await expect(service.isDownloadClientHealthy()).resolves.toBe(true)
    })
  })

  describe('getFailedDownloadConfig', () => {
    it('reports both redownload switches', async () => {
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

    // On is Sonarr's own default for both switches.
    it('reads an absent switch as on', async () => {
      mockGetApiV3ConfigDownloadclient.mockResolvedValue({ data: { id: 1 } })

      await expect(service.getFailedDownloadConfig()).resolves.toEqual({
        autoRedownloadFailed: true,
        fromInteractive: true,
      })
    })
  })

  describe('editSeries', () => {
    it('puts just the given fields to the series editor', async () => {
      mockPutApiV3SeriesEditor.mockResolvedValue({ data: {} })

      await service.editSeries([9, 10], { monitored: false })

      expect(mockPutApiV3SeriesEditor.mock.calls[0][0].body).toEqual({
        monitored: false,
        seriesIds: [9, 10],
      })
    })

    it('sends a quality profile alongside monitored', async () => {
      mockPutApiV3SeriesEditor.mockResolvedValue({ data: {} })

      await service.editSeries([9], { monitored: true, qualityProfileId: 4 })

      expect(mockPutApiV3SeriesEditor.mock.calls[0][0].body).toEqual({
        monitored: true,
        qualityProfileId: 4,
        seriesIds: [9],
      })
    })

    it('makes no call for no series or no changes', async () => {
      await service.editSeries([], { monitored: false })
      await service.editSeries([9], {})

      expect(mockPutApiV3SeriesEditor).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when the edit is refused', async () => {
      mockPutApiV3SeriesEditor.mockResolvedValue({ error: { message: 'boom' } })

      await expect(
        service.editSeries([9], { monitored: false }),
      ).rejects.toThrow('editSeries failed')
    })
  })

  describe('resolveScope', () => {
    it('fills in season and episode numbers from an episode id', async () => {
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: { episodeNumber: 5, id: 4412, seasonNumber: 3 },
      })

      await expect(service.resolveScope({ episodeId: 4412 })).resolves.toEqual({
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      })
      expect(getApiV3EpisodeById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 4412 } }),
      )
    })

    // The unscoped request is the common case and must not pay for a
    // lookup it has nothing to look up.
    it.each([
      ['a season-only scope', { seasonNumber: 3 }],
      ['an empty scope', {}],
    ])('returns %s untouched with no round trip', async (_label, scope) => {
      await expect(service.resolveScope(scope)).resolves.toEqual(scope)
      expect(getApiV3EpisodeById).not.toHaveBeenCalled()
    })

    it('throws for an episode id Sonarr does not know', async () => {
      mockGetApiV3EpisodeById.mockResolvedValue({
        error: { message: 'not found' },
      })

      await expect(service.resolveScope({ episodeId: 1 })).rejects.toThrow(
        'getEpisodeById failed',
      )
    })

    // A half-filled scope would search for nothing and never say why.
    it('throws rather than returning a partial scope when numbers are missing', async () => {
      mockGetApiV3EpisodeById.mockResolvedValue({ data: { id: 4412 } })

      await expect(service.resolveScope({ episodeId: 4412 })).rejects.toThrow(
        /no season\/episode number/,
      )
    })

    // The caller's own `seasonNumber` is replaced by Sonarr's, which is the
    // authoritative one for that episode id.
    it('prefers Sonarr’s season number over one the caller guessed', async () => {
      mockGetApiV3EpisodeById.mockResolvedValue({
        data: { episodeNumber: 5, seasonNumber: 3 },
      })

      await expect(
        service.resolveScope({ episodeId: 4412, seasonNumber: 99 }),
      ).resolves.toMatchObject({ seasonNumber: 3 })
    })
  })

  describe('unmonitorScope', () => {
    const monitoredEpisodes = [
      { id: 1, monitored: true, seasonNumber: 3 },
      { id: 2, monitored: true, seasonNumber: 3 },
    ]

    it('unmonitors just the one episode an episode-scope names', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: monitoredEpisodes })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await expect(
        service.unmonitorScope(9, { episodeId: 2, seasonNumber: 3 }),
      ).resolves.toBe(1)

      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [2], monitored: false },
        }),
      )
    })

    // A multi-episode file's siblings - no single `episodeId` names them.
    it('unmonitors exactly the episodes an episode-id list names', async () => {
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          ...monitoredEpisodes,
          { id: 3, monitored: true, seasonNumber: 3 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await expect(
        service.unmonitorScope(9, { episodeIds: [1, 3] }),
      ).resolves.toBe(2)

      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [1, 3],
        monitored: false,
      })
    })

    it('lets an episode-id list win over a single episode id', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: monitoredEpisodes })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await expect(
        service.unmonitorScope(9, { episodeId: 2, episodeIds: [1] }),
      ).resolves.toBe(1)

      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [1],
        monitored: false,
      })
    })

    // A request cancelled before its episode number resolved to an id.
    it('unmonitors just the one episode a season and episode number name', async () => {
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { episodeNumber: 1, id: 1, monitored: true, seasonNumber: 3 },
          { episodeNumber: 2, id: 2, monitored: true, seasonNumber: 3 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await expect(
        service.unmonitorScope(9, { episodeNumber: 2, seasonNumber: 3 }),
      ).resolves.toBe(1)

      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [2],
        monitored: false,
      })
    })

    it('unmonitors a whole season when only a season is given', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: monitoredEpisodes })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await expect(
        service.unmonitorScope(9, { seasonNumber: 3 }),
      ).resolves.toBe(2)

      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seasonNumber: 3, seriesId: 9 } }),
      )
      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [1, 2],
        monitored: false,
      })
    })

    // An empty scope means the whole series, matching how a whole-series
    // request widens on the way in.
    it('unmonitors every episode of the series for an empty scope', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: monitoredEpisodes })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await expect(service.unmonitorScope(9, {})).resolves.toBe(2)

      expect(mockGetApiV3Episode.mock.calls[0][0].query).not.toHaveProperty(
        'seasonNumber',
      )
    })

    it('skips episodes that are already unmonitored, and counts only what it changed', async () => {
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 1, monitored: false, seasonNumber: 3 },
          { id: 2, monitored: true, seasonNumber: 3 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      await expect(
        service.unmonitorScope(9, { seasonNumber: 3 }),
      ).resolves.toBe(1)
      expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
        episodeIds: [2],
        monitored: false,
      })
    })

    it('is a zero-cost no-op when the scope matches nothing', async () => {
      mockGetApiV3Episode.mockResolvedValue({ data: monitoredEpisodes })

      await expect(service.unmonitorScope(9, { episodeId: 999 })).resolves.toBe(
        0,
      )

      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
    })

    describe('withoutFileOnly', () => {
      const mixedEpisodes = [
        { hasFile: true, id: 1, monitored: true, seasonNumber: 0 },
        { hasFile: false, id: 2, monitored: true, seasonNumber: 0 },
        { id: 3, monitored: true, seasonNumber: 0 },
      ]

      it('leaves episodes with a file monitored and uncounted', async () => {
        mockGetApiV3Episode.mockResolvedValue({ data: mixedEpisodes })
        mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

        await expect(
          service.unmonitorScope(
            9,
            { seasonNumber: 0 },
            { withoutFileOnly: true },
          ),
        ).resolves.toBe(2)

        // Season 0 (specials) is a real season, not "no season".
        expect(getApiV3Episode).toHaveBeenCalledWith(
          expect.objectContaining({ query: { seasonNumber: 0, seriesId: 9 } }),
        )
        expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
          episodeIds: [2, 3],
          monitored: false,
        })
      })

      it('is a no-op when the one scoped episode has a file', async () => {
        mockGetApiV3Episode.mockResolvedValue({ data: mixedEpisodes })

        await expect(
          service.unmonitorScope(
            9,
            { episodeId: 1 },
            { withoutFileOnly: true },
          ),
        ).resolves.toBe(0)
        expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
      })

      it('unmonitors episodes with files too when the option is off', async () => {
        mockGetApiV3Episode.mockResolvedValue({ data: mixedEpisodes })
        mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

        await expect(service.unmonitorScope(9, {})).resolves.toBe(3)
        expect(mockPutApiV3EpisodeMonitor.mock.calls[0][0].body).toEqual({
          episodeIds: [1, 2, 3],
          monitored: false,
        })
      })
    })
  })

  describe('getSeriesById', () => {
    it('unwraps the series resource', async () => {
      mockGetApiV3SeriesById.mockResolvedValue({ data: { id: 9, title: 'X' } })

      await expect(service.getSeriesById(9)).resolves.toEqual({
        id: 9,
        title: 'X',
      })
      expect(getApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 9 } }),
      )
    })

    it('throws a descriptive error when the lookup fails', async () => {
      mockGetApiV3SeriesById.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getSeriesById(9)).rejects.toThrow('getSeries failed')
    })
  })

  describe('getReleases', () => {
    it('maps the show-only fields on top of the shared release shape', async () => {
      mockGetApiV3Release.mockResolvedValue({
        data: [
          {
            downloadAllowed: true,
            episodeNumbers: [1, 2],
            fullSeason: true,
            guid: 'indexer://abc',
            indexer: 'Some Indexer',
            indexerId: 3,
            languages: [{ id: 1, name: 'English' }],
            mappedSeriesId: 9,
            protocol: 'usenet',
            quality: { quality: { name: 'WEBDL-1080p', resolution: 1080 } },
            rejected: false,
            seasonNumber: 2,
            seeders: 10,
            title: 'Some.Show.S02.1080p',
          },
        ],
      })

      const [result] = await service.getReleases(9, { seasonNumber: 2 })

      expect(result).toEqual({
        age: undefined,
        customFormatScore: undefined,
        downloadAllowed: true,
        episodeNumbers: [1, 2],
        flaggedBad: false,
        fullSeason: true,
        guid: 'indexer://abc',
        indexer: 'Some Indexer',
        indexerId: 3,
        languages: ['English'],
        leechers: undefined,
        mappedEpisodeNumbers: undefined,
        mappedSeasonNumber: undefined,
        mappedSeriesId: 9,
        protocol: 'usenet',
        publishDate: undefined,
        quality: { name: 'WEBDL-1080p', resolution: 1080 },
        rejected: false,
        rejections: undefined,
        releaseGroup: undefined,
        seasonNumber: 2,
        seeders: 10,
        size: undefined,
        title: 'Some.Show.S02.1080p',
      })
    })

    it('leaves the show-only fields undefined when absent', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [{ seriesId: 9 }] })

      const [result] = await service.getReleases(9, { seasonNumber: 2 })

      expect(result?.episodeNumbers).toBeUndefined()
      expect(result?.fullSeason).toBeUndefined()
      expect(result?.seasonNumber).toBeUndefined()
      expect(result?.mappedEpisodeNumbers).toBeUndefined()
      expect(result?.mappedSeasonNumber).toBeUndefined()
      expect(result?.mappedSeriesId).toBeUndefined()
    })

    it('keeps only the releases Sonarr mapped to this series', async () => {
      mockGetApiV3Release.mockResolvedValue({
        data: [
          { guid: 'ours-mapped', mappedSeriesId: 9 },
          // `mappedSeriesId` wins over `seriesId` when both are set.
          { guid: 'foreign-mapped', mappedSeriesId: 12, seriesId: 9 },
          { guid: 'ours-unmapped', seriesId: 9 },
          { guid: 'foreign-unmapped', seriesId: 12 },
          { guid: 'no-series' },
        ],
      })

      const result = await service.getReleases(9, { episodeId: 4412 })

      expect(result.map(release => release.guid)).toEqual([
        'ours-mapped',
        'ours-unmapped',
      ])
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'getReleases', dropped: 3 }),
        expect.any(String),
      )
    })

    it('passes seasonNumber and episodeId straight through to Sonarr', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [] })

      await service.getReleases(9, { episodeId: 4412, seasonNumber: 2 })

      expect(getApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { episodeId: 4412, seasonNumber: 2, seriesId: 9 },
        }),
      )
    })

    it('sends a season scope without an episodeId - season 0 included', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [] })

      await service.getReleases(9, { seasonNumber: 0 })

      expect(mockGetApiV3Release.mock.calls[0][0].query).toEqual({
        seasonNumber: 0,
        seriesId: 9,
      })
    })

    it('sends an episode scope without a seasonNumber', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [] })

      await service.getReleases(9, { episodeId: 4412 })

      expect(mockGetApiV3Release.mock.calls[0][0].query).toEqual({
        episodeId: 4412,
        seriesId: 9,
      })
    })

    it('refuses an unscoped call at the type level', () => {
      // Never invoked - this only has to fail to compile without the
      // directives. Unscoped, Sonarr answers with its RSS feed, not a search.
      const unscoped = () => [
        // @ts-expect-error - a season or an episode is required
        service.getReleases(9),
        // @ts-expect-error - an empty scope is no scope
        service.getReleases(9, {}),
      ]

      expect(unscoped).toBeInstanceOf(Function)
    })

    it('returns an empty list when the indexer search found nothing', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [] })

      await expect(
        service.getReleases(9, { seasonNumber: 1 }),
      ).resolves.toEqual([])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3Release.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getReleases(9, { seasonNumber: 1 })).rejects.toThrow(
        'getReleases failed',
      )
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
      mockPostApiV3Release.mockResolvedValue({ error: { message: 'nope' } })

      await expect(service.grabRelease('g', 1)).rejects.toThrow(
        'grabRelease failed',
      )
    })
  })

  describe('getEpisodeFiles / deleteEpisodeFile', () => {
    it('lists the files for one series', async () => {
      mockGetApiV3Episodefile.mockResolvedValue({
        data: [{ id: 11, seasonNumber: 2, seriesId: 9 }],
      })

      const result = await service.getEpisodeFiles(9)

      expect(getApiV3Episodefile).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seriesId: 9 } }),
      )
      expect(result).toEqual([{ id: 11, seasonNumber: 2, seriesId: 9 }])
    })

    it('returns an empty list for a series with no files yet', async () => {
      mockGetApiV3Episodefile.mockResolvedValue({ data: [] })

      await expect(service.getEpisodeFiles(9)).resolves.toEqual([])
    })

    it('deletes one file by id without touching the series', async () => {
      mockDeleteApiV3EpisodefileById.mockResolvedValue({ data: undefined })

      await service.deleteEpisodeFile(11)

      expect(deleteApiV3EpisodefileById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 11 } }),
      )
      expect(deleteApiV3SeriesById).not.toHaveBeenCalled()
    })

    it('throws a descriptive error when the file delete fails', async () => {
      mockDeleteApiV3EpisodefileById.mockResolvedValue({
        error: { message: 'not found' },
      })

      await expect(service.deleteEpisodeFile(11)).rejects.toThrow(
        'deleteEpisodeFile failed',
      )
    })
  })

  describe('getSeriesHistory', () => {
    it('fetches the whole series in one call and returns the records raw', async () => {
      mockGetApiV3HistorySeries.mockResolvedValue({
        data: [
          { downloadId: 'abc', eventType: 'grabbed', id: 1 },
          { downloadId: 'abc', eventType: 'downloadFolderImported', id: 2 },
        ],
      })

      const result = await service.getSeriesHistory(9)

      expect(getApiV3HistorySeries).toHaveBeenCalledTimes(1)
      expect(getApiV3HistorySeries).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seriesId: 9 } }),
      )
      expect(result).toEqual([
        { downloadId: 'abc', eventType: 'grabbed', id: 1 },
        { downloadId: 'abc', eventType: 'downloadFolderImported', id: 2 },
      ])
    })

    // Both narrowings are deliberate omissions, not oversights: a season
    // filter would multiply the call count for no saving, and a numeric
    // `eventType` doesn't line up with the SDK's string union
    // (`downloadFolderImported` is 3 on the wire, not 2) so it would quietly
    // fetch the wrong events.
    it('sends neither a seasonNumber nor an eventType filter', async () => {
      mockGetApiV3HistorySeries.mockResolvedValue({ data: [] })

      await service.getSeriesHistory(9)

      const { query } = mockGetApiV3HistorySeries.mock.calls[0][0]
      expect(query).not.toHaveProperty('seasonNumber')
      expect(query).not.toHaveProperty('eventType')
    })

    it('returns an empty list for a series with no history yet', async () => {
      mockGetApiV3HistorySeries.mockResolvedValue({ data: [] })

      await expect(service.getSeriesHistory(9)).resolves.toEqual([])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3HistorySeries.mockResolvedValue({
        error: { message: 'boom' },
      })

      await expect(service.getSeriesHistory(9)).rejects.toThrow(
        'getSeriesHistory failed',
      )
    })
  })

  describe('getIndexers', () => {
    // Raw resources, unfiltered and unmapped - the name -> id lookup that
    // Sonarr's indexerId-less grabbed history needs is the caller's to build.
    it('returns the configured indexers untouched', async () => {
      mockGetApiV3Indexer.mockResolvedValue({
        data: [
          { enableInteractiveSearch: true, id: 3, name: 'AltHub' },
          { enableInteractiveSearch: false, id: 7, name: 'NzbGeek' },
        ],
      })

      const result = await service.getIndexers()

      expect(getApiV3Indexer).toHaveBeenCalledTimes(1)
      expect(result).toEqual([
        { enableInteractiveSearch: true, id: 3, name: 'AltHub' },
        { enableInteractiveSearch: false, id: 7, name: 'NzbGeek' },
      ])
    })

    it('returns an empty list when no indexer is configured', async () => {
      mockGetApiV3Indexer.mockResolvedValue({ data: [] })

      await expect(service.getIndexers()).resolves.toEqual([])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3Indexer.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getIndexers()).rejects.toThrow('getIndexers failed')
    })
  })

  describe('getQueue', () => {
    it('returns queue records, filtered by seriesIds when provided', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [{ id: 1, seriesId: 9, status: 'downloading' }] },
      })

      const result = await service.getQueue([9])

      expect(getApiV3Queue).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ seriesIds: [9] }),
        }),
      )
      expect(result).toEqual([{ id: 1, seriesId: 9, status: 'downloading' }])
    })

    it('returns an empty array when the queue has no records', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: {} })

      const result = await service.getQueue()

      expect(result).toEqual([])
    })

    it('reads every page of the whole queue, unknown-series rows included', async () => {
      mockGetApiV3Queue
        .mockResolvedValueOnce({
          data: {
            page: 1,
            records: [
              { downloadId: 'a', id: 1, seriesId: 9, status: 'downloading' },
              { downloadId: 'b', id: 2, seriesId: 9, status: 'queued' },
            ],
            totalRecords: 4,
          },
        })
        .mockResolvedValueOnce({
          data: {
            page: 2,
            records: [
              // No downloadId yet - still a real queue row.
              { id: 3, seriesId: 9, status: 'delay' },
              // Unknown to Sonarr's library - no seriesId at all.
              { downloadId: 'd', id: 4, status: 'completed' },
            ],
            totalRecords: 4,
          },
        })

      const result = await service.getQueue()

      expect(result.map(item => item.id)).toEqual([1, 2, 3, 4])
      expect(mockGetApiV3Queue).toHaveBeenCalledTimes(2)
      expect(mockGetApiV3Queue.mock.calls[0][0].query).toEqual({
        includeEpisode: false,
        includeSeries: false,
        includeUnknownSeriesItems: true,
        page: 1,
        pageSize: 1000,
      })
      expect(mockGetApiV3Queue.mock.calls[1][0].query).toMatchObject({
        includeUnknownSeriesItems: true,
        page: 2,
      })
    })

    // A per-series caller must never see (or cancel) a row owned by no series.
    it('leaves unknown-series rows out of a read filtered to series ids', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [], totalRecords: 0 },
      })

      await service.getQueue([9])

      expect(mockGetApiV3Queue.mock.calls[0][0].query).toEqual({
        includeEpisode: false,
        includeSeries: false,
        page: 1,
        pageSize: 1000,
        seriesIds: [9],
      })
    })

    it('carries errorMessage and episodeHasFile through', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: {
          records: [
            {
              episodeHasFile: true,
              errorMessage: 'Unpacking failed',
              id: 1,
              seriesId: 9,
              status: 'failed',
            },
            // Sonarr omits a null errorMessage.
            { episodeHasFile: false, id: 2, seriesId: 9, status: 'queued' },
          ],
          totalRecords: 2,
        },
      })

      const [failed, queued] = await service.getQueue()

      expect(failed).toMatchObject({
        episodeHasFile: true,
        errorMessage: 'Unpacking failed',
      })
      expect(queued?.episodeHasFile).toBe(false)
      expect(queued?.errorMessage).toBeUndefined()
    })

    it('throws a descriptive error when a page fails', async () => {
      mockGetApiV3Queue
        .mockResolvedValueOnce({
          data: { records: [{ id: 1 }], totalRecords: 2 },
        })
        .mockResolvedValueOnce({ error: { message: 'boom' } })

      await expect(service.getQueue()).rejects.toThrow('getQueue failed')
    })
  })

  describe('unmonitorAndDelete', () => {
    it('cancels in-progress queue items then deletes the series', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [{ id: 1 }, { id: 2 }] },
      })
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      await service.unmonitorAndDelete(9, true)

      expect(deleteApiV3QueueById).toHaveBeenCalledTimes(2)
      expect(deleteApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 9 },
          query: { deleteFiles: true, addImportListExclusion: false },
        }),
      )
    })

    it('throws when the delete call itself fails', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockDeleteApiV3SeriesById.mockResolvedValue({
        error: { message: 'not found' },
        response: { status: 404 },
      })

      await expect(service.unmonitorAndDelete(9)).rejects.toThrow(
        'deleteSeries failed',
      )
    })
  })

  describe('getManualImportCandidates', () => {
    // Sonarr v4 ignores `downloadId` whenever `seriesId` is sent and lists
    // the series' library files instead; v5 ignores `seasonNumber`. Only
    // `downloadId` behaves on both, so it is the whole scope.
    it('asks by downloadId alone, filtering existing files', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [{ id: 1 }] })

      const result = await service.getManualImportCandidates('abc123')

      const { query } = mockGetApiV3Manualimport.mock.calls[0][0]
      expect(query).toEqual({ downloadId: 'abc123', filterExistingFiles: true })
      expect(query).not.toHaveProperty('seriesId')
      expect(query).not.toHaveProperty('seasonNumber')
      expect(result).toEqual([{ id: 1 }])
    })

    it('returns an empty array when Sonarr offers no candidates', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [] })

      await expect(
        service.getManualImportCandidates('abc123'),
      ).resolves.toEqual([])
    })

    it('keeps a candidate with no parsed episodes untouched', async () => {
      const candidate = { episodes: [], id: 1, path: '/downloads/pack' }
      mockGetApiV3Manualimport.mockResolvedValue({ data: [candidate] })

      const result = await service.getManualImportCandidates('abc123')

      expect(result).toEqual([candidate])
    })

    it('throws when Sonarr rejects the lookup', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.getManualImportCandidates('abc123')).rejects.toThrow(
        'getManualImportCandidates failed',
      )
    })
  })

  describe('commitManualImport', () => {
    const file: SonarrManualImportFile = {
      downloadId: 'abc123',
      episodeIds: [4412],
      folderName: 'Some.Show.S01E01',
      path: '/downloads/Some.Show.S01E01/file.mkv',
      quality: { quality: { id: 4, name: 'HDTV-720p' } },
      seriesId: 9,
    }

    it('posts a ManualImport command with importMode auto and the files untouched', async () => {
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      await service.commitManualImport([file])

      expect(mockPostApiV3Command.mock.calls[0][0].body).toEqual({
        files: [file],
        importMode: 'auto',
        name: 'ManualImport',
      })
    })

    it('throws before calling Sonarr when given no files', async () => {
      await expect(service.commitManualImport([])).rejects.toThrow(
        'commitManualImport requires at least one file',
      )

      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('surfaces an upstream failure with its own context', async () => {
      mockPostApiV3Command.mockResolvedValue({
        error: { message: 'no such series' },
        response: { status: 400 },
      })

      await expect(service.commitManualImport([file])).rejects.toThrow(
        'commitManualImport failed: {"message":"no such series"}',
      )
    })
  })

  describe('removeQueueItem', () => {
    it('deletes the queue row without blocklisting or redownloading', async () => {
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })

      await service.removeQueueItem(77)

      expect(deleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 77 },
          query: {
            blocklist: false,
            removeFromClient: true,
            skipRedownload: true,
          },
        }),
      )
    })

    it('throws when Sonarr refuses the delete', async () => {
      mockDeleteApiV3QueueById.mockResolvedValue({
        error: { message: 'not found' },
        response: { status: 404 },
      })

      await expect(service.removeQueueItem(77)).rejects.toThrow(
        'removeQueueItem failed',
      )
    })
  })
})

describe('toShow', () => {
  const series: SeriesResource = {
    alternateTitles: [
      { seasonNumber: -1, title: 'Shingeki no Kyojin' },
      { seasonNumber: 1, title: 'shingeki no kyojin' },
      { title: 'Attack on Titan' },
      { title: '  ' },
    ],
    id: 9,
    imdbId: 'tt2560140',
    lastAired: '2023-11-05T00:00:00Z',
    network: 'NHK',
    originalLanguage: { id: 8, name: 'Japanese' },
    seriesType: 'anime',
    statistics: { sizeOnDisk: 67_477_969_060 },
    status: 'ended',
    title: 'Attack on Titan',
    tmdbId: 1429,
    tvMazeId: 919,
    tvdbId: 267440,
  }

  it('maps the series details', () => {
    expect(toShow(series)).toMatchObject({
      alternateTitles: ['Shingeki no Kyojin'],
      imdbId: 'tt2560140',
      lastAired: '2023-11-05T00:00:00Z',
      network: 'NHK',
      originalLanguage: 'Japanese',
      seriesType: 'anime',
      sizeOnDisk: 67_477_969_060,
      status: 'ended',
      tmdbId: 1429,
      tvMazeId: 919,
    })
  })

  it('leaves out what only restates the default or the unknown', () => {
    const show = toShow({
      ...series,
      alternateTitles: [],
      imdbId: '',
      network: null,
      originalLanguage: { id: 0, name: 'Unknown' },
      seriesType: 'standard',
      status: 'deleted',
      tmdbId: 0,
      tvMazeId: 0,
    })

    expect(show.alternateTitles).toBeUndefined()
    expect(show.imdbId).toBeUndefined()
    expect(show.network).toBeUndefined()
    expect(show.originalLanguage).toBeUndefined()
    expect(show.seriesType).toBeUndefined()
    expect(show.status).toBeUndefined()
    expect(show.tmdbId).toBeUndefined()
    expect(show.tvMazeId).toBeUndefined()
  })

  // Sonarr zeroes a lookup hit's statistics, and a series outside the
  // library has no folder to measure.
  it('reports a size for a library series only', () => {
    expect(toShow({ ...series, id: 0 }).sizeOnDisk).toBeUndefined()
    expect(toLookupShow(series).sizeOnDisk).toBeUndefined()
  })
})

describe('toEpisode', () => {
  const episode: EpisodeResource = {
    episodeNumber: 1,
    id: 1,
    seasonNumber: 1,
  }

  it('drops a finale type it does not know', () => {
    expect(toEpisode({ ...episode, finaleType: 'weird' }).finaleType).toBe(
      undefined,
    )
  })

  it('treats a zero absolute number as none', () => {
    expect(
      toEpisode({ ...episode, absoluteEpisodeNumber: 0 }).absoluteEpisodeNumber,
    ).toBeUndefined()
  })

  it('never falls back to the UTC air date', () => {
    expect(
      toEpisode({ ...episode, airDateUtc: '2026-05-18T00:00:00Z' }).airDate,
    ).toBeUndefined()
  })
})

describe('toRelease', () => {
  it('maps what Sonarr mapped the release to, beside the parsed numbers', () => {
    const release = toRelease({
      episodeNumbers: [13],
      mappedEpisodeNumbers: [1],
      mappedSeasonNumber: 2,
      mappedSeriesId: 9,
      seasonNumber: 1,
    })

    expect(release).toMatchObject({
      episodeNumbers: [13],
      mappedEpisodeNumbers: [1],
      mappedSeasonNumber: 2,
      mappedSeriesId: 9,
      seasonNumber: 1,
    })
  })

  // Season 0 is specials - a falsy mapped season that must survive.
  it('keeps a mapped season 0', () => {
    expect(toRelease({ mappedSeasonNumber: 0 }).mappedSeasonNumber).toBe(0)
  })

  it('leaves the mapped fields undefined when Sonarr could not map it', () => {
    const release = toRelease({ episodeNumbers: [1], seasonNumber: 1 })

    expect(release.mappedEpisodeNumbers).toBeUndefined()
    expect(release.mappedSeasonNumber).toBeUndefined()
    expect(release.mappedSeriesId).toBeUndefined()
  })
})

describe('toSonarrReleaseScope', () => {
  it('keeps an episode scope, with or without its season', () => {
    expect(toSonarrReleaseScope({ episodeId: 4412 })).toEqual({
      episodeId: 4412,
    })
    expect(toSonarrReleaseScope({ episodeId: 4412, seasonNumber: 2 })).toEqual({
      episodeId: 4412,
      seasonNumber: 2,
    })
  })

  // Season 0 is Sonarr's specials - a real scope, not an absent one.
  it('keeps a season scope, season 0 included', () => {
    expect(toSonarrReleaseScope({ seasonNumber: 0 })).toEqual({
      seasonNumber: 0,
    })
    expect(toSonarrReleaseScope({ seasonNumber: 3 })).toEqual({
      seasonNumber: 3,
    })
  })

  it('answers undefined for a scope that names neither', () => {
    expect(toSonarrReleaseScope({})).toBeUndefined()
    expect(
      toSonarrReleaseScope({ episodeId: undefined, seasonNumber: undefined }),
    ).toBeUndefined()
  })
})
