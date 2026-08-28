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

import { AuditLogService } from 'src/audit/audit-log.service'
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
  let auditLogService: { record: jest.Mock }
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
      deleteVideoDownloadJob: jest.fn(),
      pauseVideoDownloadJob: jest.fn(),
      resumeVideoDownloadJob: jest.fn(),
    }
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }
    const jobsMap = new Map<string, DownloadJob>()
    auditLogService = { record: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: AuditLogService, useValue: auditLogService },
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

  describe('deleteVideoJob', () => {
    it('masks a hidden job for a non-admin caller and reveals it for an admin', async () => {
      const job = buildVideoJob({
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'u1' },
        status: DownloadJobStatus.Cancelled,
      })
      downloadService.deleteVideoDownloadJob.mockResolvedValue(job)

      adminCheckService.checkIsAdmin.mockResolvedValue(false)
      expect(
        (await controller.deleteVideoJob(job.id, nonAdmin)).requester,
      ).toBeNull()

      adminCheckService.checkIsAdmin.mockResolvedValue(true)
      expect(
        (await controller.deleteVideoJob(job.id, admin)).requester,
      ).toEqual({ email: 'alice@example.com', userId: 'u1' })
    })

    it('records a video.delete audit row against the job', async () => {
      const job = buildVideoJob({ status: DownloadJobStatus.Cancelled })
      downloadService.deleteVideoDownloadJob.mockResolvedValue(job)

      await controller.deleteVideoJob(job.id, admin)

      expect(auditLogService.record).toHaveBeenCalledWith({
        action: 'video.delete',
        actor: admin,
        metadata: undefined,
        target: { id: job.id, type: 'job' },
      })
    })

    // The service's own 404/400 must reach the caller untouched - unlike
    // cancel, which flattens everything into a 404.
    it('re-throws the service exception as-is', async () => {
      downloadService.deleteVideoDownloadJob.mockRejectedValue(
        new NotFoundException("Job with ID 'missing' not found"),
      )

      await expect(
        controller.deleteVideoJob('missing', undefined),
      ).rejects.toThrow(NotFoundException)
      expect(auditLogService.record).not.toHaveBeenCalled()
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

  // ---- Phase 8: the audit log ----
  //
  // Every video route that changes something appends exactly one row, after
  // the service call has resolved - so a rejected service call leaves the
  // log untouched, and a read leaves it untouched too.
  describe('audit log', () => {
    it('records a create against the new job id, with the full url including its query string', async () => {
      const job = buildVideoJob()
      downloadService.createVideoDownloadJob.mockResolvedValue(job)

      await controller.createVideoJob(
        { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
        nonAdmin,
      )

      expect(auditLogService.record).toHaveBeenCalledTimes(1)
      expect(auditLogService.record).toHaveBeenCalledWith({
        action: 'video.create',
        actor: nonAdmin,
        // The raw url, query string and all - the log lines strip the query,
        // but for the URL shape this service mostly sees the video's identity
        // is *only* in the query string, so an audit entry without it can't
        // say what was downloaded. The log is admin-only and unmasked by
        // design, and outlives the job row it points at.
        metadata: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
        target: { id: 'video-1', type: 'job' },
      })
    })

    // tdr-bot's DownloadClient calls this route with no forwarded identity;
    // the row still lands, and AuditLogService reads the absent actor as
    // `origin: 'service'`.
    it('records actor undefined for a service-origin create', async () => {
      downloadService.createVideoDownloadJob.mockResolvedValue(buildVideoJob())

      await controller.createVideoJob(
        { url: 'https://example.com/video' },
        undefined,
      )

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ actor: undefined }),
      )
    })

    it('records a cancel against the job id', async () => {
      downloadService.cancelVideoDownloadJob.mockResolvedValue(
        buildVideoJob({ status: DownloadJobStatus.Cancelling }),
      )

      await controller.cancelVideoJob('video-1', admin)

      expect(auditLogService.record).toHaveBeenCalledTimes(1)
      expect(auditLogService.record).toHaveBeenCalledWith({
        action: 'video.cancel',
        actor: admin,
        target: { id: 'video-1', type: 'job' },
      })
    })

    it.each([
      ['pauseVideoJob', 'video.pause'],
      ['resumeVideoJob', 'video.resume'],
    ] as const)('records %s against the job id', async (method, action) => {
      downloadService.pauseVideoDownloadJob.mockResolvedValue(buildVideoJob())
      downloadService.resumeVideoDownloadJob.mockResolvedValue(buildVideoJob())

      await controller[method]('video-1', admin)

      expect(auditLogService.record).toHaveBeenCalledTimes(1)
      expect(auditLogService.record).toHaveBeenCalledWith({
        action,
        actor: admin,
        metadata: undefined,
        target: { id: 'video-1', type: 'job' },
      })
    })

    describe('a failed action records nothing', () => {
      it('writes no row when the create throws', async () => {
        downloadService.createVideoDownloadJob.mockRejectedValue(
          new Error('yt-dlp exploded'),
        )

        await expect(
          controller.createVideoJob({ url: 'https://example.com/v' }, admin),
        ).rejects.toThrow('yt-dlp exploded')

        expect(auditLogService.record).not.toHaveBeenCalled()
      })

      it('writes no row when the cancel throws', async () => {
        downloadService.cancelVideoDownloadJob.mockRejectedValue(
          new Error("Job with ID 'missing' not found"),
        )

        await expect(
          controller.cancelVideoJob('missing', admin),
        ).rejects.toThrow(HttpException)

        expect(auditLogService.record).not.toHaveBeenCalled()
      })

      it('writes no row when the pause is rejected as a 409', async () => {
        downloadService.pauseVideoDownloadJob.mockRejectedValue(
          new ConflictException('not downloading'),
        )

        await expect(
          controller.pauseVideoJob('video-1', admin),
        ).rejects.toThrow(ConflictException)

        expect(auditLogService.record).not.toHaveBeenCalled()
      })
    })

    it('writes no row for a read', async () => {
      const job = buildVideoJob()
      downloadStateService.jobs.set(job.id, job)

      await controller.getVideoJob(job.id, admin)

      expect(auditLogService.record).not.toHaveBeenCalled()
    })
  })
})
