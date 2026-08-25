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

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
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
    hiddenAttribution: false,
    id: `${type}-1`,
    mediaId,
    requester: null,
    status: DownloadJobStatus.Requested,
    type,
    updatedAt: NOW_ISO,
    ...overrides,
  }
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
      search: jest.fn(),
      triggerSearch: jest.fn(),
      unmonitorAndDelete: jest.fn(),
    }
    const mockSonarrService = {
      ensureSeries: jest.fn().mockResolvedValue({ series: {}, sonarrId: 9 }),
      getQueue: jest.fn(),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      // The real one is a no-op for a season-only/empty scope and fills in
      // the display fields for an episode scope - mirrored here so a test
      // that passes an episode id gets a realistically resolved scope back.
      resolveScope: jest.fn(async (scope: ShowScope) =>
        scope.episodeId != null
          ? { episodeId: scope.episodeId, episodeNumber: 5, seasonNumber: 3 }
          : scope,
      ),
      search: jest.fn(),
      triggerEpisodeSearch: jest.fn(),
      triggerSeasonSearch: jest.fn(),
      triggerSearch: jest.fn(),
      unmonitorAndDelete: jest.fn(),
    }
    const mockDownloadGateway = { broadcastPerViewer: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaDownloadService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
        { provide: DownloadGateway, useValue: mockDownloadGateway },
        { provide: MediaResolverService, useValue: mediaResolver },
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
        hiddenAttribution: false,
        id: job.id,
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

    it('moves the job to Failed when RadarrService throws', async () => {
      radarrService.ensureMovie.mockRejectedValue(new Error('radarr down'))

      const job = await service.requestMovie(123)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('radarr down')
    })
  })

  describe('requestShow', () => {
    it('creates a Requested job, then moves it to Searching on success', async () => {
      const job = await service.requestShow(456)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.media.type).toBe(DownloadType.Show)
      expect(job.media.id).toBe('tvdb:456')
    })

    it('triggers the generic search command when the title has no flagged releases', async () => {
      await service.requestShow(456)

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(456)
      expect(sonarrService.triggerSearch).toHaveBeenCalledWith(9)
      expect(sonarrService.getReleases).not.toHaveBeenCalled()
    })

    it('moves the job to Failed when SonarrService throws', async () => {
      sonarrService.ensureSeries.mockRejectedValue(new Error('sonarr down'))

      const job = await service.requestShow(456)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('sonarr down')
    })

    // The no-regression guarantee: an unscoped request must be exactly what
    // it was before Phase 4 - bare ensureSeries, generic command, no
    // resolution round trip, no scope on the job.
    it('leaves an unscoped request untouched by Phase 4', async () => {
      const job = await service.requestShow(456)

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(456)
      expect(sonarrService.resolveScope).not.toHaveBeenCalled()
      expect(sonarrService.triggerEpisodeSearch).not.toHaveBeenCalled()
      expect(sonarrService.triggerSeasonSearch).not.toHaveBeenCalled()
      expect(job.scope).toBeUndefined()
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
  })
})
