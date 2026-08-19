// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { DownloadType } from '@lilnas/utils/download/types'
import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'

describe('DownloadController - activity/gallery list endpoints', () => {
  let controller: DownloadController
  let jobQueryService: jest.Mocked<JobQueryService>
  let adminCheckService: jest.Mocked<AdminCheckService>

  const admin: ForwardedUser = { email: 'admin@example.com', userId: 'a1' }
  const nonAdmin: ForwardedUser = { email: 'bob@example.com', userId: 'u2' }

  const emptyPage = { items: [], nextCursor: null, total: 0 }
  const emptyFacets = { types: [], uploaders: [] }

  beforeEach(async () => {
    const mockJobQueryService = {
      getGalleryFacets: jest.fn().mockReturnValue(emptyFacets),
      listActivity: jest.fn().mockReturnValue(emptyPage),
      listGallery: jest.fn().mockReturnValue(emptyPage),
      listHistory: jest.fn().mockReturnValue(emptyPage),
    }
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: DiscoveryService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { jobs: new Map() } },
        { provide: JobQueryService, useValue: mockJobQueryService },
        { provide: MediaDownloadService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    jobQueryService = module.get(JobQueryService)
    adminCheckService = module.get(AdminCheckService)
    adminCheckService.checkIsAdmin.mockResolvedValue(false)
  })

  describe('getActivity', () => {
    it('builds the filter from the query and forwards isAdmin', async () => {
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      await controller.getActivity(
        { cursor: 'abc', limit: 10, type: [DownloadType.Movie] },
        admin,
      )

      expect(jobQueryService.listActivity).toHaveBeenCalledWith({
        cursor: 'abc',
        isAdmin: true,
        limit: 10,
        types: [DownloadType.Movie],
      })
    })

    it('resolves isAdmin: false and passes no requester param for a service caller', async () => {
      await controller.getActivity({ limit: 24 }, undefined)

      expect(adminCheckService.checkIsAdmin).not.toHaveBeenCalled()
      expect(jobQueryService.listActivity).toHaveBeenCalledWith(
        expect.objectContaining({ isAdmin: false }),
      )
    })

    it('returns the { items, nextCursor, total } shape verbatim', async () => {
      const page = {
        items: [{ id: 'x' }],
        nextCursor: 'next-cursor',
        total: 5,
      }
      jobQueryService.listActivity.mockReturnValue(page as never)

      const result = await controller.getActivity({ limit: 24 }, undefined)

      expect(result).toBe(page)
    })

    it('propagates a BadRequestException from a bad cursor as-is', async () => {
      jobQueryService.listActivity.mockImplementation(() => {
        throw new BadRequestException('bad cursor')
      })

      await expect(
        controller.getActivity({ cursor: 'bogus', limit: 24 }, undefined),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('getGallery', () => {
    it('builds the filter from the query, including the date range and requester', async () => {
      const from = new Date('2026-01-01T00:00:00.000Z')
      const to = new Date('2026-01-31T23:59:59.999Z')

      await controller.getGallery(
        {
          cursor: undefined,
          from,
          limit: 24,
          requester: 'alice@example.com',
          to,
        },
        nonAdmin,
      )

      expect(jobQueryService.listGallery).toHaveBeenCalledWith({
        createdFrom: from,
        createdTo: to,
        cursor: undefined,
        isAdmin: false,
        limit: 24,
        requesterEmail: 'alice@example.com',
        types: undefined,
      })
    })

    it("does not compute excludeHiddenVideos itself - that is JobQueryService.listGallery's responsibility", async () => {
      await controller.getGallery(
        { limit: 24, requester: 'alice@example.com' },
        nonAdmin,
      )

      const call = jobQueryService.listGallery.mock.calls[0]?.[0]
      expect(call).not.toHaveProperty('excludeHiddenVideos')
    })

    it('returns the { items, nextCursor, total } shape verbatim', async () => {
      const page = { items: [{ id: 'y' }], nextCursor: null, total: 1 }
      jobQueryService.listGallery.mockReturnValue(page as never)

      const result = await controller.getGallery({ limit: 24 }, undefined)

      expect(result).toBe(page)
    })

    it('propagates a BadRequestException from a bad cursor as-is', async () => {
      jobQueryService.listGallery.mockImplementation(() => {
        throw new BadRequestException('bad cursor')
      })

      await expect(
        controller.getGallery({ cursor: 'bogus', limit: 24 }, undefined),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('getGalleryFacets', () => {
    it('builds the params from the query and forwards isAdmin', async () => {
      adminCheckService.checkIsAdmin.mockResolvedValue(true)
      const from = new Date('2026-01-01T00:00:00.000Z')
      const to = new Date('2026-01-31T23:59:59.999Z')

      await controller.getGalleryFacets({ from, to }, admin)

      expect(jobQueryService.getGalleryFacets).toHaveBeenCalledWith({
        createdFrom: from,
        createdTo: to,
        isAdmin: true,
      })
    })

    it('returns the facets shape verbatim', async () => {
      const facets = {
        types: [{ count: 3, type: 'movie' }],
        uploaders: [{ count: 1, email: 'alice@example.com' }],
      }
      jobQueryService.getGalleryFacets.mockReturnValue(facets as never)

      const result = await controller.getGalleryFacets({}, undefined)

      expect(result).toBe(facets)
    })
  })
})
