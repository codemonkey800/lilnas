// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService/MediaDownloadService) must mock it
// first (see media/__tests__/download.controller.media.test.ts for the
// same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJobStatus,
  DownloadType,
  MovieDownloadJob,
  ShowDownloadJob,
  VideoDownloadJob,
} from '@lilnas/utils/download/types'
import { HttpException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

// Exercises the U14 restart-fallback fix on all three detail routes with a
// REAL DownloadStateService/DbService (not mocked) - a bare-object mock of
// DownloadStateService can't exercise the DB fallback at all, since that's
// exactly the code path being tested here.
describe('DownloadController - detail-route restart fallback', () => {
  let controller: DownloadController
  let downloadStateService: DownloadStateService
  let adminCheckService: jest.Mocked<AdminCheckService>

  const admin: ForwardedUser = { email: 'admin@example.com', userId: 'a1' }
  const nonAdmin: ForwardedUser = { email: 'bob@example.com', userId: 'u2' }

  beforeEach(async () => {
    const dbService = createTestDbService()
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: DiscoveryService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        {
          provide: DownloadGateway,
          useValue: { broadcastPerViewer: jest.fn() },
        },
        { provide: JobQueryService, useValue: {} },
        MediaDownloadService,
        { provide: RadarrService, useValue: {} },
        { provide: SonarrService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    downloadStateService = module.get(DownloadStateService)
    adminCheckService = module.get(AdminCheckService)
    adminCheckService.checkIsAdmin.mockResolvedValue(false)
  })

  function seedThenDropFromMap<T extends { id: string }>(job: T): void {
    // Mirrors what a restart leaves behind: a durable row survives, but the
    // in-memory Map starts out empty. persistJob() is private, so route
    // through addJob() (which writes both) and then remove the Map entry.
    downloadStateService.addJob(job as never)
    downloadStateService.jobs.delete(job.id)
  }

  describe('GET /videos/:id', () => {
    const job: VideoDownloadJob = {
      hiddenAttribution: true,
      id: 'video-restart-1',
      requester: { email: 'alice@example.com', userId: 'u1' },
      status: DownloadJobStatus.Completed,
      type: DownloadType.Video,
      url: 'https://example.com/video',
    }

    it('resolves a job absent from the Map but present in the DB', async () => {
      seedThenDropFromMap(job)

      const response = await controller.getVideoJob(job.id, nonAdmin)

      expect(response.id).toBe(job.id)
    })

    it('still applies masking to the hydrated job', async () => {
      seedThenDropFromMap(job)

      const nonAdminResponse = await controller.getVideoJob(job.id, nonAdmin)
      adminCheckService.checkIsAdmin.mockResolvedValue(true)
      const adminResponse = await controller.getVideoJob(job.id, admin)

      expect(nonAdminResponse.requester).toBeNull()
      expect(adminResponse.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('still 404s when the job exists in neither the Map nor the DB', async () => {
      await expect(
        controller.getVideoJob('never-existed', nonAdmin),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('GET /movies/:id', () => {
    const job: MovieDownloadJob = {
      id: 'movie-restart-1',
      mediaTitle: 'A Movie',
      radarrId: 7,
      requester: { email: 'alice@example.com', userId: 'u1' },
      status: DownloadJobStatus.Completed,
      type: DownloadType.Movie,
      url: 'radarr://tmdb/1',
    }

    it('resolves a job absent from the Map but present in the DB', async () => {
      seedThenDropFromMap(job)

      const response = await controller.getMovieJob(job.id, nonAdmin)

      expect(response.id).toBe(job.id)
      expect(response.radarrId).toBe(7)
      // Movies are always attributed - no masking toggle exists for them.
      expect(response.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('still 404s when the job exists in neither the Map nor the DB', async () => {
      await expect(
        controller.getMovieJob('never-existed', nonAdmin),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('GET /shows/:id', () => {
    const job: ShowDownloadJob = {
      id: 'show-restart-1',
      mediaTitle: 'A Show',
      requester: { email: 'alice@example.com', userId: 'u1' },
      sonarrId: 9,
      status: DownloadJobStatus.Completed,
      type: DownloadType.Show,
      url: 'sonarr://tvdb/1',
    }

    it('resolves a job absent from the Map but present in the DB', async () => {
      seedThenDropFromMap(job)

      const response = await controller.getShowJob(job.id, nonAdmin)

      expect(response.id).toBe(job.id)
      expect(response.sonarrId).toBe(9)
    })

    it('still 404s when the job exists in neither the Map nor the DB', async () => {
      await expect(
        controller.getShowJob('never-existed', nonAdmin),
      ).rejects.toThrow(HttpException)
    })
  })
})
