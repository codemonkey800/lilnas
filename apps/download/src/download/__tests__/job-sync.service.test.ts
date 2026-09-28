// nanoid v5 ships ESM-only - see download-state.service.test.ts.
jest.mock('nanoid', () => {
  let counter = 0
  return { nanoid: jest.fn(() => `mock-id-${++counter}`) }
})

import {
  DOWNLOAD_JOB_EVENT_TYPE,
  type DownloadJobEvent,
  type DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  MEDIA_EVENT_TYPE,
} from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { buildJobRow } from 'src/db/job-row'
import { jobs } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobSyncService } from 'src/download/job-sync.service'
import {
  DownloadGateway,
  type DownloadGatewayMessage,
} from 'src/download-gateway/download.gateway'
import { createFakeMediaResolver } from 'src/media/__tests__/helpers/fake-media-resolver'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'

const SINCE = new Date('2026-08-20T12:00:00.000Z')
const BEFORE = new Date('2026-08-20T11:00:00.000Z')
const AFTER = new Date('2026-08-20T13:00:00.000Z')

function buildMovieRecord(
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return {
    completedAt: null,
    createdAt: BEFORE.toISOString(),
    discordRequester: null,
    hiddenAttribution: false,
    id: 'movie-1',
    linkedDiscord: null,
    mediaId: 'tmdb:1',
    requester: null,
    status: DownloadJobStatus.Downloading,
    type: DownloadType.Movie,
    updatedAt: BEFORE.toISOString(),
    ...overrides,
  }
}

/** The job frames among `frames`, as `[id, status]` pairs. */
function jobStatuses(frames: DownloadGatewayMessage[]): [string, string][] {
  return frames
    .filter(frame => frame.type === DOWNLOAD_JOB_EVENT_TYPE)
    .map(frame => {
      const { job } = frame.data as DownloadJobEvent
      return [job.id, job.status]
    })
}

describe('JobSyncService', () => {
  let dbService: DbService
  let downloadGateway: { setSyncSource: jest.Mock }
  let service: JobSyncService
  let state: DownloadStateService

  /** Writes `record`'s row as last updated at `updatedAt`. */
  function seedRow(record: DownloadJobRecord, updatedAt: Date): void {
    dbService.db
      .insert(jobs)
      .values({ ...buildJobRow(record), updatedAt })
      .run()
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    downloadGateway = {
      broadcast: jest.fn(),
      broadcastPerViewer: jest.fn(),
      setSyncSource: jest.fn(),
    } as unknown as { setSyncSource: jest.Mock }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        DownloadStateService,
        JobSyncService,
        { provide: DbService, useValue: dbService },
        { provide: DownloadGateway, useValue: downloadGateway },
        { provide: MediaResolverService, useValue: createFakeMediaResolver() },
        MediaStateService,
      ],
    }).compile()

    service = module.get(JobSyncService)
    state = module.get(DownloadStateService)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  it('registers itself as the gateway sync source at init', () => {
    service.onModuleInit()

    expect(downloadGateway.setSyncSource).toHaveBeenCalledTimes(1)
  })

  it('sends only open jobs on a first connect', async () => {
    seedRow(buildMovieRecord({ id: 'open' }), BEFORE)
    seedRow(
      buildMovieRecord({ id: 'done', status: DownloadJobStatus.Completed }),
      AFTER,
    )

    const build = await service.buildSyncFrames(undefined)

    expect(jobStatuses(build(false))).toEqual([['open', 'downloading']])
  })

  it('sends open jobs plus every job written since the cursor', async () => {
    seedRow(buildMovieRecord({ id: 'open' }), BEFORE)
    seedRow(
      buildMovieRecord({ id: 'old', status: DownloadJobStatus.Completed }),
      BEFORE,
    )
    seedRow(
      buildMovieRecord({ id: 'missed', status: DownloadJobStatus.Completed }),
      AFTER,
    )

    const build = await service.buildSyncFrames(SINCE)

    expect(jobStatuses(build(false))).toEqual([
      ['missed', 'completed'],
      ['open', 'downloading'],
    ])
  })

  it('prefers the in-memory record over its row', async () => {
    const record = buildMovieRecord({ status: DownloadJobStatus.Requested })
    seedRow(record, BEFORE)
    state.jobs.set(record.id, {
      ...record,
      status: DownloadJobStatus.Importing,
    })

    const build = await service.buildSyncFrames(undefined)

    expect(jobStatuses(build(false))).toEqual([['movie-1', 'importing']])
  })

  it('sends a video job with its media frame first', async () => {
    const video = state.ensureVideo({ sourceUrl: 'https://example.com/v' })
    seedRow(
      buildMovieRecord({
        id: 'video-job',
        mediaId: `video:${video.id}`,
        status: DownloadJobStatus.Completed,
        type: DownloadType.Video,
      }),
      AFTER,
    )

    const build = await service.buildSyncFrames(SINCE)

    expect(build(false).map(frame => frame.type)).toEqual([
      MEDIA_EVENT_TYPE,
      DOWNLOAD_JOB_EVENT_TYPE,
    ])
  })

  it('masks a hidden requester for a non-admin only', async () => {
    const video = state.ensureVideo({ sourceUrl: 'https://example.com/v' })
    seedRow(
      buildMovieRecord({
        hiddenAttribution: true,
        id: 'hidden',
        mediaId: `video:${video.id}`,
        requester: { email: 'alice@example.com', userId: 'user_1' },
        type: DownloadType.Video,
      }),
      BEFORE,
    )

    const build = await service.buildSyncFrames(undefined)
    const requesterFor = (isAdmin: boolean) =>
      build(isAdmin)
        .filter(frame => frame.type === DOWNLOAD_JOB_EVENT_TYPE)
        .map(frame => (frame.data as DownloadJobEvent).job.requester)

    expect(requesterFor(false)).toEqual([null])
    expect(requesterFor(true)).toEqual([
      { email: 'alice@example.com', userId: 'user_1' },
    ])
  })
})
