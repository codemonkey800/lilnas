// nanoid v5 ships ESM-only; DownloadStateService and MediaDownloadService pull
// it in (see media-poller.service.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type { QueueResource } from '@lilnas/media/radarr'
import {
  DownloadJobStatus,
  DownloadType,
  type Movie,
  type Release,
  type Show,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { nanoid } from 'nanoid'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { getJobById } from 'src/db/jobs.repo'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { EmbyStatusService } from 'src/emby/emby-status.service'
import { flushAsync } from 'src/media/__tests__/helpers/fake-media-resolver'
import type { CommandRef, CommandSnapshot } from 'src/media/arr-command.types'
import {
  ADD_REFRESH_NOTES,
  MediaDownloadService,
} from 'src/media/media-download.service'
import { MediaPollerService } from 'src/media/media-poller.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'
import { NO_USABLE_RELEASE_NOTE } from 'src/media/start-search'

/**
 * A first-time Download of a title Radarr/Sonarr don't hold yet, with the
 * request path, the poller, the resolver (and its library cache), the state
 * annotator and the job store all real - only Radarr, Sonarr, Emby and the
 * socket are stubbed.
 *
 * The page was open before the click, so the resolver's library cache was
 * filled without the title. `ensureMovie` adds it; unless the resolver
 * forgets that copy, the job's media resolves from the discover lookup (no
 * `radarrId`) and the poller - which tracks a job by that id - can't follow
 * it until the cache expires a minute later.
 *
 * A fresh add never searches on the request: the job waits on the add-time
 * refresh (kind `refresh`), and the poller starts the search once that has
 * finished. A title already in the library is searched at once - unless
 * Radarr/Sonarr are still refreshing it (an earlier request added it
 * moments ago), when it waits on that refresh the same way.
 */

const MEDIA_ID = 'tmdb:77016'
const RADARR_ID = 380
const SHOW_MEDIA_ID = 'tvdb:81189'
const SONARR_ID = 9
const T0 = Date.parse('2026-09-28T12:00:00.000Z')

const iso = (ms: number): string => new Date(ms).toISOString()

function libraryMovie(): Movie {
  return {
    id: MEDIA_ID,
    monitored: true,
    radarrId: RADARR_ID,
    title: 'End of Watch',
    tmdbId: 77016,
    type: DownloadType.Movie,
  }
}

/** What `toMovie()` makes of Radarr's `/movie/lookup/tmdb` answer. */
function discoverLookupMovie(): Movie {
  return {
    id: MEDIA_ID,
    title: 'End of Watch',
    tmdbId: 77016,
    type: DownloadType.Movie,
  }
}

function libraryShow(): Show {
  return {
    id: SHOW_MEDIA_ID,
    monitored: true,
    sonarrId: SONARR_ID,
    title: 'Breaking Bad',
    tvdbId: 81189,
    type: DownloadType.Show,
  }
}

function commandRef(id: number, name: string, ms = T0): CommandRef {
  return { id, name, queuedAt: iso(ms) }
}

/** A command as `getCommand` reads it back. */
function snapshot(
  id: number,
  status: CommandSnapshot['status'],
): CommandSnapshot {
  return { body: {}, id, name: 'Command', status }
}

/** A refresh as `listCommands` lists it. */
function refreshCommand(
  id: number,
  name: 'RefreshMovie' | 'RefreshSeries',
  status: CommandSnapshot['status'],
  body: Record<string, unknown>,
): CommandSnapshot {
  return { body, id, name, queued: iso(T0 - 1_000), status }
}

/** The add-time refresh Radarr queued for `RADARR_ID`. */
const MOVIE_ADD_REFRESH = refreshCommand(31, 'RefreshMovie', 'started', {
  isNewMovie: true,
  movieIds: [RADARR_ID],
})

/** The add-time refresh Sonarr queued for `SONARR_ID`. */
const SHOW_ADD_REFRESH = refreshCommand(41, 'RefreshSeries', 'queued', {
  isNewSeries: true,
  seriesIds: [SONARR_ID],
})

function release(guid: string): Release {
  return {
    downloadAllowed: true,
    flaggedBad: false,
    guid,
    indexerId: 1,
    rejected: false,
    title: guid,
  }
}

const QUEUE_ITEM: QueueResource = {
  movieId: RADARR_ID,
  size: 1000,
  sizeleft: 600,
  status: 'downloading',
}

/** The upstream calls every poller tick makes, answered with nothing. */
function idleUpstream() {
  return {
    getCommand: jest.fn().mockResolvedValue(null),
    getFailedDownloadConfig: jest
      .fn()
      .mockResolvedValue({ autoRedownloadFailed: true }),
    getHistoryByDownloadId: jest.fn().mockResolvedValue([]),
    getHistorySince: jest.fn().mockResolvedValue([]),
    getQueue: jest.fn().mockResolvedValue([]),
    getReleases: jest.fn().mockResolvedValue([]),
    grabRelease: jest.fn().mockResolvedValue(undefined),
    isDownloadClientHealthy: jest.fn().mockResolvedValue(true),
    listCommands: jest.fn().mockResolvedValue([]),
    refreshMonitoredDownloads: jest.fn().mockResolvedValue(undefined),
    removeQueueItem: jest.fn().mockResolvedValue(undefined),
  }
}

describe('MediaDownloadService - a first request for a title not yet in the library', () => {
  let downloadService: MediaDownloadService
  let poller: MediaPollerService
  let resolver: MediaResolverService
  let downloadStateService: DownloadStateService
  let radarrService: ReturnType<typeof idleUpstream> & {
    editMovies: jest.Mock
    ensureMovie: jest.Mock
    getLibrary: jest.Mock
    getLibraryMovie: jest.Mock
    getMovieFiles: jest.Mock
    lookupByTmdbId: jest.Mock
    refreshMovie: jest.Mock
    tierProfileId: jest.Mock
    triggerSearch: jest.Mock
    unmonitorIfMissing: jest.Mock
  }
  let sonarrService: ReturnType<typeof idleUpstream> & {
    editSeries: jest.Mock
    ensureSeries: jest.Mock
    getEpisodeFiles: jest.Mock
    getEpisodes: jest.Mock
    getLibrary: jest.Mock
    getLibraryShow: jest.Mock
    lookupByTvdbId: jest.Mock
    monitorScope: jest.Mock
    refreshSeries: jest.Mock
    resolveScope: jest.Mock
    tierProfileId: jest.Mock
    triggerEpisodeSearch: jest.Mock
    triggerSearch: jest.Mock
    triggerSeasonSearch: jest.Mock
    unmonitorScope: jest.Mock
  }
  let dbService: DbService
  let now: number

  /** The clock the poller and `startSearch` read. */
  function at(ms: number): void {
    now = ms
  }

  function stored(id = 'mock-id') {
    return downloadStateService.jobs.get(id)
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    at(T0)
    jest.spyOn(Date, 'now').mockImplementation(() => now)

    radarrService = {
      ...idleUpstream(),
      editMovies: jest.fn().mockResolvedValue(undefined),
      // Upstream before the click: Radarr holds nothing.
      ensureMovie: jest.fn(async () => {
        radarrService.getLibrary.mockResolvedValue([libraryMovie()])
        return {
          movie: {},
          radarrId: RADARR_ID,
          wasAdded: true,
          wasMonitored: false,
        }
      }),
      getLibrary: jest.fn().mockResolvedValue([]),
      getLibraryMovie: jest.fn().mockResolvedValue(undefined),
      getMovieFiles: jest.fn().mockResolvedValue([]),
      lookupByTmdbId: jest.fn().mockResolvedValue(discoverLookupMovie()),
      // The add-time refresh, deduped onto the one the add queued.
      refreshMovie: jest
        .fn()
        .mockResolvedValue(commandRef(31, 'RefreshMovie', T0 - 1_000)),
      tierProfileId: jest.fn().mockResolvedValue(11),
      triggerSearch: jest
        .fn()
        .mockResolvedValue(commandRef(32, 'MoviesSearch', T0 + 100)),
      unmonitorIfMissing: jest.fn().mockResolvedValue(true),
    }
    sonarrService = {
      ...idleUpstream(),
      editSeries: jest.fn().mockResolvedValue(undefined),
      ensureSeries: jest.fn(async () => {
        sonarrService.getLibrary.mockResolvedValue([libraryShow()])
        return {
          series: {},
          sonarrId: SONARR_ID,
          wasAdded: true,
          wasMonitored: false,
        }
      }),
      getEpisodeFiles: jest.fn().mockResolvedValue([]),
      getEpisodes: jest.fn().mockResolvedValue([]),
      getLibrary: jest.fn().mockResolvedValue([]),
      getLibraryShow: jest.fn().mockResolvedValue(undefined),
      lookupByTvdbId: jest.fn().mockResolvedValue({
        id: SHOW_MEDIA_ID,
        title: 'Breaking Bad',
        tvdbId: 81189,
        type: DownloadType.Show,
      }),
      monitorScope: jest.fn().mockResolvedValue(undefined),
      refreshSeries: jest
        .fn()
        .mockResolvedValue(commandRef(41, 'RefreshSeries', T0 - 1_000)),
      resolveScope: jest.fn(),
      tierProfileId: jest.fn().mockResolvedValue(21),
      triggerEpisodeSearch: jest
        .fn()
        .mockResolvedValue(commandRef(42, 'EpisodeSearch', T0 + 100)),
      triggerSearch: jest
        .fn()
        .mockResolvedValue(commandRef(44, 'SeriesSearch', T0 + 100)),
      triggerSeasonSearch: jest
        .fn()
        .mockResolvedValue(commandRef(43, 'SeasonSearch', T0 + 100)),
      unmonitorScope: jest.fn().mockResolvedValue(0),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        DownloadStateService,
        MediaDownloadService,
        MediaPollerService,
        MediaResolverService,
        MediaStateService,
        { provide: DbService, useValue: dbService },
        {
          provide: DownloadGateway,
          useValue: {
            broadcast: jest.fn(),
            broadcastPerViewer: jest.fn(),
            watchedMediaIds: jest.fn(() => new Set<string>()),
          },
        },
        {
          provide: EmbyStatusService,
          useValue: { annotate: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: RadarrService, useValue: radarrService },
        { provide: SonarrService, useValue: sonarrService },
      ],
    }).compile()

    downloadService = module.get(MediaDownloadService)
    poller = module.get(MediaPollerService)
    resolver = module.get(MediaResolverService)
    downloadStateService = module.get(DownloadStateService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
    jest.restoreAllMocks()
  })

  it('resolves the job with its radarrId, and the next tick tracks it', async () => {
    // The page render that filled the cache before the click.
    const before = await resolver.resolve([
      { mediaId: MEDIA_ID, type: DownloadType.Movie },
    ])
    expect(before.media.get(MEDIA_ID)).toMatchObject({ state: 'absent' })

    const job = await downloadService.requestMovie(77016)
    await flushAsync()

    expect(job.status).toBe(DownloadJobStatus.Searching)
    expect(job.media).toMatchObject({
      monitored: true,
      radarrId: RADARR_ID,
      state: 'wanted',
    })

    radarrService.getCommand.mockResolvedValue(snapshot(31, 'started'))
    radarrService.getQueue.mockResolvedValue([QUEUE_ITEM])
    await poller.poll()

    expect(stored(job.id)?.status).toBe(DownloadJobStatus.Downloading)
  })

  describe('a movie', () => {
    it('waits on the add-time refresh, and does not search yet', async () => {
      const job = await downloadService.requestMovie(77016)

      expect(radarrService.refreshMovie).toHaveBeenCalledWith(RADARR_ID, {
        isNew: true,
      })
      expect(radarrService.triggerSearch).not.toHaveBeenCalled()
      expect(job).toMatchObject({
        status: DownloadJobStatus.Searching,
        statusNote: 'Waiting for Radarr to finish adding the movie',
      })
      expect(stored()).toMatchObject({
        upstreamCommandAt: iso(T0 - 1_000),
        upstreamCommandId: 31,
        upstreamCommandKind: 'refresh',
      })
      expect(getJobById(dbService.db, job.id)).toMatchObject({
        statusNote: ADD_REFRESH_NOTES[DownloadType.Movie],
        upstreamCommandId: 31,
        upstreamCommandKind: 'refresh',
      })
    })

    it('starts the search once the refresh finishes', async () => {
      await downloadService.requestMovie(77016)

      radarrService.getCommand.mockResolvedValue(snapshot(31, 'started'))
      await poller.poll()
      expect(radarrService.triggerSearch).not.toHaveBeenCalled()

      radarrService.getCommand.mockResolvedValue(snapshot(31, 'completed'))
      at(T0 + 5_000)
      await poller.poll()

      expect(radarrService.triggerSearch).toHaveBeenCalledWith(RADARR_ID)
      expect(stored()).toMatchObject({
        status: DownloadJobStatus.Searching,
        statusNote: undefined,
        upstreamCommandId: 32,
        upstreamCommandKind: 'search',
      })
    })

    it('searches a library movie at once, and stores the search', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: { qualityProfileId: 11 },
        radarrId: RADARR_ID,
        wasAdded: false,
        wasMonitored: true,
      })

      const job = await downloadService.requestMovie(77016)

      expect(radarrService.refreshMovie).not.toHaveBeenCalled()
      expect(radarrService.triggerSearch).toHaveBeenCalledWith(RADARR_ID)
      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.statusNote).toBeUndefined()
      expect(stored()).toMatchObject({
        upstreamCommandAt: iso(T0 + 100),
        upstreamCommandId: 32,
        upstreamCommandKind: 'search',
      })
    })

    describe('a library movie Radarr is still refreshing', () => {
      beforeEach(() => {
        radarrService.getLibrary.mockResolvedValue([libraryMovie()])
        radarrService.ensureMovie.mockResolvedValue({
          movie: { qualityProfileId: 11 },
          radarrId: RADARR_ID,
          wasAdded: false,
          wasMonitored: true,
        })
      })

      it('waits on that refresh, and searches once it finishes', async () => {
        radarrService.listCommands.mockResolvedValue([MOVIE_ADD_REFRESH])

        const job = await downloadService.requestMovie(77016)

        expect(radarrService.refreshMovie).not.toHaveBeenCalled()
        expect(radarrService.triggerSearch).not.toHaveBeenCalled()
        expect(job).toMatchObject({
          status: DownloadJobStatus.Searching,
          statusNote: ADD_REFRESH_NOTES[DownloadType.Movie],
        })
        expect(stored()).toMatchObject({
          upstreamCommandAt: iso(T0 - 1_000),
          upstreamCommandId: 31,
          upstreamCommandKind: 'refresh',
        })

        radarrService.getCommand.mockResolvedValue(snapshot(31, 'completed'))
        at(T0 + 5_000)
        await poller.poll()

        expect(radarrService.triggerSearch).toHaveBeenCalledWith(RADARR_ID)
        expect(stored()).toMatchObject({
          statusNote: undefined,
          upstreamCommandId: 32,
          upstreamCommandKind: 'search',
        })
      })

      it.each([
        [
          'another movie',
          refreshCommand(31, 'RefreshMovie', 'started', {
            isNewMovie: true,
            movieIds: [RADARR_ID + 1],
          }),
        ],
        ['a finished one', { ...MOVIE_ADD_REFRESH, status: 'completed' }],
        [
          'the whole library',
          refreshCommand(31, 'RefreshMovie', 'started', { movieIds: [] }),
        ],
      ] as const)(
        'searches at once when the only refresh is for %s',
        async (_, command: CommandSnapshot) => {
          radarrService.listCommands.mockResolvedValue([command])

          const job = await downloadService.requestMovie(77016)

          expect(radarrService.triggerSearch).toHaveBeenCalledWith(RADARR_ID)
          expect(job.statusNote).toBeUndefined()
          expect(stored()).toMatchObject({
            upstreamCommandId: 32,
            upstreamCommandKind: 'search',
          })
        },
      )

      it('searches at once when the command list cannot be read', async () => {
        radarrService.listCommands.mockRejectedValue(new Error('radarr down'))

        const job = await downloadService.requestMovie(77016)

        expect(radarrService.triggerSearch).toHaveBeenCalledWith(RADARR_ID)
        expect(job.status).toBe(DownloadJobStatus.Searching)
        expect(stored()).toMatchObject({
          upstreamCommandId: 32,
          upstreamCommandKind: 'search',
        })
      })
    })

    it('fails the job when the refresh cannot be pushed', async () => {
      radarrService.refreshMovie.mockRejectedValue(new Error('radarr down'))

      const job = await downloadService.requestMovie(77016)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('radarr down')
      expect(stored()?.upstreamCommandId).toBeUndefined()
    })

    describe('with flagged releases', () => {
      beforeEach(() => {
        insertBadFile(dbService.db, {
          flaggedByEmail: 'alice@example.com',
          flaggedByUserId: 'user_1',
          mediaId: MEDIA_ID,
          mediaType: DownloadType.Movie,
          releaseGuid: 'indexer://bad',
        })
        radarrService.ensureMovie.mockResolvedValue({
          movie: { qualityProfileId: 11 },
          radarrId: RADARR_ID,
          wasAdded: false,
          wasMonitored: true,
        })
      })

      it('grabs the pick, and waits on no command', async () => {
        radarrService.getReleases.mockResolvedValue([
          release('indexer://bad'),
          release('indexer://ok'),
        ])

        const job = await downloadService.requestMovie(77016)

        expect(radarrService.grabRelease).toHaveBeenCalledWith(
          'indexer://ok',
          1,
        )
        expect(radarrService.triggerSearch).not.toHaveBeenCalled()
        expect(job.status).toBe(DownloadJobStatus.Searching)
        expect(stored()?.upstreamCommandAt).toBe(iso(T0))
        expect(stored()?.upstreamCommandId).toBeUndefined()
      })

      it('ends not_found, with the note, when nothing is usable', async () => {
        radarrService.getReleases.mockResolvedValue([release('indexer://bad')])

        const job = await downloadService.requestMovie(77016)

        expect(job.status).toBe(DownloadJobStatus.NotFound)
        expect(job.statusNote).toBe(NO_USABLE_RELEASE_NOTE)
        expect(job.error).toBeUndefined()
      })
    })
  })

  describe('a show', () => {
    it('waits on the add-time refresh, and neither monitors nor searches yet', async () => {
      const job = await downloadService.requestShow(81189)

      expect(sonarrService.refreshSeries).toHaveBeenCalledWith(SONARR_ID, {
        isNew: true,
      })
      expect(sonarrService.monitorScope).not.toHaveBeenCalled()
      expect(sonarrService.triggerSearch).not.toHaveBeenCalled()
      expect(job).toMatchObject({
        status: DownloadJobStatus.Searching,
        statusNote: 'Waiting for Sonarr to finish adding the show',
      })
      expect(stored()).toMatchObject({
        upstreamCommandId: 41,
        upstreamCommandKind: 'refresh',
      })
    })

    it('searches a library show at once, and stores the search', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: { qualityProfileId: 21 },
        sonarrId: SONARR_ID,
        wasAdded: false,
        wasMonitored: true,
      })

      const job = await downloadService.requestShow(81189, null, {
        seasonNumber: 2,
      })

      expect(sonarrService.refreshSeries).not.toHaveBeenCalled()
      expect(sonarrService.monitorScope).toHaveBeenCalledWith(SONARR_ID, {
        seasonNumber: 2,
      })
      expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(
        SONARR_ID,
        2,
      )
      expect(job.statusNote).toBeUndefined()
      expect(stored()).toMatchObject({
        status: DownloadJobStatus.Searching,
        upstreamCommandId: 43,
        upstreamCommandKind: 'search',
      })
    })

    describe('a library show Sonarr is still refreshing', () => {
      beforeEach(() => {
        sonarrService.getLibrary.mockResolvedValue([libraryShow()])
        sonarrService.ensureSeries.mockResolvedValue({
          series: { qualityProfileId: 21 },
          sonarrId: SONARR_ID,
          wasAdded: false,
          wasMonitored: true,
        })
      })

      it('waits on that refresh, and monitors and searches once it finishes', async () => {
        sonarrService.listCommands.mockResolvedValue([SHOW_ADD_REFRESH])

        const job = await downloadService.requestShow(81189, null, {
          seasonNumber: 2,
        })

        expect(sonarrService.refreshSeries).not.toHaveBeenCalled()
        expect(sonarrService.monitorScope).not.toHaveBeenCalled()
        expect(sonarrService.triggerSeasonSearch).not.toHaveBeenCalled()
        expect(job).toMatchObject({
          status: DownloadJobStatus.Searching,
          statusNote: ADD_REFRESH_NOTES[DownloadType.Show],
        })
        expect(stored()).toMatchObject({
          upstreamCommandAt: iso(T0 - 1_000),
          upstreamCommandId: 41,
          upstreamCommandKind: 'refresh',
        })

        sonarrService.getCommand.mockResolvedValue(snapshot(41, 'completed'))
        await poller.poll()

        expect(sonarrService.monitorScope).toHaveBeenCalledWith(SONARR_ID, {
          seasonNumber: 2,
        })
        expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(
          SONARR_ID,
          2,
        )
        expect(stored()).toMatchObject({
          statusNote: undefined,
          upstreamCommandId: 43,
          upstreamCommandKind: 'search',
        })
      })

      it('waits on a plain refresh too, with no note', async () => {
        sonarrService.listCommands.mockResolvedValue([
          refreshCommand(45, 'RefreshSeries', 'started', {
            seriesIds: [SONARR_ID],
          }),
        ])

        const job = await downloadService.requestShow(81189)

        expect(sonarrService.triggerSearch).not.toHaveBeenCalled()
        expect(job.status).toBe(DownloadJobStatus.Searching)
        expect(job.statusNote).toBeUndefined()
        expect(stored()).toMatchObject({
          upstreamCommandId: 45,
          upstreamCommandKind: 'refresh',
        })
      })

      it.each([
        [
          'another series',
          refreshCommand(41, 'RefreshSeries', 'queued', {
            isNewSeries: true,
            seriesIds: [SONARR_ID + 1],
          }),
        ],
        ['a finished one', { ...SHOW_ADD_REFRESH, status: 'completed' }],
      ] as const)(
        'searches at once when the only refresh is for %s',
        async (_, command: CommandSnapshot) => {
          sonarrService.listCommands.mockResolvedValue([command])

          await downloadService.requestShow(81189, null, { seasonNumber: 2 })

          expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(
            SONARR_ID,
            2,
          )
          expect(stored()?.statusNote).toBeUndefined()
          expect(stored()).toMatchObject({
            upstreamCommandId: 43,
            upstreamCommandKind: 'search',
          })
        },
      )

      it('searches at once when the command list cannot be read', async () => {
        sonarrService.listCommands.mockRejectedValue(new Error('sonarr down'))

        const job = await downloadService.requestShow(81189, null, {
          seasonNumber: 2,
        })

        expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(
          SONARR_ID,
          2,
        )
        expect(job.status).toBe(DownloadJobStatus.Searching)
        expect(stored()?.upstreamCommandKind).toBe('search')
      })
    })

    // The bot sends a multi-episode pick as one request per episode. Only
    // the first sees the add; the second must not look its episode up
    // before the add-time refresh has created it.
    it('holds a second request for a show the first just added until the refresh is done', async () => {
      const S02E05 = { episodeNumber: 5, id: 805, seasonNumber: 2 }
      const S02E06 = { episodeNumber: 6, id: 806, seasonNumber: 2 }
      jest
        .mocked(nanoid)
        .mockReturnValueOnce('job-1')
        .mockReturnValueOnce('job-2')

      await downloadService.requestShow(81189, null, {
        episodeNumber: 5,
        seasonNumber: 2,
      })
      // Sonarr queued the add-time refresh during the add, and the series is
      // in the library from then on.
      sonarrService.listCommands.mockResolvedValue([SHOW_ADD_REFRESH])
      sonarrService.ensureSeries.mockResolvedValue({
        series: { qualityProfileId: 21 },
        sonarrId: SONARR_ID,
        wasAdded: false,
        wasMonitored: true,
      })
      const second = await downloadService.requestShow(81189, null, {
        episodeNumber: 6,
        seasonNumber: 2,
      })

      expect(sonarrService.getEpisodes).not.toHaveBeenCalled()
      expect(second).toMatchObject({
        status: DownloadJobStatus.Searching,
        statusNote: ADD_REFRESH_NOTES[DownloadType.Show],
      })
      for (const id of ['job-1', 'job-2']) {
        expect(stored(id)).toMatchObject({
          upstreamCommandId: 41,
          upstreamCommandKind: 'refresh',
        })
      }

      sonarrService.getEpisodes.mockResolvedValue([S02E05, S02E06])
      sonarrService.listCommands.mockResolvedValue([
        { ...SHOW_ADD_REFRESH, status: 'completed' },
      ])
      sonarrService.getCommand.mockResolvedValue(snapshot(41, 'completed'))
      await poller.poll()

      expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([805])
      expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([806])
      expect(stored('job-2')).toMatchObject({
        scope: { episodeId: 806, episodeNumber: 6, seasonNumber: 2 },
        status: DownloadJobStatus.Searching,
        statusNote: undefined,
        upstreamCommandKind: 'search',
      })
    })

    // Added with `monitor: 'none'` (see the SonarrService spec); the scope's
    // episodes are monitored only once the refresh that would undo it is
    // done.
    it('monitors only the scope of a fresh scoped add, once its refresh is done', async () => {
      await downloadService.requestShow(81189, null, { seasonNumber: 2 })

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(81189, {
        monitored: true,
        monitorEpisodes: { seasonNumber: 2 },
        qualityProfileId: 21,
      })
      expect(sonarrService.monitorScope).not.toHaveBeenCalled()

      sonarrService.getCommand.mockResolvedValue(snapshot(41, 'completed'))
      await poller.poll()

      expect(sonarrService.monitorScope).toHaveBeenCalledTimes(1)
      expect(sonarrService.monitorScope).toHaveBeenCalledWith(SONARR_ID, {
        seasonNumber: 2,
      })
      expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(
        SONARR_ID,
        2,
      )
      expect(stored()).toMatchObject({
        statusNote: undefined,
        upstreamCommandId: 43,
        upstreamCommandKind: 'search',
      })
    })

    describe('an episode asked for by number', () => {
      const S02E05 = { episodeNumber: 5, id: 805, seasonNumber: 2 }

      it('carries the number on a fresh add, and resolves it once the refresh is done', async () => {
        const job = await downloadService.requestShow(81189, null, {
          episodeNumber: 5,
          seasonNumber: 2,
        })

        expect(job.scope).toEqual({ episodeNumber: 5, seasonNumber: 2 })
        expect(sonarrService.getEpisodes).not.toHaveBeenCalled()

        sonarrService.getEpisodes.mockResolvedValue([S02E05])
        sonarrService.getCommand.mockResolvedValue(snapshot(41, 'completed'))
        await poller.poll()

        const resolved = { episodeId: 805, episodeNumber: 5, seasonNumber: 2 }
        expect(sonarrService.monitorScope).toHaveBeenCalledWith(
          SONARR_ID,
          resolved,
        )
        expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([805])
        expect(stored()).toMatchObject({
          scope: resolved,
          upstreamCommandId: 42,
          upstreamCommandKind: 'search',
        })
      })

      it('resolves it at once for a library show', async () => {
        sonarrService.ensureSeries.mockResolvedValue({
          series: { qualityProfileId: 21 },
          sonarrId: SONARR_ID,
          wasAdded: false,
          wasMonitored: true,
        })
        sonarrService.getEpisodes.mockResolvedValue([S02E05])

        const job = await downloadService.requestShow(81189, null, {
          episodeNumber: 5,
          seasonNumber: 2,
        })

        expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([805])
        expect(job.scope).toEqual({
          episodeId: 805,
          episodeNumber: 5,
          seasonNumber: 2,
        })
      })

      it("fails the request when a library show doesn't have it", async () => {
        sonarrService.ensureSeries.mockResolvedValue({
          series: { qualityProfileId: 21 },
          sonarrId: SONARR_ID,
          wasAdded: false,
          wasMonitored: true,
        })

        const job = await downloadService.requestShow(81189, null, {
          episodeNumber: 5,
          seasonNumber: 2,
        })

        expect(job.status).toBe(DownloadJobStatus.Failed)
        expect(job.error).toBe("S02E05 isn't in Sonarr")
        expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
      })

      it("fails the job once the refresh is done when Sonarr doesn't have it", async () => {
        await downloadService.requestShow(81189, null, {
          episodeNumber: 5,
          seasonNumber: 2,
        })

        sonarrService.getCommand.mockResolvedValue(snapshot(41, 'completed'))
        await poller.poll()

        expect(stored()).toMatchObject({
          error: "S02E05 isn't in Sonarr",
          status: DownloadJobStatus.Failed,
          statusNote: undefined,
          upstreamCommandId: undefined,
        })
      })
    })

    it('ends a fresh flagged show not_found, with the note, once its refresh is done', async () => {
      insertBadFile(dbService.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId: SHOW_MEDIA_ID,
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://bad',
      })
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeNumber: 1, hasFile: false, monitored: true, seasonNumber: 2 },
      ])
      sonarrService.getReleases.mockResolvedValue([
        { ...release('indexer://bad'), episodeNumbers: [1] },
      ])

      await downloadService.requestShow(81189, null, { seasonNumber: 2 })
      sonarrService.getCommand.mockResolvedValue(snapshot(41, 'completed'))
      await poller.poll()

      expect(stored()).toMatchObject({
        status: DownloadJobStatus.NotFound,
        statusNote: NO_USABLE_RELEASE_NOTE,
        upstreamCommandId: undefined,
      })
      expect(sonarrService.grabRelease).not.toHaveBeenCalled()
    })
  })

  // Cancel pressed while `ensureMovie` is still out: the title has no
  // radarrId yet, so the press can only move the job - `request()` has to
  // finish the cancel once `submit()` has put the title in the library.
  describe('a cancel that lands while the request is out upstream', () => {
    let finishEnsure: () => void

    beforeEach(() => {
      const ensure = radarrService.ensureMovie.getMockImplementation()
      radarrService.ensureMovie.mockImplementation(
        () =>
          new Promise(resolve => {
            finishEnsure = () => resolve(ensure?.())
          }),
      )
    })

    it('stays cancelling, and cleans up upstream once the add is done', async () => {
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')
      const requested = downloadService.requestMovie(77016)
      await flushAsync()

      const cancelled = await downloadService.cancelMovieJob('mock-id')
      expect(cancelled.status).toBe(DownloadJobStatus.Cancelling)
      expect(radarrService.getQueue).not.toHaveBeenCalled()

      // Something grabbed the movie by the time the cleanup reads the queue.
      radarrService.getQueue.mockResolvedValue([{ ...QUEUE_ITEM, id: 55 }])
      finishEnsure()
      const job = await requested

      expect(radarrService.refreshMovie).toHaveBeenCalledWith(RADARR_ID, {
        isNew: true,
      })
      expect(radarrService.triggerSearch).not.toHaveBeenCalled()
      expect(job.status).toBe(DownloadJobStatus.Cancelling)
      expect(job.media).toMatchObject({ radarrId: RADARR_ID })
      expect(radarrService.getQueue).toHaveBeenCalledWith([RADARR_ID])
      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(55)
      expect(radarrService.unmonitorIfMissing).toHaveBeenCalledWith(RADARR_ID)
      expect(updateJob).not.toHaveBeenCalledWith(
        'mock-id',
        expect.objectContaining({ status: DownloadJobStatus.Searching }),
      )
      // The cancel wins: nothing is left for the poller to follow.
      expect(stored()?.status).toBe(DownloadJobStatus.Cancelling)
      expect(stored()?.upstreamCommandId).toBeUndefined()
    })

    it('does not write failed when the request then fails upstream', async () => {
      radarrService.refreshMovie.mockRejectedValue(new Error('Radarr is down'))
      const requested = downloadService.requestMovie(77016)
      await flushAsync()

      await downloadService.cancelMovieJob('mock-id')
      finishEnsure()
      const job = await requested

      expect(job.status).toBe(DownloadJobStatus.Cancelling)
      expect(job.error).toBeUndefined()
      expect(stored()?.status).toBe(DownloadJobStatus.Cancelling)
    })
  })
})
