import type {
  AdminStatsResponse,
  AuditLogQuery,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import {
  BadRequestException,
  type ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminController } from 'src/admin/admin.controller'
import { AdminStatsService } from 'src/admin/admin-stats.service'
import { AuditLogService } from 'src/audit/audit-log.service'
import { AdminGuard } from 'src/auth/admin.guard'
import { AdminCheckService } from 'src/auth/admin-check.service'

const ADMIN_HEADERS = {
  'x-forwarded-user': 'ada@lilnas.io',
  'x-forwarded-user-id': 'u-1',
}

function buildContext(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

const EMPTY_STATS: AdminStatsResponse = {
  jobsPerDay: [],
  topRequesters: [],
  totalJobs: 0,
  totalsByStatus: [],
  totalsByType: [],
  windowDays: 30,
}

describe('AdminController', () => {
  let controller: AdminController
  let guard: AdminGuard
  let adminCheckService: jest.Mocked<AdminCheckService>
  let adminStatsService: jest.Mocked<AdminStatsService>
  let auditLogService: jest.Mocked<AuditLogService>

  beforeEach(async () => {
    // Every handler logs a structured success line; silenced so the suite's
    // output is its assertions rather than two screens of Nest logs.
    jest.spyOn(Logger.prototype, 'log').mockImplementation()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminGuard,
        { provide: AdminCheckService, useValue: { checkIsAdmin: jest.fn() } },
        { provide: AdminStatsService, useValue: { getStats: jest.fn() } },
        { provide: AuditLogService, useValue: { listAuditLog: jest.fn() } },
      ],
    }).compile()

    controller = module.get(AdminController)
    guard = module.get(AdminGuard)
    adminCheckService = module.get(AdminCheckService)
    adminStatsService = module.get(AdminStatsService)
    auditLogService = module.get(AuditLogService)

    adminCheckService.checkIsAdmin.mockResolvedValue(true)
    adminStatsService.getStats.mockReturnValue(EMPTY_STATS)
    auditLogService.listAuditLog.mockResolvedValue({
      items: [],
      nextCursor: null,
      total: 0,
    })
  })

  describe('guard wiring', () => {
    // Class-level, not per-route: a route added to this controller later
    // must be admin-gated by default rather than by remembering to decorate
    // it. Asserted on the metadata Nest itself reads so this fails if the
    // decorator is ever moved down onto individual handlers.
    it('gates the whole controller with AdminGuard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([
        AdminGuard,
      ])
    })

    it('leaves no route ungated by a route-level override', () => {
      for (const handler of [
        controller.getAuditLog,
        controller.getStats,
      ] as const) {
        const routeGuards: unknown[] =
          Reflect.getMetadata(GUARDS_METADATA, handler) ?? []
        expect(routeGuards).toEqual([])
      }
    })

    it('rejects a request with no forwarded identity as 401', async () => {
      await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
        UnauthorizedException,
      )
      expect(adminCheckService.checkIsAdmin).not.toHaveBeenCalled()
    })

    it('rejects a known non-admin as 403', async () => {
      adminCheckService.checkIsAdmin.mockResolvedValue(false)

      await expect(
        guard.canActivate(buildContext(ADMIN_HEADERS)),
      ).rejects.toThrow(ForbiddenException)
      expect(adminCheckService.checkIsAdmin).toHaveBeenCalledWith(
        'ada@lilnas.io',
      )
    })

    it('admits an admin', async () => {
      await expect(
        guard.canActivate(buildContext(ADMIN_HEADERS)),
      ).resolves.toBe(true)
    })
  })

  describe('getAuditLog', () => {
    it('passes every filter and the cursor straight through', async () => {
      const query: AuditLogQuery = {
        action: 'video.create',
        actor: 'ada@lilnas.io',
        cursor: 'opaque-cursor',
        from: new Date('2026-06-01T00:00:00.000Z'),
        limit: 50,
        to: new Date('2026-06-30T23:59:59.999Z'),
      }

      await controller.getAuditLog(query)

      expect(auditLogService.listAuditLog).toHaveBeenCalledWith(query)
    })

    it('returns the page verbatim - no masking or reshaping', async () => {
      const page = {
        items: [
          {
            action: 'video.create' as const,
            actor: { email: 'ada@lilnas.io', userId: 'u-1' },
            createdAt: '2026-06-15T12:00:00.000Z',
            id: 7,
            metadata: { url: 'https://example.com/watch' },
            origin: 'web' as const,
            targetId: 'job-1',
            targetType: 'job' as const,
          },
        ],
        nextCursor: 'next',
        total: 42,
      }
      auditLogService.listAuditLog.mockResolvedValue(page)

      await expect(controller.getAuditLog({ limit: 25 })).resolves.toBe(page)
    })

    it('lets the service own cursor validation', async () => {
      auditLogService.listAuditLog.mockRejectedValue(
        new BadRequestException('Invalid or expired cursor'),
      )

      await expect(
        controller.getAuditLog({ cursor: 'garbage', limit: 25 }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('getStats', () => {
    it('forwards the parsed window to AdminStatsService', async () => {
      await controller.getStats({ days: 7 })

      expect(adminStatsService.getStats).toHaveBeenCalledWith({ days: 7 })
    })

    it('returns the aggregate response verbatim', async () => {
      const stats: AdminStatsResponse = {
        ...EMPTY_STATS,
        jobsPerDay: [{ count: 3, day: '2026-06-15', type: DownloadType.Video }],
        topRequesters: [{ count: 3, requesterEmail: 'ada@lilnas.io' }],
        totalJobs: 3,
        windowDays: 7,
      }
      adminStatsService.getStats.mockReturnValue(stats)

      await expect(controller.getStats({ days: 7 })).resolves.toBe(stats)
    })
  })
})
