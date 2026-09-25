// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// MediaDownloadService) must mock it first (see
// apps/tdr-bot/src/media/services/__tests__/radarr.service.test.ts for the
// same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEventType,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  Media,
  type Release,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { getJobById } from 'src/db/jobs.repo'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

import {
  createFakeMediaResolver,
  flushAsync,
} from './helpers/fake-media-resolver'

const NOW_ISO = '2026-08-20T12:00:00.000Z'

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
    id: `${type}-1`,
    linkedDiscord: null,
    mediaId,
    requester: null,
    status: DownloadJobStatus.Requested,
    type,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

/** A promise the test settles by hand, to hold `submit()` mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

describe('MediaDownloadService', () => {
  let service: MediaDownloadService
  let downloadStateService: DownloadStateService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let downloadGateway: jest.Mocked<DownloadGateway>
  let mediaResolver: ReturnType<typeof createFakeMediaResolver>
  let dbService: DbService

  beforeEach(async () => {
    dbService = createTestDbService()
    mediaResolver = createFakeMediaResolver()
    const mockRadarrService = {
      ensureMovie: jest.fn().mockResolvedValue({ movie: {}, radarrId: 42 }),
      getQueue: jest.fn(),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      removeQueueItem: jest.fn(),
      search: jest.fn(),
      triggerSearch: jest.fn(),
      unmonitorAndDelete: jest.fn(),
      unmonitorIfMissing: jest.fn(),
    }
    const mockSonarrService = {
      ensureSeries: jest.fn().mockResolvedValue({ series: {}, sonarrId: 9 }),
      getQueue: jest.fn(),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      removeQueueItem: jest.fn(),
      // The real one is a no-op for a season-only/empty scope and fills in
      // the display fields for an episode scope - mirrored here so a test
      // that passes an episode id gets a realistically resolved scope back.
      resolveScope: jest.fn(async (scope: ShowScope) =>
        scope.episodeId != null
          ? { episodeId: scope.episodeId, episodeNumber: 5, seasonNumber: 3 }
          : scope,
      ),
      search: jest.fn(),
      setSeasonsMonitored: jest.fn().mockResolvedValue([]),
      triggerEpisodeSearch: jest.fn(),
      triggerSeasonSearch: jest.fn(),
      triggerSearch: jest.fn(),
      unmonitorAndDelete: jest.fn(),
      unmonitorScope: jest.fn(),
    }
    const mockDownloadGateway = {
      broadcast: jest.fn(),
      broadcastPerViewer: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        MediaDownloadService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
        { provide: MediaResolverService, useValue: mediaResolver },
        MediaStateService,
      ],
    }).compile()

    service = module.get(MediaDownloadService)
    downloadStateService = module.get(DownloadStateService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)
    downloadGateway = module.get(DownloadGateway)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('searchMovies / searchShows', () => {
    it('delegates to RadarrService/SonarrService', async () => {
      const movie: Media = {
        id: 'tmdb:1',
        title: 'A',
        tmdbId: 1,
        type: DownloadType.Movie,
      }
      const show: Media = {
        id: 'tvdb:2',
        title: 'B',
        tvdbId: 2,
        type: DownloadType.Show,
      }
      radarrService.search.mockResolvedValue([movie] as never)
      sonarrService.search.mockResolvedValue([show] as never)

      await expect(service.searchMovies('a')).resolves.toEqual([movie])
      await expect(service.searchShows('b')).resolves.toEqual([show])
      expect(radarrService.search).toHaveBeenCalledWith('a')
      expect(sonarrService.search).toHaveBeenCalledWith('b')
    })
  })

  describe('requestMovie', () => {
    it('creates a Requested job keyed only by media id, then moves it to Searching', async () => {
      const job = await service.requestMovie(123)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.media.type).toBe(DownloadType.Movie)
      expect(job.media.id).toBe('tmdb:123')

      // The whole point of the derived model: requesting a title writes no
      // metadata whatsoever. The persisted record is the key and nothing
      // else; the title/poster come back through the resolver on read.
      const record = downloadStateService.jobs.get(job.id)
      expect(record).toEqual({
        completedAt: null,
        createdAt: expect.any(String),
        // Both null on a movie request: it arrives over the web or as a
        // service call, never over Discord, and `linkedDiscord` is resolved
        // at read time rather than minted here.
        discordRequester: null,
        hiddenAttribution: false,
        id: job.id,
        linkedDiscord: null,
        mediaId: 'tmdb:123',
        requester: null,
        status: DownloadJobStatus.Searching,
        type: DownloadType.Movie,
        updatedAt: expect.any(String),
      })
    })

    it('broadcasts both the creation and the status change', async () => {
      const job = await service.requestMovie(123)
      await flushAsync()

      // Job creation (the initial `Requested` insert) and the subsequent
      // `Searching` status update must each broadcast - this is the real
      // call site that closes the "job creation is invisible" gap.
      expect(downloadGateway.broadcastPerViewer).toHaveBeenCalledTimes(2)

      const [firstBuild] =
        downloadGateway.broadcastPerViewer.mock.calls[0] ?? []
      const [secondBuild] =
        downloadGateway.broadcastPerViewer.mock.calls[1] ?? []

      expect(firstBuild?.(false)).toEqual({
        data: {
          job: expect.objectContaining({
            id: job.id,
            status: DownloadJobStatus.Requested,
          }),
          type: DownloadJobEventType.Created,
        },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
      expect(secondBuild?.(false)).toEqual({
        data: {
          job: expect.objectContaining({
            id: job.id,
            status: DownloadJobStatus.Searching,
          }),
          type: DownloadJobEventType.Updated,
        },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })

    // The unflagged path is the pre-Phase-3 path: ensure the movie exists,
    // then hand the choice to Radarr's own scoring via the generic command.
    it('triggers the generic search command when the title has no flagged releases', async () => {
      await service.requestMovie(123)

      expect(radarrService.ensureMovie).toHaveBeenCalledWith(123)
      expect(radarrService.triggerSearch).toHaveBeenCalledWith(42)
      expect(radarrService.getReleases).not.toHaveBeenCalled()
      expect(radarrService.grabRelease).not.toHaveBeenCalled()
    })

    // A title added this request is missing from the resolver's cached
    // library - without this the job's media has no radarrId and the poller
    // can't track it until the cache expires.
    it('hands the ensure result to the resolver before searching', async () => {
      const ensured = {
        movie: {},
        radarrId: 42,
        wasAdded: true,
        wasMonitored: false,
      }
      radarrService.ensureMovie.mockResolvedValue(ensured as never)

      await service.requestMovie(123)

      expect(mediaResolver.invalidateAfterEnsure).toHaveBeenCalledWith(
        'tmdb:123',
        ensured,
      )
      expect(
        mediaResolver.invalidateAfterEnsure.mock.invocationCallOrder[0],
      ).toBeLessThan(
        radarrService.triggerSearch.mock.invocationCallOrder[0] as number,
      )
    })

    it('moves the job to Failed when RadarrService throws', async () => {
      radarrService.ensureMovie.mockRejectedValue(new Error('radarr down'))

      const job = await service.requestMovie(123)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('radarr down')
    })
  })

  describe('requestShow', () => {
    it('hands the ensure result to the resolver', async () => {
      const ensured = {
        series: {},
        sonarrId: 9,
        turnedOnEpisodeIds: [],
        wasAdded: true,
        wasMonitored: false,
      }
      sonarrService.ensureSeries.mockResolvedValue(ensured as never)

      await service.requestShow(456)

      expect(mediaResolver.invalidateAfterEnsure).toHaveBeenCalledWith(
        'tvdb:456',
        ensured,
      )
    })

    it('creates a Requested job, then moves it to Searching on success', async () => {
      const job = await service.requestShow(456)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.media.type).toBe(DownloadType.Show)
      expect(job.media.id).toBe('tvdb:456')
    })

    it('triggers the generic search command when the title has no flagged releases', async () => {
      await service.requestShow(456)

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(456, {
        monitorEpisodes: {},
      })
      expect(sonarrService.triggerSearch).toHaveBeenCalledWith(9)
      expect(sonarrService.getReleases).not.toHaveBeenCalled()
    })

    it('moves the job to Failed when SonarrService throws', async () => {
      sonarrService.ensureSeries.mockRejectedValue(new Error('sonarr down'))

      const job = await service.requestShow(456)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('sonarr down')
    })

    // A bare request is an *explicit* whole-series request: an empty scope
    // (not "no options"), every season flag on, the generic command, no
    // resolution round trip and no scope on the job.
    it('monitors the whole series for an unscoped request', async () => {
      const job = await service.requestShow(456)

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(456, {
        monitorEpisodes: {},
      })
      expect(sonarrService.setSeasonsMonitored).toHaveBeenCalledWith(
        9,
        'all',
        true,
      )
      expect(sonarrService.resolveScope).not.toHaveBeenCalled()
      expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
      expect(sonarrService.triggerSeasonSearch).not.toHaveBeenCalled()
      expect(job.scope).toBeUndefined()
    })

    // Sonarr's `PUT /series` may cascade a season flag down to that
    // season's episodes, so every episode read/write has to be done before
    // the season write - otherwise a cascade could change what gets
    // reported back as the restore set.
    it('writes the season flags after ensureSeries, never before', async () => {
      await service.requestShow(456)

      const ensureOrder =
        sonarrService.ensureSeries.mock.invocationCallOrder[0] ?? 0
      const seasonOrder =
        sonarrService.setSeasonsMonitored.mock.invocationCallOrder[0] ?? 0

      expect(ensureOrder).toBeGreaterThan(0)
      expect(seasonOrder).toBeGreaterThan(ensureOrder)
    })

    it('fails the job when the season-flag write throws', async () => {
      sonarrService.setSeasonsMonitored.mockRejectedValue(
        new Error('sonarr rejected the season write'),
      )

      const job = await service.requestShow(456)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('sonarr rejected the season write')
      expect(sonarrService.triggerSearch).not.toHaveBeenCalled()
    })
  })

  describe('requestShow with a scope', () => {
    it('runs an EpisodeSearch and stores the resolved scope on the job', async () => {
      const job = await service.requestShow(456, null, { episodeId: 4412 })

      expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([4412])
      expect(sonarrService.triggerSearch).not.toHaveBeenCalled()
      // Resolved, not as supplied: `episodeNumber` is what makes an
      // activity row able to say "S03E05" without a second lookup.
      expect(job.scope).toEqual({
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      })
    })

    it('runs a SeasonSearch for a season-only scope', async () => {
      const job = await service.requestShow(456, null, { seasonNumber: 3 })

      expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(9, 3)
      expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
      expect(job.scope).toEqual({ seasonNumber: 3 })
    })

    // Season 0 is specials - a truthiness check would silently widen this
    // to a whole-series search.
    it('runs a SeasonSearch for season 0', async () => {
      await service.requestShow(456, null, { seasonNumber: 0 })

      expect(sonarrService.triggerSeasonSearch).toHaveBeenCalledWith(9, 0)
      expect(sonarrService.triggerSearch).not.toHaveBeenCalled()
    })

    // Narrowest wins: an episode id beats a season number.
    it('prefers EpisodeSearch when the scope names both', async () => {
      await service.requestShow(456, null, { episodeId: 4412, seasonNumber: 3 })

      expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([4412])
      expect(sonarrService.triggerSeasonSearch).not.toHaveBeenCalled()
    })

    it('asks ensureSeries to monitor only the scoped episodes', async () => {
      const scope = { seasonNumber: 3 }

      await service.requestShow(456, null, scope)

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(456, {
        monitorEpisodes: scope,
      })
    })

    // The season flag is Sonarr's third, independent `monitored` switch:
    // without this write, Sonarr's own UI and its RSS/missing jobs still
    // see an unmonitored season even though the episodes are on.
    it('monitors the scoped season flag', async () => {
      await service.requestShow(456, null, { seasonNumber: 3 })

      expect(sonarrService.setSeasonsMonitored).toHaveBeenCalledWith(
        9,
        [3],
        true,
      )
    })

    // Season 0 is specials - a truthiness check would widen this to every
    // season's flag.
    it('monitors the season 0 flag rather than every season', async () => {
      await service.requestShow(456, null, { seasonNumber: 0 })

      expect(sonarrService.setSeasonsMonitored).toHaveBeenCalledWith(
        9,
        [0],
        true,
      )
    })

    it('leaves the season flag alone for an episode request', async () => {
      await service.requestShow(456, null, { episodeId: 4412 })

      expect(sonarrService.setSeasonsMonitored).not.toHaveBeenCalled()
    })

    // Narrowest wins here too: a scope naming both is an episode request,
    // so the season flag stays untouched.
    it('leaves the season flag alone when the scope names both', async () => {
      await service.requestShow(456, null, { episodeId: 4412, seasonNumber: 3 })

      expect(sonarrService.setSeasonsMonitored).not.toHaveBeenCalled()
    })

    it('mints the job with the requested scope before submit resolves it', async () => {
      const created: DownloadJobRecord[] = []
      jest.spyOn(downloadStateService, 'addJob').mockImplementation(function (
        this: DownloadStateService,
        record,
      ) {
        created.push(record)
        return DownloadStateService.prototype.addJob.call(this, record)
      })

      await service.requestShow(456, null, { episodeId: 4412 })

      // The `created` broadcast already carries a scope, so a subscriber
      // never sees a scoped request as a whole-series one.
      expect(created[0]?.scope).toEqual({ episodeId: 4412 })
    })

    it('fails the job when the episode id cannot be resolved', async () => {
      sonarrService.resolveScope.mockRejectedValue(new Error('no such episode'))

      const job = await service.requestShow(456, null, { episodeId: 9999 })

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('no such episode')
      expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
    })
  })

  // The whole point of Phase 3's enforcement: a title with flagged releases
  // can't go through the generic command, because that command has no way to
  // be told "anything but that one".
  describe('auto-select enforcement for flagged titles', () => {
    function flag(mediaId: string, releaseGuid: string) {
      insertBadFile(dbService.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId,
        mediaType: mediaId.startsWith('tmdb:')
          ? DownloadType.Movie
          : DownloadType.Show,
        releaseGuid,
      })
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

    it('fetches and grabs the best unflagged release instead of searching', async () => {
      flag('tmdb:123', 'indexer://bad')
      radarrService.getReleases.mockResolvedValue([
        release({ customFormatScore: 10, guid: 'indexer://bad' }),
        release({ customFormatScore: 5, guid: 'indexer://ok' }),
      ])

      const job = await service.requestMovie(123)

      expect(radarrService.triggerSearch).not.toHaveBeenCalled()
      expect(radarrService.getReleases).toHaveBeenCalledWith(42)
      expect(radarrService.grabRelease).toHaveBeenCalledWith('indexer://ok', 1)
      expect(job.status).toBe(DownloadJobStatus.Searching)
    })

    it('skips releases the upstream service already rejected', async () => {
      flag('tmdb:123', 'indexer://bad')
      radarrService.getReleases.mockResolvedValue([
        release({
          customFormatScore: 99,
          guid: 'indexer://rejected',
          rejected: true,
        }),
        release({ customFormatScore: 1, guid: 'indexer://ok' }),
      ])

      await service.requestMovie(123)

      expect(radarrService.grabRelease).toHaveBeenCalledWith('indexer://ok', 1)
    })

    it('fails the job with a descriptive error when nothing survives the filter', async () => {
      flag('tmdb:123', 'indexer://bad')
      radarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://bad' }),
      ])

      const job = await service.requestMovie(123)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toContain('No usable release for tmdb:123')
      expect(radarrService.grabRelease).not.toHaveBeenCalled()
    })

    it('fails the job when the indexer returned nothing at all', async () => {
      flag('tmdb:123', 'indexer://bad')
      radarrService.getReleases.mockResolvedValue([])

      const job = await service.requestMovie(123)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toContain('all 0 release(s)')
    })

    // Flags are scoped to one title - another movie's flags must not push
    // this one off the command path.
    it('ignores flags recorded against a different title', async () => {
      flag('tmdb:999', 'indexer://bad')

      await service.requestMovie(123)

      expect(radarrService.triggerSearch).toHaveBeenCalledWith(42)
      expect(radarrService.getReleases).not.toHaveBeenCalled()
    })

    it('applies the same branch to shows', async () => {
      flag('tvdb:456', 'indexer://bad')
      sonarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://bad' }),
        release({ guid: 'indexer://ok', seeders: 50 }),
      ])

      await service.requestShow(456)

      expect(sonarrService.triggerSearch).not.toHaveBeenCalled()
      expect(sonarrService.grabRelease).toHaveBeenCalledWith('indexer://ok', 1)
    })

    // The flagged branch was already scope-capable - `getReleases` has
    // taken a scope since Phase 3, so only the argument changed.
    it('narrows the release fetch to the scope on a flagged, scoped request', async () => {
      flag('tvdb:456', 'indexer://bad')
      sonarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://ok' }),
      ])

      const job = await service.requestShow(456, null, { episodeId: 4412 })

      expect(sonarrService.getReleases).toHaveBeenCalledWith(9, {
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      })
      expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
      expect(sonarrService.grabRelease).toHaveBeenCalledWith('indexer://ok', 1)
      // The scope still lands on the job on the flagged path.
      expect(job.scope).toEqual({
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      })
    })

    // The unscoped flagged path keeps calling getReleases with one arg.
    it('leaves the unscoped flagged fetch unscoped', async () => {
      flag('tvdb:456', 'indexer://bad')
      sonarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://ok' }),
      ])

      await service.requestShow(456)

      expect(sonarrService.getReleases).toHaveBeenCalledWith(9)
    })
  })

  describe('getMovieJob / getShowJob', () => {
    it('throws when the job does not exist', async () => {
      await expect(service.getMovieJob('missing')).rejects.toThrow('not found')
      await expect(service.getShowJob('missing')).rejects.toThrow('not found')
    })

    it('throws when the job exists but is the wrong type', async () => {
      const showJob = buildRecord(DownloadType.Show, 'tvdb:1', { id: 'show-1' })
      downloadStateService.jobs.set(showJob.id, showJob)

      await expect(service.getMovieJob('show-1')).rejects.toThrow(
        "Expected a movie job but got a 'show' job",
      )
    })

    it('returns the job with its media resolved when the type matches', async () => {
      const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
        id: 'movie-1',
        status: DownloadJobStatus.Searching,
      })
      downloadStateService.jobs.set(movieJob.id, movieJob)

      const job = await service.getMovieJob('movie-1')

      expect(job.id).toBe('movie-1')
      expect(job.media).toEqual({
        id: 'tmdb:1',
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      })
    })
  })

  describe('deleteMovieJob', () => {
    it('unmonitors and deletes in Radarr using the resolved radarrId, then cancels the job', async () => {
      mediaResolver.fixtures.set('tmdb:1', {
        id: 'tmdb:1',
        radarrId: 42,
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      })
      const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
        id: 'movie-1',
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(movieJob.id, movieJob)
      radarrService.unmonitorAndDelete.mockResolvedValue(undefined)

      const result = await service.deleteMovieJob('movie-1')

      expect(radarrService.unmonitorAndDelete).toHaveBeenCalledWith(42)
      expect(result.status).toBe(DownloadJobStatus.Cancelled)
      // Without this, the next read would serve the pre-delete library
      // entry (still carrying filePath) for up to a full TTL window.
      expect(mediaResolver.invalidate).toHaveBeenCalledWith('tmdb:1')
    })

    // A title requested but never added to the library resolves without a
    // radarrId - there is nothing upstream to delete, and that is not an
    // error.
    it('skips the Radarr call when the title has no radarrId', async () => {
      const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
        id: 'movie-1',
      })
      downloadStateService.jobs.set(movieJob.id, movieJob)

      const result = await service.deleteMovieJob('movie-1')

      expect(radarrService.unmonitorAndDelete).not.toHaveBeenCalled()
      expect(result.status).toBe(DownloadJobStatus.Cancelled)
    })

    // Plan 021: a job is one attempt. Deleting the file a completed attempt
    // produced is a second fact, not a rewrite of the first.
    describe('a finished attempt', () => {
      const COMPLETED_AT = '2026-08-20T12:30:00.000Z'

      beforeEach(() => {
        mediaResolver.fixtures.set('tmdb:1', {
          filePath: '/movies/A Movie (2026)/a-movie.mkv',
          id: 'tmdb:1',
          radarrId: 42,
          title: 'A Movie',
          tmdbId: 1,
          type: DownloadType.Movie,
        })
        // What Radarr's delete leaves behind: the title resolves again, but
        // with no upstream id and no file.
        radarrService.unmonitorAndDelete.mockImplementation(async () => {
          mediaResolver.fixtures.set('tmdb:1', {
            id: 'tmdb:1',
            title: 'A Movie',
            tmdbId: 1,
            type: DownloadType.Movie,
          })
        })
      })

      it('leaves a completed attempt completed, completedAt and all', async () => {
        const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
          completedAt: COMPLETED_AT,
          id: 'movie-1',
          status: DownloadJobStatus.Completed,
        })
        downloadStateService.jobs.set(movieJob.id, movieJob)
        const updateJob = jest.spyOn(downloadStateService, 'updateJob')

        const result = await service.deleteMovieJob('movie-1')

        expect(radarrService.unmonitorAndDelete).toHaveBeenCalledWith(42)
        expect(updateJob).not.toHaveBeenCalled()
        expect(result.status).toBe(DownloadJobStatus.Completed)
        expect(result.completedAt).toBe(COMPLETED_AT)
        expect(downloadStateService.jobs.get('movie-1')).toEqual(movieJob)
      })

      // The route still answers with the job, and its media is read after
      // the delete - not the pre-delete copy the upstream id came off.
      it('answers with the post-delete media', async () => {
        const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
          completedAt: COMPLETED_AT,
          id: 'movie-1',
          status: DownloadJobStatus.Completed,
        })
        downloadStateService.jobs.set(movieJob.id, movieJob)

        const result = await service.deleteMovieJob('movie-1')

        expect(mediaResolver.invalidate).toHaveBeenCalledWith('tmdb:1')
        expect(result.media).not.toHaveProperty('radarrId')
        expect(result.media).not.toHaveProperty('filePath')
      })

      // Nothing about the job changed, so there is no job event to send.
      it('broadcasts no job event', async () => {
        const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
          completedAt: COMPLETED_AT,
          id: 'movie-1',
          status: DownloadJobStatus.Completed,
        })
        downloadStateService.jobs.set(movieJob.id, movieJob)

        await service.deleteMovieJob('movie-1')
        await flushAsync()

        expect(downloadGateway.broadcastPerViewer).not.toHaveBeenCalled()
      })

      it('leaves a failed attempt failed', async () => {
        const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
          error: 'No release found',
          id: 'movie-1',
          status: DownloadJobStatus.Failed,
        })
        downloadStateService.jobs.set(movieJob.id, movieJob)

        const result = await service.deleteMovieJob('movie-1')

        expect(result.status).toBe(DownloadJobStatus.Failed)
        expect(result.error).toBe('No release found')
      })

      // A restart empties the Map, and `updateJob()` throws for a job the
      // Map has never seen - which used to make a finished movie from before
      // the restart undeletable. Nothing is written now, so the durable row
      // is enough.
      it('deletes a finished attempt that only the durable row remembers', async () => {
        const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
          completedAt: COMPLETED_AT,
          id: 'movie-1',
          status: DownloadJobStatus.Completed,
        })
        downloadStateService.addJob(movieJob)
        downloadStateService.jobs.delete(movieJob.id)

        const result = await service.deleteMovieJob('movie-1')

        expect(radarrService.unmonitorAndDelete).toHaveBeenCalledWith(42)
        expect(result.status).toBe(DownloadJobStatus.Completed)
        expect(result.completedAt).toBe(COMPLETED_AT)
      })

      // The gallery is built from the library, so nothing about the delete
      // needs writing to the title's other jobs - an older attempt keeps its
      // outcome exactly as the one named here does.
      it('leaves every other attempt at the title untouched', async () => {
        const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
          completedAt: COMPLETED_AT,
          id: 'movie-1',
          status: DownloadJobStatus.Completed,
        })
        const olderJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
          completedAt: '2026-08-01T00:00:00.000Z',
          createdAt: '2026-08-01T00:00:00.000Z',
          id: 'movie-0',
          status: DownloadJobStatus.Completed,
        })
        downloadStateService.addJob(olderJob)
        downloadStateService.addJob(movieJob)
        const before = getJobById(dbService.db, 'movie-0')
        expect(before).toMatchObject({ status: DownloadJobStatus.Completed })

        await service.deleteMovieJob('movie-1')

        expect(getJobById(dbService.db, 'movie-0')).toEqual(before)
      })
    })
  })

  describe('cancelMovieJob', () => {
    function inLibrary(): void {
      mediaResolver.fixtures.set('tmdb:1', {
        id: 'tmdb:1',
        radarrId: 42,
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      })
    }

    function seedJob(overrides: Partial<DownloadJobRecord> = {}) {
      const movieJob = buildRecord(DownloadType.Movie, 'tmdb:1', {
        id: 'movie-1',
        status: DownloadJobStatus.Downloading,
        ...overrides,
      })
      downloadStateService.jobs.set(movieJob.id, movieJob)
      return movieJob
    }

    beforeEach(() => {
      radarrService.getQueue.mockResolvedValue([])
      radarrService.removeQueueItem.mockResolvedValue(undefined)
      radarrService.unmonitorIfMissing.mockResolvedValue(true)
    })

    it("removes the movie's queue items and moves the job to cancelling", async () => {
      inLibrary()
      seedJob()
      radarrService.getQueue.mockResolvedValue([
        { id: 101, movieId: 42 },
        { id: 102, movieId: 42 },
        // Another movie's row, which a filtered read shouldn't return but
        // must never be touched if it does.
        { id: 103, movieId: 7 },
      ])

      const result = await service.cancelMovieJob('movie-1')

      expect(radarrService.getQueue).toHaveBeenCalledWith([42])
      expect(radarrService.removeQueueItem).toHaveBeenCalledTimes(2)
      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(101)
      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(102)
      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(downloadStateService.jobs.get('movie-1')?.status).toBe(
        DownloadJobStatus.Cancelling,
      )
    })

    // Radarr decides what "has no file" means - a cancelled replacement
    // keeps the copy on disk monitored.
    it('delegates the unmonitor to unmonitorIfMissing, and never deletes a file', async () => {
      inLibrary()
      seedJob()
      radarrService.getQueue.mockResolvedValue([{ id: 101, movieId: 42 }])
      const deleteMovieFile = jest.fn()
      Object.assign(radarrService, { deleteMovieFile })

      await service.cancelMovieJob('movie-1')

      expect(radarrService.unmonitorIfMissing).toHaveBeenCalledWith(42)
      expect(radarrService.unmonitorAndDelete).not.toHaveBeenCalled()
      expect(deleteMovieFile).not.toHaveBeenCalled()
    })

    it('clears the error a needs_attention job carried', async () => {
      inLibrary()
      seedJob({
        error: 'Not an upgrade for existing movie file',
        status: DownloadJobStatus.NeedsAttention,
      })
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')

      const result = await service.cancelMovieJob('movie-1')

      expect(updateJob).toHaveBeenCalledWith('movie-1', {
        error: undefined,
        status: DownloadJobStatus.Cancelling,
      })
      expect(result.error).toBeUndefined()
      // Persisted too, not just the in-memory copy.
      expect(getJobById(dbService.db, 'movie-1')?.error).toBeNull()
    })

    it('cancels a paused job the same way', async () => {
      inLibrary()
      seedJob({ status: DownloadJobStatus.Paused })
      radarrService.getQueue.mockResolvedValue([{ id: 101, movieId: 42 }])

      const result = await service.cancelMovieJob('movie-1')

      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(101)
      expect(result.status).toBe(DownloadJobStatus.Cancelling)
    })

    // The next read must see the post-cancel `monitored` flag.
    it('invalidates the resolver before the status write', async () => {
      inLibrary()
      seedJob()
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')

      await service.cancelMovieJob('movie-1')

      expect(mediaResolver.invalidate).toHaveBeenCalledWith('tmdb:1')
      expect(mediaResolver.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
        updateJob.mock.invocationCallOrder[0] as number,
      )
    })

    it('returns a cancelling job as is, with no upstream call', async () => {
      inLibrary()
      seedJob({ status: DownloadJobStatus.Cancelling })
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')

      const result = await service.cancelMovieJob('movie-1')

      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(radarrService.getQueue).not.toHaveBeenCalled()
      expect(radarrService.unmonitorIfMissing).not.toHaveBeenCalled()
      expect(updateJob).not.toHaveBeenCalled()
    })

    it.each([
      DownloadJobStatus.Completed,
      DownloadJobStatus.Cancelled,
      DownloadJobStatus.Failed,
    ])('throws for a %s job, touching nothing', async status => {
      inLibrary()
      seedJob({ status })
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')

      await expect(service.cancelMovieJob('movie-1')).rejects.toThrow(
        "Job with ID 'movie-1'",
      )
      expect(radarrService.getQueue).not.toHaveBeenCalled()
      expect(updateJob).not.toHaveBeenCalled()
    })

    it('throws for a show job', async () => {
      downloadStateService.jobs.set(
        'show-1',
        buildRecord(DownloadType.Show, 'tvdb:1', {
          id: 'show-1',
          status: DownloadJobStatus.Downloading,
        }),
      )

      await expect(service.cancelMovieJob('show-1')).rejects.toThrow(
        "Expected a movie job but got a 'show' job",
      )
    })

    // A first request whose `ensureMovie` hasn't returned yet: nothing is
    // upstream to undo, and `request()` finishes the cancel once it is.
    it('only moves a requested job with no radarrId to cancelling', async () => {
      seedJob({ status: DownloadJobStatus.Requested })

      const result = await service.cancelMovieJob('movie-1')

      expect(radarrService.getQueue).not.toHaveBeenCalled()
      expect(radarrService.removeQueueItem).not.toHaveBeenCalled()
      expect(radarrService.unmonitorIfMissing).not.toHaveBeenCalled()
      expect(result.status).toBe(DownloadJobStatus.Cancelling)
    })

    it('propagates a getQueue failure and leaves the job as it was', async () => {
      inLibrary()
      const movieJob = seedJob()
      radarrService.getQueue.mockRejectedValue(new Error('Radarr is down'))

      await expect(service.cancelMovieJob('movie-1')).rejects.toThrow(
        'Radarr is down',
      )
      expect(downloadStateService.jobs.get('movie-1')).toEqual(movieJob)
      expect(radarrService.unmonitorIfMissing).not.toHaveBeenCalled()
    })

    it('propagates an unmonitor failure and leaves the job as it was', async () => {
      inLibrary()
      const movieJob = seedJob()
      radarrService.unmonitorIfMissing.mockRejectedValue(
        new Error('Radarr is down'),
      )

      await expect(service.cancelMovieJob('movie-1')).rejects.toThrow(
        'Radarr is down',
      )
      expect(downloadStateService.jobs.get('movie-1')).toEqual(movieJob)
    })

    // The poller retries whatever is left of a cancelling job's queue.
    it('still cancels when one of two removals fails, and warns', async () => {
      inLibrary()
      seedJob()
      radarrService.getQueue.mockResolvedValue([
        { id: 101, movieId: 42 },
        { id: 102, movieId: 42 },
      ])
      radarrService.removeQueueItem.mockImplementation(async queueId => {
        if (queueId === 101) throw new Error('Client unreachable')
      })

      const result = await service.cancelMovieJob('movie-1')

      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(102)
      expect(radarrService.unmonitorIfMissing).toHaveBeenCalledWith(42)
      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Client unreachable', queueId: 101 }),
        expect.any(String),
      )
    })

    it('skips a queue item with no id', async () => {
      inLibrary()
      seedJob()
      radarrService.getQueue.mockResolvedValue([
        { movieId: 42 },
        { id: 102, movieId: 42 },
      ])

      const result = await service.cancelMovieJob('movie-1')

      expect(radarrService.removeQueueItem).toHaveBeenCalledTimes(1)
      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(102)
      expect(result.status).toBe(DownloadJobStatus.Cancelling)
    })

    // The upstream calls take seconds; a file landing meanwhile is an
    // outcome the cancel must not overwrite.
    it('keeps an outcome the poller settled during the upstream calls', async () => {
      inLibrary()
      seedJob()
      radarrService.unmonitorIfMissing.mockImplementation(async () => {
        downloadStateService.updateJob('movie-1', {
          status: DownloadJobStatus.Completed,
        })
        return false
      })

      const result = await service.cancelMovieJob('movie-1')

      expect(result.status).toBe(DownloadJobStatus.Completed)
      expect(downloadStateService.jobs.get('movie-1')?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })

    describe('racing a request', () => {
      // The title is already in the library, so the press does its upstream
      // work - and `submit()` resolves (and moves the job to `Searching`)
      // while that work is still out. The search it dispatched came after
      // the press's queue read, so the press has to run it once more.
      it('re-runs the upstream half when submit() resolved during it', async () => {
        inLibrary()
        const ensure = deferred<{ movie: object; radarrId: number }>()
        radarrService.ensureMovie.mockReturnValue(
          ensure.promise as ReturnType<RadarrService['ensureMovie']>,
        )
        const firstQueueRead = deferred<[]>()
        radarrService.getQueue
          .mockReturnValueOnce(firstQueueRead.promise)
          .mockResolvedValue([{ id: 101, movieId: 42 }])

        const requested = service.requestMovie(1)
        await flushAsync()
        const cancelled = service.cancelMovieJob('mock-id')
        await flushAsync()

        ensure.resolve({ movie: {}, radarrId: 42 })
        expect((await requested).status).toBe(DownloadJobStatus.Searching)

        firstQueueRead.resolve([])
        const result = await cancelled

        expect(result.status).toBe(DownloadJobStatus.Cancelling)
        expect(radarrService.getQueue).toHaveBeenCalledTimes(2)
        expect(radarrService.removeQueueItem).toHaveBeenCalledWith(101)
        expect(radarrService.unmonitorIfMissing).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('deleteShowJob', () => {
    it('unmonitors and deletes in Sonarr using the resolved sonarrId, then cancels the job', async () => {
      mediaResolver.fixtures.set('tvdb:1', {
        id: 'tvdb:1',
        sonarrId: 9,
        title: 'A Show',
        tvdbId: 1,
        type: DownloadType.Show,
      })
      const showJob = buildRecord(DownloadType.Show, 'tvdb:1', {
        id: 'show-1',
        status: DownloadJobStatus.Downloading,
      })
      downloadStateService.jobs.set(showJob.id, showJob)
      sonarrService.unmonitorAndDelete.mockResolvedValue(undefined)

      const result = await service.deleteShowJob('show-1')

      expect(sonarrService.unmonitorAndDelete).toHaveBeenCalledWith(9)
      expect(result.status).toBe(DownloadJobStatus.Cancelled)
    })

    it('leaves a completed attempt completed, completedAt and all', async () => {
      const completedAt = '2026-08-20T12:30:00.000Z'
      mediaResolver.fixtures.set('tvdb:1', {
        id: 'tvdb:1',
        sonarrId: 9,
        title: 'A Show',
        tvdbId: 1,
        type: DownloadType.Show,
      })
      const showJob = buildRecord(DownloadType.Show, 'tvdb:1', {
        completedAt,
        id: 'show-1',
        status: DownloadJobStatus.Completed,
      })
      downloadStateService.jobs.set(showJob.id, showJob)
      sonarrService.unmonitorAndDelete.mockResolvedValue(undefined)

      const result = await service.deleteShowJob('show-1')

      expect(sonarrService.unmonitorAndDelete).toHaveBeenCalledWith(9)
      expect(result.status).toBe(DownloadJobStatus.Completed)
      expect(result.completedAt).toBe(completedAt)
    })

    it('leaves a cancelled attempt cancelled without writing it again', async () => {
      const showJob = buildRecord(DownloadType.Show, 'tvdb:1', {
        id: 'show-1',
        status: DownloadJobStatus.Cancelled,
      })
      downloadStateService.jobs.set(showJob.id, showJob)
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')

      const result = await service.deleteShowJob('show-1')

      expect(updateJob).not.toHaveBeenCalled()
      expect(result.status).toBe(DownloadJobStatus.Cancelled)
    })
  })

  describe('cancelShowJob', () => {
    function seedJob(overrides: Partial<DownloadJobRecord> = {}) {
      mediaResolver.fixtures.set('tvdb:1', {
        id: 'tvdb:1',
        sonarrId: 9,
        title: 'A Show',
        tvdbId: 1,
        type: DownloadType.Show,
      })
      const showJob = buildRecord(DownloadType.Show, 'tvdb:1', {
        id: 'show-1',
        status: DownloadJobStatus.Downloading,
        ...overrides,
      })
      downloadStateService.jobs.set(showJob.id, showJob)
      return showJob
    }

    // Two seasons, two episodes each, plus a row from another series.
    const QUEUE = [
      { episodeId: 301, id: 1, seasonNumber: 3, seriesId: 9 },
      { episodeId: 302, id: 2, seasonNumber: 3, seriesId: 9 },
      { episodeId: 401, id: 3, seasonNumber: 4, seriesId: 9 },
      { episodeId: 402, id: 4, seasonNumber: 4, seriesId: 9 },
      { episodeId: 999, id: 5, seasonNumber: 3, seriesId: 10 },
    ]

    function removedIds(): number[] {
      return sonarrService.removeQueueItem.mock.calls
        .map(([queueId]) => queueId)
        .sort((a, b) => a - b)
    }

    beforeEach(() => {
      sonarrService.getQueue.mockResolvedValue(QUEUE)
      sonarrService.removeQueueItem.mockResolvedValue(undefined)
      sonarrService.unmonitorScope.mockResolvedValue(1)
    })

    it("leaves a sibling episode's download alone for an episode job", async () => {
      const scope = { episodeId: 301, episodeNumber: 1, seasonNumber: 3 }
      seedJob({ scope })

      const result = await service.cancelShowJob('show-1')

      expect(sonarrService.getQueue).toHaveBeenCalledWith([9])
      expect(removedIds()).toEqual([1])
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, scope, {
        withoutFileOnly: true,
      })
      expect(result.status).toBe(DownloadJobStatus.Cancelling)
    })

    it("removes only its own season's items for a season job", async () => {
      seedJob({ scope: { seasonNumber: 4 } })

      await service.cancelShowJob('show-1')

      expect(removedIds()).toEqual([3, 4])
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(
        9,
        { seasonNumber: 4 },
        { withoutFileOnly: true },
      )
    })

    it("removes every one of the series's items for a whole-series job", async () => {
      seedJob()

      await service.cancelShowJob('show-1')

      expect(removedIds()).toEqual([1, 2, 3, 4])
      // An unscoped job is the whole series - `{}` to `unmonitorScope`.
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(
        9,
        {},
        { withoutFileOnly: true },
      )
    })

    it('never deletes a file', async () => {
      seedJob()
      const deleteEpisodeFile = jest.fn()
      Object.assign(sonarrService, { deleteEpisodeFile })

      await service.cancelShowJob('show-1')

      expect(sonarrService.unmonitorAndDelete).not.toHaveBeenCalled()
      expect(deleteEpisodeFile).not.toHaveBeenCalled()
    })

    it('clears the error a needs_attention job carried', async () => {
      seedJob({
        error: 'Episode file already imported',
        status: DownloadJobStatus.NeedsAttention,
      })

      const result = await service.cancelShowJob('show-1')

      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(result.error).toBeUndefined()
    })

    it('returns a cancelling job as is, with no upstream call', async () => {
      seedJob({ status: DownloadJobStatus.Cancelling })

      const result = await service.cancelShowJob('show-1')

      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(sonarrService.getQueue).not.toHaveBeenCalled()
      expect(sonarrService.unmonitorScope).not.toHaveBeenCalled()
    })

    it('throws for a completed job', async () => {
      seedJob({ status: DownloadJobStatus.Completed })

      await expect(service.cancelShowJob('show-1')).rejects.toThrow(
        "Job with ID 'show-1'",
      )
      expect(sonarrService.getQueue).not.toHaveBeenCalled()
    })

    it('propagates a getQueue failure and leaves the job as it was', async () => {
      const showJob = seedJob()
      sonarrService.getQueue.mockRejectedValue(new Error('Sonarr is down'))

      await expect(service.cancelShowJob('show-1')).rejects.toThrow(
        'Sonarr is down',
      )
      expect(downloadStateService.jobs.get('show-1')).toEqual(showJob)
    })
  })

  // `request()` re-reads the job once `submit()` settles: a cancel that
  // landed while it was out upstream must survive it.
  describe('a cancel while request() is out upstream', () => {
    const SCOPE = { episodeId: 301 }
    const RESOLVED = { episodeId: 301, episodeNumber: 5, seasonNumber: 3 }
    let ensure: ReturnType<
      typeof deferred<{ series: object; sonarrId: number }>
    >

    beforeEach(() => {
      ensure = deferred()
      sonarrService.ensureSeries.mockReturnValue(
        ensure.promise as ReturnType<SonarrService['ensureSeries']>,
      )
      sonarrService.getQueue.mockResolvedValue([
        { episodeId: 301, id: 1, seasonNumber: 3, seriesId: 9 },
        { episodeId: 302, id: 2, seasonNumber: 3, seriesId: 9 },
      ])
      sonarrService.removeQueueItem.mockResolvedValue(undefined)
      sonarrService.unmonitorScope.mockResolvedValue(1)
    })

    /** Requests, then cancels while `ensureSeries` is still out. */
    async function requestThenCancel() {
      const requested = service.requestShow(1, null, SCOPE)
      await flushAsync()

      // A first request: the title has no sonarrId yet, so the press can
      // only move the job.
      const cancelled = await service.cancelShowJob('mock-id')
      expect(cancelled.status).toBe(DownloadJobStatus.Cancelling)
      expect(sonarrService.getQueue).not.toHaveBeenCalled()

      // What `ensureSeries` leaves behind: the title in the library.
      mediaResolver.fixtures.set('tvdb:1', {
        id: 'tvdb:1',
        sonarrId: 9,
        title: 'A Show',
        tvdbId: 1,
        type: DownloadType.Show,
      })

      return requested
    }

    it('stays cancelling, writes the resolved scope, and cleans up upstream', async () => {
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')
      const requested = requestThenCancel()
      await flushAsync()

      ensure.resolve({ series: {}, sonarrId: 9 })
      const result = await requested

      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(result.scope).toEqual(RESOLVED)
      expect(downloadStateService.jobs.get('mock-id')).toMatchObject({
        scope: RESOLVED,
        status: DownloadJobStatus.Cancelling,
      })
      expect(updateJob).not.toHaveBeenCalledWith(
        'mock-id',
        expect.objectContaining({ status: DownloadJobStatus.Searching }),
      )
      // The search `submit()` dispatched is cleaned up, in scope only.
      expect(sonarrService.triggerEpisodeSearch).toHaveBeenCalledWith([301])
      expect(sonarrService.getQueue).toHaveBeenCalledWith([9])
      expect(sonarrService.removeQueueItem).toHaveBeenCalledTimes(1)
      expect(sonarrService.removeQueueItem).toHaveBeenCalledWith(1)
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, RESOLVED, {
        withoutFileOnly: true,
      })
    })

    // The poller's cancelling path still removes a late grab, so a failed
    // cleanup is logged rather than turning a cancel that took into an error.
    it('stays cancelling when the upstream cleanup fails', async () => {
      sonarrService.getQueue.mockRejectedValue(new Error('Sonarr is down'))
      const requested = requestThenCancel()
      await flushAsync()

      ensure.resolve({ series: {}, sonarrId: 9 })
      const result = await requested

      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Sonarr is down', jobId: 'mock-id' }),
        expect.any(String),
      )
    })

    it('does not write failed when submit() rejects after the cancel', async () => {
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')
      const requested = requestThenCancel()
      await flushAsync()

      ensure.reject(new Error('Sonarr is down'))
      const result = await requested

      expect(result.status).toBe(DownloadJobStatus.Cancelling)
      expect(result.error).toBeUndefined()
      expect(updateJob).not.toHaveBeenCalledWith(
        'mock-id',
        expect.objectContaining({ status: DownloadJobStatus.Failed }),
      )
    })

    // The poller only moves a job it can see upstream - its status is
    // fresher than the `Searching` `request()` would otherwise write.
    it('leaves a status the poller wrote meanwhile', async () => {
      const requested = service.requestShow(1, null, SCOPE)
      await flushAsync()
      downloadStateService.updateJob('mock-id', {
        status: DownloadJobStatus.Downloading,
      })

      ensure.resolve({ series: {}, sonarrId: 9 })
      const result = await requested

      expect(result.status).toBe(DownloadJobStatus.Downloading)
    })
  })
})
