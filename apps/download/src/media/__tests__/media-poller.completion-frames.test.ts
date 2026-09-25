// nanoid v5 ships ESM-only; DownloadStateService pulls it in (see
// media-poller.service.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type { MovieFileResource, QueueResource } from '@lilnas/media/radarr'
import {
  type DownloadJobEvent,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isMovie,
  type Media,
  MEDIA_EVENT_TYPE,
  type MediaEvent,
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
import { MediaPollerService } from 'src/media/media-poller.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

/**
 * The frames an open movie page hears around the end of a download, with the
 * poller, the resolver (and its library cache), the state annotator and the
 * job store all real - only Radarr, Emby and the socket are stubbed.
 *
 * Modelled on the live bug of 2026-09-23: _End of Watch_ (`tmdb:77016`,
 * Radarr movie 380, monitored with no file) downloaded from its page, and
 * when the item left the queue the page flipped to `not downloaded` while a
 * reload showed it `in library`. Radarr's two answers below are the shapes
 * the live instance returned for that movie: the library entry, and the
 * `/movie/lookup/tmdb` discover hit (no `id`, no `hasFile`, `monitored:
 * false`), which `toMovie` maps to a movie with no `radarrId`, no
 * `monitored` and no `filePath` - `absent`.
 */

const MEDIA_ID = 'tmdb:77016'
const RADARR_ID = 380
const FILE_PATH = '/movies/End of Watch (2012)/End of Watch (2012).mkv'

const T0 = Date.parse('2026-09-23T23:59:00.000Z')
const JOB_CREATED_ISO = '2026-09-23T23:58:30.000Z'
const FILE_ADDED_ISO = '2026-09-24T00:01:00.000Z'

const QUEUE_ITEM: QueueResource = {
  movieId: RADARR_ID,
  size: 1000,
  sizeleft: 0,
  status: 'downloading',
}

const FILE: MovieFileResource = {
  dateAdded: FILE_ADDED_ISO,
  id: 9001,
  movieId: RADARR_ID,
  path: FILE_PATH,
}

function libraryMovie(filePath?: string): Movie {
  return {
    id: MEDIA_ID,
    monitored: true,
    radarrId: RADARR_ID,
    title: 'End of Watch',
    tmdbId: 77016,
    type: DownloadType.Movie,
    ...(filePath ? { addedAt: FILE_ADDED_ISO, filePath } : {}),
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

describe('MediaPollerService - the frames a finished download ends on', () => {
  let service: MediaPollerService
  let downloadGateway: { broadcast: jest.Mock; broadcastPerViewer: jest.Mock }
  let downloadStateService: DownloadStateService
  let radarrService: {
    getLibrary: jest.Mock
    getMovieFiles: jest.Mock
    getQueue: jest.Mock
    lookupByTmdbId: jest.Mock
    refreshMonitoredDownloads: jest.Mock
  }
  let dbService: DbService
  let job: DownloadJobRecord

  function at(ms: number): void {
    jest.spyOn(Date, 'now').mockReturnValue(ms)
  }

  /** Upstream as of now: the library entry, the queue and the file list. */
  function upstream({
    file,
    queued,
  }: {
    file: boolean
    queued: boolean
  }): void {
    radarrService.getLibrary.mockResolvedValue([
      libraryMovie(file ? FILE_PATH : undefined),
    ])
    radarrService.getQueue.mockResolvedValue(queued ? [QUEUE_ITEM] : [])
    radarrService.getMovieFiles.mockResolvedValue(file ? [FILE] : [])
  }

  async function tick(ms: number): Promise<void> {
    at(ms)
    ;(service as unknown as { nextAllowedRunAt: number }).nextAllowedRunAt = 0
    await service.poll()
    await flushAsync()
  }

  function mediaEvents(): MediaEvent[] {
    return downloadGateway.broadcast.mock.calls
      .map(([message]) => message as { data: unknown; type: string })
      .filter(message => message.type === MEDIA_EVENT_TYPE)
      .map(message => message.data as MediaEvent)
  }

  function jobFrames(): DownloadJobEvent[] {
    return downloadGateway.broadcastPerViewer.mock.calls.map(
      ([build]) =>
        (build as (isAdmin: boolean) => { data: DownloadJobEvent })(true).data,
    )
  }

  /** Every movie this page was sent, media frames and job frames alike. */
  function everyMovieSent(): Media[] {
    return [
      ...mediaEvents().map(event => event.media),
      ...jobFrames().map(frame => frame.job.media),
    ].filter(media => media.id === MEDIA_ID)
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    radarrService = {
      getLibrary: jest.fn(),
      getMovieFiles: jest.fn(),
      getQueue: jest.fn(),
      lookupByTmdbId: jest.fn().mockResolvedValue(discoverLookupMovie()),
      refreshMonitoredDownloads: jest.fn().mockResolvedValue(undefined),
    }
    downloadGateway = { broadcast: jest.fn(), broadcastPerViewer: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        DownloadStateService,
        MediaPollerService,
        MediaResolverService,
        MediaStateService,
        { provide: DbService, useValue: dbService },
        { provide: DownloadGateway, useValue: downloadGateway },
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

    service = module.get(MediaPollerService)
    downloadStateService = module.get(DownloadStateService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()

    job = {
      completedAt: null,
      createdAt: JOB_CREATED_ISO,
      discordRequester: null,
      hiddenAttribution: false,
      id: 'job-1',
      linkedDiscord: null,
      mediaId: MEDIA_ID,
      requester: null,
      status: DownloadJobStatus.Downloading,
      type: DownloadType.Movie,
      updatedAt: JOB_CREATED_ISO,
    }
    downloadStateService.jobs.set(job.id, job)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
    jest.restoreAllMocks()
  })

  // The live sequence: the 17:01:00 tick still has the item at 100%, and by
  // 17:01:10 it is gone and the file is listed - the job settles `completed`
  // in the same tick the media leaves the queue.
  it('ends on the imported file when the item leaves and the job settles in one tick', async () => {
    upstream({ file: false, queued: true })
    await tick(T0)

    expect(mediaEvents().at(-1)?.media).toMatchObject({
      state: 'downloading',
    })

    upstream({ file: true, queued: false })
    await tick(T0 + 10_000)

    expect(downloadStateService.jobs.get(job.id)?.status).toBe(
      DownloadJobStatus.Completed,
    )
    expect(mediaEvents().at(-1)?.media).toMatchObject({
      filePath: FILE_PATH,
      monitored: true,
      radarrId: RADARR_ID,
      state: 'available',
    })
    expect(jobFrames().at(-1)?.job).toMatchObject({
      media: { filePath: FILE_PATH, state: 'available' },
      status: DownloadJobStatus.Completed,
    })
    // Nothing the page heard on the way was the discover lookup's copy.
    expect(everyMovieSent().map(media => media.state)).not.toContain('absent')
    expect(radarrService.lookupByTmdbId).not.toHaveBeenCalled()
  })

  // The import race: the item goes a tick before Radarr lists the file. The
  // vanish frame is truthfully "no file yet", so the frame that says the file
  // landed has to come from the job settling - nothing else is left to send
  // it once the media is no longer queued.
  it('follows a no-file vanish frame with one carrying the file once it lands', async () => {
    upstream({ file: false, queued: true })
    await tick(T0)

    upstream({ file: false, queued: false })
    await tick(T0 + 10_000)

    expect(downloadStateService.jobs.get(job.id)?.status).toBe(
      DownloadJobStatus.Downloading,
    )
    expect(mediaEvents().at(-1)?.media).toMatchObject({ state: 'wanted' })

    upstream({ file: true, queued: false })
    await tick(T0 + 20_000)

    expect(downloadStateService.jobs.get(job.id)?.status).toBe(
      DownloadJobStatus.Completed,
    )
    const last = mediaEvents().at(-1)?.media
    expect(last).toMatchObject({ filePath: FILE_PATH, state: 'available' })
    expect(everyMovieSent().map(media => media.state)).not.toContain('absent')

    // Owed once, then forgotten like any other vanished media.
    const sent = mediaEvents().length
    await tick(T0 + 30_000)
    expect(mediaEvents()).toHaveLength(sent)
    expect(isMovie(last as Media)).toBe(true)
  })
})
