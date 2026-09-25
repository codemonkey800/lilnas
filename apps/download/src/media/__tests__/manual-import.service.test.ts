// nanoid v5 ships ESM-only and this codebase's ts-jest transform doesn't
// cover it, so any suite that transitively imports DownloadStateService (as
// ManualImportService does) has to mock it before the imports below.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type {
  ManualImportResource as RadarrManualImportResource,
  QueueResource as RadarrQueueResource,
} from '@lilnas/media/radarr'
import type {
  ManualImportResource as SonarrManualImportResource,
  QueueResource as SonarrQueueResource,
} from '@lilnas/media/sonarr'
import {
  type DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  type ShowScope,
} from '@lilnas/utils/download/types'
import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import {
  jobScopeCovers,
  ManualImportService,
} from 'src/media/manual-import.service'
import { UNPARSED_EPISODES_REASON } from 'src/media/manual-import-mapper.util'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

import { createFakeMediaResolver } from './helpers/fake-media-resolver'

const NOW_ISO = '2026-09-21T12:00:00.000Z'

const MOVIE_ID = 'tmdb:445571'
const RADARR_ID = 434
const SHOW_ID = 'tvdb:81189'
const SONARR_ID = 9

const MOVIE_DOWNLOAD_ID = 'ce427a39-be9f-4271-b193-f7067dd82c4a'
const MOVIE_PATH =
  '/downloads/Game.Night.2018.1080p.BluRay.x265/Game.Night.2018.1080p.BluRay.x265.mp4'
const MOVIE_REJECTION =
  'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265'

const SHOW_DOWNLOAD_ID = 'sonarr-download-1'
const SHOW_PATH =
  '/downloads/The.Wire.S03.1080p.BluRay.x265/the.wire.s03e05.mkv'
const SHOW_PATH_2 =
  '/downloads/The.Wire.S03.1080p.BluRay.x265/the.wire.s03e06.mkv'

/**
 * The live Radarr queue row this feature exists for, read 2026-09-21:
 * finished, warned about, and never imported.
 */
const movieQueueItem: RadarrQueueResource = {
  downloadId: MOVIE_DOWNLOAD_ID,
  id: 152557673,
  movieId: RADARR_ID,
  protocol: 'usenet',
  size: 1681143972,
  sizeleft: 0,
  status: 'completed',
  title: 'Game.Night.2018.1080p.BluRay.x265',
  trackedDownloadState: 'importPending',
  trackedDownloadStatus: 'warning',
}

/** Its one manual-import candidate, verbatim. */
const movieCandidate: RadarrManualImportResource = {
  customFormatScore: 0,
  customFormats: [],
  downloadId: MOVIE_DOWNLOAD_ID,
  folderName: 'Game.Night.2018.1080p.BluRay.x265',
  id: 26454175,
  indexerFlags: 0,
  languages: [{ id: 1, name: 'English' }],
  movie: { id: RADARR_ID, title: 'Game Night' },
  movieFileId: null,
  name: 'Game.Night.2018.1080p.BluRay.x265',
  path: MOVIE_PATH,
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
  qualityWeight: 20,
  rejections: [{ reason: MOVIE_REJECTION, type: 'permanent' }],
  relativePath: 'Game.Night.2018.1080p.BluRay.x265.mp4',
  releaseGroup: null,
  size: 1674940307,
}

function showQueueItem(
  episodeId: number,
  overrides: Partial<SonarrQueueResource> = {},
): SonarrQueueResource {
  return {
    downloadId: SHOW_DOWNLOAD_ID,
    episodeId,
    id: 1000 + episodeId,
    seasonNumber: 3,
    seriesId: SONARR_ID,
    size: 2_000_000,
    sizeleft: 0,
    status: 'completed',
    trackedDownloadState: 'importPending',
    trackedDownloadStatus: 'warning',
    ...overrides,
  }
}

function showCandidate(
  overrides: Partial<SonarrManualImportResource> = {},
): SonarrManualImportResource {
  return {
    downloadId: SHOW_DOWNLOAD_ID,
    folderName: 'The.Wire.S03.1080p.BluRay.x265',
    id: 900,
    indexerFlags: 0,
    languages: [{ id: 1, name: 'English' }],
    path: SHOW_PATH,
    quality: {
      quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 },
      revision: { version: 1 },
    },
    rejections: [],
    relativePath: 'the.wire.s03e05.mkv',
    releaseGroup: null,
    seasonNumber: 3,
    size: 2_000_000,
    ...overrides,
  }
}

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
    status: DownloadJobStatus.NeedsAttention,
    type,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

describe('ManualImportService', () => {
  let service: ManualImportService
  let downloadStateService: DownloadStateService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let mediaResolver: ReturnType<typeof createFakeMediaResolver>
  let dbService: DbService
  let warn: jest.SpyInstance

  /** Seeds a stuck job the way the poller would have left it. */
  function seedJob(record: DownloadJobRecord): DownloadJobRecord {
    downloadStateService.jobs.set(record.id, record)
    return record
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    mediaResolver = createFakeMediaResolver()
    mediaResolver.fixtures.set(MOVIE_ID, {
      id: MOVIE_ID,
      radarrId: RADARR_ID,
      title: 'Game Night',
      tmdbId: 445571,
      type: DownloadType.Movie,
    })
    mediaResolver.fixtures.set(SHOW_ID, {
      id: SHOW_ID,
      sonarrId: SONARR_ID,
      title: 'The Wire',
      tvdbId: 81189,
      type: DownloadType.Show,
    })

    const mockRadarrService = {
      commitManualImport: jest.fn().mockResolvedValue(undefined),
      getManualImportCandidates: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
      removeQueueItem: jest.fn().mockResolvedValue(undefined),
    }
    const mockSonarrService = {
      commitManualImport: jest.fn().mockResolvedValue(undefined),
      getManualImportCandidates: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
      removeQueueItem: jest.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        ManualImportService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        {
          provide: DownloadGateway,
          useValue: { broadcast: jest.fn(), broadcastPerViewer: jest.fn() },
        },
        { provide: MediaResolverService, useValue: mediaResolver },
        MediaStateService,
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
      ],
    }).compile()

    service = module.get(ManualImportService)
    downloadStateService = module.get(DownloadStateService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('listCandidates', () => {
    it('maps the live Radarr candidate for the movie in the queue', async () => {
      radarrService.getQueue.mockResolvedValue([movieQueueItem])
      radarrService.getManualImportCandidates.mockResolvedValue([
        movieCandidate,
      ])

      const candidates = await service.listCandidates(MOVIE_ID, undefined)

      expect(radarrService.getQueue).toHaveBeenCalledWith([RADARR_ID])
      expect(radarrService.getManualImportCandidates).toHaveBeenCalledWith(
        MOVIE_DOWNLOAD_ID,
        RADARR_ID,
      )
      expect(candidates).toEqual([
        {
          downloadId: MOVIE_DOWNLOAD_ID,
          importable: true,
          languages: ['English'],
          movieTitle: 'Game Night',
          name: 'Game.Night.2018.1080p.BluRay.x265',
          path: MOVIE_PATH,
          quality: { name: 'Bluray-1080p', resolution: 1080 },
          rejections: [MOVIE_REJECTION],
          relativePath: 'Game.Night.2018.1080p.BluRay.x265.mp4',
          releaseGroup: undefined,
          size: 1674940307,
        },
      ])
    })

    it('ignores a queue item belonging to another title', async () => {
      radarrService.getQueue.mockResolvedValue([
        { ...movieQueueItem, movieId: 999 },
      ])

      await expect(
        service.listCandidates(MOVIE_ID, undefined),
      ).resolves.toEqual([])
      expect(radarrService.getManualImportCandidates).not.toHaveBeenCalled()
    })

    it('asks once per distinct downloadId and concatenates both candidate lists', async () => {
      sonarrService.getQueue.mockResolvedValue([
        showQueueItem(4201, { downloadId: 'download-a' }),
        showQueueItem(4202, { downloadId: 'download-b' }),
      ])
      sonarrService.getManualImportCandidates
        .mockResolvedValueOnce([
          showCandidate({
            episodes: [{ episodeNumber: 5, id: 4201, seasonNumber: 3 }],
          }),
        ])
        .mockResolvedValueOnce([
          showCandidate({
            episodes: [{ episodeNumber: 6, id: 4202, seasonNumber: 3 }],
            path: SHOW_PATH_2,
          }),
        ])

      const candidates = await service.listCandidates(SHOW_ID, {
        seasonNumber: 3,
      })

      expect(sonarrService.getManualImportCandidates).toHaveBeenCalledTimes(2)
      expect(sonarrService.getManualImportCandidates).toHaveBeenNthCalledWith(
        1,
        'download-a',
        SONARR_ID,
        3,
      )
      expect(candidates.map(candidate => candidate.path)).toEqual([
        SHOW_PATH,
        SHOW_PATH_2,
      ])
    })

    it('reports a season pack Sonarr could not parse as not importable', async () => {
      sonarrService.getQueue.mockResolvedValue([
        showQueueItem(4201, { episodeId: null }),
      ])
      sonarrService.getManualImportCandidates.mockResolvedValue([
        showCandidate({ episodes: [] }),
      ])

      const candidates = await service.listCandidates(SHOW_ID, undefined)

      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.importable).toBe(false)
      expect(candidates[0]?.blockedReason).toBe(UNPARSED_EPISODES_REASON)
    })

    it('skips a queue item with no downloadId and warns', async () => {
      radarrService.getQueue.mockResolvedValue([
        { ...movieQueueItem, downloadId: null },
      ])

      await expect(
        service.listCandidates(MOVIE_ID, undefined),
      ).resolves.toEqual([])
      expect(radarrService.getManualImportCandidates).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalled()
    })

    it('skips a candidate with no path and warns', async () => {
      radarrService.getQueue.mockResolvedValue([movieQueueItem])
      radarrService.getManualImportCandidates.mockResolvedValue([
        { ...movieCandidate, path: null },
      ])

      await expect(
        service.listCandidates(MOVIE_ID, undefined),
      ).resolves.toEqual([])
      expect(warn).toHaveBeenCalled()
    })

    it('404s for a media key that is not a movie or a show', async () => {
      await expect(
        service.listCandidates('video:abc', undefined),
      ).rejects.toThrow(NotFoundException)
    })

    it('404s for a title that is not in the library', async () => {
      mediaResolver.fixtures.set(MOVIE_ID, {
        id: MOVIE_ID,
        title: 'Game Night',
        tmdbId: 445571,
        type: DownloadType.Movie,
      })

      await expect(service.listCandidates(MOVIE_ID, undefined)).rejects.toThrow(
        `Media '${MOVIE_ID}' is not in the library`,
      )
    })

    it('400s when a movie key carries a show scope', async () => {
      await expect(
        service.listCandidates(MOVIE_ID, { seasonNumber: 3 }),
      ).rejects.toThrow(BadRequestException)
      expect(radarrService.getQueue).not.toHaveBeenCalled()
    })
  })

  describe('importFiles', () => {
    it('builds the Radarr command from the fresh candidate and moves the job to Importing', async () => {
      radarrService.getQueue.mockResolvedValue([movieQueueItem])
      radarrService.getManualImportCandidates.mockResolvedValue([
        movieCandidate,
      ])
      const job = seedJob(
        buildRecord(DownloadType.Movie, MOVIE_ID, {
          error: MOVIE_REJECTION,
          id: 'movie-job',
        }),
      )

      await expect(
        service.importFiles(MOVIE_ID, { paths: [MOVIE_PATH] }),
      ).resolves.toEqual({ importedCount: 1 })

      // Field-by-field: every one of these comes from the upstream resource,
      // never from the request body, which carried only the path.
      expect(radarrService.commitManualImport).toHaveBeenCalledWith([
        {
          downloadId: MOVIE_DOWNLOAD_ID,
          folderName: 'Game.Night.2018.1080p.BluRay.x265',
          indexerFlags: 0,
          languages: [{ id: 1, name: 'English' }],
          movieId: RADARR_ID,
          path: MOVIE_PATH,
          quality: movieCandidate.quality,
          releaseGroup: null,
        },
      ])

      const updated = downloadStateService.jobs.get(job.id)
      expect(updated?.status).toBe(DownloadJobStatus.Importing)
      // The whole point of the explicit `{ error: undefined }` patch: the
      // rejection must not follow the job into its history.
      expect(updated?.error).toBeUndefined()
      expect(mediaResolver.invalidate).toHaveBeenCalledWith(MOVIE_ID)
    })

    it('builds the Sonarr command with the episodes Sonarr parsed', async () => {
      sonarrService.getQueue.mockResolvedValue([showQueueItem(4201)])
      sonarrService.getManualImportCandidates.mockResolvedValue([
        showCandidate({
          episodes: [{ episodeNumber: 5, id: 4201, seasonNumber: 3 }],
        }),
      ])
      const job = seedJob(
        buildRecord(DownloadType.Show, SHOW_ID, {
          id: 'season-job',
          scope: { seasonNumber: 3 },
        }),
      )

      await expect(
        service.importFiles(SHOW_ID, { paths: [SHOW_PATH], seasonNumber: 3 }),
      ).resolves.toEqual({ importedCount: 1 })

      expect(sonarrService.commitManualImport).toHaveBeenCalledWith([
        {
          downloadId: SHOW_DOWNLOAD_ID,
          episodeFileId: undefined,
          episodeIds: [4201],
          folderName: 'The.Wire.S03.1080p.BluRay.x265',
          indexerFlags: 0,
          languages: [{ id: 1, name: 'English' }],
          path: SHOW_PATH,
          quality: showCandidate().quality,
          releaseGroup: null,
          releaseType: 'unknown',
          seriesId: SONARR_ID,
        },
      ])
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Importing,
      )
    })

    it('fills episodeIds from an episode-level scope when Sonarr parsed none', async () => {
      sonarrService.getQueue.mockResolvedValue([showQueueItem(4201)])
      sonarrService.getManualImportCandidates.mockResolvedValue([
        showCandidate({ episodes: [] }),
      ])

      await expect(
        service.importFiles(SHOW_ID, { episodeId: 4201, paths: [SHOW_PATH] }),
      ).resolves.toEqual({ importedCount: 1 })

      expect(sonarrService.getManualImportCandidates).toHaveBeenCalledWith(
        SHOW_DOWNLOAD_ID,
        SONARR_ID,
        undefined,
      )
      expect(sonarrService.commitManualImport).toHaveBeenCalledWith([
        expect.objectContaining({ episodeIds: [4201], seriesId: SONARR_ID }),
      ])
    })

    it('sends both files of a two-item season in one command', async () => {
      sonarrService.getQueue.mockResolvedValue([
        showQueueItem(4201),
        showQueueItem(4202),
      ])
      sonarrService.getManualImportCandidates.mockResolvedValue([
        showCandidate({
          episodes: [{ episodeNumber: 5, id: 4201, seasonNumber: 3 }],
        }),
        showCandidate({
          episodes: [{ episodeNumber: 6, id: 4202, seasonNumber: 3 }],
          path: SHOW_PATH_2,
        }),
      ])

      await expect(
        service.importFiles(SHOW_ID, {
          paths: [SHOW_PATH, SHOW_PATH_2],
          seasonNumber: 3,
        }),
      ).resolves.toEqual({ importedCount: 2 })

      expect(sonarrService.commitManualImport).toHaveBeenCalledTimes(1)
      expect(sonarrService.commitManualImport).toHaveBeenCalledWith([
        expect.objectContaining({ episodeIds: [4201], path: SHOW_PATH }),
        expect.objectContaining({ episodeIds: [4202], path: SHOW_PATH_2 }),
      ])
    })

    it('400s on a path that is no longer on offer', async () => {
      radarrService.getQueue.mockResolvedValue([movieQueueItem])
      radarrService.getManualImportCandidates.mockResolvedValue([
        movieCandidate,
      ])

      await expect(
        service.importFiles(MOVIE_ID, { paths: ['/downloads/gone.mkv'] }),
      ).rejects.toThrow(
        `These files are not waiting to be imported for '${MOVIE_ID}': /downloads/gone.mkv`,
      )
      expect(radarrService.commitManualImport).not.toHaveBeenCalled()
    })

    it('400s on a path Sonarr could not attribute to any episode', async () => {
      sonarrService.getQueue.mockResolvedValue([
        showQueueItem(4201, { episodeId: null }),
      ])
      sonarrService.getManualImportCandidates.mockResolvedValue([
        showCandidate({ episodes: [] }),
      ])

      await expect(
        service.importFiles(SHOW_ID, { paths: [SHOW_PATH] }),
      ).rejects.toThrow(`These files can't be imported from here: ${SHOW_PATH}`)
      expect(sonarrService.commitManualImport).not.toHaveBeenCalled()
    })

    it('404s when nothing is in scope', async () => {
      radarrService.getQueue.mockResolvedValue([])

      await expect(
        service.importFiles(MOVIE_ID, { paths: [MOVIE_PATH] }),
      ).rejects.toThrow(`Nothing is waiting to be imported for '${MOVIE_ID}'`)
    })

    it('400s when a movie import carries an episode id', async () => {
      await expect(
        service.importFiles(MOVIE_ID, { episodeId: 4201, paths: [MOVIE_PATH] }),
      ).rejects.toThrow(BadRequestException)
      expect(radarrService.getQueue).not.toHaveBeenCalled()
    })

    it('leaves a job that is not NeedsAttention alone', async () => {
      radarrService.getQueue.mockResolvedValue([movieQueueItem])
      radarrService.getManualImportCandidates.mockResolvedValue([
        movieCandidate,
      ])
      const job = seedJob(
        buildRecord(DownloadType.Movie, MOVIE_ID, {
          id: 'completed-job',
          status: DownloadJobStatus.Completed,
        }),
      )

      await service.importFiles(MOVIE_ID, { paths: [MOVIE_PATH] })

      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Completed,
      )
    })
  })

  describe('discard', () => {
    it('removes every matched queue row and cancels only the jobs in scope', async () => {
      sonarrService.getQueue.mockResolvedValue([
        showQueueItem(4201),
        showQueueItem(4202),
      ])
      const seasonJob = seedJob(
        buildRecord(DownloadType.Show, SHOW_ID, {
          error: 'Waiting to import',
          id: 'season-job',
          scope: { seasonNumber: 3 },
        }),
      )
      const episodeJob = seedJob(
        buildRecord(DownloadType.Show, SHOW_ID, {
          id: 'episode-job',
          scope: { episodeId: 4201, seasonNumber: 3 },
        }),
      )

      await expect(
        service.discard(SHOW_ID, { seasonNumber: 3 }),
      ).resolves.toEqual({ discardedCount: 2 })

      expect(sonarrService.removeQueueItem).toHaveBeenCalledTimes(2)
      expect(sonarrService.removeQueueItem).toHaveBeenNthCalledWith(1, 5201)
      expect(sonarrService.removeQueueItem).toHaveBeenNthCalledWith(2, 5202)

      const cancelled = downloadStateService.jobs.get(seasonJob.id)
      expect(cancelled?.status).toBe(DownloadJobStatus.Cancelled)
      expect(cancelled?.error).toBeUndefined()

      // A sibling episode job is *not* answered by a season-level discard:
      // only a request naming that episode moves it.
      expect(downloadStateService.jobs.get(episodeJob.id)?.status).toBe(
        DownloadJobStatus.NeedsAttention,
      )
      expect(mediaResolver.invalidate).toHaveBeenCalledWith(SHOW_ID)
    })

    it('still cancels when only some of the removals succeeded', async () => {
      sonarrService.getQueue.mockResolvedValue([
        showQueueItem(4201),
        showQueueItem(4202),
      ])
      sonarrService.removeQueueItem
        .mockRejectedValueOnce(new Error('Sonarr said no'))
        .mockResolvedValueOnce(undefined)
      const job = seedJob(
        buildRecord(DownloadType.Show, SHOW_ID, { id: 'series-job' }),
      )

      await expect(service.discard(SHOW_ID, undefined)).resolves.toEqual({
        discardedCount: 1,
      })

      expect(warn).toHaveBeenCalled()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
    })

    it('throws when every removal failed', async () => {
      sonarrService.getQueue.mockResolvedValue([showQueueItem(4201)])
      sonarrService.removeQueueItem.mockRejectedValue(
        new Error('Sonarr said no'),
      )
      const job = seedJob(
        buildRecord(DownloadType.Show, SHOW_ID, { id: 'series-job' }),
      )

      await expect(service.discard(SHOW_ID, undefined)).rejects.toThrow(
        ServiceUnavailableException,
      )
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.NeedsAttention,
      )
    })

    it('discarding nothing is a success, and still gives up on the jobs', async () => {
      radarrService.getQueue.mockResolvedValue([])
      const job = seedJob(
        buildRecord(DownloadType.Movie, MOVIE_ID, { id: 'movie-job' }),
      )

      await expect(service.discard(MOVIE_ID, undefined)).resolves.toEqual({
        discardedCount: 0,
      })
      expect(radarrService.removeQueueItem).not.toHaveBeenCalled()
      expect(downloadStateService.jobs.get(job.id)?.status).toBe(
        DownloadJobStatus.Cancelled,
      )
    })

    it('removes a movie queue row through Radarr', async () => {
      radarrService.getQueue.mockResolvedValue([movieQueueItem])

      await expect(service.discard(MOVIE_ID, undefined)).resolves.toEqual({
        discardedCount: 1,
      })
      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(152557673)
    })
  })

  describe('jobScopeCovers', () => {
    const cases: Array<{
      covered: boolean
      jobScope: ShowScope | undefined
      requestScope: ShowScope | undefined
      what: string
    }> = [
      {
        covered: true,
        jobScope: undefined,
        requestScope: { episodeId: 4201 },
        what: 'an unscoped job covers any request',
      },
      {
        covered: true,
        jobScope: { seasonNumber: 0 },
        requestScope: { seasonNumber: 0 },
        what: 'season 0 is a real season',
      },
      {
        covered: true,
        jobScope: { seasonNumber: 3 },
        requestScope: undefined,
        what: 'a season job is covered by a whole-series request',
      },
      {
        covered: false,
        jobScope: { seasonNumber: 3 },
        requestScope: { seasonNumber: 4 },
        what: 'a season job is not covered by another season',
      },
      {
        covered: false,
        jobScope: { seasonNumber: 3 },
        requestScope: { episodeId: 4201 },
        what: 'a season job is not covered by one of its episodes',
      },
      {
        covered: true,
        jobScope: { episodeId: 4201 },
        requestScope: { episodeId: 4201 },
        what: 'an episode job is covered by its own episode',
      },
      {
        covered: false,
        jobScope: { episodeId: 4201 },
        requestScope: { seasonNumber: 3 },
        what: 'an episode job is not covered by its season',
      },
    ]

    it.each(cases)('$what', ({ covered, jobScope, requestScope }) => {
      expect(jobScopeCovers(jobScope, requestScope)).toBe(covered)
    })
  })
})
