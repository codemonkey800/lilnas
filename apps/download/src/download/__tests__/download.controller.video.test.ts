// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { DownloadJob, DownloadJobStatus } from '@lilnas/utils/download/types'
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaFileService } from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

import { buildJob, buildVideo } from './helpers/job-fixtures'

// This exercises DownloadController's video endpoints — the only ones
// `projectJobForViewer` can ever change the output of, since masking is
// video-only by design. Lives alongside download.controller.media.test.ts's
// sibling but as its own file/describe block per that file's own note about
// per-unit test-file ownership.
describe('DownloadController - video endpoints', () => {
  let controller: DownloadController
  let downloadService: jest.Mocked<DownloadService>
  let downloadStateService: { jobs: Map<string, DownloadJob> }
  let adminCheckService: jest.Mocked<AdminCheckService>

  const admin: ForwardedUser = { email: 'admin@example.com', userId: 'a1' }
  const nonAdmin: ForwardedUser = { email: 'bob@example.com', userId: 'u2' }

  function buildVideoJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
    return buildJob(buildVideo(), {
      id: 'video-1',
      status: DownloadJobStatus.Completed,
      ...overrides,
    })
  }

  beforeEach(async () => {
    const mockDownloadService = {
      createVideoDownloadJob: jest.fn(),
      cancelVideoDownloadJob: jest.fn(),
      pauseVideoDownloadJob: jest.fn(),
      resumeVideoDownloadJob: jest.fn(),
    }
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }
    const jobsMap = new Map<string, DownloadJob>()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: mockDownloadService },
        {
          provide: DownloadStateService,
          useValue: {
            jobs: jobsMap,
            queue: { size: () => 0 },
            inProgressJobs: new Set<string>(),
            // Mirrors the real resolveJob()'s Map-hit behaviour - the
            // DB-fallback path itself is covered by
            // download-state.service.test.ts's dedicated tests.
            resolveJob: (id: string) => Promise.resolve(jobsMap.get(id)),
          },
        },
        { provide: DiscoveryService, useValue: {} },
        { provide: JobQueryService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: { resolve: jest.fn() } },
        // Phase 3/4: DownloadController injects ReleaseService for the
        // release and bad-file routes and ShowService for the seasons and
        // file-delete routes. Unused by this file's routes, but DI still has
        // to satisfy the constructor.
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    downloadService = module.get(DownloadService)
    adminCheckService = module.get(AdminCheckService)
    downloadStateService = module.get(DownloadStateService)
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  describe('getVideoJob', () => {
    it('masks a hidden video job requester for a non-admin viewer', async () => {
      const job = buildVideoJob({
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadStateService.jobs.set(job.id, job)
      adminCheckService.checkIsAdmin.mockResolvedValue(false)

      const res = await controller.getVideoJob(job.id, nonAdmin)

      expect(res.requester).toBeNull()
      expect(res.hiddenAttribution).toBe(true)
    })

    it('reveals the true requester to an admin viewer', async () => {
      const job = buildVideoJob({
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadStateService.jobs.set(job.id, job)
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      const res = await controller.getVideoJob(job.id, admin)

      expect(adminCheckService.checkIsAdmin).toHaveBeenCalledWith(
        'admin@example.com',
      )
      expect(res.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('never masks a non-hidden video job, even for a non-admin viewer', async () => {
      const job = buildVideoJob({
        hiddenAttribution: false,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadStateService.jobs.set(job.id, job)

      const res = await controller.getVideoJob(job.id, nonAdmin)

      expect(res.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('throws a 404 HttpException when the job does not exist', async () => {
      await expect(
        controller.getVideoJob('missing', undefined),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('createVideoJob', () => {
    it('masks a hidden job for a non-admin caller', async () => {
      const job = buildVideoJob({
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.createVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(false)

      const res = await controller.createVideoJob(
        { url: 'https://example.com/video' },
        nonAdmin,
      )

      expect(downloadService.createVideoDownloadJob).toHaveBeenCalledWith(
        { url: 'https://example.com/video' },
        nonAdmin,
      )
      expect(res.requester).toBeNull()
    })

    it('reveals the requester for an admin caller', async () => {
      const job = buildVideoJob({
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.createVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      const res = await controller.createVideoJob(
        { url: 'https://example.com/video' },
        admin,
      )

      expect(res.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })
  })

  describe('cancelVideoJob', () => {
    it('masks a hidden job for a non-admin caller', async () => {
      const job = buildVideoJob({
        status: DownloadJobStatus.Cancelling,
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.cancelVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(false)

      const res = await controller.cancelVideoJob(job.id, nonAdmin)

      expect(res.requester).toBeNull()
    })

    it('reveals the requester for an admin caller', async () => {
      const job = buildVideoJob({
        status: DownloadJobStatus.Cancelling,
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.cancelVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      const res = await controller.cancelVideoJob(job.id, admin)

      expect(res.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('converts a DownloadService error into a 404 HttpException', async () => {
      downloadService.cancelVideoDownloadJob.mockImplementation(() => {
        throw new Error("Job with ID 'missing' not found")
      })

      await expect(
        controller.cancelVideoJob('missing', undefined),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('pauseVideoJob', () => {
    it('masks a hidden job for a non-admin caller', async () => {
      const job = buildVideoJob({
        status: DownloadJobStatus.Pausing,
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.pauseVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(false)

      const res = await controller.pauseVideoJob(job.id, nonAdmin)

      expect(downloadService.pauseVideoDownloadJob).toHaveBeenCalledWith(job.id)
      expect(res.status).toBe(DownloadJobStatus.Pausing)
      expect(res.requester).toBeNull()
      expect(res.hiddenAttribution).toBe(true)
    })

    it('reveals the requester for an admin caller', async () => {
      const job = buildVideoJob({
        status: DownloadJobStatus.Pausing,
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.pauseVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      const res = await controller.pauseVideoJob(job.id, admin)

      expect(adminCheckService.checkIsAdmin).toHaveBeenCalledWith(
        'admin@example.com',
      )
      expect(res.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    // The whole reason this route doesn't reuse cancelVideoJob's catch
    // block: "you can't pause a job that isn't downloading" is a 409, and
    // flattening it to a 404 would tell the UI to forget a live job.
    it('surfaces a ConflictException as a 409, not a 404', async () => {
      downloadService.pauseVideoDownloadJob.mockRejectedValue(
        new ConflictException(
          "Job 'video-1' cannot be paused while it is 'converting'; only a downloading job can be paused",
        ),
      )

      const err = await controller
        .pauseVideoJob('video-1', undefined)
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(ConflictException)
      expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT)
    })

    it('surfaces a NotFoundException as a 404', async () => {
      downloadService.pauseVideoDownloadJob.mockRejectedValue(
        new NotFoundException("Job with ID 'missing' not found"),
      )

      const err = await controller
        .pauseVideoJob('missing', undefined)
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(NotFoundException)
      expect((err as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND)
    })
  })

  describe('resumeVideoJob', () => {
    it('masks a hidden job for a non-admin caller', async () => {
      const job = buildVideoJob({
        status: DownloadJobStatus.Pending,
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.resumeVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(false)

      const res = await controller.resumeVideoJob(job.id, nonAdmin)

      expect(downloadService.resumeVideoDownloadJob).toHaveBeenCalledWith(
        job.id,
      )
      expect(res.status).toBe(DownloadJobStatus.Pending)
      expect(res.requester).toBeNull()
      expect(res.hiddenAttribution).toBe(true)
    })

    it('reveals the requester for an admin caller', async () => {
      const job = buildVideoJob({
        status: DownloadJobStatus.Pending,
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })
      downloadService.resumeVideoDownloadJob.mockResolvedValue(job)
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      const res = await controller.resumeVideoJob(job.id, admin)

      expect(res.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('surfaces a ConflictException as a 409, not a 404', async () => {
      downloadService.resumeVideoDownloadJob.mockRejectedValue(
        new ConflictException(
          "Job 'video-1' cannot be resumed while it is 'pausing'; only a paused job can be resumed",
        ),
      )

      const err = await controller
        .resumeVideoJob('video-1', undefined)
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(ConflictException)
      expect((err as HttpException).getStatus()).toBe(HttpStatus.CONFLICT)
    })

    it('surfaces a NotFoundException as a 404', async () => {
      downloadService.resumeVideoDownloadJob.mockRejectedValue(
        new NotFoundException("Job with ID 'missing' not found"),
      )

      const err = await controller
        .resumeVideoJob('missing', undefined)
        .catch((e: unknown) => e)

      expect(err).toBeInstanceOf(NotFoundException)
      expect((err as HttpException).getStatus()).toBe(HttpStatus.NOT_FOUND)
    })
  })
})
