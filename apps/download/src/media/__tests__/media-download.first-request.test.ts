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
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { EmbyStatusService } from 'src/emby/emby-status.service'
import { flushAsync } from 'src/media/__tests__/helpers/fake-media-resolver'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaPollerService } from 'src/media/media-poller.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

/**
 * A first-time Download of a movie Radarr doesn't hold yet, with the
 * request path, the poller, the resolver (and its library cache), the state
 * annotator and the job store all real - only Radarr, Emby and the socket are
 * stubbed.
 *
 * The page was open before the click, so the resolver's library cache was
 * filled without the movie. `ensureMovie` adds it; unless the resolver
 * forgets that copy, the job's media resolves from the discover lookup (no
 * `radarrId`) and the poller - which tracks a job by that id - can't follow
 * it until the cache expires a minute later.
 */

const MEDIA_ID = 'tmdb:77016'
const RADARR_ID = 380

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

const QUEUE_ITEM: QueueResource = {
  movieId: RADARR_ID,
  size: 1000,
  sizeleft: 600,
  status: 'downloading',
}

describe('MediaDownloadService - a first request for a title not yet in the library', () => {
  let downloadService: MediaDownloadService
  let poller: MediaPollerService
  let resolver: MediaResolverService
  let downloadStateService: DownloadStateService
  let radarrService: {
    ensureMovie: jest.Mock
    getLibrary: jest.Mock
    getMovieFiles: jest.Mock
    getQueue: jest.Mock
    lookupByTmdbId: jest.Mock
    refreshMonitoredDownloads: jest.Mock
    removeQueueItem: jest.Mock
    triggerSearch: jest.Mock
    unmonitorIfMissing: jest.Mock
  }
  let dbService: DbService

  beforeEach(async () => {
    dbService = createTestDbService()
    radarrService = {
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
      getMovieFiles: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
      lookupByTmdbId: jest.fn().mockResolvedValue(discoverLookupMovie()),
      refreshMonitoredDownloads: jest.fn().mockResolvedValue(undefined),
      removeQueueItem: jest.fn().mockResolvedValue(undefined),
      triggerSearch: jest.fn().mockResolvedValue(undefined),
      unmonitorIfMissing: jest.fn().mockResolvedValue(true),
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
          useValue: { broadcast: jest.fn(), broadcastPerViewer: jest.fn() },
        },
        {
          provide: EmbyStatusService,
          useValue: { annotate: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: RadarrService, useValue: radarrService },
        {
          provide: SonarrService,
          useValue: {
            getLibrary: jest.fn().mockResolvedValue([]),
            getQueue: jest.fn().mockResolvedValue([]),
            refreshMonitoredDownloads: jest.fn(),
          },
        },
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

    radarrService.getQueue.mockResolvedValue([QUEUE_ITEM])
    await poller.poll()

    expect(downloadStateService.jobs.get(job.id)?.status).toBe(
      DownloadJobStatus.Downloading,
    )
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

    it('stays cancelling, and cleans up the search it dispatched', async () => {
      const updateJob = jest.spyOn(downloadStateService, 'updateJob')
      const requested = downloadService.requestMovie(77016)
      await flushAsync()

      const cancelled = await downloadService.cancelMovieJob('mock-id')
      expect(cancelled.status).toBe(DownloadJobStatus.Cancelling)
      expect(radarrService.getQueue).not.toHaveBeenCalled()

      // The search `submit()` fires has already grabbed by the time the
      // cleanup reads the queue.
      radarrService.getQueue.mockResolvedValue([{ ...QUEUE_ITEM, id: 55 }])
      finishEnsure()
      const job = await requested

      expect(radarrService.triggerSearch).toHaveBeenCalledWith(RADARR_ID)
      expect(job.status).toBe(DownloadJobStatus.Cancelling)
      expect(job.media).toMatchObject({ radarrId: RADARR_ID })
      expect(radarrService.getQueue).toHaveBeenCalledWith([RADARR_ID])
      expect(radarrService.removeQueueItem).toHaveBeenCalledWith(55)
      expect(radarrService.unmonitorIfMissing).toHaveBeenCalledWith(RADARR_ID)
      expect(updateJob).not.toHaveBeenCalledWith(
        'mock-id',
        expect.objectContaining({ status: DownloadJobStatus.Searching }),
      )
      expect(downloadStateService.jobs.get('mock-id')?.status).toBe(
        DownloadJobStatus.Cancelling,
      )
    })

    it('does not write failed when the request then fails upstream', async () => {
      radarrService.triggerSearch.mockRejectedValue(new Error('Radarr is down'))
      const requested = downloadService.requestMovie(77016)
      await flushAsync()

      await downloadService.cancelMovieJob('mock-id')
      finishEnsure()
      const job = await requested

      expect(job.status).toBe(DownloadJobStatus.Cancelling)
      expect(job.error).toBeUndefined()
      expect(downloadStateService.jobs.get('mock-id')?.status).toBe(
        DownloadJobStatus.Cancelling,
      )
    })
  })
})
