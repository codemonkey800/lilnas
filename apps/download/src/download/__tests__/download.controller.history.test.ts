// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { ForbiddenException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'

describe('DownloadController - getHistory', () => {
  let controller: DownloadController
  let jobQueryService: jest.Mocked<JobQueryService>
  let adminCheckService: jest.Mocked<AdminCheckService>

  const alice: ForwardedUser = { email: 'alice@example.com', userId: 'u1' }
  const emptyPage = { items: [], nextCursor: null, total: 0 }

  beforeEach(async () => {
    const mockJobQueryService = {
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

  it('scopes to the caller when no requester param is given', async () => {
    await controller.getHistory({ limit: 24 }, alice)

    expect(jobQueryService.listHistory).toHaveBeenCalledWith({
      cursor: undefined,
      isAdmin: false,
      limit: 24,
      requesterEmail: 'alice@example.com',
    })
  })

  it('scopes to the caller when requester matches their own email, case-insensitively', async () => {
    await controller.getHistory(
      { limit: 24, requester: 'ALICE@EXAMPLE.COM' },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requesterEmail: 'alice@example.com' }),
    )
  })

  it("throws ForbiddenException when a non-admin requests another user's history", async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    await expect(
      controller.getHistory({ limit: 24, requester: 'bob@example.com' }, alice),
    ).rejects.toThrow(ForbiddenException)

    expect(jobQueryService.listHistory).not.toHaveBeenCalled()
  })

  it("allows an admin to view another user's history, scoped to that user", async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(true)

    await controller.getHistory(
      { limit: 24, requester: 'bob@example.com' },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith({
      cursor: undefined,
      isAdmin: true,
      limit: 24,
      requesterEmail: 'bob@example.com',
    })
  })

  it('returns the { items, nextCursor, total } shape verbatim', async () => {
    const page = { items: [{ id: 'z' }], nextCursor: null, total: 1 }
    jobQueryService.listHistory.mockReturnValue(page as never)

    const result = await controller.getHistory({ limit: 24 }, alice)

    expect(result).toBe(page)
  })
})
