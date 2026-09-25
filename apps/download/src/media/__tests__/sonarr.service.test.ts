import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3EpisodefileById: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3EpisodeById: jest.fn(),
  getApiV3Episodefile: jest.fn(),
  getApiV3HistorySeries: jest.fn(),
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
}))

import {
  deleteApiV3EpisodefileById,
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3Episodefile,
  getApiV3HistorySeries,
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
} from '@lilnas/media/sonarr'

import { SONARR_CLIENT } from 'src/media/clients'
import {
  type SonarrManualImportFile,
  SonarrService,
} from 'src/media/sonarr.service'

const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.Mock
const mockGetApiV3Qualityprofile = getApiV3Qualityprofile as jest.Mock
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

  describe('requestShow', () => {
    it('triggers a search directly when the series is already in the library', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [
          {
            id: 9,
            images: [],
            monitored: true,
            title: 'Existing Show',
            tvdbId: 456,
          },
        ],
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      const result = await service.requestShow(456)

      expect(postApiV3Series).not.toHaveBeenCalled()
      // An already-monitored title is left strictly alone, and requestShow
      // passes no `monitorEpisodes` scope - so a user who has monitored only
      // season 3 does not silently get all ten seasons switched on.
      expect(putApiV3SeriesById).not.toHaveBeenCalled()
      expect(getApiV3Episode).not.toHaveBeenCalled()
      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'SeriesSearch', seriesId: 9 },
        }),
      )
      expect(result).toEqual({
        posterUrl: undefined,
        sonarrId: 9,
        title: 'Existing Show',
      })
    })

    it('looks up, adds, and triggers a search for a new series', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          { tvdbId: 456, title: 'New Show', titleSlug: 'new-show' },
          { tvdbId: 999, title: 'Different Show', titleSlug: 'different' },
        ],
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 2, name: 'Any' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/tv', accessible: true }],
      })
      mockPostApiV3Series.mockResolvedValue({
        data: {
          id: 77,
          tvdbId: 456,
          title: 'New Show',
          images: [{ coverType: 'poster', remoteUrl: 'remote-poster.jpg' }],
        },
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      const result = await service.requestShow(456)

      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tvdbId: 456,
            title: 'New Show',
            titleSlug: 'new-show',
            qualityProfileId: 2,
            rootFolderPath: '/tv',
            monitored: true,
          }),
        }),
      )
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'SeriesSearch', seriesId: 77 },
        }),
      )
      expect(result).toEqual({
        posterUrl: 'remote-poster.jpg',
        sonarrId: 77,
        title: 'New Show',
      })
    })

    it('throws when the series cannot be found in Sonarr search results', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [] })

      await expect(service.requestShow(456)).rejects.toThrow(
        'Series with TVDB ID 456 not found',
      )
    })

    it('prefers the "Any" quality profile when one exists', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{ tvdbId: 456, title: 'New Show' }],
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [
          { id: 1, name: 'HD-1080p' },
          { id: 2, name: 'Any' },
        ],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/tv', accessible: true }],
      })
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, tvdbId: 456, title: 'New Show', images: [] },
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      await service.requestShow(456)

      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ qualityProfileId: 2 }),
        }),
      )
    })
  })

  describe('ensureSeries', () => {
    it('touches nothing when the series is already in the library and monitored', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })

      const result = await service.ensureSeries(456)

      expect(result).toMatchObject({
        sonarrId: 9,
        turnedOnEpisodeIds: [],
        wasMonitored: true,
      })
      expect(postApiV3Series).not.toHaveBeenCalled()
      expect(putApiV3SeriesById).not.toHaveBeenCalled()
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('flips series-level monitoring on for a library series that is unmonitored, and re-monitors every episode', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: false, tvdbId: 456 }],
      })
      mockGetApiV3SeriesById.mockResolvedValue({
        data: { id: 9, monitored: false, qualityProfileId: 2, tvdbId: 456 },
      })
      mockPutApiV3SeriesById.mockResolvedValue({ data: {} })
      mockGetApiV3Episode.mockResolvedValue({
        data: [
          { id: 100, monitored: false, seasonNumber: 1 },
          { id: 101, monitored: false, seasonNumber: 2 },
        ],
      })
      mockPutApiV3EpisodeMonitor.mockResolvedValue({ data: {} })

      const result = await service.ensureSeries(456)

      expect(result).toMatchObject({
        sonarrId: 9,
        turnedOnEpisodeIds: [100, 101],
        wasMonitored: false,
      })
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: true }),
          path: { id: '9' },
        }),
      )
      // No `monitorEpisodes` scope was given, so this must widen to the
      // whole series the same way an empty scope does everywhere else -
      // otherwise a series brought back from a whole-series delete would
      // have its row re-monitored but every episode still off, and Sonarr's
      // `SeriesSearch` finds nothing to grab.
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { episodeIds: [100, 101], monitored: true },
        }),
      )
    })

    it('adds an absent series monitored, without searching for it', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{ title: 'New Show', titleSlug: 'new-show', tvdbId: 456 }],
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 2, name: 'Any' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ accessible: true, id: 1, path: '/tv' }],
      })
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, monitored: true, title: 'New Show', tvdbId: 456 },
      })

      const result = await service.ensureSeries(456)

      expect(result).toMatchObject({
        sonarrId: 77,
        // `monitor: 'all'` already covered every episode, so this call turned
        // nothing on individually and a restore has nothing episode-level to
        // undo.
        turnedOnEpisodeIds: [],
        wasMonitored: false,
      })
      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            addOptions: {
              monitor: 'all',
              // Both false - the search moved to the explicit SeriesSearch
              // command, so browsing releases for a not-yet-added show no
              // longer kicks off a series-wide grab as a side effect.
              searchForCutoffUnmetEpisodes: false,
              searchForMissingEpisodes: false,
            },
            monitored: true,
          }),
        }),
      )
      expect(postApiV3Command).not.toHaveBeenCalled()
    })

    it('monitors only the unmonitored episodes in the requested season, and reports just those', async () => {
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

      const result = await service.ensureSeries(456, {
        monitorEpisodes: { seasonNumber: 2 },
      })

      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { seasonNumber: 2, seriesId: 9 } }),
      )
      // Episode 100 was already on - restoring it to unmonitored later would
      // clobber a choice the user made, so it is deliberately not in the set.
      expect(result.turnedOnEpisodeIds).toEqual([101, 102])
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

      const result = await service.ensureSeries(456, {
        monitorEpisodes: { episodeId: 101, seasonNumber: 2 },
      })

      expect(result.turnedOnEpisodeIds).toEqual([101])
    })

    it('makes no monitor call when every scoped episode is already monitored', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })
      mockGetApiV3Episode.mockResolvedValue({
        data: [{ id: 100, monitored: true, seasonNumber: 2 }],
      })

      const result = await service.ensureSeries(456, {
        monitorEpisodes: { seasonNumber: 2 },
      })

      expect(result.turnedOnEpisodeIds).toEqual([])
      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
    })

    it('skips the episode pass entirely when no scope is given', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, monitored: true, tvdbId: 456 }],
      })

      await service.ensureSeries(456)

      expect(getApiV3Episode).not.toHaveBeenCalled()
    })

    it('throws when Sonarr returns a library series with no id', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [{ tvdbId: 456 }] })

      await expect(service.ensureSeries(456)).rejects.toThrow(
        'Sonarr did not return an id for series tvdbId=456',
      )
    })

    it('throws when the series cannot be found in Sonarr search results', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [] })

      await expect(service.ensureSeries(456)).rejects.toThrow(
        'Series with TVDB ID 456 not found',
      )
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

    it("'all' touches every season, specials included", async () => {
      const changed = await service.setSeasonsMonitored(9, 'all', true)

      expect(changed).toEqual([0, 1, 3])
      expect(putApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            seasons: seasons.map(season => ({ ...season, monitored: true })),
          }),
        }),
      )
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
            airDateUtc: '2004-12-19T02:00:00Z',
            episodeFileId: 991,
            episodeNumber: 1,
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
              airDate: '2004-12-19T02:00:00Z',
              episodeFileId: 991,
              episodeNumber: 1,
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

    // An empty scope means the whole series, matching how the monitoring
    // borrow widens on the way in.
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
            protocol: 'usenet',
            quality: { quality: { name: 'WEBDL-1080p', resolution: 1080 } },
            rejected: false,
            seasonNumber: 2,
            seeders: 10,
            title: 'Some.Show.S02.1080p',
          },
        ],
      })

      const [result] = await service.getReleases(9)

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
      mockGetApiV3Release.mockResolvedValue({ data: [{}] })

      const [result] = await service.getReleases(9)

      expect(result?.episodeNumbers).toBeUndefined()
      expect(result?.fullSeason).toBeUndefined()
      expect(result?.seasonNumber).toBeUndefined()
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

    it('omits both scope params when neither is given', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [] })

      await service.getReleases(9)

      expect(mockGetApiV3Release.mock.calls[0][0].query).toEqual({
        seriesId: 9,
      })
    })

    it('returns an empty list when the indexer search found nothing', async () => {
      mockGetApiV3Release.mockResolvedValue({ data: [] })

      await expect(service.getReleases(9)).resolves.toEqual([])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3Release.mockResolvedValue({ error: { message: 'boom' } })

      await expect(service.getReleases(9)).rejects.toThrow('getReleases failed')
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
    it('scopes the query to the download and series, filtering existing files', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [{ id: 1 }] })

      const result = await service.getManualImportCandidates('abc123', 9)

      expect(mockGetApiV3Manualimport.mock.calls[0][0].query).toEqual({
        downloadId: 'abc123',
        filterExistingFiles: true,
        seriesId: 9,
      })
      expect(result).toEqual([{ id: 1 }])
    })

    // Season 0 is specials - a falsy season number that must still be sent.
    it('forwards season 0 as a real season number', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [] })

      await service.getManualImportCandidates('abc123', 9, 0)

      expect(mockGetApiV3Manualimport.mock.calls[0][0].query).toEqual({
        downloadId: 'abc123',
        filterExistingFiles: true,
        seasonNumber: 0,
        seriesId: 9,
      })
    })

    it('omits seasonNumber entirely when the caller passed none', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [] })

      await service.getManualImportCandidates('abc123', 9, undefined)

      expect(
        mockGetApiV3Manualimport.mock.calls[0][0].query,
      ).not.toHaveProperty('seasonNumber')
    })

    it('returns an empty array when Sonarr offers no candidates', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({ data: [] })

      await expect(
        service.getManualImportCandidates('abc123', 9),
      ).resolves.toEqual([])
    })

    it('keeps a candidate with no parsed episodes untouched', async () => {
      const candidate = { episodes: [], id: 1, path: '/downloads/pack' }
      mockGetApiV3Manualimport.mockResolvedValue({ data: [candidate] })

      const result = await service.getManualImportCandidates('abc123', 9)

      expect(result).toEqual([candidate])
    })

    it('throws when Sonarr rejects the lookup', async () => {
      mockGetApiV3Manualimport.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(
        service.getManualImportCandidates('abc123', 9),
      ).rejects.toThrow('getManualImportCandidates failed')
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
