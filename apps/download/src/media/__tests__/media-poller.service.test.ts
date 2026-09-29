// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, since Phase 5's ensureVideo()) must mock it first
// (see media/__tests__/download.controller.media.test.ts for the same
// pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type {
  HistoryResource,
  MovieFileResource,
  QueueResource,
} from '@lilnas/media/radarr'
import type {
  EpisodeFileResource,
  EpisodeResource,
  HistoryResource as SonarrHistoryResource,
  QueueResource as SonarrQueueResource,
} from '@lilnas/media/sonarr'
import {
  type DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  isMovie,
  isShow,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
  type Movie,
  type Release,
  type Show,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { nanoid } from 'nanoid'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { AttributionResolutionService } from 'src/auth/attribution-resolution.service'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { getCursor, setCursor } from 'src/db/history-cursors.repo'
import { linkDownload, listForJob, markFailed } from 'src/db/job-downloads.repo'
import { getJobById } from 'src/db/jobs.repo'
import { arrHistoryCursors } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { flushAsync } from 'src/media/__tests__/helpers/fake-media-resolver'
import { REOPEN_WINDOW_MS } from 'src/media/adoption.util'
import type { CommandSnapshot } from 'src/media/arr-command.types'
import { DISK_SPACE_ERROR } from 'src/media/client-failure.util'
import {
  COMMAND_POLL_MS,
  EVENT_REFRESH_MIN_MS,
  HISTORY_FIRST_READ_MS,
  HISTORY_MAX_CATCH_UP_MS,
  MediaPollerService,
  type PollableCompletionData,
  QUEUE_REFRESH_MS,
  REFRESH_WAIT_TIMEOUT_MS,
  RETRY_SEARCH_TIMEOUT_MS,
  type TrackedJob,
  WATCHED_QUEUE_REFRESH_MS,
} from 'src/media/media-poller.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import {
  MediaStateService,
  type SabClientHealth,
} from 'src/media/media-state.service'
import { KEPT_PACK_NOTE } from 'src/media/queue-cancel.util'
import {
  ABSENT_REMOVED_MS,
  ATTENTION_DELAY_MS,
  CANCEL_GRACE_MS,
  REMOVED_FROM_CLIENT_ERROR,
  STALL_MS,
} from 'src/media/queue-status.util'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'
import type { SabPhase, SabReading } from 'src/sabnzbd/sab-readings.util'

const NOW_ISO = '2026-08-20T12:00:00.000Z'
/** A file imported after every job built here was created. */
const AFTER_ISO = '2026-08-20T12:05:00.000Z'
/** A file already in the library before any job built here was created. */
const BEFORE_ISO = '2026-08-20T11:00:00.000Z'

/**
 * The real Radarr queue row for a blocked import, read off the live instance
 * on 2026-09-21: movie 434, `Game Night (2018)` (`tmdb:445571`).
 *
 * Kept verbatim because its shape is the whole point - it is
 * `status: 'completed'` **and** `trackedDownloadState: 'importPending'` at
 * once, with `sizeleft: 0`. Every byte is on disk, nothing is moving it, and
 * the one thing a person needs in order to act is the sentence buried in
 * `statusMessages`.
 */
const BLOCKED_IMPORT_ITEM: QueueResource = {
  downloadClient: 'SABnzbd',
  downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
  id: 152557673,
  movieId: 434,
  outputPath: '/downloads/Game.Night.2018.1080p.BluRay.x265/',
  protocol: 'usenet',
  size: 1681143972,
  sizeleft: 0,
  status: 'completed',
  statusMessages: [
    {
      messages: [
        'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
      ],
      title: 'Game.Night.2018.1080p.BluRay.x265',
    },
  ],
  title: 'Game.Night.2018.1080p.BluRay.x265',
  trackedDownloadState: 'importPending',
  trackedDownloadStatus: 'warning',
}

/** Radarr's/Sonarr's defaults: a failed download is retried either way. */
const RETRY_ON = { autoRedownloadFailed: true, fromInteractive: true }

const BLOCKED_IMPORT_REASON =
  'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265'

function buildRecord(
  type: DownloadType,
  mediaId: string,
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    discordRequester: null,
    hiddenAttribution: false,
    id: type === DownloadType.Movie ? 'movie-1' : 'show-1',
    linkedDiscord: null,
    mediaId,
    requester: null,
    status: DownloadJobStatus.Searching,
    type,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

/**
 * A Radarr/Sonarr command as `getCommand` / `listCommands` read it - by
 * default a search someone started by hand, still running.
 */
function buildCommand(
  overrides: Partial<CommandSnapshot> & { id: number },
): CommandSnapshot {
  return {
    body: {},
    name: 'MoviesSearch',
    queued: NOW_ISO,
    status: 'started',
    trigger: 'manual',
    ...overrides,
  }
}

function buildMovieJob(
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return buildRecord(DownloadType.Movie, 'tmdb:1', overrides)
}

function buildShowJob(
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return buildRecord(DownloadType.Show, 'tvdb:1', overrides)
}

function buildTrackedShowJob(
  upstreamId: number,
  overrides: Partial<DownloadJobRecord> = {},
): TrackedJob {
  return { record: buildShowJob(overrides), upstreamId }
}

describe('MediaPollerService', () => {
  // Which upstream library id each media key resolves to. A key absent from
  // this map resolves to a media with no radarrId/sonarrId, i.e. a title
  // that isn't in the library yet and therefore isn't pollable.
  let upstreamIds: Map<string, number>

  let service: MediaPollerService
  let downloadGateway: jest.Mocked<DownloadGateway>
  let downloadStateService: DownloadStateService
  let mediaResolverService: jest.Mocked<MediaResolverService>
  let mediaStateService: MediaStateService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let dbService: DbService
  let testingModule: TestingModule

  /**
   * Every job event broadcast so far, as an admin sees it. Job events are
   * fire-and-forget (the broadcast resolves the media first), so this lets
   * them settle before reading.
   */
  async function jobFrames(): Promise<DownloadJobEvent[]> {
    await flushAsync()
    return downloadGateway.broadcastPerViewer.mock.calls.map(
      ([build]) => build(true).data as DownloadJobEvent,
    )
  }

  /** A job frame's media snapshot - movies and shows only have one. */
  function snapshotOf(frame: DownloadJobEvent | undefined) {
    const media = frame?.job.media
    return media && isManagedMedia(media) ? media.queueSnapshot : undefined
  }

  /** Every test that moves the clock starts it here. */
  const T0 = Date.parse('2026-08-20T13:00:00.000Z')

  // Wall-clock, like the poller's own timers: every tick after this reads
  // the clock it sets.
  function at(ms: number): void {
    jest.spyOn(Date, 'now').mockReturnValue(ms)
  }

  // The poll gate is a backoff concern most tests don't exercise.
  function clearBackoff(): void {
    ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt = 0
  }

  /**
   * Stores a job the way a request does - with its row, which a download
   * link needs - and forgets the Created frame that sends.
   */
  async function seed(record: DownloadJobRecord): Promise<DownloadJobRecord> {
    downloadStateService.addJob(record)
    await flushAsync()
    downloadGateway.broadcastPerViewer.mockClear()
    return record
  }

  /** The downloads a job is linked to, as stored. */
  function linksOf(jobId: string) {
    return listForJob(dbService.db, jobId)
  }

  /**
   * A process restart: the job Map reloaded from its rows at boot, and a
   * poller with nothing in memory - on the same database.
   */
  function restart(): void {
    downloadStateService = new DownloadStateService(
      testingModule.get(AttributionResolutionService),
      dbService,
      downloadGateway,
      mediaResolverService,
      mediaStateService,
    )
    downloadStateService.adoptOpenJobs()
    service = new MediaPollerService(
      downloadGateway,
      downloadStateService,
      mediaResolverService,
      mediaStateService,
      radarrService,
      sonarrService,
    )
  }

  beforeEach(async () => {
    upstreamIds = new Map([
      ['tmdb:1', 42],
      ['tvdb:1', 9],
    ])
    dbService = createTestDbService()
    const mockRadarrService = {
      // A command still running, whatever the id - no job settles on it.
      getCommand: jest.fn((id: number) =>
        Promise.resolve(buildCommand({ id })),
      ),
      getFailedDownloadConfig: jest.fn().mockResolvedValue(RETRY_ON),
      getHistoryByDownloadId: jest.fn().mockResolvedValue([]),
      getHistorySince: jest.fn().mockResolvedValue([]),
      getLibraryMovie: jest.fn().mockResolvedValue(undefined),
      getMovieFiles: jest.fn().mockResolvedValue([]),
      getMovieHistory: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
      getReleases: jest.fn().mockResolvedValue([]),
      grabRelease: jest.fn().mockResolvedValue(undefined),
      isDownloadClientHealthy: jest.fn().mockResolvedValue(true),
      listCommands: jest.fn().mockResolvedValue([]),
      refreshMonitoredDownloads: jest.fn().mockResolvedValue(undefined),
      removeQueueItem: jest.fn().mockResolvedValue(undefined),
      triggerSearch: jest.fn(),
    }
    const mockSonarrService = {
      getCommand: jest.fn((id: number) =>
        Promise.resolve(buildCommand({ id })),
      ),
      getEpisodeFiles: jest.fn().mockResolvedValue([]),
      getEpisodes: jest.fn().mockResolvedValue([]),
      getFailedDownloadConfig: jest.fn().mockResolvedValue(RETRY_ON),
      getHistoryByDownloadId: jest.fn().mockResolvedValue([]),
      getHistorySince: jest.fn().mockResolvedValue([]),
      getLibraryShow: jest.fn().mockResolvedValue(undefined),
      getQueue: jest.fn().mockResolvedValue([]),
      getReleases: jest.fn().mockResolvedValue([]),
      getSeriesHistory: jest.fn().mockResolvedValue([]),
      grabRelease: jest.fn().mockResolvedValue(undefined),
      isDownloadClientHealthy: jest.fn().mockResolvedValue(true),
      listCommands: jest.fn().mockResolvedValue([]),
      monitorScope: jest.fn().mockResolvedValue(undefined),
      refreshMonitoredDownloads: jest.fn().mockResolvedValue(undefined),
      removeQueueItem: jest.fn().mockResolvedValue(undefined),
      resolveScope: jest.fn(),
      triggerEpisodeSearch: jest.fn(),
      triggerSearch: jest.fn(),
      triggerSeasonSearch: jest.fn(),
      unmonitorScope: jest.fn().mockResolvedValue(0),
    }
    const mockDownloadGateway = {
      broadcast: jest.fn(),
      broadcastPerViewer: jest.fn(),
      // No detail page open unless a test opens one.
      watchedMediaIds: jest.fn(() => new Set<string>()),
    }
    // `radarrId`/`sonarrId` are no longer persisted on the job - the poller
    // reads them off the resolved media, so the resolver is what supplies
    // "which upstream id do I poll this by". It annotates like the real one,
    // so a job frame's `media.queueSnapshot` comes off the queue cache the
    // poller fed - the only place it comes from.
    const mockMediaResolverService = {
      // Empty by default: a queue item no job owns maps to no media, so only
      // the 'media events' block below ever sees a media event.
      getMovieLibrary: jest.fn().mockResolvedValue(new Map()),
      getShowLibrary: jest.fn().mockResolvedValue(new Map()),
      invalidate: jest.fn(),
      invalidateLibrary: jest.fn(),
      resolve: jest.fn(
        (keys: Array<{ mediaId: string; type: DownloadType }>) => {
          const media = new Map<string, Movie | Show>(
            keys.map(key => [
              key.mediaId,
              key.type === DownloadType.Movie
                ? {
                    id: key.mediaId,
                    radarrId: upstreamIds.get(key.mediaId),
                    title: 'A Movie',
                    tmdbId: 1,
                    type: DownloadType.Movie,
                  }
                : {
                    id: key.mediaId,
                    sonarrId: upstreamIds.get(key.mediaId),
                    title: 'A Show',
                    tvdbId: 1,
                    type: DownloadType.Show,
                  },
            ]),
          )
          mediaStateService.annotate(media.values())
          return { degradedSources: [], media }
        },
      ),
    }

    testingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        MediaPollerService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
        { provide: MediaResolverService, useValue: mockMediaResolverService },
        // The real one: it's a fed cache with no dependencies, so what the
        // poller wrote is asserted by reading it back.
        MediaStateService,
      ],
    }).compile()

    service = testingModule.get(MediaPollerService)
    downloadGateway = testingModule.get(DownloadGateway)
    downloadStateService = testingModule.get(DownloadStateService)
    radarrService = testingModule.get(RadarrService)
    sonarrService = testingModule.get(SonarrService)
    mediaResolverService = testingModule.get(MediaResolverService)
    mediaStateService = testingModule.get(MediaStateService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('tick gating', () => {
    // Nothing tracked no longer means nothing to do - a download started
    // outside this app is only ever seen by reading the queue - but an idle
    // upstream is still sent no refresh command.
    it('reads both queues but requests no refresh when idle', async () => {
      await service.poll()

      expect(radarrService.getQueue).toHaveBeenCalledTimes(1)
      expect(sonarrService.getQueue).toHaveBeenCalledTimes(1)
      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
      expect(sonarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
    })

    it('no-ops when called before nextAllowedRunAt (mid-backoff)', async () => {
      const job = buildMovieJob()
      downloadStateService.jobs.set(job.id, job)
      ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt =
        Date.now() + 60_000

      await service.poll()

      expect(radarrService.getQueue).not.toHaveBeenCalled()
    })
  })

  describe('queue refresh', () => {
    const MOVING: QueueResource = {
      downloadId: 'dl-refresh',
      id: 1,
      movieId: 42,
      size: 1000,
      sizeleft: 500,
      status: 'downloading',
    }
    const MOVING_EPISODE: SonarrQueueResource = {
      downloadId: 'dl-refresh-episode',
      episodeId: 5,
      id: 2,
      seriesId: 9,
      size: 1000,
      sizeleft: 500,
      status: 'downloading',
    }

    // The gate reads the previous tick's queue, so each test seeds that and
    // has every read after it return the same.
    function queueRadarr(...items: QueueResource[]): void {
      mediaStateService.setQueue('radarr', items)
      radarrService.getQueue.mockResolvedValue(items)
    }

    function queueSonarr(...items: SonarrQueueResource[]): void {
      mediaStateService.setQueue('sonarr', items)
      sonarrService.getQueue.mockResolvedValue(items)
    }

    async function pollAt(ms: number): Promise<void> {
      at(ms)
      clearBackoff()
      await service.poll()
    }

    const radarrRefreshes = () =>
      radarrService.refreshMonitoredDownloads.mock.calls.length
    const sonarrRefreshes = () =>
      sonarrService.refreshMonitoredDownloads.mock.calls.length

    it('asks Radarr to refresh before reading a queue with a download moving', async () => {
      queueRadarr(MOVING)

      await service.poll()

      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(
        radarrService.refreshMonitoredDownloads.mock.invocationCallOrder[0],
      ).toBeLessThan(
        radarrService.getQueue.mock.invocationCallOrder[0] as number,
      )
      // Nothing queued on the Sonarr side, so nothing sent there.
      expect(sonarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
    })

    it('asks Sonarr the same way', async () => {
      queueSonarr(MOVING_EPISODE)

      await service.poll()

      expect(sonarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
    })

    // Radarr/Sonarr refresh on their own a few seconds after a grab, and
    // history settles the job - a search has nothing to watch move.
    it('sends nothing for a tracked job with nothing in the queue', async () => {
      await seed(buildMovieJob({ status: DownloadJobStatus.Searching }))

      await service.poll()

      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
    })

    it.each<[string, QueueResource]>([
      [
        'blocked from import',
        {
          ...MOVING,
          sizeleft: 0,
          status: 'completed',
          trackedDownloadState: 'importBlocked',
          trackedDownloadStatus: 'warning',
        },
      ],
      [
        'failed at the client',
        { ...MOVING, status: 'failed', trackedDownloadStatus: 'error' },
      ],
      ['held by a delay profile', { ...MOVING, status: 'delay' }],
      ['paused', { ...MOVING, status: 'paused' }],
    ])('sends nothing for an item %s', async (_, item) => {
      queueRadarr(item)

      await service.poll()

      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()
    })

    it('refreshes at most every QUEUE_REFRESH_MS', async () => {
      queueRadarr(MOVING)

      await pollAt(T0)
      await pollAt(T0 + 1_000)
      await pollAt(T0 + 4_000)
      expect(radarrRefreshes()).toBe(1)

      await pollAt(T0 + QUEUE_REFRESH_MS)
      expect(radarrRefreshes()).toBe(2)
    })

    it('refreshes every tick for a title a detail page is open on, per source', async () => {
      queueRadarr(MOVING)
      queueSonarr(MOVING_EPISODE)
      ;(
        service as unknown as {
          queuedMedia: Record<'radarr' | 'sonarr', Map<string, number>>
        }
      ).queuedMedia.radarr.set('tmdb:1', 42)
      downloadGateway.watchedMediaIds.mockReturnValue(new Set(['tmdb:1']))

      await pollAt(T0)
      await pollAt(T0 + WATCHED_QUEUE_REFRESH_MS)
      await pollAt(T0 + 2 * WATCHED_QUEUE_REFRESH_MS)

      expect(radarrRefreshes()).toBe(3)
      // Nobody is watching the show: Sonarr keeps its own 5 s pace.
      expect(sonarrRefreshes()).toBe(1)
    })

    it('stops once an item has read the same for STALL_MS, and starts again when it moves', async () => {
      queueRadarr(MOVING)

      await pollAt(T0)
      await pollAt(T0 + 30_000)
      expect(radarrRefreshes()).toBe(2)

      // This tick still gates on the stalled reading; the one after sees
      // the new `sizeleft`.
      radarrService.getQueue.mockResolvedValue([{ ...MOVING, sizeleft: 400 }])
      await pollAt(T0 + STALL_MS + 1_000)
      expect(radarrRefreshes()).toBe(2)

      await pollAt(T0 + STALL_MS + 2_000)
      expect(radarrRefreshes()).toBe(3)
    })

    it('keeps refreshing an import that is running, however long it takes', async () => {
      queueRadarr({
        ...MOVING,
        sizeleft: 0,
        status: 'completed',
        trackedDownloadState: 'importing',
      })

      await pollAt(T0)
      await pollAt(T0 + 2 * STALL_MS)

      expect(radarrRefreshes()).toBe(2)
    })

    it('reads the queue anyway, without backing off, when the refresh is refused', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Searching }),
      )
      queueRadarr(MOVING)
      radarrService.refreshMonitoredDownloads.mockRejectedValueOnce(
        new Error('radarr said no'),
      )

      await service.poll()

      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)
    })

    it.each<SabClientHealth>(['unhealthy', 'off'])(
      'keeps the timed gate with SABnzbd %s',
      async health => {
        mediaStateService.setClientReadings(new Map(), health)
        queueRadarr(MOVING)

        await pollAt(T0)
        await pollAt(T0 + 1_000)
        await pollAt(T0 + QUEUE_REFRESH_MS)

        expect(radarrRefreshes()).toBe(2)
      },
    )

    describe('with SABnzbd healthy', () => {
      beforeEach(() => {
        mediaStateService.setClientReadings(new Map(), 'ok')
      })

      /** A SAB phase change of one download, as the monitor pushes it. */
      function phaseChange(nzoId: string, to: SabPhase = 'completed'): void {
        mediaStateService.pushClientTransitions([
          { from: 'downloading', nzoId, to },
        ])
      }

      // The live progress comes from SABnzbd, so a moving item alone buys
      // nothing a refresh would.
      it('sends nothing for a moving item with no phase change', async () => {
        queueRadarr(MOVING)
        queueSonarr(MOVING_EPISODE)

        await pollAt(T0)
        await pollAt(T0 + QUEUE_REFRESH_MS)

        expect(radarrRefreshes()).toBe(0)
        expect(sonarrRefreshes()).toBe(0)
      })

      it('refreshes only the app whose download changed phase', async () => {
        queueRadarr(MOVING)
        queueSonarr(MOVING_EPISODE)
        phaseChange(MOVING.downloadId as string)

        await pollAt(T0)

        expect(radarrRefreshes()).toBe(1)
        expect(sonarrRefreshes()).toBe(0)
        // Spent, not sent again.
        await pollAt(T0 + EVENT_REFRESH_MIN_MS)
        expect(radarrRefreshes()).toBe(1)
        expect(mediaStateService.takeClientTransitions()).toEqual([])
      })

      it('refreshes each app for its own changes in the same tick', async () => {
        queueRadarr(MOVING)
        queueSonarr(MOVING_EPISODE)
        phaseChange(MOVING.downloadId as string)
        phaseChange(MOVING_EPISODE.downloadId as string)

        await pollAt(T0)

        expect(radarrRefreshes()).toBe(1)
        expect(sonarrRefreshes()).toBe(1)
      })

      it('collapses changes inside EVENT_REFRESH_MIN_MS into the next refresh allowed', async () => {
        queueRadarr(MOVING)

        // Two at once: one refresh.
        phaseChange(MOVING.downloadId as string, 'post_processing')
        phaseChange(MOVING.downloadId as string, 'completed')
        await pollAt(T0)
        expect(radarrRefreshes()).toBe(1)

        // One inside the limit waits for it.
        phaseChange(MOVING.downloadId as string, 'gone')
        await pollAt(T0 + 1_000)
        expect(radarrRefreshes()).toBe(1)

        await pollAt(T0 + EVENT_REFRESH_MIN_MS)
        expect(radarrRefreshes()).toBe(2)

        await pollAt(T0 + EVENT_REFRESH_MIN_MS + 1_000)
        expect(radarrRefreshes()).toBe(2)
      })

      it('drops a change for a download neither queue lists', async () => {
        queueRadarr(MOVING)
        queueSonarr(MOVING_EPISODE)
        phaseChange('SABnzbd_nzo_untracked')

        await pollAt(T0)

        expect(radarrRefreshes()).toBe(0)
        expect(sonarrRefreshes()).toBe(0)
        expect(mediaStateService.takeClientTransitions()).toEqual([])
      })

      it("keeps the other app's changes through this app's pass", async () => {
        queueRadarr(MOVING)
        queueSonarr(MOVING_EPISODE)

        phaseChange(MOVING_EPISODE.downloadId as string, 'post_processing')
        await pollAt(T0)
        expect(sonarrRefreshes()).toBe(1)

        // Sonarr's change waits out its limit while Radarr's pass takes every
        // pending change and spends its own.
        phaseChange(MOVING.downloadId as string)
        phaseChange(MOVING_EPISODE.downloadId as string, 'completed')
        await pollAt(T0 + 1_000)
        expect(radarrRefreshes()).toBe(1)
        expect(sonarrRefreshes()).toBe(1)

        await pollAt(T0 + EVENT_REFRESH_MIN_MS)
        expect(sonarrRefreshes()).toBe(2)
        expect(radarrRefreshes()).toBe(1)
        expect(mediaStateService.takeClientTransitions()).toEqual([])
      })

      it('logs a refused refresh without backing off or sending it again', async () => {
        queueRadarr(MOVING)
        radarrService.refreshMonitoredDownloads.mockRejectedValueOnce(
          new Error('radarr said no'),
        )
        phaseChange(MOVING.downloadId as string)

        await pollAt(T0)

        expect(radarrRefreshes()).toBe(1)
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'requestQueueRefresh',
            error: 'radarr said no',
            source: 'radarr',
          }),
          expect.any(String),
        )
        expect(
          (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
        ).toBe(0)

        // The change was spent on the refused refresh, and it still counts
        // against the limit.
        phaseChange(MOVING.downloadId as string, 'gone')
        await pollAt(T0 + 1_000)
        expect(radarrRefreshes()).toBe(1)
        await pollAt(T0 + EVENT_REFRESH_MIN_MS)
        expect(radarrRefreshes()).toBe(2)
      })
    })
  })

  describe('full queue cache', () => {
    it('reads each queue whole, with no ids', async () => {
      const job = buildMovieJob()
      downloadStateService.jobs.set(job.id, job)
      const show = buildShowJob()
      downloadStateService.jobs.set(show.id, show)

      await service.poll()

      expect(radarrService.getQueue).toHaveBeenCalledWith()
      expect(sonarrService.getQueue).toHaveBeenCalledWith()
    })

    it('stores a queue item no tracked job owns', async () => {
      const unowned: QueueResource = {
        movieId: 77,
        size: 1000,
        sizeleft: 250,
        status: 'downloading',
      }
      const unownedEpisode: SonarrQueueResource = {
        episodeId: 5,
        seasonNumber: 1,
        seriesId: 12,
        status: 'downloading',
      }
      radarrService.getQueue.mockResolvedValue([unowned])
      sonarrService.getQueue.mockResolvedValue([unownedEpisode])

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual([unowned])
      expect(mediaStateService.getQueue('sonarr')).toEqual([unownedEpisode])
    })

    it('stores the whole queue alongside the tracked job it matches', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      const queue: QueueResource[] = [
        { movieId: 42, size: 1000, sizeleft: 500, status: 'downloading' },
        { movieId: 77, size: 1000, sizeleft: 250, status: 'downloading' },
      ]
      radarrService.getQueue.mockResolvedValue(queue)

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual(queue)
      const [frame] = await jobFrames()
      expect(snapshotOf(frame)?.progress).toBe(50)
    })

    // An empty queue is news - whatever was downloading has left - so it
    // replaces the last one rather than being skipped as "nothing to store".
    it('stores an empty queue as empty', async () => {
      mediaStateService.setQueue('radarr', [
        { movieId: 77, status: 'downloading' },
      ])
      radarrService.getQueue.mockResolvedValue([])

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual([])
    })

    it('keeps the previous queue, and backs off, when reading it fails', async () => {
      const previous = [{ movieId: 77, status: 'downloading' }]
      mediaStateService.setQueue('radarr', previous)
      radarrService.getQueue.mockRejectedValueOnce(new Error('radarr down'))

      await service.poll()

      expect(mediaStateService.getQueue('radarr')).toEqual(previous)
      expect((service as unknown as { backoffMs: number }).backoffMs).toBe(
        20_000,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBeGreaterThan(Date.now())
    })

    // Something is downloading that this app didn't start: keep nudging
    // upstream until it leaves the queue, exactly as for a tracked job.
    it('requests a refresh for a non-empty previous queue with nothing tracked', async () => {
      mediaStateService.setQueue('radarr', [
        { movieId: 77, status: 'downloading' },
      ])
      mediaStateService.setQueue('sonarr', [
        { seriesId: 12, status: 'downloading' },
      ])

      await service.poll()

      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(sonarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
      expect(
        radarrService.refreshMonitoredDownloads.mock.invocationCallOrder[0],
      ).toBeLessThan(
        radarrService.getQueue.mock.invocationCallOrder[0] as number,
      )
    })

    // The gate reads the queue as of the *previous* tick, so the first tick
    // that sees an un-owned download reads it un-refreshed and the next one
    // refreshes - and once it has left, the tick after goes quiet again.
    it('gates the refresh on the previous tick, not the one being read', async () => {
      radarrService.getQueue.mockResolvedValue([
        { movieId: 77, status: 'downloading' },
      ])
      await service.poll()
      expect(radarrService.refreshMonitoredDownloads).not.toHaveBeenCalled()

      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)

      await service.poll()
      expect(radarrService.refreshMonitoredDownloads).toHaveBeenCalledTimes(1)
    })
  })

  describe('backoff', () => {
    it('doubles the backoff (capped at 120s) on failure and resets on success', async () => {
      const job = buildMovieJob()
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockRejectedValueOnce(new Error('radarr down'))
      await service.poll()

      expect((service as unknown as { backoffMs: number }).backoffMs).toBe(
        20_000,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBeGreaterThan(Date.now())

      // Clear the artificial backoff window so the next tick actually runs.
      ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt = 0

      radarrService.getQueue.mockResolvedValueOnce([])
      await service.poll()

      expect((service as unknown as { backoffMs: number }).backoffMs).toBe(
        10_000,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)
    })
  })

  describe('pollMovies', () => {
    it('only updates tracked, non-terminal movie jobs', async () => {
      const trackedJob = buildMovieJob({
        id: 'tracked',
        status: DownloadJobStatus.Downloading,
      })
      const completedJob = buildMovieJob({
        id: 'done',
        status: DownloadJobStatus.Completed,
      })
      // Plan 024: a search that found nothing is just as finished.
      const notFoundJob = buildMovieJob({
        id: 'nothing-found',
        status: DownloadJobStatus.NotFound,
      })
      // A title that has been requested but isn't in Radarr's library yet
      // resolves without a radarrId, so there is nothing to poll it by.
      const notInLibraryJob = buildMovieJob({
        id: 'no-id',
        mediaId: 'tmdb:999',
      })
      downloadStateService.jobs.set(trackedJob.id, trackedJob)
      downloadStateService.jobs.set(completedJob.id, completedJob)
      downloadStateService.jobs.set(notFoundJob.id, notFoundJob)
      downloadStateService.jobs.set(notInLibraryJob.id, notInLibraryJob)
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, size: 1000, sizeleft: 500, status: 'downloading' },
      ])

      await service.poll()

      expect(radarrService.getQueue).toHaveBeenCalledWith()
      // Only the tracked job moved; the completed and not-found ones and the
      // one with no library id were never matched against the queue.
      expect(updateJobSpy).not.toHaveBeenCalled()
      // The tracked job's progress still went out, as a bare re-broadcast.
      expect((await jobFrames()).map(frame => frame.job.id)).toEqual([
        trackedJob.id,
      ])
      expect(downloadStateService.jobs.get(notInLibraryJob.id)?.status).toBe(
        DownloadJobStatus.Searching,
      )
    })

    it('updates the job status when the queue entry changes', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([
        {
          movieId: 42,
          status: 'downloading',
          size: 1000,
          sizeleft: 500,
        },
      ])

      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Downloading)
      // The snapshot is never on the job - the frame's media carries the
      // one the resolver derived from the queue cache.
      const frames = await jobFrames()
      expect(frames).toHaveLength(1)
      expect(snapshotOf(frames[0])).toMatchObject({
        progress: 50,
        status: 'downloading',
      })
    })

    it('neither calls updateJob nor broadcasts when nothing has changed', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, status: 'downloading', size: 1000, sizeleft: 500 },
      ])
      await service.poll()
      await flushAsync()
      downloadGateway.broadcastPerViewer.mockClear()
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      await service.poll()

      expect(updateJobSpy).not.toHaveBeenCalled()
      expect(await jobFrames()).toEqual([])
    })

    it('marks the job Completed once it leaves the queue with its file imported', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('evicts the media from the resolver cache before broadcasting Completed', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])

      await service.poll()

      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(job.mediaId)
      expect(
        mediaResolverService.invalidate.mock.invocationCallOrder[0],
      ).toBeLessThan(updateJobSpy.mock.invocationCallOrder[0] as number)
    })

    it('leaves the resolver cache alone for a non-terminal status change', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, status: 'downloading', size: 1000, sizeleft: 500 },
      ])

      await service.poll()

      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
    })

    // A failed item is not a failed job: history's `failed` event says
    // whether Radarr retries. Only an item still failed two minutes on - no
    // event is coming - is put in front of a person.
    it('holds a failed queue item, then asks for attention once it lingers', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      radarrService.getQueue.mockResolvedValue([
        {
          movieId: 42,
          status: 'failed',
          statusMessages: [{ title: 'x', messages: ['no seeds found'] }],
        },
      ])

      at(T0)
      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + ATTENTION_DELAY_MS)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe('no seeds found')
    })

    it("carries Radarr's delay as a note on a searching job", async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      const until = new Date(T0 + 3_600_000)
      radarrService.getQueue.mockResolvedValue([
        {
          estimatedCompletionTime: until.toISOString(),
          movieId: 42,
          status: 'delay',
        },
      ])

      await service.poll()

      const hh = String(until.getHours()).padStart(2, '0')
      const mm = String(until.getMinutes()).padStart(2, '0')
      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Searching)
      expect(updated?.statusNote).toBe(`Delayed by Radarr until ${hh}:${mm}`)
      expect(getJobById(dbService.db, job.id)?.statusNote).toBe(
        `Delayed by Radarr until ${hh}:${mm}`,
      )

      // Grabbed for real: the note goes with the status it described.
      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, size: 1000, sizeleft: 500, status: 'downloading' },
      ])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)).toMatchObject({
        status: DownloadJobStatus.Downloading,
        statusNote: undefined,
      })
      expect(getJobById(dbService.db, job.id)?.statusNote).toBeNull()
    })
  })

  // A job's `media.queueSnapshot` is the resolver's, off the queue cache, so
  // the poller's only part in live progress is deciding when a job is worth
  // re-broadcasting - once per change, never twice in a tick.
  describe('job frames', () => {
    const downloading = (sizeleft: number): QueueResource => ({
      movieId: 42,
      size: 1000,
      sizeleft,
      status: 'downloading',
    })

    async function pollOnce(): Promise<DownloadJobEvent[]> {
      downloadGateway.broadcastPerViewer.mockClear()
      await service.poll()
      return jobFrames()
    }

    it('sends one Updated frame carrying the new progress on a progress-only tick', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()
      const updateJobSpy = jest.spyOn(downloadStateService, 'updateJob')

      radarrService.getQueue.mockResolvedValue([downloading(250)])
      const frames = await pollOnce()

      expect(updateJobSpy).not.toHaveBeenCalled()
      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({
        job: { id: job.id, status: DownloadJobStatus.Downloading },
        type: DownloadJobEventType.Updated,
      })
      expect(snapshotOf(frames[0])?.progress).toBe(75)
    })

    it('sends no frame when the snapshot is unchanged', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()

      expect(await pollOnce()).toEqual([])
    })

    it('sends one frame, not two, when the status and the progress move together', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      const touchSpy = jest.spyOn(downloadStateService, 'touchJob')

      radarrService.getQueue.mockResolvedValue([downloading(500)])
      const frames = await pollOnce()

      expect(touchSpy).not.toHaveBeenCalled()
      expect(frames).toHaveLength(1)
      expect(frames[0]?.job.status).toBe(DownloadJobStatus.Downloading)
      expect(snapshotOf(frames[0])?.progress).toBe(50)
    })

    // The item is gone but nothing has landed yet, so the job stays where it
    // is - and its frame must stop showing the progress it last had.
    it('sends one frame without a snapshot when the item leaves the queue unsettled', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()

      radarrService.getQueue.mockResolvedValue([])
      const frames = await pollOnce()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(frames).toHaveLength(1)
      expect(frames[0]?.job.media).not.toHaveProperty('queueSnapshot')
      // Still gone: nothing new to say.
      expect(await pollOnce()).toEqual([])
    })

    it('sends only the status frame when the item leaves and the job settles in the same tick', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([downloading(500)])
      await pollOnce()
      const touchSpy = jest.spyOn(downloadStateService, 'touchJob')

      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])
      const frames = await pollOnce()

      expect(touchSpy).not.toHaveBeenCalled()
      expect(frames).toHaveLength(1)
      expect(frames[0]?.job.status).toBe(DownloadJobStatus.Completed)
    })

    // Radarr's own numbers only move when it re-reads SABnzbd; the job's
    // snapshot follows SAB's live reading of the same download every tick.
    it("sends a frame with SAB's bytes each tick while Radarr's numbers stand still", async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([
        { ...downloading(500), downloadId: 'SABnzbd_nzo_movie' },
      ])
      const reading = (downloadedBytes: number): SabReading => ({
        diskFreeGb: 500,
        downloadedBytes,
        etaSeconds: 30,
        failMessage: null,
        globallyPaused: false,
        nzoId: 'SABnzbd_nzo_movie',
        phase: 'downloading',
        seenAt: 0,
        speedBps: 100,
        stage: null,
        stageDetail: null,
        totalBytes: 1000,
      })
      const readSab = (downloadedBytes: number) =>
        mediaStateService.setClientReadings(
          new Map([['SABnzbd_nzo_movie', reading(downloadedBytes)]]),
          'ok',
        )

      readSab(600)
      const first = await pollOnce()
      readSab(700)
      const second = await pollOnce()

      expect(first).toHaveLength(1)
      expect(snapshotOf(first[0])).toMatchObject({
        downloadedBytes: 600,
        progress: 60,
        stage: 'downloading',
      })
      expect(second).toHaveLength(1)
      expect(snapshotOf(second[0])).toMatchObject({
        downloadedBytes: 700,
        progress: 70,
      })
      // The same reading again: nothing new to say.
      expect(await pollOnce()).toEqual([])
    })
  })

  describe('pollShows', () => {
    it('only updates tracked, non-terminal show jobs', async () => {
      const trackedJob = buildShowJob({ status: DownloadJobStatus.Downloading })
      const failedJob = buildShowJob({
        id: 'failed',
        status: DownloadJobStatus.Failed,
      })
      downloadStateService.jobs.set(trackedJob.id, trackedJob)
      downloadStateService.jobs.set(failedJob.id, failedJob)

      sonarrService.getQueue.mockResolvedValue([
        { seriesId: 9, size: 100, sizeleft: 50, status: 'downloading' },
      ])

      await service.poll()

      expect(sonarrService.getQueue).toHaveBeenCalledWith()
      expect((await jobFrames()).map(frame => frame.job.id)).toEqual([
        trackedJob.id,
      ])
      expect(downloadStateService.jobs.get(failedJob.id)?.status).toBe(
        DownloadJobStatus.Failed,
      )
    })

    it('updates the show job status from the queue entry', async () => {
      const job = buildShowJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { seriesId: 9, trackedDownloadState: 'importing' },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Importing,
      )
    })
  })

  describe('pollShows with scoped jobs', () => {
    // The regression this whole aggregation exists for: Sonarr queues one
    // item per episode, so taking the first hit made a season job report
    // "Completed" the moment its first episode landed.
    it('does not complete a season job while later episodes are still downloading', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 0,
          trackedDownloadState: 'imported',
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 80,
          status: 'downloading',
        },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      // Progress is over the whole season, not over the finished episode.
      const [frame] = await jobFrames()
      expect(snapshotOf(frame)?.progress).toBe(60)
    })

    it('completes a season job once every episode leaves the queue with its file', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([])
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 901, id: 1, seasonNumber: 3, seriesId: 9 },
        { episodeFileId: 902, id: 2, seasonNumber: 3, seriesId: 9 },
      ])
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 901, seasonNumber: 3, seriesId: 9 },
        { dateAdded: AFTER_ISO, id: 902, seasonNumber: 3, seriesId: 9 },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    // The frame's snapshot is the series' - the media is per-title - but
    // whether a job is re-broadcast at all is decided by its own scope.
    it('re-broadcasts only the jobs whose own queue items moved', async () => {
      const episodeJob = buildShowJob({
        id: 'show-episode',
        scope: { episodeId: 2, seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      const seriesJob = buildShowJob({
        id: 'show-series',
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(episodeJob.id, episodeJob)
      downloadStateService.jobs.set(seriesJob.id, seriesJob)
      const queue = (episodeOneLeft: number): SonarrQueueResource[] => [
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: episodeOneLeft,
          status: 'downloading',
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 50,
          status: 'downloading',
        },
      ]

      sonarrService.getQueue.mockResolvedValue(queue(100))
      await service.poll()
      expect((await jobFrames()).map(frame => frame.job.id).sort()).toEqual([
        episodeJob.id,
        seriesJob.id,
      ])
      downloadGateway.broadcastPerViewer.mockClear()

      // Only episode 1 moved, which is outside the episode job's scope.
      sonarrService.getQueue.mockResolvedValue(queue(0))
      await service.poll()

      const frames = await jobFrames()
      expect(frames.map(frame => frame.job.id)).toEqual([seriesJob.id])
      expect(snapshotOf(frames[0])?.progress).toBe(75)
    })

    // An item Sonarr can't attribute to an episode is not evidence about
    // *this* episode.
    it('never matches a null-episodeId item to an episode-scoped job', async () => {
      const job = buildShowJob({
        scope: { episodeId: 2 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { episodeId: null, seriesId: 9, status: 'downloading' },
      ])

      await service.poll()

      // No match at all, so the job is settled from its files - and with
      // none landed and no download linked, it is left where it was.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
    })

    it('ignores queue items from another season', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 7, seasonNumber: 4, seriesId: 9, status: 'failed' },
      ])

      await service.poll()

      // Not Failed: the other season's failure is not this job's.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
    })

    // Season 0 is specials - a truthiness check would match every item.
    it('treats season 0 as a real filter', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 0 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 7, seasonNumber: 1, seriesId: 9, status: 'downloading' },
      ])

      await service.poll()

      // The season 1 item is no evidence about season 0, so the job has no
      // item at all and nothing it can be settled from yet.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
    })

    it('surfaces every failure message across a scope once it lingers', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)
      at(T0)

      sonarrService.getQueue.mockResolvedValue([
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          status: 'failed',
          statusMessages: [{ messages: ['repair failed'], title: 'a' }],
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          status: 'failed',
          statusMessages: [{ messages: ['unpack failed'], title: 'b' }],
        },
      ])

      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + ATTENTION_DELAY_MS)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe('repair failed; unpack failed')
    })
  })

  describe('needs_attention reasons', () => {
    // Every test here polls the real fixture, so the job has to resolve to
    // the movie it actually belongs to.
    function seedBlockedMovieJob(): DownloadJobRecord {
      upstreamIds.set('tmdb:445571', 434)
      const job = buildMovieJob({
        mediaId: 'tmdb:445571',
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)
      return job
    }

    /**
     * Polls the blocked import until it has lingered long enough to be put
     * in front of a person: Radarr retries a pending import by itself every
     * minute, so the first two minutes read as Importing.
     */
    async function pollUntilBlocked(): Promise<void> {
      radarrService.getQueue.mockResolvedValue([BLOCKED_IMPORT_ITEM])
      at(T0)
      await service.poll()
      at(T0 + ATTENTION_DELAY_MS)
      await service.poll()
    }

    it("carries upstream's own sentence onto the job once an import stays blocked", async () => {
      const job = seedBlockedMovieJob()

      radarrService.getQueue.mockResolvedValue([BLOCKED_IMPORT_ITEM])
      at(T0)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Importing,
      )

      at(T0 + ATTENTION_DELAY_MS)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe(BLOCKED_IMPORT_REASON)
    })

    // `updateJob` spreads its patch over the record and never touches
    // `error` on its own, so nothing clears it implicitly. Without the
    // explicit `undefined` the job would carry "was not found in the grabbed
    // release" into history forever - including into the persisted row,
    // which `buildJobRow` writes as `record.error ?? null`.
    it('drops the reason from the record and the row once the job completes', async () => {
      const job = seedBlockedMovieJob()

      await pollUntilBlocked()

      expect(getJobById(dbService.db, job.id)?.error).toBe(
        BLOCKED_IMPORT_REASON,
      )

      // A human worked the manual-import dialog, so Radarr imported the file
      // from the job's own download and dropped the row.
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 434 },
      ])
      radarrService.getMovieHistory.mockResolvedValue([
        {
          data: { fileId: '501' },
          date: AFTER_ISO,
          downloadId: BLOCKED_IMPORT_ITEM.downloadId,
          eventType: 'downloadFolderImported',
          movieId: 434,
        },
      ])
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Completed)
      expect(updated?.error).toBeUndefined()
      expect(getJobById(dbService.db, job.id)?.error).toBeNull()
    })

    // The status never moves and neither does the snapshot, so the only
    // thing that makes this tick a change at all is the sentence itself.
    it('re-writes the reason when upstream re-parses while still blocked', async () => {
      const job = seedBlockedMovieJob()

      await pollUntilBlocked()

      const reparsed =
        'Found matching movie via grab history, but release was matched to movie by ID. Automatic import is not possible.'
      radarrService.getQueue.mockResolvedValue([
        {
          ...BLOCKED_IMPORT_ITEM,
          statusMessages: [
            { messages: [reparsed], title: BLOCKED_IMPORT_ITEM.title },
          ],
        },
      ])
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe(reparsed)
    })

    it('replaces the block reason with the failure message once a later failure lingers', async () => {
      const job = seedBlockedMovieJob()

      await pollUntilBlocked()

      radarrService.getQueue.mockResolvedValue([
        {
          ...BLOCKED_IMPORT_ITEM,
          status: 'failed',
          statusMessages: [
            {
              messages: ['Download client reported an error'],
              title: BLOCKED_IMPORT_ITEM.title,
            },
          ],
          trackedDownloadState: 'failedPending',
        },
      ])
      at(T0 + ATTENTION_DELAY_MS + 1_000)
      await service.poll()

      // A new state restarts the clock: until history says what became of
      // the failure, the job stays where it was.
      expect(downloadStateService.jobs.get(job.id)).toMatchObject({
        error: BLOCKED_IMPORT_REASON,
        status: DownloadJobStatus.NeedsAttention,
      })

      at(T0 + 2 * ATTENTION_DELAY_MS + 1_000)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe('Download client reported an error')
    })

    // A season is blocked as a whole the moment any one of its episodes is:
    // that is the one thing in the scope a person can act on now, and the
    // sibling still transferring must not hide it.
    it('reports a season blocked by one episode, with every message joined', async () => {
      const job = buildShowJob({
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)

      sonarrService.getQueue.mockResolvedValue([
        {
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 0,
          status: 'completed',
          statusMessages: [
            {
              messages: [
                'Episode [S03E01] was not found in the grabbed release',
                'One or more episodes expected in this release were not imported or missing',
              ],
              title: 'A.Show.S03E01.1080p.WEB.x265',
            },
          ],
          trackedDownloadState: 'importBlocked',
          trackedDownloadStatus: 'warning',
        },
        {
          episodeId: 2,
          seasonNumber: 3,
          seriesId: 9,
          size: 100,
          sizeleft: 40,
          status: 'downloading',
        },
      ])

      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.NeedsAttention)
      expect(updated?.error).toBe(
        'Episode [S03E01] was not found in the grabbed release; One or more episodes expected in this release were not imported or missing',
      )
    })
  })

  describe('media events', () => {
    // What upstream holds right now, by media id: a movie (Radarr 77) and a
    // series (Sonarr 12) that no job owns. The resolver mock below models the
    // real one's library cache - it serves the copy it first read until
    // `invalidate()` evicts it - so an event can only carry a freshly
    // imported file if the poller invalidated before resolving.
    let upstream: Map<string, Movie | Show>
    let cached: Map<string, Movie | Show>

    const UNOWNED_MOVIE_ITEM: QueueResource = {
      movieId: 77,
      size: 1000,
      sizeleft: 750,
      status: 'downloading',
    }

    function mediaEvents(): MediaEvent[] {
      return downloadGateway.broadcast.mock.calls.map(([message]) => {
        expect(message.type).toBe(MEDIA_EVENT_TYPE)
        return message.data as MediaEvent
      })
    }

    function buildEpisodes(count: number): EpisodeResource[] {
      return Array.from({ length: count }, (_, index) => ({
        episodeNumber: index + 1,
        hasFile: false,
        id: index + 1,
        monitored: true,
        seasonNumber: 1,
        seriesId: 12,
      }))
    }

    beforeEach(() => {
      // Every download here is one no job owns, which the poller would
      // otherwise adopt - minting a job and reading the library and episodes
      // to do it. This block covers the media diff on its own; adoption has
      // its own block below.
      jest
        .spyOn(
          service as unknown as {
            adoptUnownedDownloads: () => Promise<void>
          },
          'adoptUnownedDownloads',
        )
        .mockResolvedValue(undefined)

      upstream = new Map<string, Movie | Show>([
        [
          'tmdb:500',
          {
            id: 'tmdb:500',
            monitored: true,
            radarrId: 77,
            title: 'Unowned Movie',
            tmdbId: 500,
            type: DownloadType.Movie,
          },
        ],
        [
          'tvdb:300',
          {
            id: 'tvdb:300',
            monitored: true,
            sonarrId: 12,
            title: 'Unowned Show',
            tvdbId: 300,
            type: DownloadType.Show,
          },
        ],
      ])
      cached = new Map()

      mediaResolverService.getMovieLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(upstream.values())
              .filter(isMovie)
              .map(movie => [movie.tmdbId, movie]),
          ),
      )
      mediaResolverService.getShowLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(upstream.values())
              .filter(isShow)
              .map(show => [show.tvdbId, show]),
          ),
      )
      mediaResolverService.invalidate.mockImplementation(key => {
        cached.delete(key)
      })

      const byUpstreamIds = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve.mockImplementation(async keys => {
        const result = await byUpstreamIds!(keys)

        for (const { mediaId } of keys) {
          const current = upstream.get(mediaId)
          if (!current) continue

          if (!cached.has(mediaId)) cached.set(mediaId, { ...current })
          result.media.set(mediaId, cached.get(mediaId) as Movie | Show)
        }

        // What the real resolve() ends on.
        mediaStateService.annotate(result.media.values())
        return result
      })
    })

    it('costs nothing while both queues are empty', async () => {
      await service.poll()

      expect(mediaResolverService.getMovieLibrary).not.toHaveBeenCalled()
      expect(mediaResolverService.resolve).not.toHaveBeenCalled()
      expect(sonarrService.getEpisodes).not.toHaveBeenCalled()
      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
    })

    it('broadcasts a download no job owns the first tick it is seen', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

      await service.poll()

      expect(downloadStateService.jobs.size).toBe(0)
      const events = mediaEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.media).toMatchObject({
        id: 'tmdb:500',
        queueSnapshot: { progress: 25, status: 'downloading' },
        state: 'downloading',
      })
      expect(events[0]).not.toHaveProperty('episodes')
    })

    it('sends nothing on a tick that changed nothing', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

      await service.poll()
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
    })

    // Anything seen last tick already knows its media id, so the library is
    // read only for an upstream id that is new.
    it('reads the library only for a queue item it has not seen before', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

      await service.poll()
      await service.poll()

      expect(mediaResolverService.getMovieLibrary).toHaveBeenCalledTimes(1)
    })

    // Added in Radarr's own UI, which searches and grabs within seconds: the
    // resolver's library cache was filled before the add, and serves that
    // copy until `invalidateLibrary()` drops it.
    describe('a title added upstream after the library was cached', () => {
      let cachedLibrary: Map<number, Movie> | undefined

      beforeEach(() => {
        cachedLibrary = new Map()
        mediaResolverService.getMovieLibrary.mockImplementation(async () => {
          cachedLibrary ??= new Map(
            Array.from(upstream.values())
              .filter(isMovie)
              .map(movie => [movie.tmdbId, movie]),
          )
          return cachedLibrary
        })
        mediaResolverService.invalidateLibrary.mockImplementation(() => {
          cachedLibrary = undefined
        })
      })

      it('re-reads the library and broadcasts the download the first tick it is seen', async () => {
        radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])

        await service.poll()

        expect(mediaResolverService.invalidateLibrary).toHaveBeenCalledWith(
          DownloadType.Movie,
        )
        const events = mediaEvents()
        expect(events).toHaveLength(1)
        expect(events[0]?.media).toMatchObject({
          id: 'tmdb:500',
          state: 'downloading',
        })
      })

      it('re-reads the library only once for an id it still cannot find', async () => {
        radarrService.getQueue.mockResolvedValue([
          { ...UNOWNED_MOVIE_ITEM, movieId: 99 },
        ])

        await service.poll()
        await service.poll()
        await service.poll()

        expect(mediaResolverService.invalidateLibrary).toHaveBeenCalledTimes(1)
        expect(mediaEvents()).toHaveLength(0)
      })

      it('re-reads the library again once the id leaves the queue and comes back', async () => {
        const orphan = { ...UNOWNED_MOVIE_ITEM, movieId: 99 }
        radarrService.getQueue.mockResolvedValue([orphan])
        await service.poll()
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
        radarrService.getQueue.mockResolvedValue([orphan])

        await service.poll()

        expect(mediaResolverService.invalidateLibrary).toHaveBeenCalledTimes(2)
      })
    })

    it('sends one event when the progress moves', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      await service.poll()

      radarrService.getQueue.mockResolvedValue([
        { ...UNOWNED_MOVIE_ITEM, sizeleft: 500 },
      ])
      await service.poll()

      const events = mediaEvents()
      expect(events).toHaveLength(2)
      expect(events[1]?.media).toMatchObject({
        queueSnapshot: { progress: 50 },
      })
    })

    it('sends one last event, carrying the imported file, once the item leaves the queue', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      await service.poll()

      // Radarr imported it between ticks.
      upstream.set('tmdb:500', {
        ...(upstream.get('tmdb:500') as Movie),
        filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
      })
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      const events = mediaEvents()
      expect(events).toHaveLength(2)
      expect(events[1]?.media).toMatchObject({
        filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
        id: 'tmdb:500',
        state: 'available',
      })
      expect(events[1]?.media).not.toHaveProperty('queueSnapshot')

      expect(mediaResolverService.invalidate).toHaveBeenCalledWith('tmdb:500')
      expect(
        mediaResolverService.invalidate.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mediaResolverService.resolve.mock.invocationCallOrder.at(-1) as number,
      )
    })

    it('sends nothing more once the last event, carrying the file, is out', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      await service.poll()
      upstream.set('tmdb:500', {
        ...(upstream.get('tmdb:500') as Movie),
        filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
      })
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      const resolveCalls = mediaResolverService.resolve.mock.calls.length

      await service.poll()

      expect(mediaEvents()).toHaveLength(2)
      expect(mediaResolverService.resolve).toHaveBeenCalledTimes(resolveCalls)
    })

    // The import race, for a download no job owns: the item goes a tick
    // before Radarr lists the file. The vanish frame is truthfully "no file",
    // so the media stays watched - re-read fresh each tick - until the file
    // lands, or for the grace period if it never does.
    describe('after the item leaves with no file listed', () => {
      async function vanishWithoutFile(): Promise<void> {
        at(T0)
        radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
        await service.poll()

        at(T0 + 10_000)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
      }

      afterEach(() => {
        jest.restoreAllMocks()
      })

      it('says wanted, then sends one more frame once the file is listed', async () => {
        await vanishWithoutFile()

        expect(mediaEvents().at(-1)?.media).toMatchObject({ state: 'wanted' })

        upstream.set('tmdb:500', {
          ...(upstream.get('tmdb:500') as Movie),
          filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
        })
        at(T0 + 20_000)
        clearBackoff()
        await service.poll()

        const events = mediaEvents()
        expect(events).toHaveLength(3)
        expect(events[2]?.media).toMatchObject({
          filePath: '/movies/Unowned Movie (2020)/unowned.mkv',
          state: 'available',
        })

        // Landed: no longer watched.
        const resolveCalls = mediaResolverService.resolve.mock.calls.length
        at(T0 + 30_000)
        await service.poll()
        expect(mediaResolverService.resolve).toHaveBeenCalledTimes(resolveCalls)
      })

      it('re-reads it fresh every tick while watched, sending nothing unchanged', async () => {
        await vanishWithoutFile()
        mediaResolverService.invalidate.mockClear()

        at(T0 + 20_000)
        await service.poll()

        expect(mediaResolverService.invalidate).toHaveBeenCalledWith('tmdb:500')
        expect(mediaEvents()).toHaveLength(2)
      })

      it('stops watching once the grace period passes with no file', async () => {
        await vanishWithoutFile()

        at(T0 + 10_000 + 59_000)
        await service.poll()
        expect(mediaResolverService.resolve).toHaveBeenCalledTimes(3)

        at(T0 + 10_000 + 60_000)
        await service.poll()
        const resolveCalls = mediaResolverService.resolve.mock.calls.length

        at(T0 + 10_000 + 70_000)
        await service.poll()

        expect(mediaResolverService.resolve).toHaveBeenCalledTimes(resolveCalls)
        expect(mediaEvents()).toHaveLength(2)
      })

      // A series that already had episodes is `available` before this grab
      // even started, so the series state can't say the grab landed - the
      // episodes it had queued can.
      it('watches a series until the episodes it had queued have files', async () => {
        const withFiles = (ids: readonly number[]): EpisodeResource[] =>
          buildEpisodes(3).map(episode => ({
            ...episode,
            hasFile: ids.includes(episode.id as number),
          }))
        upstream.set('tvdb:300', {
          ...(upstream.get('tvdb:300') as Show),
          episodeFileCount: 1,
        })
        sonarrService.getEpisodes.mockResolvedValue(withFiles([1]))

        at(T0)
        sonarrService.getQueue.mockResolvedValue([
          {
            episodeId: 2,
            seasonNumber: 1,
            seriesId: 12,
            status: 'downloading',
          },
        ])
        await service.poll()

        at(T0 + 10_000)
        sonarrService.getQueue.mockResolvedValue([])
        await service.poll()

        expect(mediaEvents().at(-1)?.media).toMatchObject({
          state: 'available',
        })
        expect(
          mediaEvents()
            .at(-1)
            ?.episodes?.find(entry => entry.episodeId === 2),
        ).toMatchObject({ state: 'wanted' })

        sonarrService.getEpisodes.mockResolvedValue(withFiles([1, 2]))
        at(T0 + 20_000)
        await service.poll()

        expect(
          mediaEvents()
            .at(-1)
            ?.episodes?.find(entry => entry.episodeId === 2),
        ).toMatchObject({ state: 'available' })

        const episodeReads = sonarrService.getEpisodes.mock.calls.length
        at(T0 + 30_000)
        await service.poll()
        expect(sonarrService.getEpisodes).toHaveBeenCalledTimes(episodeReads)
      })
    })

    it('sends a series as one event carrying every episode, however many are queued', async () => {
      sonarrService.getEpisodes.mockResolvedValue(buildEpisodes(200))
      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 1, seasonNumber: 1, seriesId: 12, status: 'downloading' },
        { episodeId: 2, seasonNumber: 1, seriesId: 12, status: 'downloading' },
        { episodeId: 3, seasonNumber: 1, seriesId: 12, status: 'downloading' },
      ])

      await service.poll()

      const events = mediaEvents()
      expect(events).toHaveLength(1)
      expect(events[0]?.media).toMatchObject({
        id: 'tvdb:300',
        state: 'downloading',
      })
      expect(sonarrService.getEpisodes).toHaveBeenCalledTimes(1)
      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(12)

      const episodes = events[0]?.episodes ?? []
      expect(episodes).toHaveLength(200)
      expect(episodes[0]).toMatchObject({ episodeId: 1, state: 'downloading' })
      expect(episodes[3]).toEqual({
        episodeId: 4,
        seasonNumber: 1,
        state: 'wanted',
      })
    })

    it('skips a series whose episodes cannot be read, and retries it next tick', async () => {
      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 1, seasonNumber: 1, seriesId: 12, status: 'downloading' },
      ])
      sonarrService.getEpisodes.mockRejectedValueOnce(new Error('sonarr down'))

      await service.poll()

      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      sonarrService.getEpisodes.mockResolvedValue(buildEpisodes(1))
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
    })

    it('swallows a resolve failure without disturbing the job update', async () => {
      upstream.set('tmdb:1', {
        id: 'tmdb:1',
        monitored: true,
        radarrId: 42,
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      })
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([
        { movieId: 42, size: 1000, sizeleft: 500, status: 'downloading' },
      ])
      // The job lookup's resolve succeeds and every later one - the media
      // diff's, and the job broadcast's fire-and-forget hydrate - rejects.
      const resolve = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve
        .mockImplementationOnce(resolve!)
        .mockRejectedValue(new Error('resolver broke'))

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      // Nothing was recorded, so the next tick sends it.
      mediaResolverService.resolve.mockImplementation(resolve!)
      await service.poll()

      expect(mediaEvents().map(event => event.media.id)).toEqual(['tmdb:1'])
    })

    it('sends no vanish event for a source whose queue read failed', async () => {
      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 1, seasonNumber: 1, seriesId: 12, status: 'downloading' },
      ])
      await service.poll()
      expect(mediaEvents()).toHaveLength(1)

      sonarrService.getQueue.mockRejectedValueOnce(new Error('sonarr down'))
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()

      // Still queued once Sonarr answers again: nothing moved, nothing sent.
      clearBackoff()
      await service.poll()

      expect(mediaEvents()).toHaveLength(1)
    })

    it('skips the batch, and retries it, when the resolve comes back degraded', async () => {
      radarrService.getQueue.mockResolvedValue([UNOWNED_MOVIE_ITEM])
      const resolve = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve.mockImplementationOnce(async keys => ({
        ...(await resolve!(keys)),
        degradedSources: [DownloadType.Movie],
      }))

      await service.poll()
      expect(downloadGateway.broadcast).not.toHaveBeenCalled()

      await service.poll()
      expect(mediaEvents()).toHaveLength(1)
    })
  })

  describe('completionInputs', () => {
    // Private - `settleAbsentJobs` is its only caller - but its batching is
    // a contract of its own, so it is exercised directly as well as through
    // `poll()` below.
    function completionInputs(
      type: DownloadType.Movie | DownloadType.Show,
      jobs: readonly TrackedJob[],
    ): Promise<Map<string, PollableCompletionData>> {
      return (
        service as unknown as {
          completionInputs: (
            type: DownloadType.Movie | DownloadType.Show,
            jobs: readonly TrackedJob[],
          ) => Promise<Map<string, PollableCompletionData>>
        }
      ).completionInputs(type, jobs)
    }

    // The steady state: every job has a queue entry, so nothing ever reaches
    // the completion check and it must cost exactly nothing.
    it('makes no upstream call at all when handed no jobs', async () => {
      const movies = await completionInputs(DownloadType.Movie, [])
      const shows = await completionInputs(DownloadType.Show, [])

      expect(movies.size).toBe(0)
      expect(shows.size).toBe(0)
      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
      expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
      expect(sonarrService.getEpisodes).not.toHaveBeenCalled()
    })

    it('returns a movie job its movie files, keyed by job id', async () => {
      const record = buildMovieJob()
      const files: MovieFileResource[] = [
        { dateAdded: NOW_ISO, id: 501, movieId: 42 },
      ]
      radarrService.getMovieFiles.mockResolvedValue(files)

      const result = await completionInputs(DownloadType.Movie, [
        { record, upstreamId: 42 },
      ])

      expect(radarrService.getMovieFiles).toHaveBeenCalledWith(42)
      expect(result.get(record.id)).toEqual({ files })
      // A movie is one file with no episode indirection, so there is nothing
      // to join and `episodes` stays absent rather than empty.
      expect(result.get(record.id)?.episodes).toBeUndefined()
      expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
    })

    it('returns a show job both its episode files and its episodes', async () => {
      const record = buildShowJob({ scope: { episodeId: 77, seasonNumber: 3 } })
      const files: EpisodeFileResource[] = [
        { dateAdded: NOW_ISO, id: 900, seasonNumber: 3, seriesId: 9 },
      ]
      const episodes: EpisodeResource[] = [
        { episodeFileId: 900, id: 77, seasonNumber: 3, seriesId: 9 },
      ]
      sonarrService.getEpisodeFiles.mockResolvedValue(files)
      sonarrService.getEpisodes.mockResolvedValue(episodes)

      const result = await completionInputs(DownloadType.Show, [
        { record, upstreamId: 9 },
      ])

      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
      // Unfiltered by season: one list per series serves every scope, which
      // is what lets differently-scoped jobs share the call below.
      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9)
      // `EpisodeFileResource` has no `episodeId`, so the episodes are the
      // only way back from `scope.episodeId` to a file - hence both.
      expect(result.get(record.id)).toEqual({ episodes, files })
    })

    // The whole point of the helper: four episode-scoped jobs on one series
    // read one series-wide file list, so they must cost one fetch, not four.
    it('fetches once per distinct upstreamId, not once per job', async () => {
      const jobs: TrackedJob[] = [1, 2, 3, 4].map(episodeId =>
        buildTrackedShowJob(9, {
          id: `show-${episodeId}`,
          scope: { episodeId, seasonNumber: 3 },
        }),
      )

      const result = await completionInputs(DownloadType.Show, jobs)

      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledTimes(1)
      expect(sonarrService.getEpisodes).toHaveBeenCalledTimes(1)
      expect(result.size).toBe(4)
      // Every job is keyed separately but shares the one fetched result.
      const shared = result.get('show-1')
      expect(shared).toBeDefined()
      for (const job of jobs) {
        expect(result.get(job.record.id)).toBe(shared)
      }
    })

    it('still fetches once per series when the jobs span two series', async () => {
      const result = await completionInputs(DownloadType.Show, [
        buildTrackedShowJob(9, { id: 'a' }),
        buildTrackedShowJob(9, { id: 'b' }),
        buildTrackedShowJob(11, { id: 'c' }),
      ])

      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledTimes(2)
      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(11)
      expect(result.get('a')).toBe(result.get('b'))
      expect(result.get('a')).not.toBe(result.get('c'))
    })

    // One title's failed read must not hold up another's, nor trip the
    // poll's backoff: its jobs are simply left out, and stay as they are.
    it('leaves out only the jobs whose title could not be read', async () => {
      sonarrService.getEpisodeFiles.mockImplementation(async seriesId => {
        if (seriesId === 11) throw new Error('sonarr down')
        return []
      })

      const result = await completionInputs(DownloadType.Show, [
        buildTrackedShowJob(9, { id: 'a' }),
        buildTrackedShowJob(11, { id: 'b' }),
      ])

      expect(result.has('a')).toBe(true)
      expect(result.has('b')).toBe(false)
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'completionInputs',
          error: 'sonarr down',
          upstreamId: 11,
        }),
        expect.any(String),
      )
    })
  })

  describe('settling a job with no queue item', () => {
    function absentSince(): Map<string, number> {
      return (service as unknown as { absentSince: Map<string, number> })
        .absentSince
    }

    const DOWNLOADING_ITEM: QueueResource = {
      movieId: 42,
      size: 1000,
      sizeleft: 500,
      status: 'downloading',
    }

    /** The same download, carrying the id the job is linked by. */
    const LINKED_ITEM: QueueResource = {
      ...DOWNLOADING_ITEM,
      downloadId: 'dl-1',
    }

    it('reads no files while every job has a queue item', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([DOWNLOADING_ITEM])

      await service.poll()

      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
      expect(absentSince().size).toBe(0)
    })

    // The race the grace period exists for: the queue row goes a tick before
    // the file listing shows the import.
    it('completes a job whose file is listed a tick after its item left', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)

      at(T0)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()

      at(T0 + 10_000)
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
      expect(downloadStateService.jobs.get(job.id)?.error).toBeUndefined()
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(job.mediaId)
      expect(absentSince().has(job.id)).toBe(false)
    })

    // No link, no evidence: an empty queue alone never ends a job, however
    // long it lasts. The old minute's grace failed live downloads whenever
    // SABnzbd blinked.
    it('leaves a job with no download link alone however long it is gone', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      at(T0)
      await service.poll()
      at(T0 + 61_000)
      await service.poll()
      at(T0 + ABSENT_REMOVED_MS + 61_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
    })

    it('cancels a linked show job gone ten minutes from a healthy client', async () => {
      const job = await seed(
        buildShowJob({
          scope: { seasonNumber: 3 },
          status: DownloadJobStatus.Importing,
        }),
      )

      at(T0)
      sonarrService.getQueue.mockResolvedValue([
        {
          downloadId: 'dl-show',
          episodeId: 1,
          seasonNumber: 3,
          seriesId: 9,
          status: 'completed',
        },
      ])
      await service.poll()
      expect(linksOf(job.id).map(link => link.downloadId)).toEqual(['dl-show'])

      at(T0 + 10_000)
      sonarrService.getQueue.mockResolvedValue([])
      await service.poll()
      at(T0 + 10_000 + ABSENT_REMOVED_MS)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
      expect(updated?.error).toBe(REMOVED_FROM_CLIENT_ERROR)
    })

    it('restarts the absence when the item comes back', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )

      at(T0)
      radarrService.getQueue.mockResolvedValue([LINKED_ITEM])
      await service.poll()

      at(T0 + 10_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      expect(absentSince().get(job.id)).toBe(T0 + 10_000)

      at(T0 + 300_000)
      radarrService.getQueue.mockResolvedValue([LINKED_ITEM])
      await service.poll()
      expect(absentSince().has(job.id)).toBe(false)

      at(T0 + 360_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      // Ten minutes after it first went, but only four since it last went.
      at(T0 + 10_000 + ABSENT_REMOVED_MS)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(absentSince().get(job.id)).toBe(T0 + 360_000)
    })

    // Wall-clock, not tick-count: polls that fail in between still count.
    it('keeps the absence timer running through a failed poll', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )

      at(T0)
      radarrService.getQueue.mockResolvedValue([LINKED_ITEM])
      await service.poll()
      at(T0 + 10_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      at(T0 + 300_000)
      radarrService.getQueue.mockRejectedValueOnce(new Error('radarr down'))
      await service.poll()
      expect(absentSince().get(job.id)).toBe(T0 + 10_000)

      clearBackoff()
      at(T0 + 10_000 + ABSENT_REMOVED_MS)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
    })

    // Without the listing there is no telling a finished import from a
    // dropped download, so a failed read decides nothing - even past the
    // removal window - and never backs the poll off.
    it('leaves a job unchanged when its files cannot be read', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )

      at(T0)
      radarrService.getQueue.mockResolvedValue([LINKED_ITEM])
      await service.poll()
      at(T0 + 10_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      at(T0 + 10_000 + ABSENT_REMOVED_MS)
      radarrService.getMovieFiles.mockRejectedValueOnce(
        new Error('radarr down'),
      )
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      // Readable again, and still nothing landed: now it is called removed.
      at(T0 + 20_000 + ABSENT_REMOVED_MS)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
    })

    // The wedge this whole check exists for: a small usenet grab can go
    // grabbed -> imported entirely between two ticks.
    it('completes a searching job whose whole download ran between ticks', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    // A file from before the job is the library's old copy, not this
    // attempt's result.
    it('leaves a searching job searching when its only file is older than it', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: BEFORE_ISO, id: 501, movieId: 42 },
      ])

      at(T0)
      await service.poll()
      at(T0 + 120_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Searching,
      )
    })

    // A blocked import that vanished without a file is a human's call -
    // they may still import it by hand - so it waits; with a file, it's done.
    it('never fails a needs-attention job, and completes it once a file lands', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.NeedsAttention })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      at(T0)
      await service.poll()
      at(T0 + 120_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.NeedsAttention,
      )

      radarrService.getMovieFiles.mockResolvedValue([
        { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
      ])
      at(T0 + 130_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    describe('a show job completes only once its own scope lands', () => {
      const EPISODES: EpisodeResource[] = [
        { episodeFileId: 0, id: 1, seasonNumber: 3, seriesId: 9 },
        { episodeFileId: 0, id: 2, seasonNumber: 3, seriesId: 9 },
        { episodeFileId: 0, id: 3, seasonNumber: 4, seriesId: 9 },
      ]

      function landed(...episodeIds: number[]): void {
        sonarrService.getEpisodes.mockResolvedValue(
          EPISODES.map(episode =>
            episodeIds.includes(episode.id as number)
              ? { ...episode, episodeFileId: 900 + (episode.id as number) }
              : episode,
          ),
        )
        sonarrService.getEpisodeFiles.mockResolvedValue(
          episodeIds.map(id => ({
            dateAdded: AFTER_ISO,
            id: 900 + id,
            seasonNumber: EPISODES.find(e => e.id === id)?.seasonNumber,
            seriesId: 9,
          })),
        )
      }

      beforeEach(() => {
        sonarrService.getQueue.mockResolvedValue([])
      })

      it('an episode job, on its own episode', async () => {
        const job = buildShowJob({
          scope: { episodeId: 2, seasonNumber: 3 },
          status: DownloadJobStatus.Downloading,
        })
        downloadStateService.jobs.set(job.id, job)

        landed(1, 3)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )

        landed(2)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
      })

      // One new file in its season is enough - how much of the season is
      // on disk is the media's state, not the attempt's - but a file from
      // another season is not.
      it('a season job, on any new file in its season', async () => {
        const job = buildShowJob({
          scope: { seasonNumber: 3 },
          status: DownloadJobStatus.Downloading,
        })
        downloadStateService.jobs.set(job.id, job)

        landed(3)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )

        landed(1, 3)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
      })

      it('reads a series once for all of its settling jobs', async () => {
        const episodeJob = buildShowJob({
          id: 'show-episode',
          scope: { episodeId: 3, seasonNumber: 4 },
          status: DownloadJobStatus.Downloading,
        })
        const seasonJob = buildShowJob({
          id: 'show-season',
          scope: { seasonNumber: 3 },
          status: DownloadJobStatus.Downloading,
        })
        downloadStateService.jobs.set(episodeJob.id, episodeJob)
        downloadStateService.jobs.set(seasonJob.id, seasonJob)

        landed(3)
        await service.poll()

        expect(sonarrService.getEpisodeFiles).toHaveBeenCalledTimes(1)
        expect(downloadStateService.jobs.get(episodeJob.id)?.status).toBe(
          DownloadJobStatus.Completed,
        )
        expect(downloadStateService.jobs.get(seasonJob.id)?.status).toBe(
          DownloadJobStatus.Downloading,
        )
      })
    })

    // Cancel pressed here: the action removed the queue items and wrote
    // `cancelling`, and the poller carries the job the rest of the way.
    describe('carrying a cancelling job to its end', () => {
      /** A release a search still running at the press grabbed afterwards. */
      const LATE_GRAB: QueueResource = {
        ...DOWNLOADING_ITEM,
        downloadId: 'dl-late',
        id: 7001,
      }

      function cancellingMovie(
        overrides: Partial<DownloadJobRecord> = {},
      ): DownloadJobRecord {
        const job = buildMovieJob({
          status: DownloadJobStatus.Cancelling,
          ...overrides,
        })
        downloadStateService.jobs.set(job.id, job)
        return job
      }

      it('removes a late grab instead of following it', async () => {
        const job = cancellingMovie()

        at(T0)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()

        at(T0 + 10_000)
        radarrService.getQueue.mockResolvedValue([LATE_GRAB])
        await service.poll()

        expect(radarrService.removeQueueItem).toHaveBeenCalledTimes(1)
        expect(radarrService.removeQueueItem).toHaveBeenCalledWith(7001)
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )
        expect(getJobById(dbService.db, job.id)).toBeUndefined()
      })

      it("never removes a sibling episode's download", async () => {
        const job = buildShowJob({
          scope: { episodeId: 2, seasonNumber: 3 },
          status: DownloadJobStatus.Cancelling,
        })
        downloadStateService.jobs.set(job.id, job)

        const sibling: SonarrQueueResource = {
          episodeId: 1,
          id: 8001,
          seasonNumber: 3,
          seriesId: 9,
          status: 'downloading',
        }
        sonarrService.getQueue.mockResolvedValue([sibling])
        await service.poll()

        expect(sonarrService.removeQueueItem).not.toHaveBeenCalled()

        sonarrService.getQueue.mockResolvedValue([
          sibling,
          { ...sibling, episodeId: 2, id: 8002 },
        ])
        await service.poll()

        expect(sonarrService.removeQueueItem).toHaveBeenCalledTimes(1)
        expect(sonarrService.removeQueueItem).toHaveBeenCalledWith(8002)
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )
      })

      // Sonarr queues a season pack as one row per episode sharing one
      // downloadId, and deleting any row removes the whole download.
      describe('a late grab that is a season pack', () => {
        function packRow(episodeId: number): SonarrQueueResource {
          return {
            downloadId: 'dl-pack',
            episodeId,
            id: 8000 + episodeId,
            seasonNumber: 3,
            seriesId: 9,
            status: 'downloading',
          }
        }
        const PACK = [packRow(1), packRow(2), packRow(3)]

        it('keeps it for an episode job, and cancels the job with a note', async () => {
          const scope = { episodeId: 2, seasonNumber: 3 }
          const job = await seed(
            buildShowJob({ scope, status: DownloadJobStatus.Cancelling }),
          )
          sonarrService.getQueue.mockResolvedValue(PACK)

          await service.poll()

          expect(sonarrService.removeQueueItem).not.toHaveBeenCalled()
          expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, scope, {
            withoutFileOnly: true,
          })
          const updated = downloadStateService.jobs.get(job.id)
          expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
          expect(updated?.statusNote).toBe(KEPT_PACK_NOTE)
          expect(updated?.error).toBeUndefined()
          expect(getJobById(dbService.db, job.id)).toMatchObject({
            error: null,
            status: DownloadJobStatus.Cancelled,
            statusNote: KEPT_PACK_NOTE,
          })
          expect(linksOf(job.id).map(link => link.downloadId)).toEqual([
            'dl-pack',
          ])

          // Settled, so the next tick leaves it - and the pack - alone.
          await service.poll()
          expect(sonarrService.removeQueueItem).not.toHaveBeenCalled()
          expect(downloadStateService.jobs.get(job.id)?.status).toBe(
            DownloadJobStatus.Cancelled,
          )
        })

        it('removes it with one DELETE for a season job that owns it whole', async () => {
          const job = await seed(
            buildShowJob({
              scope: { seasonNumber: 3 },
              status: DownloadJobStatus.Cancelling,
            }),
          )
          sonarrService.getQueue.mockResolvedValue(PACK)

          await service.poll()

          expect(sonarrService.removeQueueItem).toHaveBeenCalledTimes(1)
          expect(sonarrService.removeQueueItem).toHaveBeenCalledWith(8001)
          expect(sonarrService.unmonitorScope).not.toHaveBeenCalled()
          expect(downloadStateService.jobs.get(job.id)?.status).toBe(
            DownloadJobStatus.Cancelling,
          )
        })

        it('stays cancelling, and tries again, when the unmonitor fails', async () => {
          const job = await seed(
            buildShowJob({
              scope: { episodeId: 2, seasonNumber: 3 },
              status: DownloadJobStatus.Cancelling,
            }),
          )
          sonarrService.getQueue.mockResolvedValue(PACK)
          sonarrService.unmonitorScope.mockRejectedValueOnce(
            new Error('sonarr down'),
          )

          await expect(service.poll()).resolves.toBeUndefined()
          expect(downloadStateService.jobs.get(job.id)?.status).toBe(
            DownloadJobStatus.Cancelling,
          )

          await service.poll()
          expect(sonarrService.unmonitorScope).toHaveBeenCalledTimes(2)
          expect(sonarrService.removeQueueItem).not.toHaveBeenCalled()
          expect(downloadStateService.jobs.get(job.id)?.statusNote).toBe(
            KEPT_PACK_NOTE,
          )
        })
      })

      it('logs a refused removal and finishes the tick without backing off', async () => {
        const job = cancellingMovie()
        radarrService.removeQueueItem.mockRejectedValue(
          new Error('radarr said no'),
        )
        radarrService.getQueue.mockResolvedValue([LATE_GRAB])

        await expect(service.poll()).resolves.toBeUndefined()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'removeLateGrab',
            error: 'radarr said no',
            jobId: job.id,
            queueId: 7001,
          }),
          expect.any(String),
        )
        expect(
          (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
        ).toBe(0)
      })

      it('skips an item with no id', async () => {
        const job = cancellingMovie()
        radarrService.getQueue.mockResolvedValue([
          { ...LATE_GRAB, id: undefined },
        ])

        await service.poll()

        expect(radarrService.removeQueueItem).not.toHaveBeenCalled()
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'removeLateGrab',
            jobId: job.id,
          }),
          expect.any(String),
        )
      })

      // The cancel was the user's own press, so the job carries none of
      // "Removed and blocklisted in Radarr" - nor whatever it said before.
      it('cancels with no error once history confirms the removal', async () => {
        const job = await seed(
          buildMovieJob({
            error: BLOCKED_IMPORT_REASON,
            status: DownloadJobStatus.Cancelling,
          }),
        )

        at(T0)
        radarrService.getQueue.mockResolvedValue([LATE_GRAB])
        await service.poll()
        expect(radarrService.removeQueueItem).toHaveBeenCalledWith(7001)
        expect(linksOf(job.id).map(link => link.downloadId)).toEqual([
          'dl-late',
        ])

        // The removal, blocklisted, as Radarr records it.
        radarrService.getHistorySince.mockResolvedValue([
          {
            data: { message: 'Manually marked as failed' },
            date: new Date(T0 + 2_000).toISOString(),
            downloadId: 'dl-late',
            eventType: 'downloadFailed',
            id: 1,
            movieId: 42,
          },
        ])
        at(T0 + 5_000)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
        // Recorded, but the cancel settles itself - two reads must agree.
        expect(linksOf(job.id)[0]?.failedAt).not.toBeNull()
        at(T0 + 5_000 + 4_999)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )

        at(T0 + 10_000)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBeUndefined()
        expect(getJobById(dbService.db, job.id)?.status).toBe(
          DownloadJobStatus.Cancelled,
        )
        expect(getJobById(dbService.db, job.id)?.error).toBeNull()
      })

      it('cancels a show job with no error once history confirms the removal', async () => {
        const job = await seed(
          buildShowJob({ status: DownloadJobStatus.Cancelling }),
        )

        at(T0)
        sonarrService.getQueue.mockResolvedValue([
          { downloadId: 'dl-1', id: 8001, seriesId: 9, status: 'downloading' },
        ])
        await service.poll()
        expect(sonarrService.removeQueueItem).toHaveBeenCalledWith(8001)

        sonarrService.getHistorySince.mockResolvedValue([
          {
            data: { message: 'Manually marked as failed' },
            date: new Date(T0 + 2_000).toISOString(),
            downloadId: 'dl-1',
            eventType: 'downloadFailed',
            id: 1,
            seriesId: 9,
          },
        ])
        sonarrService.getQueue.mockResolvedValue([])
        at(T0 + 5_000)
        await service.poll()
        at(T0 + 10_000)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBeUndefined()
        expect(getJobById(dbService.db, job.id)?.error).toBeNull()
      })

      it('cancels at the grace period when nothing says what became of it', async () => {
        const job = cancellingMovie()
        radarrService.getQueue.mockResolvedValue([])

        at(T0)
        await service.poll()
        at(T0 + CANCEL_GRACE_MS - 1)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )

        at(T0 + CANCEL_GRACE_MS)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
        expect(updated?.error).toBeUndefined()
        expect(getJobById(dbService.db, job.id)?.error).toBeNull()
      })

      // Removing a late grab must not restart the clock, or a search that
      // keeps grabbing would hold the job in `cancelling` forever.
      it('times the grace period from the first absence across a late grab', async () => {
        const job = cancellingMovie()

        at(T0)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()

        // No download id, so no history can confirm it: only the clock can.
        at(T0 + 10_000)
        radarrService.getQueue.mockResolvedValue([
          { ...LATE_GRAB, downloadId: undefined },
        ])
        await service.poll()
        expect(radarrService.removeQueueItem).toHaveBeenCalledWith(7001)
        expect(absentSince().get(job.id)).toBe(T0)

        at(T0 + 20_000)
        radarrService.getQueue.mockResolvedValue([])
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )

        at(T0 + CANCEL_GRACE_MS)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelled,
        )
      })

      it('completes a cancelling job whose file landed anyway', async () => {
        const job = cancellingMovie()
        radarrService.getQueue.mockResolvedValue([])
        radarrService.getMovieFiles.mockResolvedValue([
          { dateAdded: AFTER_ISO, id: 501, movieId: 42 },
        ])

        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Completed)
        expect(updated?.error).toBeUndefined()
      })
    })

    // Cancelled while its listing was in flight: the cancel stands.
    it('does not move a job that settled while its files were being read', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])
      radarrService.getMovieFiles.mockImplementation(async () => {
        downloadStateService.jobs.set(job.id, {
          ...job,
          status: DownloadJobStatus.Cancelled,
        })
        return [{ dateAdded: AFTER_ISO, id: 501, movieId: 42 }]
      })

      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
    })

    it('forgets the timer of a job that stops being tracked', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Downloading })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([])

      await service.poll()
      expect(absentSince().has(job.id)).toBe(true)

      downloadStateService.jobs.set(job.id, {
        ...job,
        status: DownloadJobStatus.Cancelled,
      })
      await service.poll()

      expect(absentSince().has(job.id)).toBe(false)
    })
  })

  // A grab made in Radarr's/Sonarr's own UI, by their RSS sync, or by a
  // search this app did not send: no job covers it until the poller mints
  // one.
  describe('adopting downloads started upstream', () => {
    const UPSTREAM_GRAB: QueueResource = {
      downloadId: 'dl-up',
      id: 7001,
      movieId: 42,
      size: 1000,
      sizeleft: 500,
      status: 'downloading',
    }

    /** Season 2 of Sonarr series 9, three episodes, none with a file yet. */
    const SEASON_2: EpisodeResource[] = [21, 22, 23].map((id, index) => ({
      episodeNumber: index + 1,
      hasFile: false,
      id,
      monitored: true,
      seasonNumber: 2,
      seriesId: 9,
    }))

    function episodeItem(episodeId: number): SonarrQueueResource {
      return {
        downloadId: 'dl-pack',
        episodeId,
        id: 8000 + episodeId,
        seasonNumber: 2,
        seriesId: 9,
        size: 1000,
        sizeleft: 500,
        status: 'downloading',
      }
    }

    // What upstream's library holds, by media id: the same titles the
    // default resolve maps to Radarr 42 / Sonarr 9, so an adopted job
    // resolves - and is tracked - on the next tick.
    let library: Map<string, Movie | Show>
    let addJob: jest.SpyInstance

    function adoptedJobs(): DownloadJobRecord[] {
      return Array.from(downloadStateService.jobs.values()).filter(
        record => record.startedUpstream,
      )
    }

    beforeEach(() => {
      // Distinct ids, so a second mint shows up as a second job rather than
      // overwriting the first in the Map.
      let minted = 0
      jest.mocked(nanoid).mockImplementation(() => `adopted-${++minted}`)

      library = new Map<string, Movie | Show>([
        [
          'tmdb:1',
          {
            id: 'tmdb:1',
            monitored: true,
            radarrId: 42,
            title: 'A Movie',
            tmdbId: 1,
            type: DownloadType.Movie,
          },
        ],
        [
          'tvdb:1',
          {
            id: 'tvdb:1',
            monitored: true,
            sonarrId: 9,
            title: 'A Show',
            tvdbId: 1,
            type: DownloadType.Show,
          },
        ],
      ])

      mediaResolverService.getMovieLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(library.values())
              .filter(isMovie)
              .map(movie => [movie.tmdbId, movie]),
          ),
      )
      mediaResolverService.getShowLibrary.mockImplementation(
        async () =>
          new Map(
            Array.from(library.values())
              .filter(isShow)
              .map(show => [show.tvdbId, show]),
          ),
      )

      // The library copy of a title that resolves at all, so a file on it
      // reaches the adoption's upgrade check.
      const byUpstreamIds = mediaResolverService.resolve.getMockImplementation()
      mediaResolverService.resolve.mockImplementation(async keys => {
        const result = await byUpstreamIds!(keys)
        for (const { mediaId } of keys) {
          const entry = library.get(mediaId)
          if (entry && upstreamIds.has(mediaId)) {
            result.media.set(mediaId, { ...entry })
          }
        }
        mediaStateService.annotate(result.media.values())
        return result
      })

      sonarrService.getEpisodes.mockResolvedValue(SEASON_2)
      addJob = jest.spyOn(downloadStateService, 'addJob')
    })

    afterEach(() => {
      jest.mocked(nanoid).mockImplementation(() => 'mock-id')
    })

    it('adopts a movie download no job covers, and tracks it from the next tick', async () => {
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      const [job] = adoptedJobs()
      expect(job).toMatchObject({
        discordRequester: null,
        hiddenAttribution: false,
        mediaId: 'tmdb:1',
        requester: null,
        startedUpstream: true,
        status: DownloadJobStatus.Downloading,
        type: DownloadType.Movie,
      })
      expect(job).not.toHaveProperty('scope')
      expect(getJobById(dbService.db, job!.id)?.origin).toBe('upstream')
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'adoptUnownedDownloads',
          downloadId: 'dl-up',
          jobId: job!.id,
          mediaId: 'tmdb:1',
          status: DownloadJobStatus.Downloading,
        }),
        'Adopted a download started upstream',
      )
      const [created] = await jobFrames()
      expect(created).toMatchObject({
        job: { id: job!.id },
        type: DownloadJobEventType.Created,
      })

      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, sizeleft: 0, status: 'completed' },
      ])
      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(downloadStateService.jobs.get(job!.id)?.status).toBe(
        DownloadJobStatus.Importing,
      )
    })

    it('leaves an upgrade of a movie that has its file alone', async () => {
      library.set('tmdb:1', {
        ...(library.get('tmdb:1') as Movie),
        filePath: '/movies/A Movie (2020)/a-movie.mkv',
      })
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()
      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
    })

    it('leaves a download a request made here already covers', async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
    })

    // `trackedJobs` drops it this tick, but it still owns its media id.
    it('lets a job whose title did not resolve still own its download', async () => {
      upstreamIds.delete('tmdb:1')
      const job = buildMovieJob({ status: DownloadJobStatus.Searching })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, downloadId: undefined },
      ])

      await service.poll()

      expect(mediaResolverService.getMovieLibrary).toHaveBeenCalled()
      expect(addJob).not.toHaveBeenCalled()
    })

    it("never adopts a cancelling job's late grab, but adopts one after it is cancelled", async () => {
      const job = buildMovieJob({ status: DownloadJobStatus.Cancelling })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()

      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(7001)
      expect(addJob).not.toHaveBeenCalled()

      downloadStateService.jobs.set(job.id, {
        ...job,
        status: DownloadJobStatus.Cancelled,
      })
      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, downloadId: 'dl-later', id: 7002 },
      ])
      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(adoptedJobs()).toHaveLength(1)
    })

    it('adopts a Sonarr season pack as one season-scoped job', async () => {
      sonarrService.getQueue.mockResolvedValue([
        episodeItem(21),
        episodeItem(22),
        episodeItem(23),
      ])

      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9)
      const [job] = adoptedJobs()
      expect(job).toMatchObject({
        mediaId: 'tvdb:1',
        scope: { seasonNumber: 2 },
        startedUpstream: true,
        status: DownloadJobStatus.Downloading,
        type: DownloadType.Show,
      })

      await service.poll()
      expect(addJob).toHaveBeenCalledTimes(1)
    })

    it('adopts one episode with its episode number filled in', async () => {
      sonarrService.getQueue.mockResolvedValue([
        { ...episodeItem(22), downloadId: 'dl-ep' },
      ])

      await service.poll()

      expect(adoptedJobs()).toEqual([
        expect.objectContaining({
          scope: { episodeId: 22, episodeNumber: 2, seasonNumber: 2 },
        }),
      ])

      await service.poll()
      expect(addJob).toHaveBeenCalledTimes(1)
    })

    it('leaves a show download whose episodes all have their files alone', async () => {
      sonarrService.getEpisodes.mockResolvedValue(
        SEASON_2.map(episode => ({ ...episode, hasFile: true })),
      )
      sonarrService.getQueue.mockResolvedValue([
        episodeItem(21),
        episodeItem(22),
      ])

      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
    })

    // The cron has no overlap guard: the second tick starts while the first
    // is still reading the library, and both plan the same download.
    it('mints one job when two ticks overlap', async () => {
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const readLibrary =
        mediaResolverService.getMovieLibrary.getMockImplementation()!
      mediaResolverService.getMovieLibrary.mockImplementation(async () => {
        await gate
        return readLibrary()
      })
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      const ticks = Promise.all([service.poll(), service.poll()])
      await flushAsync()
      expect(mediaResolverService.getMovieLibrary).toHaveBeenCalledTimes(2)
      release()
      await ticks

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(adoptedJobs()).toHaveLength(1)
    })

    // Reloaded from its row at boot by `adoptOpenJobs`.
    it('adopts nothing more for a download adopted before a restart', async () => {
      const job = buildMovieJob({
        id: 'adopted-before',
        startedUpstream: true,
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(job.id, job)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

      await service.poll()
      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.size).toBe(1)
    })

    it('never adopts a failed download, tick after tick', async () => {
      radarrService.getQueue.mockResolvedValue([
        { ...UPSTREAM_GRAB, status: 'failed' },
      ])

      await service.poll()
      await service.poll()
      await service.poll()

      expect(addJob).not.toHaveBeenCalled()
    })

    it('waits a tick, without backing off, when the episodes cannot be read', async () => {
      sonarrService.getEpisodes.mockRejectedValueOnce(new Error('sonarr down'))
      sonarrService.getQueue.mockResolvedValue([episodeItem(21)])

      await expect(service.poll()).resolves.toBeUndefined()

      expect(addJob).not.toHaveBeenCalled()
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'adoptableShows',
          error: 'sonarr down',
          seriesId: 9,
        }),
        expect.any(String),
      )
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      await service.poll()

      expect(addJob).toHaveBeenCalledTimes(1)
      expect(adoptedJobs()).toEqual([
        expect.objectContaining({
          scope: { episodeId: 21, episodeNumber: 1, seasonNumber: 2 },
        }),
      ])
    })

    // Nobody here pressed cancel, so it carries why it ended.
    it('links an adopted download, and settles the job like any other', async () => {
      at(T0)
      radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])
      await service.poll()
      const [job] = adoptedJobs()
      expect(linksOf(job!.id).map(link => link.downloadId)).toEqual(['dl-up'])

      at(T0 + 10_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()
      expect(downloadStateService.jobs.get(job!.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + 10_000 + ABSENT_REMOVED_MS)
      await service.poll()

      const updated = downloadStateService.jobs.get(job!.id)
      expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
      expect(updated?.error).toBe(REMOVED_FROM_CLIENT_ERROR)
      expect(addJob).toHaveBeenCalledTimes(1)
    })

    // SABnzbd came back, or a cancel raced a grab: the download is the
    // ended job's, so it goes back to that job - requester and all - rather
    // than to a new `upstream` one.
    describe('a download coming back to the job it was linked to', () => {
      const ENDED_AT = '2026-08-20T12:30:00.000Z'
      const ENDED = Date.parse(ENDED_AT)
      const REQUESTER = { email: 'ada@example.com', userId: 'user-ada' }

      /** A job of `mediaId`'s type that ended at `ENDED_AT`, linked. */
      async function seedEnded(
        overrides: Partial<DownloadJobRecord> = {},
        downloadId = 'dl-up',
      ): Promise<DownloadJobRecord> {
        const job = await seed(
          buildMovieJob({
            error: REMOVED_FROM_CLIENT_ERROR,
            id: 'ended',
            requester: REQUESTER,
            status: DownloadJobStatus.Cancelled,
            updatedAt: ENDED_AT,
            ...overrides,
          }),
        )
        linkDownload(dbService.db, {
          app: job.type === DownloadType.Movie ? 'radarr' : 'sonarr',
          downloadId,
          grabbedAt: ENDED_AT,
          jobId: job.id,
        })
        return job
      }

      function jobOf(id: string): DownloadJobRecord | undefined {
        return downloadStateService.jobs.get(id)
      }

      it('reopens a job cancelled within the window, and tracks it from the next tick', async () => {
        await seedEnded()
        at(ENDED + 10 * 60_000)
        radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

        await service.poll()

        expect(adoptedJobs()).toEqual([])
        expect(addJob).toHaveBeenCalledTimes(1)
        expect(downloadStateService.jobs.size).toBe(1)
        const reopened = jobOf('ended')
        expect(reopened).toMatchObject({
          requester: REQUESTER,
          status: DownloadJobStatus.Downloading,
          statusNote: 'The download came back in Radarr',
        })
        expect(reopened?.error).toBeUndefined()
        expect(reopened?.startedUpstream).toBeUndefined()
        const row = getJobById(dbService.db, 'ended')
        expect(row).toMatchObject({
          error: null,
          origin: 'web',
          status: DownloadJobStatus.Downloading,
          statusNote: 'The download came back in Radarr',
        })
        expect(Logger.prototype.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'reopenEndedJob',
            downloadId: 'dl-up',
            jobId: 'ended',
            oldStatus: DownloadJobStatus.Cancelled,
            status: DownloadJobStatus.Downloading,
          }),
          'Reopened a job whose download came back',
        )
        const frames = await jobFrames()
        expect(frames).toEqual([
          expect.objectContaining({
            job: expect.objectContaining({
              id: 'ended',
              status: DownloadJobStatus.Downloading,
            }),
            type: DownloadJobEventType.Updated,
          }),
        ])

        // Tracked like any open job: progress keeps the note, and the next
        // status move drops it.
        radarrService.getQueue.mockResolvedValue([
          { ...UPSTREAM_GRAB, sizeleft: 100 },
        ])
        await service.poll()
        expect(jobOf('ended')).toMatchObject({
          status: DownloadJobStatus.Downloading,
          statusNote: 'The download came back in Radarr',
        })

        radarrService.getQueue.mockResolvedValue([
          { ...UPSTREAM_GRAB, sizeleft: 0, status: 'completed' },
        ])
        await service.poll()
        expect(jobOf('ended')?.status).toBe(DownloadJobStatus.Importing)
        expect(jobOf('ended')?.statusNote).toBeUndefined()
        expect(adoptedJobs()).toEqual([])
      })

      // A restart leaves an ended job out of the Map; its row still counts.
      it('reopens a failed job the Map no longer holds', async () => {
        await seedEnded({
          error: 'Download failed in Radarr',
          status: DownloadJobStatus.Failed,
          upstreamCommandAt: ENDED_AT,
          upstreamCommandId: 77,
          upstreamCommandKind: 'search',
        })
        restart()
        expect(downloadStateService.jobs.has('ended')).toBe(false)
        at(ENDED + 10 * 60_000)
        radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

        await service.poll()

        const reopened = downloadStateService.jobs.get('ended')
        expect(reopened).toMatchObject({
          requester: REQUESTER,
          status: DownloadJobStatus.Downloading,
          statusNote: 'The download came back in Radarr',
        })
        expect(reopened?.error).toBeUndefined()
        expect(reopened?.upstreamCommandId).toBeUndefined()
        expect(reopened?.upstreamCommandKind).toBeUndefined()
        expect(reopened?.upstreamCommandAt).toBeUndefined()
        expect(
          Array.from(downloadStateService.jobs.values()).filter(
            record => record.startedUpstream,
          ),
        ).toEqual([])
      })

      it('reopens a show job with its own scope, noted for Sonarr', async () => {
        await seedEnded(
          {
            id: 'ended',
            mediaId: 'tvdb:1',
            scope: { seasonNumber: 2 },
            type: DownloadType.Show,
          },
          'dl-pack',
        )
        at(ENDED + 10 * 60_000)
        sonarrService.getQueue.mockResolvedValue([
          episodeItem(21),
          episodeItem(22),
          episodeItem(23),
        ])

        await service.poll()

        expect(adoptedJobs()).toEqual([])
        expect(jobOf('ended')).toMatchObject({
          scope: { seasonNumber: 2 },
          status: DownloadJobStatus.Downloading,
          statusNote: 'The download came back in Sonarr',
        })
      })

      it('adopts the download once the window has passed', async () => {
        await seedEnded()
        at(ENDED + REOPEN_WINDOW_MS + 1)
        radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

        await service.poll()

        expect(jobOf('ended')?.status).toBe(DownloadJobStatus.Cancelled)
        expect(adoptedJobs()).toEqual([
          expect.objectContaining({
            mediaId: 'tmdb:1',
            requester: null,
            status: DownloadJobStatus.Downloading,
          }),
        ])
      })

      it('never reopens a completed job, and adopts its download as before', async () => {
        await seedEnded({
          completedAt: ENDED_AT,
          error: undefined,
          status: DownloadJobStatus.Completed,
        })
        at(ENDED + 10 * 60_000)
        radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

        await service.poll()

        expect(jobOf('ended')?.status).toBe(DownloadJobStatus.Completed)
        expect(adoptedJobs()).toHaveLength(1)
      })

      it('reopens only the newest of several jobs it was linked to', async () => {
        await seedEnded({ id: 'older' })
        await seedEnded({
          createdAt: '2026-08-20T12:10:00.000Z',
          id: 'newer',
          status: DownloadJobStatus.Failed,
        })
        at(ENDED + 10 * 60_000)
        radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

        await service.poll()
        await service.poll()

        expect(jobOf('newer')?.status).toBe(DownloadJobStatus.Downloading)
        expect(jobOf('older')?.status).toBe(DownloadJobStatus.Cancelled)
        expect(adoptedJobs()).toEqual([])
      })

      it('mints no job, and reopens none, for a download an open job is linked to', async () => {
        await seedEnded()
        // Another title's job, so only the link - not the title - owns it.
        const open = await seed(
          buildMovieJob({
            id: 'open',
            mediaId: 'tmdb:2',
            status: DownloadJobStatus.Downloading,
          }),
        )
        linkDownload(dbService.db, {
          app: 'radarr',
          downloadId: 'dl-up',
          grabbedAt: null,
          jobId: open.id,
        })
        at(ENDED + 10 * 60_000)
        radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

        await service.poll()
        await service.poll()

        expect(addJob).toHaveBeenCalledTimes(2)
        expect(adoptedJobs()).toEqual([])
        expect(jobOf('ended')?.status).toBe(DownloadJobStatus.Cancelled)
      })

      it('neither reopens nor adopts a download whose queue item failed', async () => {
        await seedEnded()
        at(ENDED + 10 * 60_000)
        radarrService.getQueue.mockResolvedValue([
          { ...UPSTREAM_GRAB, status: 'failed' },
        ])

        await service.poll()
        await service.poll()

        expect(jobOf('ended')?.status).toBe(DownloadJobStatus.Cancelled)
        expect(adoptedJobs()).toEqual([])
      })

      // A cancel that left the pack running on purpose: the pack is still
      // that job's, not a download that came back to it.
      it('neither adopts nor reopens a season pack a cancel kept', async () => {
        await seedEnded(
          {
            error: undefined,
            mediaId: 'tvdb:1',
            scope: { episodeId: 22, episodeNumber: 2, seasonNumber: 2 },
            status: DownloadJobStatus.Cancelled,
            statusNote: KEPT_PACK_NOTE,
            type: DownloadType.Show,
          },
          'dl-pack',
        )
        at(ENDED + 10 * 60_000)
        sonarrService.getQueue.mockResolvedValue([
          episodeItem(21),
          episodeItem(22),
          episodeItem(23),
        ])

        await service.poll()
        await service.poll()

        expect(adoptedJobs()).toEqual([])
        expect(addJob).toHaveBeenCalledTimes(1)
        expect(jobOf('ended')).toMatchObject({
          status: DownloadJobStatus.Cancelled,
          statusNote: KEPT_PACK_NOTE,
        })
      })

      it('neither adopts nor reopens a pack a cancelling job just kept', async () => {
        await seed(
          buildShowJob({
            id: 'cancelling',
            scope: { episodeId: 22, seasonNumber: 2 },
            status: DownloadJobStatus.Cancelling,
          }),
        )
        sonarrService.getQueue.mockResolvedValue([
          episodeItem(21),
          episodeItem(22),
          episodeItem(23),
        ])

        await service.poll()
        await service.poll()

        expect(sonarrService.removeQueueItem).not.toHaveBeenCalled()
        expect(adoptedJobs()).toEqual([])
        expect(jobOf('cancelling')).toMatchObject({
          status: DownloadJobStatus.Cancelled,
          statusNote: KEPT_PACK_NOTE,
        })
      })

      // The job would never read that download again (`matchJobItems`).
      it('adopts, rather than reopens, a download that already failed for the job', async () => {
        await seedEnded({ status: DownloadJobStatus.Failed })
        markFailed(dbService.db, 'radarr', 'dl-up', ENDED_AT, 'bad release')
        at(ENDED + 10 * 60_000)
        radarrService.getQueue.mockResolvedValue([UPSTREAM_GRAB])

        await service.poll()

        expect(jobOf('ended')?.status).toBe(DownloadJobStatus.Failed)
        expect(adoptedJobs()).toHaveLength(1)
      })
    })
  })

  // Radarr's/Sonarr's history decides what became of a download: a grab
  // links it to its job, and an import, a failure or a removal settles it.
  describe('history', () => {
    type EventType =
      | 'downloadFailed'
      | 'downloadFolderImported'
      | 'downloadIgnored'
      | 'grabbed'

    const iso = (ms: number): string => new Date(ms).toISOString()

    /** A Radarr history record for movie 42 - the default job's title. */
    function movieEvent(
      id: number,
      eventType: EventType,
      downloadId: string,
      ms: number,
      data: Record<string, string> = {},
    ): HistoryResource {
      return { data, date: iso(ms), downloadId, eventType, id, movieId: 42 }
    }

    /** A Sonarr history record for series 9, with its episode. */
    function showEvent(
      id: number,
      eventType: EventType,
      downloadId: string,
      ms: number,
      episode: { episodeId: number; episodeNumber: number; season: number },
      data: Record<string, string> = {},
    ): SonarrHistoryResource {
      return {
        data,
        date: iso(ms),
        downloadId,
        episode: {
          episodeNumber: episode.episodeNumber,
          seasonNumber: episode.season,
        },
        episodeId: episode.episodeId,
        eventType,
        id,
        seriesId: 9,
      }
    }

    const SAB_ABORTED =
      'Aborted, cannot be completed - https://sabnzbd.org/not-complete'

    const downloading = (downloadId: string): QueueResource => ({
      downloadId,
      id: 7001,
      movieId: 42,
      size: 1000,
      sizeleft: 500,
      status: 'downloading',
    })

    /** Radarr's history reads so far, as the date each one started from. */
    function radarrReadsFrom(): number[] {
      return radarrService.getHistorySince.mock.calls.map(([since]) =>
        since.getTime(),
      )
    }

    it('reads a day back on first boot, then resumes from its cursor after a restart', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Searching }),
      )
      const grab = movieEvent(1, 'grabbed', 'dl-1', T0 - 10_000)
      radarrService.getHistorySince.mockResolvedValue([grab])

      at(T0)
      await service.poll()

      expect(radarrReadsFrom()).toEqual([T0 - HISTORY_FIRST_READ_MS])
      expect(linksOf(job.id)).toEqual([
        expect.objectContaining({
          app: 'radarr',
          downloadId: 'dl-1',
          grabbedAt: iso(T0 - 10_000),
        }),
      ])
      expect(getCursor(dbService.db, 'radarr')).toEqual({
        date: iso(T0 - 10_000),
        ids: [1],
      })

      restart()
      radarrService.getHistorySince.mockClear()
      // Inclusive: the grab at the cursor comes back and is skipped by id.
      radarrService.getHistorySince.mockResolvedValue([
        grab,
        movieEvent(2, 'downloadFolderImported', 'dl-1', T0 + 30_000),
      ])
      at(T0 + 60_000)
      await service.poll()

      expect(radarrReadsFrom()).toEqual([T0 - 10_000])
      expect(linksOf(job.id)).toEqual([
        expect.objectContaining({
          downloadId: 'dl-1',
          importedAt: iso(T0 + 30_000),
        }),
      ])
      expect(getCursor(dbService.db, 'radarr')).toEqual({
        date: iso(T0 + 30_000),
        ids: [2],
      })
    })

    it('stores where a first read started even when it found nothing', async () => {
      at(T0)
      await service.poll()

      expect(getCursor(dbService.db, 'sonarr')).toEqual({
        date: iso(T0 - HISTORY_FIRST_READ_MS),
        ids: [],
      })
    })

    it('catches up at most a week after a long downtime', async () => {
      setCursor(dbService.db, 'radarr', iso(T0 - 30 * 86_400_000), [5])

      at(T0)
      await service.poll()

      expect(radarrReadsFrom()).toEqual([T0 - HISTORY_MAX_CATCH_UP_MS])
    })

    it('keeps its cursor through a failed read and tries again next interval', async () => {
      at(T0)
      radarrService.getHistorySince.mockRejectedValueOnce(
        new Error('radarr down'),
      )
      await service.poll()

      expect(getCursor(dbService.db, 'radarr')).toBeUndefined()
      expect(
        (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
      ).toBe(0)

      // Too soon for another read.
      at(T0 + 4_999)
      await service.poll()
      expect(radarrService.getHistorySince).toHaveBeenCalledTimes(1)

      at(T0 + 5_000)
      await service.poll()
      expect(radarrService.getHistorySince).toHaveBeenCalledTimes(2)
    })

    // Two overlapping ticks never read at once, and an event read twice -
    // here with the cursor lost, the worst case - changes nothing the
    // second time.
    it('applies an overlapping or replayed event once', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      radarrService.getHistorySince.mockResolvedValue([
        movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000),
        movieEvent(2, 'downloadFailed', 'dl-1', T0 - 30_000, {
          message: SAB_ABORTED,
        }),
      ])
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')

      at(T0)
      await Promise.all([service.poll(), service.poll()])

      expect(radarrService.getHistorySince).toHaveBeenCalledTimes(1)
      expect(linksOf(job.id)).toHaveLength(1)
      expect(updateJob).toHaveBeenCalledTimes(1)
      const retried = downloadStateService.jobs.get(job.id)
      expect(retried?.status).toBe(DownloadJobStatus.Searching)

      dbService.db.delete(arrHistoryCursors).run()
      at(T0 + 5_000)
      await service.poll()

      expect(radarrService.getHistorySince).toHaveBeenCalledTimes(2)
      expect(linksOf(job.id)).toHaveLength(1)
      expect(updateJob).toHaveBeenCalledTimes(1)
      expect(downloadStateService.jobs.get(job.id)).toEqual(retried)
    })

    it('follows a grab through its import to completed', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Searching }),
      )
      const events = [movieEvent(1, 'grabbed', 'dl-1', T0 - 2_000)]
      radarrService.getHistorySince.mockResolvedValue(events)

      at(T0)
      radarrService.getQueue.mockResolvedValue([downloading('dl-1')])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(linksOf(job.id)[0]).toMatchObject({
        downloadId: 'dl-1',
        grabbedAt: iso(T0 - 2_000),
        importedAt: null,
      })

      // Imported and gone from the queue, before the file listing shows it:
      // the recorded import is enough.
      events.push(movieEvent(2, 'downloadFolderImported', 'dl-1', T0 + 3_000))
      at(T0 + 5_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Completed)
      expect(updated?.error).toBeUndefined()
      expect(linksOf(job.id)[0]?.importedAt).toBe(iso(T0 + 3_000))
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(job.mediaId)
    })

    it('goes back to searching with a note while Radarr retries, and completes on the next grab', async () => {
      const job = await seed(
        buildMovieJob({
          status: DownloadJobStatus.Searching,
          upstreamCommandAt: NOW_ISO,
          upstreamCommandId: 7,
          upstreamCommandKind: 'search',
        }),
      )
      const events = [movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000)]
      radarrService.getHistorySince.mockResolvedValue(events)

      at(T0)
      radarrService.getQueue.mockResolvedValue([downloading('dl-1')])
      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      // SABnzbd gives up; Radarr records it and searches again. The dead
      // item lingers in the queue meanwhile.
      events.push(
        movieEvent(2, 'downloadFailed', 'dl-1', T0 + 2_000, {
          message: SAB_ABORTED,
        }),
      )
      at(T0 + 5_000)
      radarrService.getQueue.mockResolvedValue([
        {
          ...downloading('dl-1'),
          status: 'failed',
          trackedDownloadState: 'failedPending',
          trackedDownloadStatus: 'error',
        },
      ])
      await service.poll()

      const note = `Last download failed: ${SAB_ABORTED}. Radarr is trying another release.`
      const retrying = downloadStateService.jobs.get(job.id)
      expect(retrying?.error).toBeUndefined()
      expect(retrying).toMatchObject({
        status: DownloadJobStatus.Searching,
        statusNote: note,
        upstreamCommandId: undefined,
        upstreamCommandKind: undefined,
      })
      expect(getJobById(dbService.db, job.id)).toMatchObject({
        status: DownloadJobStatus.Searching,
        statusNote: note,
        upstreamCommandKind: null,
      })
      expect(linksOf(job.id)[0]).toMatchObject({
        failReason: SAB_ABORTED,
        failedAt: iso(T0 + 2_000),
      })

      // Still searching on the next tick: the failed item is history's,
      // and a failed link alone settles nothing.
      at(T0 + 6_000)
      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Searching,
      )

      // The retry grabs another release.
      events.push(movieEvent(3, 'grabbed', 'dl-2', T0 + 8_000))
      at(T0 + 10_000)
      radarrService.getQueue.mockResolvedValue([downloading('dl-2')])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)).toMatchObject({
        status: DownloadJobStatus.Downloading,
        statusNote: undefined,
      })
      expect(linksOf(job.id).map(link => link.downloadId)).toEqual([
        'dl-1',
        'dl-2',
      ])

      events.push(movieEvent(4, 'downloadFolderImported', 'dl-2', T0 + 12_000))
      at(T0 + 15_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
      expect(radarrService.getFailedDownloadConfig).toHaveBeenCalledTimes(1)
    })

    it('fails the job for good when Radarr will not retry', async () => {
      radarrService.getFailedDownloadConfig.mockResolvedValue({
        autoRedownloadFailed: false,
        fromInteractive: true,
      })
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      radarrService.getHistorySince.mockResolvedValue([
        movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000),
        movieEvent(2, 'downloadFailed', 'dl-1', T0 - 1_000, {
          message: SAB_ABORTED,
        }),
      ])

      at(T0)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Failed)
      expect(updated?.error).toBe(SAB_ABORTED)
      expect(updated?.statusNote).toBeUndefined()
      expect(getJobById(dbService.db, job.id)?.error).toBe(SAB_ABORTED)
    })

    // - SABnzbd's unrar disk-full text carries unrar's output, so it isn't
    //   the exact string Radarr/Sonarr map to a warning: the download fails,
    //   Radarr blocklists a good release, and the next one lands on the same
    //   full disk.
    describe('a disk-full failure', () => {
      const SAB_DISK_FULL =
        'Unpacking failed, write error or disk is full?  in the file /downloads/incomplete/Game.Night.2018/Game.Night.2018.mkv'

      function failWithDiskFull(): void {
        radarrService.getHistorySince.mockResolvedValue([
          movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000),
          movieEvent(2, 'downloadFailed', 'dl-1', T0 - 1_000, {
            message: SAB_DISK_FULL,
          }),
        ])
      }

      it('notes that the retry fails the same way until space is freed', async () => {
        const job = await seed(
          buildMovieJob({ status: DownloadJobStatus.Downloading }),
        )
        failWithDiskFull()

        at(T0)
        await service.poll()

        const note =
          'Last download failed: the NAS ran out of disk space. Radarr is trying another release, which will fail the same way until space is freed.'
        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.error).toBeUndefined()
        expect(updated).toMatchObject({
          status: DownloadJobStatus.Searching,
          statusNote: note,
        })
        expect(getJobById(dbService.db, job.id)?.statusNote).toBe(note)
        // The link keeps SABnzbd's own text.
        expect(linksOf(job.id)[0]?.failReason).toBe(SAB_DISK_FULL)
      })

      it('fails the job saying the NAS ran out of space when Radarr will not retry', async () => {
        radarrService.getFailedDownloadConfig.mockResolvedValue({
          autoRedownloadFailed: false,
          fromInteractive: true,
        })
        const job = await seed(
          buildMovieJob({ status: DownloadJobStatus.Downloading }),
        )
        failWithDiskFull()

        at(T0)
        await service.poll()

        const error = `${DISK_SPACE_ERROR} (Unpacking failed, write error or disk is full?)`
        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.status).toBe(DownloadJobStatus.Failed)
        expect(updated?.error).toBe(error)
        expect(updated?.statusNote).toBeUndefined()
        expect(getJobById(dbService.db, job.id)?.error).toBe(error)
      })
    })

    it('reads the grab off its own history to tell whether a hand-picked release retries', async () => {
      radarrService.getFailedDownloadConfig.mockResolvedValue({
        autoRedownloadFailed: true,
        fromInteractive: false,
      })
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      // Linked off the queue, so the link can't say who picked it.
      at(T0)
      radarrService.getQueue.mockResolvedValue([downloading('dl-1')])
      await service.poll()
      expect(linksOf(job.id)[0]?.interactive).toBeNull()

      radarrService.getHistoryByDownloadId.mockResolvedValue([
        movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000, {
          releaseSource: 'InteractiveSearch',
        }),
      ])
      radarrService.getHistorySince.mockResolvedValue([
        movieEvent(2, 'downloadFailed', 'dl-1', T0 + 1_000, {
          message: SAB_ABORTED,
        }),
      ])
      at(T0 + 5_000)
      radarrService.getQueue.mockResolvedValue([])
      await service.poll()

      expect(radarrService.getHistoryByDownloadId).toHaveBeenCalledWith('dl-1')
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Failed,
      )
    })

    it('retries an automatic grab even when hand-picked ones do not', async () => {
      radarrService.getFailedDownloadConfig.mockResolvedValue({
        autoRedownloadFailed: true,
        fromInteractive: false,
      })
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      radarrService.getHistorySince.mockResolvedValue([
        movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000, {
          releaseSource: 'Search',
        }),
        movieEvent(2, 'downloadFailed', 'dl-1', T0 - 1_000, {
          message: SAB_ABORTED,
        }),
      ])

      at(T0)
      await service.poll()

      expect(linksOf(job.id)[0]?.interactive).toBe(false)
      expect(radarrService.getHistoryByDownloadId).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Searching,
      )
    })

    it('retries the failure next interval when the settings cannot be read', async () => {
      radarrService.getFailedDownloadConfig.mockRejectedValueOnce(
        new Error('radarr down'),
      )
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      radarrService.getHistorySince.mockResolvedValue([
        movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000),
        movieEvent(2, 'downloadFailed', 'dl-1', T0 - 1_000, {
          message: SAB_ABORTED,
        }),
      ])

      at(T0)
      await service.poll()

      // The grab went in; the failure waits, with the cursor before it.
      expect(linksOf(job.id)[0]?.failedAt).toBeNull()
      expect(getCursor(dbService.db, 'radarr')).toEqual({
        date: iso(T0 - 60_000),
        ids: [1],
      })
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + 5_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Searching,
      )
    })

    it('cancels a download removed and blocklisted in Radarr', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      radarrService.getHistorySince.mockResolvedValue([
        movieEvent(1, 'grabbed', 'dl-1', T0 - 60_000),
        movieEvent(2, 'downloadFailed', 'dl-1', T0 - 1_000, {
          message: 'Manually marked as failed',
        }),
      ])

      at(T0)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
      expect(updated?.error).toBe('Removed and blocklisted in Radarr')
      expect(radarrService.getFailedDownloadConfig).not.toHaveBeenCalled()
    })

    // Someone gave up on a blocked import in Sonarr's own UI.
    it('cancels a download ignored in Sonarr', async () => {
      const job = await seed(
        buildShowJob({ status: DownloadJobStatus.NeedsAttention }),
      )
      at(T0)
      sonarrService.getQueue.mockResolvedValue([
        {
          downloadId: 'dl-1',
          episodeId: 21,
          seasonNumber: 2,
          seriesId: 9,
          status: 'completed',
          trackedDownloadState: 'importBlocked',
        },
      ])
      await service.poll()
      expect(linksOf(job.id)).toHaveLength(1)

      sonarrService.getHistorySince.mockResolvedValue([
        showEvent(
          1,
          'downloadIgnored',
          'dl-1',
          T0 + 1_000,
          { episodeId: 21, episodeNumber: 1, season: 2 },
          { message: 'Manually ignored' },
        ),
      ])
      sonarrService.getQueue.mockResolvedValue([])
      at(T0 + 5_000)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
      expect(updated?.error).toBe('Ignored in Sonarr')
      expect(linksOf(job.id)[0]?.failReason).toBe('Manually ignored')
    })

    it('links every episode grab of a season pack once, to the season job', async () => {
      const seasonJob = await seed(
        buildShowJob({
          id: 'show-season-2',
          scope: { seasonNumber: 2 },
          status: DownloadJobStatus.Searching,
        }),
      )
      const otherSeason = await seed(
        buildShowJob({
          id: 'show-season-3',
          scope: { seasonNumber: 3 },
          status: DownloadJobStatus.Searching,
        }),
      )
      // One grab per episode, one download, one second.
      sonarrService.getHistorySince.mockResolvedValue(
        [21, 22, 23].map((episodeId, index) =>
          showEvent(10 + index, 'grabbed', 'dl-pack', T0 - 1_000, {
            episodeId,
            episodeNumber: index + 1,
            season: 2,
          }),
        ),
      )

      at(T0)
      await service.poll()

      expect(linksOf(seasonJob.id)).toEqual([
        expect.objectContaining({ app: 'sonarr', downloadId: 'dl-pack' }),
      ])
      expect(linksOf(otherSeason.id)).toEqual([])
      expect(getCursor(dbService.db, 'sonarr')).toEqual({
        date: iso(T0 - 1_000),
        ids: [10, 11, 12],
      })
    })

    it('leaves a grab no job asked for to adoption', async () => {
      radarrService.getHistorySince.mockResolvedValue([
        movieEvent(1, 'grabbed', 'dl-rss', T0 - 1_000),
      ])

      at(T0)
      await service.poll()

      expect(downloadStateService.jobs.size).toBe(0)
      expect(getCursor(dbService.db, 'radarr')?.ids).toEqual([1])
    })
  })

  // `/queue` drops items whenever SABnzbd is briefly unreachable and after
  // any Radarr/Sonarr restart, so a missing download is only called removed
  // once it has been gone ten minutes with the download client healthy.
  describe('a download missing from the queue', () => {
    async function linkedThenGone(): Promise<DownloadJobRecord> {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      at(T0)
      radarrService.getQueue.mockResolvedValue([
        { downloadId: 'dl-1', movieId: 42, status: 'downloading' },
      ])
      await service.poll()
      expect(linksOf(job.id)).toHaveLength(1)

      radarrService.getQueue.mockResolvedValue([])
      return job
    }

    it('cancels nothing through a twenty-minute download client outage', async () => {
      const job = await linkedThenGone()
      radarrService.isDownloadClientHealthy.mockResolvedValue(false)

      for (let ms = 30_000; ms <= 1_200_000; ms += 30_000) {
        at(T0 + ms)
        await service.poll()
      }

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
    })

    it('treats a health check that fails as unhealthy', async () => {
      const job = await linkedThenGone()
      radarrService.isDownloadClientHealthy.mockRejectedValue(
        new Error('radarr down'),
      )

      at(T0 + 30_000)
      await service.poll()
      at(T0 + 30_000 + ABSENT_REMOVED_MS)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
    })

    it('cancels a download gone ten minutes from a healthy client', async () => {
      const job = await linkedThenGone()

      at(T0 + 10_000)
      await service.poll()
      at(T0 + 10_000 + ABSENT_REMOVED_MS - 1)
      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + 10_000 + ABSENT_REMOVED_MS)
      await service.poll()

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Cancelled)
      expect(updated?.error).toBe(REMOVED_FROM_CLIENT_ERROR)
      expect(getJobById(dbService.db, job.id)?.error).toBe(
        REMOVED_FROM_CLIENT_ERROR,
      )
    })

    it('counts the absence only from when the client was seen healthy again', async () => {
      const job = await linkedThenGone()
      radarrService.isDownloadClientHealthy.mockResolvedValue(false)
      at(T0 + 30_000)
      await service.poll()

      // Back after twenty minutes.
      radarrService.isDownloadClientHealthy.mockResolvedValue(true)
      const back = T0 + 1_200_000
      at(back)
      await service.poll()
      at(back + ABSENT_REMOVED_MS - 1)
      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(back + ABSENT_REMOVED_MS)
      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
    })

    // The links live in `job_downloads`, so a restart forgets none of them
    // and nothing settles on a grace period meant for the in-memory kind.
    it('keeps its links across a restart', async () => {
      const job = await linkedThenGone()

      restart()
      at(T0 + 61_000)
      await service.poll()
      at(T0 + 121_000)
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
      expect(linksOf(job.id)).toHaveLength(1)

      at(T0 + 61_000 + ABSENT_REMOVED_MS)
      await service.poll()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
    })
  })

  // A job grabbed before its links were recorded - here, one that predates
  // `job_downloads` - is linked from its title's own history once per boot.
  describe('boot backfill', () => {
    it('links a grabbed job from its title history, once per boot', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.NeedsAttention }),
      )
      const created = Date.parse(NOW_ISO)
      radarrService.getMovieHistory.mockResolvedValue([
        // Before the job: an earlier attempt's, not this one's.
        {
          date: new Date(created - 3_600_000).toISOString(),
          downloadId: 'dl-old',
          eventType: 'grabbed',
          id: 1,
          movieId: 42,
        },
        {
          data: { releaseSource: 'InteractiveSearch' },
          date: new Date(created + 60_000).toISOString(),
          downloadId: 'dl-7',
          eventType: 'grabbed',
          id: 2,
          movieId: 42,
        },
      ])

      at(T0)
      await service.poll()
      at(T0 + 5_000)
      await service.poll()

      expect(radarrService.getMovieHistory).toHaveBeenCalledTimes(1)
      expect(radarrService.getMovieHistory).toHaveBeenCalledWith(42)
      expect(linksOf(job.id)).toEqual([
        expect.objectContaining({
          downloadId: 'dl-7',
          grabbedAt: new Date(created + 60_000).toISOString(),
          interactive: true,
        }),
      ])
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.NeedsAttention,
      )
    })

    it("fills in a show's season from its episodes and records what became of the grab", async () => {
      const job = await seed(
        buildShowJob({
          scope: { seasonNumber: 2 },
          status: DownloadJobStatus.Downloading,
        }),
      )
      const created = Date.parse(NOW_ISO)
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeNumber: 1, id: 21, seasonNumber: 2, seriesId: 9 },
      ])
      // Per-series history carries no episode, only its id.
      sonarrService.getSeriesHistory.mockResolvedValue([
        {
          date: new Date(created + 60_000).toISOString(),
          downloadId: 'dl-s2',
          episodeId: 21,
          eventType: 'grabbed',
          id: 1,
          seriesId: 9,
        },
        {
          date: new Date(created + 120_000).toISOString(),
          downloadId: 'dl-s2',
          episodeId: 21,
          eventType: 'downloadFolderImported',
          id: 2,
          seriesId: 9,
        },
      ])

      at(T0)
      await service.poll()

      expect(linksOf(job.id)).toEqual([
        expect.objectContaining({
          downloadId: 'dl-s2',
          importedAt: new Date(created + 120_000).toISOString(),
        }),
      ])
      // Every link imported and nothing queued: done.
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('tries a title again next interval when its history cannot be read', async () => {
      const job = await seed(
        buildMovieJob({ status: DownloadJobStatus.Downloading }),
      )
      radarrService.getMovieHistory.mockRejectedValueOnce(
        new Error('radarr down'),
      )

      at(T0)
      await service.poll()
      expect(linksOf(job.id)).toEqual([])

      radarrService.getMovieHistory.mockResolvedValue([
        {
          date: new Date(Date.parse(NOW_ISO) + 60_000).toISOString(),
          downloadId: 'dl-7',
          eventType: 'grabbed',
          id: 2,
          movieId: 42,
        },
      ])
      at(T0 + 5_000)
      await service.poll()

      expect(linksOf(job.id).map(link => link.downloadId)).toEqual(['dl-7'])
    })
  })

  describe('command tracking', () => {
    const iso = (ms: number): string => new Date(ms).toISOString()

    /** A Radarr grab of movie 42 - the default movie job's title. */
    function movieGrab(
      id: number,
      downloadId: string,
      ms: number,
    ): HistoryResource {
      return {
        date: iso(ms),
        downloadId,
        eventType: 'grabbed',
        id,
        movieId: 42,
      }
    }

    /** A movie job waiting on search command 21, sent a minute before T0. */
    function searchingMovie(
      overrides: Partial<DownloadJobRecord> = {},
    ): Promise<DownloadJobRecord> {
      return seed(
        buildMovieJob({
          status: DownloadJobStatus.Searching,
          upstreamCommandAt: iso(T0 - 60_000),
          upstreamCommandId: 21,
          upstreamCommandKind: 'search',
          ...overrides,
        }),
      )
    }

    function completedSearch(
      overrides: Partial<CommandSnapshot> = {},
    ): CommandSnapshot {
      return buildCommand({
        ended: iso(T0 - 3_000),
        id: 21,
        message: 'Completed. 0 reports downloaded.',
        started: iso(T0 - 50_000),
        status: 'completed',
        ...overrides,
      })
    }

    describe('the add-time refresh', () => {
      it('starts the search once the refresh completes, and waits on that instead', async () => {
        const job = await seed(
          buildMovieJob({
            status: DownloadJobStatus.Searching,
            statusNote: 'Waiting for Radarr to finish adding the movie',
            upstreamCommandAt: iso(T0 - 30_000),
            upstreamCommandId: 11,
            upstreamCommandKind: 'refresh',
          }),
        )
        radarrService.getCommand.mockResolvedValue(
          buildCommand({ id: 11, name: 'RefreshMovie', status: 'completed' }),
        )
        radarrService.triggerSearch.mockResolvedValue({
          id: 12,
          name: 'MoviesSearch',
          queuedAt: iso(T0 + 100),
        })

        at(T0)
        await service.poll()

        expect(radarrService.getCommand).toHaveBeenCalledWith(11)
        // By the id the poller resolved, not a library read.
        expect(radarrService.triggerSearch).toHaveBeenCalledWith(42)
        expect(radarrService.getLibraryMovie).not.toHaveBeenCalled()
        const updated = downloadStateService.jobs.get(job.id)
        expect(updated).toMatchObject({
          status: DownloadJobStatus.Searching,
          statusNote: undefined,
          upstreamCommandAt: iso(T0 + 100),
          upstreamCommandId: 12,
          upstreamCommandKind: 'search',
        })
        expect(getJobById(dbService.db, job.id)).toMatchObject({
          statusNote: null,
          upstreamCommandId: 12,
          upstreamCommandKind: 'search',
        })

        // The search is followed from then on, and sent only once.
        at(T0 + COMMAND_POLL_MS)
        await service.poll()
        expect(radarrService.getCommand).toHaveBeenLastCalledWith(12)
        expect(radarrService.triggerSearch).toHaveBeenCalledTimes(1)
      })

      it("sends the scope's own search for a show - season 0 included", async () => {
        const job = await seed(
          buildShowJob({
            scope: { seasonNumber: 0 },
            status: DownloadJobStatus.Searching,
            upstreamCommandAt: iso(T0 - 30_000),
            upstreamCommandId: 11,
            upstreamCommandKind: 'refresh',
          }),
        )
        sonarrService.getCommand.mockResolvedValue(
          buildCommand({ id: 11, name: 'RefreshSeries', status: 'completed' }),
        )
        sonarrService.triggerSeasonSearch.mockResolvedValue({
          id: 12,
          name: 'SeasonSearch',
          queuedAt: iso(T0),
        })

        at(T0)
        await service.poll()

        expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(9, 0)
        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          upstreamCommandId: 12,
          upstreamCommandKind: 'search',
        })
      })

      // Only now, with the refresh done: a flag written during it is undone.
      it("monitors the show's scope before its search", async () => {
        await seed(
          buildShowJob({
            scope: { seasonNumber: 2 },
            status: DownloadJobStatus.Searching,
            upstreamCommandAt: iso(T0 - 30_000),
            upstreamCommandId: 11,
            upstreamCommandKind: 'refresh',
          }),
        )
        sonarrService.getCommand.mockResolvedValue(
          buildCommand({ id: 11, name: 'RefreshSeries', status: 'completed' }),
        )
        sonarrService.triggerSeasonSearch.mockResolvedValue({
          id: 12,
          name: 'SeasonSearch',
          queuedAt: iso(T0),
        })

        at(T0)
        await service.poll()

        expect(sonarrService.monitorScope).toHaveBeenCalledWith(9, {
          seasonNumber: 2,
        })
        expect(
          sonarrService.monitorScope.mock.invocationCallOrder[0],
        ).toBeLessThan(
          sonarrService.triggerSeasonSearch.mock.invocationCallOrder[0] ?? 0,
        )
      })

      describe('an episode asked for by number', () => {
        async function seedByNumber(): Promise<DownloadJobRecord> {
          const job = await seed(
            buildShowJob({
              scope: { episodeNumber: 5, seasonNumber: 2 },
              status: DownloadJobStatus.Searching,
              statusNote: 'Waiting for Sonarr to finish adding the show',
              upstreamCommandAt: iso(T0 - 30_000),
              upstreamCommandId: 11,
              upstreamCommandKind: 'refresh',
            }),
          )
          sonarrService.getCommand.mockResolvedValue(
            buildCommand({
              id: 11,
              name: 'RefreshSeries',
              status: 'completed',
            }),
          )
          sonarrService.triggerEpisodeSearch.mockResolvedValue({
            id: 12,
            name: 'EpisodeSearch',
            queuedAt: iso(T0),
          })
          return job
        }

        it('resolves it, writes the resolved scope and waits on its search', async () => {
          const job = await seedByNumber()
          sonarrService.getEpisodes.mockResolvedValue([
            { episodeNumber: 5, id: 805, seasonNumber: 2, seriesId: 9 },
          ])

          at(T0)
          await service.poll()

          const resolved = { episodeId: 805, episodeNumber: 5, seasonNumber: 2 }
          expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([805])
          expect(downloadStateService.jobs.get(job.id)).toMatchObject({
            scope: resolved,
            status: DownloadJobStatus.Searching,
            statusNote: undefined,
            upstreamCommandId: 12,
            upstreamCommandKind: 'search',
          })
          expect(getJobById(dbService.db, job.id)?.scope).toEqual(resolved)
        })

        it("fails the job when Sonarr doesn't have it", async () => {
          const job = await seedByNumber()
          sonarrService.getEpisodes.mockResolvedValue([])

          at(T0)
          await service.poll()

          expect(downloadStateService.jobs.get(job.id)).toMatchObject({
            error: "S02E05 isn't in Sonarr",
            status: DownloadJobStatus.Failed,
            statusNote: undefined,
            upstreamCommandId: undefined,
            upstreamCommandKind: undefined,
          })
          expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
        })
      })

      describe('a title with flagged releases', () => {
        function flagMovie(): void {
          insertBadFile(dbService.db, {
            flaggedByEmail: 'alice@example.com',
            flaggedByUserId: 'user_1',
            mediaId: 'tmdb:1',
            mediaType: DownloadType.Movie,
            releaseGuid: 'indexer://bad',
          })
        }

        function releaseOf(guid: string): Release {
          return {
            downloadAllowed: true,
            flaggedBad: false,
            guid,
            indexerId: 1,
            rejected: false,
            title: guid,
          }
        }

        async function seedRefreshedMovie(): Promise<DownloadJobRecord> {
          flagMovie()
          const job = await seed(
            buildMovieJob({
              status: DownloadJobStatus.Searching,
              statusNote: 'Waiting for Radarr to finish adding the movie',
              upstreamCommandAt: iso(T0 - 30_000),
              upstreamCommandId: 11,
              upstreamCommandKind: 'refresh',
            }),
          )
          radarrService.getCommand.mockResolvedValue(
            buildCommand({ id: 11, name: 'RefreshMovie', status: 'completed' }),
          )
          return job
        }

        // The grab is claimed from history like any other; the job only
        // keeps when it was sent, which ranks it first for that grab.
        it('grabs, and waits on no command', async () => {
          const job = await seedRefreshedMovie()
          radarrService.getReleases.mockResolvedValue([
            releaseOf('indexer://bad'),
            releaseOf('indexer://ok'),
          ])

          at(T0)
          await service.poll()

          expect(radarrService.grabRelease).toHaveBeenCalledWith(
            'indexer://ok',
            1,
          )
          expect(radarrService.triggerSearch).not.toHaveBeenCalled()
          expect(downloadStateService.jobs.get(job.id)).toMatchObject({
            status: DownloadJobStatus.Searching,
            statusNote: undefined,
            upstreamCommandAt: iso(T0),
            upstreamCommandId: undefined,
            upstreamCommandKind: undefined,
          })
          expect(linksOf(job.id)).toEqual([])
        })

        it('ends not_found, with the note, when every release is flagged', async () => {
          const job = await seedRefreshedMovie()
          radarrService.getReleases.mockResolvedValue([
            releaseOf('indexer://bad'),
          ])

          at(T0)
          await service.poll()

          expect(downloadStateService.jobs.get(job.id)?.error).toBeUndefined()
          expect(downloadStateService.jobs.get(job.id)).toMatchObject({
            status: DownloadJobStatus.NotFound,
            statusNote:
              'No usable release — every result is flagged or rejected',
            upstreamCommandId: undefined,
            upstreamCommandKind: undefined,
          })
          expect(radarrService.grabRelease).not.toHaveBeenCalled()
        })
      })

      it('starts the search when upstream has lost the refresh', async () => {
        const job = await seed(
          buildMovieJob({
            status: DownloadJobStatus.Searching,
            upstreamCommandAt: iso(T0 - 30_000),
            upstreamCommandId: 11,
            upstreamCommandKind: 'refresh',
          }),
        )
        radarrService.getCommand.mockResolvedValue(null)
        radarrService.triggerSearch.mockResolvedValue({
          id: 12,
          name: 'MoviesSearch',
          queuedAt: iso(T0),
        })

        at(T0)
        await service.poll()

        expect(radarrService.triggerSearch).toHaveBeenCalledWith(42)
        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          status: DownloadJobStatus.Searching,
          upstreamCommandId: 12,
          upstreamCommandKind: 'search',
        })
      })

      it.each([
        ['radarr', 'Radarr never finished adding the movie'],
        ['sonarr', 'Sonarr never finished adding the show'],
      ] as const)(
        'fails a %s job whose refresh is still running after the wait',
        async (source, reason) => {
          const queuedAt = T0 - REFRESH_WAIT_TIMEOUT_MS + 1_000
          const overrides: Partial<DownloadJobRecord> = {
            status: DownloadJobStatus.Searching,
            statusNote: 'Waiting to finish adding',
            upstreamCommandAt: iso(queuedAt),
            upstreamCommandId: 11,
            upstreamCommandKind: 'refresh',
          }
          const job = await seed(
            source === 'radarr'
              ? buildMovieJob(overrides)
              : buildShowJob(overrides),
          )
          const app = source === 'radarr' ? radarrService : sonarrService
          app.getCommand.mockResolvedValue(
            buildCommand({ id: 11, name: 'RefreshMovie', status: 'started' }),
          )

          at(T0)
          await service.poll()
          expect(downloadStateService.jobs.get(job.id)?.status).toBe(
            DownloadJobStatus.Searching,
          )

          at(T0 + COMMAND_POLL_MS)
          await service.poll()

          const updated = downloadStateService.jobs.get(job.id)
          expect(updated).toMatchObject({
            error: reason,
            status: DownloadJobStatus.Failed,
            statusNote: undefined,
            upstreamCommandId: undefined,
            upstreamCommandKind: undefined,
          })
          expect(getJobById(dbService.db, job.id)).toMatchObject({
            error: reason,
            status: DownloadJobStatus.Failed,
          })
          expect(radarrService.triggerSearch).not.toHaveBeenCalled()
          expect(sonarrService.triggerSearch).not.toHaveBeenCalled()
        },
      )
    })

    describe('a search', () => {
      it('lets the job go on when it grabbed something, keeping when it was sent', async () => {
        const job = await searchingMovie()
        // Dated to the whole second before the command's start: history cuts
        // dates to seconds, so it still counts.
        radarrService.getHistorySince.mockResolvedValue([
          movieGrab(1, 'dl-1', T0 - 3_000),
        ])
        radarrService.getCommand.mockResolvedValue(
          completedSearch({
            ended: iso(T0 - 1_000),
            message: 'Completed. 1 reports downloaded.',
            started: iso(T0 - 2_600),
          }),
        )
        radarrService.getQueue.mockResolvedValue([
          {
            downloadId: 'dl-1',
            id: 7001,
            movieId: 42,
            size: 1000,
            sizeleft: 500,
            status: 'downloading',
          },
        ])

        at(T0)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          status: DownloadJobStatus.Downloading,
          upstreamCommandAt: iso(T0 - 60_000),
          upstreamCommandId: undefined,
          upstreamCommandKind: undefined,
        })
        expect(getJobById(dbService.db, job.id)).toMatchObject({
          upstreamCommandAt: iso(T0 - 60_000),
          upstreamCommandId: null,
        })

        // Nothing left to follow.
        at(T0 + COMMAND_POLL_MS)
        await service.poll()
        expect(radarrService.getCommand).toHaveBeenCalledTimes(1)
      })

      it('ends the job not_found when nothing was grabbed and history is read past its end', async () => {
        const job = await searchingMovie()
        // A grab from before the command started is an earlier attempt's.
        radarrService.getHistorySince.mockResolvedValue([
          movieGrab(1, 'dl-old', T0 - 120_000),
        ])
        radarrService.getCommand.mockResolvedValue(completedSearch())

        at(T0)
        await service.poll()

        // The chip already says "no release found": no note repeats it, and
        // nothing reads as an error.
        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.statusNote).toBeUndefined()
        expect(updated?.error).toBeUndefined()
        expect(updated).toMatchObject({
          status: DownloadJobStatus.NotFound,
          upstreamCommandId: undefined,
          upstreamCommandKind: undefined,
        })
        expect(getJobById(dbService.db, job.id)).toMatchObject({
          error: null,
          status: DownloadJobStatus.NotFound,
          statusNote: null,
        })
        expect(Logger.prototype.log).toHaveBeenCalledWith(
          expect.objectContaining({
            commandMessage: 'Completed. 0 reports downloaded.',
            jobId: job.id,
          }),
          'Search command finished without a grab',
        )
      })

      it('decides nothing until a history read started after the search ended', async () => {
        const job = await searchingMovie()
        // Ended just after this tick's history read started, its grab
        // written a moment before - a read the next interval catches.
        radarrService.getCommand.mockResolvedValue(
          completedSearch({ ended: iso(T0 + 500) }),
        )

        at(T0)
        await service.poll()
        at(T0 + COMMAND_POLL_MS)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          status: DownloadJobStatus.Searching,
          upstreamCommandId: 21,
        })
        expect(radarrService.getCommand).toHaveBeenCalledTimes(2)

        radarrService.getHistorySince.mockResolvedValue([
          movieGrab(1, 'dl-1', T0 + 400),
        ])
        at(T0 + 5_000)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          status: DownloadJobStatus.Searching,
          upstreamCommandId: undefined,
        })
        expect(linksOf(job.id).map(link => link.downloadId)).toEqual(['dl-1'])
      })

      it('ends not_found at the first history read past its end when no grab shows up', async () => {
        const job = await searchingMovie()
        radarrService.getCommand.mockResolvedValue(
          completedSearch({ ended: iso(T0 + 500) }),
        )

        at(T0)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Searching,
        )

        // The next read fails: still nothing decided.
        radarrService.getHistorySince.mockRejectedValueOnce(new Error('down'))
        at(T0 + 5_000)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Searching,
        )

        at(T0 + 10_000)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.NotFound,
        )
      })

      it('judges a search upstream has lost by the grabs since the job sent it', async () => {
        const lost = await searchingMovie()
        const found = await seed(
          buildShowJob({
            status: DownloadJobStatus.Searching,
            upstreamCommandAt: iso(T0 - 60_000),
            upstreamCommandId: 22,
            upstreamCommandKind: 'search',
          }),
        )
        radarrService.getCommand.mockResolvedValue(null)
        sonarrService.getCommand.mockResolvedValue(null)
        sonarrService.getHistorySince.mockResolvedValue([
          {
            date: iso(T0 - 30_000),
            downloadId: 'dl-s',
            eventType: 'grabbed',
            id: 1,
            seriesId: 9,
          },
        ])

        at(T0)
        await service.poll()

        expect(downloadStateService.jobs.get(found.id)).toMatchObject({
          status: DownloadJobStatus.Searching,
          upstreamCommandId: undefined,
        })
        // Gone as of now: only a history read started after that can say
        // nothing was grabbed - and the next read of the command must not
        // push that later.
        at(T0 + COMMAND_POLL_MS)
        await service.poll()
        expect(downloadStateService.jobs.get(lost.id)?.status).toBe(
          DownloadJobStatus.Searching,
        )

        at(T0 + 5_000)
        await service.poll()
        expect(downloadStateService.jobs.get(lost.id)?.status).toBe(
          DownloadJobStatus.NotFound,
        )
      })

      it.each([
        ['failed', 'Indexer query failed', 'Indexer query failed'],
        ['aborted', undefined, 'Radarr search aborted'],
        ['orphaned', undefined, 'Radarr search orphaned'],
      ] as const)(
        'fails the job when the command %s',
        async (status, message, reason) => {
          const job = await searchingMovie()
          radarrService.getCommand.mockResolvedValue(
            completedSearch({ message, status }),
          )

          at(T0)
          await service.poll()

          expect(downloadStateService.jobs.get(job.id)).toMatchObject({
            error: reason,
            status: DownloadJobStatus.Failed,
            upstreamCommandId: undefined,
            upstreamCommandKind: undefined,
          })
        },
      )

      it('leaves a cancelling job to its cancel', async () => {
        const job = await searchingMovie({
          status: DownloadJobStatus.Cancelling,
        })
        radarrService.getCommand.mockResolvedValue(completedSearch())

        at(T0)
        await service.poll()

        expect(radarrService.getCommand).not.toHaveBeenCalled()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Cancelling,
        )
      })

      it(`reads a job's command at most every ${COMMAND_POLL_MS} ms`, async () => {
        await searchingMovie()

        for (const offset of [0, 1_000, 1_999, 2_000, 3_000, 4_000]) {
          at(T0 + offset)
          await service.poll()
        }

        expect(radarrService.getCommand).toHaveBeenCalledTimes(3)
      })

      it('keeps the job waiting through a failed command read', async () => {
        const job = await searchingMovie()
        radarrService.getCommand.mockRejectedValueOnce(new Error('timeout'))

        at(T0)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          status: DownloadJobStatus.Searching,
          upstreamCommandId: 21,
        })
        expect(
          (service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt,
        ).toBe(0)
      })
    })

    describe('the search upstream queues after a failed download', () => {
      const FAILED_AT = T0 - 2_000

      /** A movie job whose download failed at FAILED_AT, Radarr retrying. */
      async function retryingMovie(): Promise<DownloadJobRecord> {
        const job = await seed(
          buildMovieJob({ status: DownloadJobStatus.Downloading }),
        )
        radarrService.getHistorySince.mockResolvedValue([
          movieGrab(1, 'dl-1', T0 - 60_000),
          {
            data: { message: 'Aborted' },
            date: iso(FAILED_AT),
            downloadId: 'dl-1',
            eventType: 'downloadFailed',
            id: 2,
            movieId: 42,
          },
        ])
        return job
      }

      function retrySearch(
        overrides: Partial<CommandSnapshot> & { id: number },
      ): CommandSnapshot {
        return buildCommand({
          body: { movieIds: [42] },
          queued: iso(FAILED_AT + 300),
          trigger: 'unspecified',
          ...overrides,
        })
      }

      it("follows Radarr's retry and ends not_found when it grabs nothing", async () => {
        const job = await retryingMovie()
        radarrService.listCommands.mockResolvedValue([
          // Someone else's movie, one started by hand, one from before the
          // failure: none of them is this job's retry.
          retrySearch({ body: { movieIds: [43] }, id: 30 }),
          retrySearch({ id: 31, trigger: 'manual' }),
          retrySearch({ id: 32, queued: iso(FAILED_AT - 60_000) }),
          retrySearch({ id: 33 }),
        ])

        at(T0)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          status: DownloadJobStatus.Searching,
          statusNote:
            'Last download failed: Aborted. Radarr is trying another release.',
          upstreamCommandAt: iso(FAILED_AT + 300),
          upstreamCommandId: 33,
          upstreamCommandKind: 'search',
        })

        radarrService.getCommand.mockResolvedValue(
          retrySearch({
            ended: iso(T0 + 1_000),
            id: 33,
            started: iso(FAILED_AT + 400),
            status: 'completed',
          }),
        )
        at(T0 + COMMAND_POLL_MS)
        await service.poll()
        expect(radarrService.getCommand).toHaveBeenCalledWith(33)
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Searching,
        )

        at(T0 + 5_000)
        await service.poll()

        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.error).toBeUndefined()
        expect(updated).toMatchObject({
          status: DownloadJobStatus.NotFound,
          statusNote: "Radarr's retry found no other release",
          upstreamCommandId: undefined,
        })
        expect(getJobById(dbService.db, job.id)).toMatchObject({
          error: null,
          statusNote: "Radarr's retry found no other release",
        })
      })

      it("ends not_found when Radarr's retry is never seen", async () => {
        const job = await retryingMovie()

        at(T0)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Searching,
        )

        at(FAILED_AT + RETRY_SEARCH_TIMEOUT_MS - 1_000)
        await service.poll()
        expect(downloadStateService.jobs.get(job.id)?.status).toBe(
          DownloadJobStatus.Searching,
        )

        at(FAILED_AT + RETRY_SEARCH_TIMEOUT_MS + 5_000)
        await service.poll()

        expect(radarrService.listCommands).toHaveBeenCalledTimes(3)
        const updated = downloadStateService.jobs.get(job.id)
        expect(updated?.error).toBeUndefined()
        expect(updated).toMatchObject({
          status: DownloadJobStatus.NotFound,
          statusNote: "Radarr's retry found no other release",
        })
      })

      it("matches Sonarr's episode retry to a season job by the season's episodes", async () => {
        const job = await seed(
          buildShowJob({
            scope: { seasonNumber: 0 },
            status: DownloadJobStatus.Downloading,
          }),
        )
        const episode = {
          episodeId: 501,
          episodeNumber: 1,
          season: 0,
        }
        sonarrService.getHistorySince.mockResolvedValue([
          {
            date: iso(T0 - 60_000),
            downloadId: 'dl-1',
            episode: { episodeNumber: 1, seasonNumber: 0 },
            episodeId: episode.episodeId,
            eventType: 'grabbed',
            id: 1,
            seriesId: 9,
          },
          {
            data: { message: 'Aborted' },
            date: iso(FAILED_AT),
            downloadId: 'dl-1',
            episode: { episodeNumber: 1, seasonNumber: 0 },
            episodeId: episode.episodeId,
            eventType: 'downloadFailed',
            id: 2,
            seriesId: 9,
          },
        ])
        sonarrService.getEpisodes.mockResolvedValue([
          { id: 501, seasonNumber: 0 },
          { id: 601, seasonNumber: 1 },
        ])
        sonarrService.listCommands.mockResolvedValue([
          buildCommand({
            body: { episodeIds: [601] },
            id: 40,
            name: 'EpisodeSearch',
            queued: iso(FAILED_AT + 100),
            trigger: 'unspecified',
          }),
          buildCommand({
            body: { episodeIds: [501] },
            id: 41,
            name: 'EpisodeSearch',
            queued: iso(FAILED_AT + 200),
            trigger: 'unspecified',
          }),
        ])

        at(T0)
        await service.poll()

        expect(downloadStateService.jobs.get(job.id)).toMatchObject({
          status: DownloadJobStatus.Searching,
          upstreamCommandId: 41,
          upstreamCommandKind: 'search',
        })
      })
    })
  })

  describe("completion credits only the job's own downloads", () => {
    /** Episode 1 of season 1, and episode 2 of season 2. */
    function library(files: { 1?: boolean; 2?: boolean }): void {
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: files[1] ? 901 : 0, id: 1, seasonNumber: 1 },
        { episodeFileId: files[2] ? 902 : 0, id: 2, seasonNumber: 2 },
      ])
      sonarrService.getEpisodeFiles.mockResolvedValue([
        ...(files[1]
          ? [{ dateAdded: AFTER_ISO, id: 901, seasonNumber: 1, seriesId: 9 }]
          : []),
        ...(files[2]
          ? [{ dateAdded: AFTER_ISO, id: 902, seasonNumber: 2, seriesId: 9 }]
          : []),
      ])
    }

    function importOf(
      downloadId: string,
      episodeId: number,
      fileId: number,
    ): SonarrHistoryResource {
      return {
        data: { fileId: String(fileId) },
        date: AFTER_ISO,
        downloadId,
        episodeId,
        eventType: 'downloadFolderImported',
        seriesId: 9,
      }
    }

    // A series job stuck on its own download while an RSS grab of another
    // season lands: the old any-new-file rule completed it.
    it('does not complete a stuck series job on an unrelated import', async () => {
      const job = await seed(
        buildShowJob({ status: DownloadJobStatus.Downloading }),
      )

      at(T0)
      sonarrService.getQueue.mockResolvedValue([
        {
          downloadId: 'dl-own',
          episodeId: 1,
          seasonNumber: 1,
          seriesId: 9,
          status: 'downloading',
        },
      ])
      await service.poll()
      expect(linksOf(job.id).map(link => link.downloadId)).toEqual(['dl-own'])

      at(T0 + 10_000)
      sonarrService.getQueue.mockResolvedValue([])
      library({ 2: true })
      sonarrService.getSeriesHistory.mockResolvedValue([
        importOf('dl-rss', 2, 902),
      ])
      await service.poll()

      expect(sonarrService.getSeriesHistory).toHaveBeenCalledWith(9)
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )

      at(T0 + 20_000)
      library({ 1: true, 2: true })
      sonarrService.getSeriesHistory.mockResolvedValue([
        importOf('dl-rss', 2, 902),
        importOf('dl-own', 1, 901),
      ])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    // Nothing to credit, nothing to read: history is only fetched once a
    // file newer than a linked job is listed.
    it('reads no history for a linked job with no new file', async () => {
      const job = await seed(
        buildShowJob({ status: DownloadJobStatus.Downloading }),
      )

      at(T0)
      sonarrService.getQueue.mockResolvedValue([
        {
          downloadId: 'dl-own',
          episodeId: 1,
          seasonNumber: 1,
          seriesId: 9,
          status: 'downloading',
        },
      ])
      await service.poll()
      sonarrService.getSeriesHistory.mockClear()

      at(T0 + 10_000)
      sonarrService.getQueue.mockResolvedValue([])
      library({})
      await service.poll()

      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
      expect(sonarrService.getSeriesHistory).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Downloading,
      )
    })

    /** A pack's rows: episode 1 imported, episode 2 blocked. */
    const PACK: SonarrQueueResource[] = [
      {
        downloadId: 'dl-pack',
        episodeHasFile: true,
        episodeId: 1,
        seasonNumber: 1,
        seriesId: 9,
        status: 'completed',
        trackedDownloadState: 'importPending',
      },
      {
        downloadId: 'dl-pack',
        episodeHasFile: false,
        episodeId: 3,
        seasonNumber: 1,
        seriesId: 9,
        status: 'completed',
        trackedDownloadState: 'importPending',
      },
    ]

    it('completes an episode job whose episode landed while its row stays', async () => {
      const job = await seed(
        buildShowJob({
          scope: { episodeId: 1, seasonNumber: 1 },
          status: DownloadJobStatus.Downloading,
        }),
      )

      at(T0)
      sonarrService.getQueue.mockResolvedValue(PACK)
      library({ 1: true })
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    // An upgrade in flight: the episode has its old file the whole time.
    it('leaves an episode job whose episode file predates it', async () => {
      const job = await seed(
        buildShowJob({
          scope: { episodeId: 1, seasonNumber: 1 },
          status: DownloadJobStatus.Downloading,
        }),
      )

      at(T0)
      sonarrService.getQueue.mockResolvedValue(PACK)
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 901, id: 1, seasonNumber: 1 },
      ])
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { dateAdded: BEFORE_ISO, id: 901, seasonNumber: 1, seriesId: 9 },
      ])
      await service.poll()

      expect(downloadStateService.jobs.get(job.id)?.status).not.toBe(
        DownloadJobStatus.Completed,
      )
    })

    it('does not complete a season job while its rows stay', async () => {
      const job = await seed(
        buildShowJob({
          scope: { seasonNumber: 1 },
          status: DownloadJobStatus.Downloading,
        }),
      )

      at(T0)
      sonarrService.getQueue.mockResolvedValue(
        PACK.map(item => ({ ...item, episodeHasFile: true })),
      )
      library({ 1: true })
      await service.poll()

      expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.get(job.id)?.status).not.toBe(
        DownloadJobStatus.Completed,
      )
    })
  })
})
