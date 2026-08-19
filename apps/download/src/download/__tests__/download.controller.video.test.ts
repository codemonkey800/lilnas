// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJobStatus,
  DownloadType,
  VideoDownloadJob,
} from '@lilnas/utils/download/types'
import { HttpException, Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'

// This exercises DownloadController's video endpoints — the only ones
// `projectJobForViewer` can ever change the output of, since masking is
// video-only by design. Lives alongside download.controller.media.test.ts's
// sibling but as its own file/describe block per that file's own note about
// per-unit test-file ownership.
describe('DownloadController - video endpoints', () => {
  let controller: DownloadController
  let downloadService: jest.Mocked<DownloadService>
  let downloadStateService: { jobs: Map<string, VideoDownloadJob> }
  let adminCheckService: jest.Mocked<AdminCheckService>

  const admin: ForwardedUser = { email: 'admin@example.com', userId: 'a1' }
  const nonAdmin: ForwardedUser = { email: 'bob@example.com', userId: 'u2' }

  function buildVideoJob(
    overrides: Partial<VideoDownloadJob> = {},
  ): VideoDownloadJob {
    return {
      id: 'video-1',
      status: DownloadJobStatus.Completed,
      type: DownloadType.Video,
      url: 'https://example.com/video',
      ...overrides,
    }
  }

  beforeEach(async () => {
    const mockDownloadService = {
      createVideoDownloadJob: jest.fn(),
      cancelVideoDownloadJob: jest.fn(),
    }
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }
    const jobsMap = new Map<string, VideoDownloadJob>()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: mockAdminCheckService },
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
            resolveJob: (id: string) => jobsMap.get(id),
          },
        },
        { provide: DiscoveryService, useValue: {} },
        { provide: JobQueryService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
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
      downloadService.cancelVideoDownloadJob.mockReturnValue(job)
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
      downloadService.cancelVideoDownloadJob.mockReturnValue(job)
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
})
