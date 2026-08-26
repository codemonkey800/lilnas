import {
  AdminStatsQuerySchema,
  AuditLogQuerySchema,
} from '@lilnas/utils/download/schema'
import type {
  AdminStatsResponse,
  AuditLogEntry,
  DownloadPage,
} from '@lilnas/utils/download/types'
import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Query,
  UseGuards,
} from '@nestjs/common'
import { createZodDto, ZodValidationPipe } from 'nestjs-zod'

import { AuditLogService } from 'src/audit/audit-log.service'
import { AdminGuard } from 'src/auth/admin.guard'

import { AdminStatsService } from './admin-stats.service'

class AdminStatsQueryDto extends createZodDto(AdminStatsQuerySchema) {}
class AuditLogQueryDto extends createZodDto(AuditLogQuerySchema) {}

/**
 * The admin dashboard's read-only backend: the audit log and the aggregate
 * stats panel.
 *
 * `@UseGuards(AdminGuard)` sits at the **class** level rather than per-route
 * on purpose - every route this controller will ever grow is admin-only by
 * definition, so making the gate the default means a new route can't ship
 * ungated by omission. That guard is also the entire reason these routes may
 * show true attribution: `AdminStatsService` deliberately skips
 * `excludeHiddenVideos`, and the audit log stores real actor emails, so this
 * class must never host a route intended for ordinary users.
 *
 * Unlike `DownloadController`'s "admins may query others, everyone may query
 * themselves" routes, there is no per-caller narrowing here at all - which is
 * exactly why a class-level guard fits, where `getHistory()`'s query-dependent
 * rule needed an inline check (see admin.guard.ts).
 */
@Controller('/download/admin')
@UseGuards(AdminGuard)
export class AdminController {
  private logger = new Logger(AdminController.name)

  constructor(
    private adminStatsService: AdminStatsService,
    private auditLogService: AuditLogService,
  ) {}

  /**
   * Returned verbatim from `AuditLogService`, which owns filtering, cursor
   * decode and the `{ items, nextCursor, total }` envelope - including the
   * 400 for a cursor minted under a different filter. Nothing is masked or
   * reshaped on the way out; an audit row's value is that it says who
   * actually did the thing.
   */
  @Get('/audit-log')
  async getAuditLog(
    @Query(new ZodValidationPipe(AuditLogQueryDto)) query: AuditLogQueryDto,
  ): Promise<DownloadPage<AuditLogEntry>> {
    const action = 'getAuditLog'
    const startTime = Date.now()

    const page = await this.auditLogService.listAuditLog(query)

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        resultCount: page.items.length,
        statusCode: HttpStatus.OK,
        total: page.total,
      },
      'GET /admin/audit-log - listed audit log entries',
    )

    return page
  }

  @Get('/stats')
  async getStats(
    @Query(new ZodValidationPipe(AdminStatsQueryDto)) query: AdminStatsQueryDto,
  ): Promise<AdminStatsResponse> {
    const action = 'getStats'
    const startTime = Date.now()

    const stats = this.adminStatsService.getStats(query)

    const duration = Date.now() - startTime
    this.logger.log(
      {
        action,
        duration,
        statusCode: HttpStatus.OK,
        totalJobs: stats.totalJobs,
        windowDays: stats.windowDays,
      },
      'GET /admin/stats - computed admin dashboard stats',
    )

    return stats
  }
}
