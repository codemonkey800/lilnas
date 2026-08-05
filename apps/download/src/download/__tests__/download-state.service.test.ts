import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
  MovieDownloadJob,
  VideoDownloadJob,
} from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'
import { ChildProcessWithoutNullStreams } from 'child_process'

import { DownloadStateService } from 'src/download/download-state.service'
import {
  DownloadGateway,
  DownloadGatewayMessage,
} from 'src/download-gateway/download.gateway'

function buildVideoJob(
  overrides: Partial<VideoDownloadJob> = {},
): VideoDownloadJob {
  return {
    id: 'video-1',
    status: DownloadJobStatus.Pending,
    type: DownloadType.Video,
    url: 'https://example.com/video',
    ...overrides,
  }
}

function buildMovieJob(
  overrides: Partial<MovieDownloadJob> = {},
): MovieDownloadJob {
  return {
    id: 'movie-1',
    status: DownloadJobStatus.Requested,
    type: DownloadType.Movie,
    url: 'radarr://tmdb/1',
    ...overrides,
  }
}

describe('DownloadStateService', () => {
  let service: DownloadStateService
  let downloadGateway: jest.Mocked<DownloadGateway>

  // `mock.calls[n]` is `[DownloadGatewayMessage] | undefined` under
  // noUncheckedIndexedAccess - this centralizes the "was it actually
  // called" assertion so every caller gets a real DownloadGatewayMessage
  // (and a clear failure) instead of juggling the possibly-undefined tuple
  // at each call site.
  function firstBroadcastPayload(): DownloadGatewayMessage {
    const call = downloadGateway.broadcast.mock.calls[0]
    if (!call) {
      throw new Error('Expected DownloadGateway.broadcast to have been called')
    }
    return call[0]
  }

  beforeEach(async () => {
    const mockDownloadGateway = { broadcast: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadStateService,
        { provide: DownloadGateway, useValue: mockDownloadGateway },
      ],
    }).compile()

    service = module.get(DownloadStateService)
    downloadGateway = module.get(DownloadGateway)
  })

  describe('addJob', () => {
    it('inserts the job into the map', () => {
      const job = buildMovieJob()

      service.addJob(job)

      expect(service.jobs.get(job.id)).toEqual(job)
    })

    it('broadcasts a "created" event carrying the job', () => {
      const job = buildMovieJob()

      service.addJob(job)

      expect(downloadGateway.broadcast).toHaveBeenCalledTimes(1)
      expect(downloadGateway.broadcast).toHaveBeenCalledWith({
        data: { job, type: DownloadJobEventType.Created },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })
  })

  describe('updateJob', () => {
    it('throws and does not broadcast when the job does not exist', () => {
      expect(() =>
        service.updateJob('missing', { status: DownloadJobStatus.Completed }),
      ).toThrow("Job with ID 'missing' not found")

      expect(downloadGateway.broadcast).not.toHaveBeenCalled()
    })

    it('merges updates, stores the result, and broadcasts an "updated" event', () => {
      const job = buildMovieJob()
      service.addJob(job) // seeds the map; also broadcasts once (Created)
      downloadGateway.broadcast.mockClear()

      const updated = service.updateJob(job.id, {
        status: DownloadJobStatus.Searching,
      })

      expect(updated.status).toBe(DownloadJobStatus.Searching)
      expect(service.jobs.get(job.id)).toEqual(updated)
      expect(downloadGateway.broadcast).toHaveBeenCalledTimes(1)
      expect(downloadGateway.broadcast).toHaveBeenCalledWith({
        data: { job: updated, type: DownloadJobEventType.Updated },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })

    it('strips the live child process handle from a video job before broadcasting, without touching the stored job', () => {
      const job = buildVideoJob()
      service.addJob(job)
      downloadGateway.broadcast.mockClear()

      // A real ChildProcess has circular internal references (sockets,
      // streams, etc.) that make JSON.stringify throw - reproduce that
      // shape here rather than a flat mock object, so this test actually
      // proves the strip prevents the crash rather than passing by
      // accident because a flat object happens to stringify fine anyway.
      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams
      ;(fakeProc as unknown as { self: unknown }).self = fakeProc

      const updated = service.updateJob(job.id, { proc: fakeProc })

      // The real job in the map (and the returned job) keep the live handle...
      expect(
        (service.jobs.get(job.id) as VideoDownloadJob | undefined)?.proc,
      ).toBe(fakeProc)
      expect((updated as VideoDownloadJob).proc).toBe(fakeProc)

      // ...but the broadcast payload must not carry it.
      expect(downloadGateway.broadcast).toHaveBeenCalledTimes(1)
      const payload = firstBroadcastPayload()
      const event = payload.data as DownloadJobEvent
      const broadcastJob = event.job as VideoDownloadJob

      expect(broadcastJob.proc).toBeUndefined()
      expect(broadcastJob.id).toBe(job.id)
      expect(() => JSON.stringify(payload)).not.toThrow()
    })

    it('keeps stripping proc on every subsequent update once it has been set', () => {
      const job = buildVideoJob()
      service.addJob(job)

      const fakeProc = {} as unknown as ChildProcessWithoutNullStreams
      ;(fakeProc as unknown as { self: unknown }).self = fakeProc
      service.updateJob(job.id, { proc: fakeProc })
      downloadGateway.broadcast.mockClear()

      // A later update (e.g. a plain status change) doesn't touch `proc`,
      // but the stored job still carries it via the prior merge - the
      // broadcast copy must keep stripping it on every call, not just the
      // update that first introduced it.
      service.updateJob(job.id, { status: DownloadJobStatus.Converting })

      const payload = firstBroadcastPayload()
      const event = payload.data as DownloadJobEvent
      const broadcastJob = event.job as VideoDownloadJob

      expect(broadcastJob.proc).toBeUndefined()
      expect(broadcastJob.status).toBe(DownloadJobStatus.Converting)
      expect(() => JSON.stringify(payload)).not.toThrow()
    })

    it('broadcasts movie/show jobs as-is, since they have no proc field to strip', () => {
      const job = buildMovieJob()
      service.addJob(job)
      downloadGateway.broadcast.mockClear()

      service.updateJob(job.id, { status: DownloadJobStatus.Downloading })

      expect(downloadGateway.broadcast).toHaveBeenCalledWith({
        data: {
          job: { ...job, status: DownloadJobStatus.Downloading },
          type: DownloadJobEventType.Updated,
        },
        type: DOWNLOAD_JOB_EVENT_TYPE,
      })
    })
  })
})
