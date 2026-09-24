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
    triggerSearch: jest.Mock
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
      triggerSearch: jest.fn().mockResolvedValue(undefined),
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
})
