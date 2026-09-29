import {
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  type Release,
  type ShowScope,
} from '@lilnas/utils/download/types'

import { createTestDb, type TestDb } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import type { CommandRef } from 'src/media/arr-command.types'
import { mediaMutex } from 'src/media/keyed-mutex.util'
import type { RadarrService } from 'src/media/radarr.service'
import type { SonarrService } from 'src/media/sonarr.service'
import {
  NO_USABLE_RELEASE_NOTE,
  startSearch,
  type StartSearchDeps,
} from 'src/media/start-search'

const NOW_ISO = '2026-09-28T12:00:00.000Z'
const NOW_MS = Date.parse(NOW_ISO)

function buildJob(
  type: DownloadType,
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    mediaId: type === DownloadType.Movie ? 'tmdb:550' : 'tvdb:81189',
    requester: null,
    status: DownloadJobStatus.Searching,
    type,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

function commandRef(name: string): CommandRef {
  return { id: 77, name, queuedAt: NOW_ISO }
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    downloadAllowed: true,
    flaggedBad: false,
    guid: 'indexer://a',
    indexerId: 1,
    rejected: false,
    title: 'A release',
    ...overrides,
  }
}

function episode(
  seasonNumber: number,
  episodeNumber: number,
  overrides: { hasFile?: boolean; id?: number; monitored?: boolean } = {},
) {
  return {
    episodeNumber,
    hasFile: false,
    id: seasonNumber * 100 + episodeNumber,
    monitored: true,
    seasonNumber,
    ...overrides,
  }
}

describe('startSearch', () => {
  let testDb: TestDb
  let radarrService: {
    getLibraryMovie: jest.Mock
    getReleases: jest.Mock
    grabRelease: jest.Mock
    triggerSearch: jest.Mock
  }
  let sonarrService: {
    getEpisodes: jest.Mock
    getLibraryShow: jest.Mock
    getReleases: jest.Mock
    grabRelease: jest.Mock
    monitorScope: jest.Mock
    resolveScope: jest.Mock
    triggerEpisodeSearch: jest.Mock
    triggerSearch: jest.Mock
    triggerSeasonSearch: jest.Mock
  }
  let deps: StartSearchDeps

  function flag(mediaId: string, releaseGuid = 'indexer://bad') {
    insertBadFile(testDb.db, {
      flaggedByEmail: 'alice@example.com',
      flaggedByUserId: 'user_1',
      mediaId,
      mediaType: mediaId.startsWith('tmdb:')
        ? DownloadType.Movie
        : DownloadType.Show,
      releaseGuid,
    })
  }

  beforeEach(() => {
    testDb = createTestDb()
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS)
    radarrService = {
      getLibraryMovie: jest.fn().mockResolvedValue({ radarrId: 42 }),
      getReleases: jest.fn().mockResolvedValue([]),
      grabRelease: jest.fn().mockResolvedValue(undefined),
      triggerSearch: jest.fn().mockResolvedValue(commandRef('MoviesSearch')),
    }
    sonarrService = {
      getEpisodes: jest.fn().mockResolvedValue([]),
      getLibraryShow: jest.fn().mockResolvedValue({ sonarrId: 9 }),
      getReleases: jest.fn().mockResolvedValue([]),
      grabRelease: jest.fn().mockResolvedValue(undefined),
      monitorScope: jest.fn().mockResolvedValue(undefined),
      // The real one fills in the display fields for an episode id.
      resolveScope: jest.fn(async (scope: ShowScope) => ({
        episodeId: scope.episodeId,
        episodeNumber: 5,
        seasonNumber: 3,
      })),
      triggerEpisodeSearch: jest
        .fn()
        .mockResolvedValue(commandRef('EpisodeSearch')),
      triggerSearch: jest.fn().mockResolvedValue(commandRef('SeriesSearch')),
      triggerSeasonSearch: jest
        .fn()
        .mockResolvedValue(commandRef('SeasonSearch')),
    }
    deps = {
      db: testDb.db,
      logger: { log: jest.fn(), warn: jest.fn() },
      radarrService: radarrService as unknown as RadarrService,
      sonarrService: sonarrService as unknown as SonarrService,
    }
  })

  afterEach(() => {
    testDb.close()
    jest.restoreAllMocks()
  })

  describe('a movie', () => {
    it('searches by the Radarr id it is given', async () => {
      const result = await startSearch(deps, buildJob(DownloadType.Movie), 42)

      expect(result).toEqual({
        command: commandRef('MoviesSearch'),
        outcome: 'search',
      })
      expect(radarrService.triggerSearch).toHaveBeenCalledWith(42)
      expect(radarrService.getLibraryMovie).not.toHaveBeenCalled()
    })

    it('reads the Radarr id off the library when it is not given', async () => {
      radarrService.getLibraryMovie.mockResolvedValue({ radarrId: 43 })

      await startSearch(deps, buildJob(DownloadType.Movie))

      expect(radarrService.getLibraryMovie).toHaveBeenCalledWith(550)
      expect(radarrService.triggerSearch).toHaveBeenCalledWith(43)
    })

    it('throws for a title the library does not hold', async () => {
      radarrService.getLibraryMovie.mockResolvedValue(undefined)

      await expect(
        startSearch(deps, buildJob(DownloadType.Movie)),
      ).rejects.toThrow('tmdb:550 is not in the library')
      expect(radarrService.triggerSearch).not.toHaveBeenCalled()
    })

    describe('with flagged releases', () => {
      beforeEach(() => flag('tmdb:550'))

      it('grabs the first eligible release instead of searching', async () => {
        radarrService.getReleases.mockResolvedValue([
          release({ guid: 'indexer://bad' }),
          release({ guid: 'indexer://rejected', rejected: true }),
          release({ guid: 'indexer://ok', indexerId: 3 }),
        ])

        const result = await startSearch(deps, buildJob(DownloadType.Movie), 42)

        expect(result).toEqual({
          grabbedAt: NOW_ISO,
          guids: ['indexer://ok'],
          outcome: 'grabbed',
        })
        expect(radarrService.getReleases).toHaveBeenCalledWith(42)
        expect(radarrService.grabRelease).toHaveBeenCalledWith(
          'indexer://ok',
          3,
        )
        expect(radarrService.triggerSearch).not.toHaveBeenCalled()
      })

      it.each([
        [
          'every result is flagged or rejected',
          [release({ guid: 'indexer://bad' })],
        ],
        ['the indexers returned nothing', []],
      ])('is not_found, with the note, when %s', async (_label, releases) => {
        radarrService.getReleases.mockResolvedValue(releases)

        const result = await startSearch(deps, buildJob(DownloadType.Movie), 42)

        expect(result).toEqual({
          outcome: 'not_found',
          statusNote: NO_USABLE_RELEASE_NOTE,
        })
        expect(radarrService.grabRelease).not.toHaveBeenCalled()
      })

      it("ignores another title's flags", async () => {
        const result = await startSearch(
          deps,
          buildJob(DownloadType.Movie, { mediaId: 'tmdb:551' }),
          42,
        )

        expect(result.outcome).toBe('search')
        expect(radarrService.getReleases).not.toHaveBeenCalled()
      })
    })
  })

  describe('a show', () => {
    it.each<[string, ShowScope | undefined, () => void]>([
      [
        'one episode',
        { episodeId: 501, seasonNumber: 2 },
        () =>
          expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([
            501,
          ]),
      ],
      [
        'one season',
        { seasonNumber: 3 },
        () =>
          expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(9, 3),
      ],
      [
        'the specials season',
        { seasonNumber: 0 },
        () =>
          expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(9, 0),
      ],
      [
        'the whole series',
        undefined,
        () => expect(sonarrService.triggerSearch).toHaveBeenCalledWith(9),
      ],
    ])('searches for %s', async (_label, scope, assertSent) => {
      await startSearch(
        deps,
        buildJob(DownloadType.Show, scope ? { scope } : {}),
        9,
      )

      assertSent()
      const sent = [
        sonarrService.triggerEpisodeSearch,
        sonarrService.triggerSeasonSearch,
        sonarrService.triggerSearch,
      ].filter(trigger => trigger.mock.calls.length > 0)
      expect(sent).toHaveLength(1)
    })

    it('reads the Sonarr id off the library when it is not given', async () => {
      await startSearch(
        deps,
        buildJob(DownloadType.Show, { scope: { seasonNumber: 1 } }),
      )

      expect(sonarrService.getLibraryShow).toHaveBeenCalledWith(81189)
      expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(9, 1)
    })

    it('monitors the scope, under the title lock, before searching', async () => {
      const run = jest.spyOn(mediaMutex, 'run')

      await startSearch(
        deps,
        buildJob(DownloadType.Show, { scope: { seasonNumber: 2 } }),
        9,
      )

      expect(sonarrService.monitorScope).toHaveBeenCalledWith(9, {
        seasonNumber: 2,
      })
      expect(run).toHaveBeenCalledWith('tvdb:81189', expect.any(Function))
      expect(
        sonarrService.monitorScope.mock.invocationCallOrder[0],
      ).toBeLessThan(
        sonarrService.triggerSeasonSearch.mock.invocationCallOrder[0] ?? 0,
      )
    })

    it('monitors the whole series for a job with no scope', async () => {
      const result = await startSearch(deps, buildJob(DownloadType.Show), 9)

      expect(sonarrService.monitorScope).toHaveBeenCalledWith(9, {})
      expect(result).toEqual({
        command: commandRef('SeriesSearch'),
        outcome: 'search',
      })
    })

    it('hands back the resolved scope of an episode id', async () => {
      const result = await startSearch(
        deps,
        buildJob(DownloadType.Show, { scope: { episodeId: 501 } }),
        9,
      )

      const resolved = { episodeId: 501, episodeNumber: 5, seasonNumber: 3 }
      expect(result).toEqual({
        command: commandRef('EpisodeSearch'),
        outcome: 'search',
        scope: resolved,
      })
      expect(sonarrService.monitorScope).toHaveBeenCalledWith(9, resolved)
    })

    it('does not search when the monitor write fails', async () => {
      sonarrService.monitorScope.mockRejectedValue(new Error('sonarr down'))

      await expect(
        startSearch(
          deps,
          buildJob(DownloadType.Show, { scope: { seasonNumber: 2 } }),
          9,
        ),
      ).rejects.toThrow('sonarr down')
      expect(sonarrService.triggerSeasonSearch).not.toHaveBeenCalled()
    })

    describe('an episode asked for by number', () => {
      beforeEach(() => {
        sonarrService.getEpisodes.mockResolvedValue([
          episode(2, 4, { id: 804 }),
          episode(2, 5, { id: 805 }),
        ])
      })

      it('resolves it to its episode id, then monitors and searches that', async () => {
        const result = await startSearch(
          deps,
          buildJob(DownloadType.Show, {
            scope: { episodeNumber: 5, seasonNumber: 2 },
          }),
          9,
        )

        const resolved = { episodeId: 805, episodeNumber: 5, seasonNumber: 2 }
        expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9, {
          seasonNumber: 2,
        })
        expect(sonarrService.monitorScope).toHaveBeenCalledWith(9, resolved)
        expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([805])
        expect(result).toEqual({
          command: commandRef('EpisodeSearch'),
          outcome: 'search',
          scope: resolved,
        })
      })

      it("fails, zero-padded, when Sonarr doesn't have it", async () => {
        const result = await startSearch(
          deps,
          buildJob(DownloadType.Show, {
            scope: { episodeNumber: 9, seasonNumber: 2 },
          }),
          9,
        )

        expect(result).toEqual({
          error: "S02E09 isn't in Sonarr",
          outcome: 'failed',
        })
        expect(sonarrService.monitorScope).not.toHaveBeenCalled()
        expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
      })

      // Season 0 is the specials - `!= null`, never truthiness.
      it('resolves a season-0 episode', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          episode(0, 1, { id: 1001 }),
        ])

        const result = await startSearch(
          deps,
          buildJob(DownloadType.Show, {
            scope: { episodeNumber: 1, seasonNumber: 0 },
          }),
          9,
        )

        expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([1001])
        expect(result.scope).toEqual({
          episodeId: 1001,
          episodeNumber: 1,
          seasonNumber: 0,
        })
      })
    })

    describe('with flagged releases', () => {
      beforeEach(() => flag('tvdb:81189'))

      it('grabs the best unflagged release for an episode', async () => {
        sonarrService.getReleases.mockResolvedValue([
          release({ guid: 'indexer://bad' }),
          release({ guid: 'indexer://ok' }),
        ])

        const result = await startSearch(
          deps,
          buildJob(DownloadType.Show, { scope: { episodeId: 501 } }),
          9,
        )

        expect(sonarrService.getReleases).toHaveBeenCalledWith(9, {
          episodeId: 501,
          seasonNumber: 3,
        })
        expect(sonarrService.grabRelease).toHaveBeenCalledWith(
          'indexer://ok',
          1,
        )
        expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
        expect(result).toEqual({
          grabbedAt: NOW_ISO,
          guids: ['indexer://ok'],
          outcome: 'grabbed',
          scope: { episodeId: 501, episodeNumber: 5, seasonNumber: 3 },
        })
      })

      it('picks a season against its missing episodes, after monitoring it', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          episode(2, 1),
          episode(2, 2, { hasFile: true }),
        ])
        sonarrService.getReleases.mockResolvedValue([
          release({ episodeNumbers: [2], guid: 'indexer://has-file' }),
          release({ episodeNumbers: [1], guid: 'indexer://e01' }),
        ])

        const result = await startSearch(
          deps,
          buildJob(DownloadType.Show, { scope: { seasonNumber: 2 } }),
          9,
        )

        expect(sonarrService.grabRelease.mock.calls).toEqual([
          ['indexer://e01', 1],
        ])
        expect(result.outcome).toBe('grabbed')
        expect(
          sonarrService.monitorScope.mock.invocationCallOrder[0],
        ).toBeLessThan(
          sonarrService.getEpisodes.mock.invocationCallOrder[0] ?? 0,
        )
      })

      it('is not_found, with the note, when nothing covers a missing episode', async () => {
        sonarrService.getEpisodes.mockResolvedValue([episode(2, 1)])
        sonarrService.getReleases.mockResolvedValue([
          release({ episodeNumbers: [1], guid: 'indexer://bad' }),
        ])

        const result = await startSearch(
          deps,
          buildJob(DownloadType.Show, { scope: { seasonNumber: 2 } }),
          9,
        )

        expect(result).toEqual({
          outcome: 'not_found',
          scope: { seasonNumber: 2 },
          statusNote: NO_USABLE_RELEASE_NOTE,
        })
        expect(sonarrService.grabRelease).not.toHaveBeenCalled()
      })

      describe('the whole series', () => {
        beforeEach(() => {
          sonarrService.getEpisodes.mockResolvedValue([
            // Missing specials - a whole-show job never covers them.
            episode(0, 1),
            episode(1, 1),
            episode(2, 1),
            episode(3, 1, { hasFile: true }),
          ])
          sonarrService.getReleases.mockImplementation(
            async (_id: number, scope: { seasonNumber?: number }) =>
              scope.seasonNumber === 1
                ? [release({ episodeNumbers: [1], guid: 'indexer://s01e01' })]
                : [release({ fullSeason: true, guid: 'indexer://bad' })],
          )
        })

        it('searches and grabs season by season', async () => {
          const result = await startSearch(deps, buildJob(DownloadType.Show), 9)

          expect(sonarrService.getReleases.mock.calls).toEqual([
            [9, { seasonNumber: 1 }],
            [9, { seasonNumber: 2 }],
          ])
          expect(result).toEqual({
            grabbedAt: NOW_ISO,
            guids: ['indexer://s01e01'],
            outcome: 'grabbed',
          })
        })

        it('is not_found, with the note, when no season yields a grab', async () => {
          sonarrService.getReleases
            .mockReset()
            .mockRejectedValueOnce(new Error('indexer down'))
            .mockResolvedValueOnce([release({ guid: 'indexer://bad' })])

          const result = await startSearch(deps, buildJob(DownloadType.Show), 9)

          expect(result).toEqual({
            outcome: 'not_found',
            statusNote: NO_USABLE_RELEASE_NOTE,
          })
          expect(deps.logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'indexer down', seasonNumber: 1 }),
            expect.any(String),
          )
        })

        it('throws when every season search failed', async () => {
          sonarrService.getReleases
            .mockReset()
            .mockRejectedValue(new Error('indexer down'))

          await expect(
            startSearch(deps, buildJob(DownloadType.Show), 9),
          ).rejects.toThrow('Could not search any season of tvdb:81189')
        })

        it('is not_found, with no note, when nothing is missing', async () => {
          sonarrService.getEpisodes.mockResolvedValue([
            episode(0, 1),
            episode(1, 1, { hasFile: true }),
          ])

          const result = await startSearch(deps, buildJob(DownloadType.Show), 9)

          expect(result).toEqual({ outcome: 'not_found' })
          expect(sonarrService.getReleases).not.toHaveBeenCalled()
        })
      })
    })
  })

  it('throws for a video job', async () => {
    await expect(
      startSearch(deps, buildJob(DownloadType.Video, { mediaId: 'video:abc' })),
    ).rejects.toThrow('has no upstream search')
  })

  it('logs what it started', async () => {
    await startSearch(deps, buildJob(DownloadType.Movie), 42)

    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'startSearch',
        commandId: 77,
        jobId: 'job-1',
        outcome: 'search',
      }),
      'Started an upstream search',
    )
  })
})
