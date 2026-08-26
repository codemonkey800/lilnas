import { Controller, Get, Post, Query } from '@nestjs/common'

import { AuditLogService } from 'src/audit/audit-log.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { OptionalCurrentUser } from 'src/auth/optional-current-user.decorator'

import { UpdateCheckResult } from './types'
import { YtdlpUpdateService } from './ytdlp-update.service'

@Controller('api/ytdlp-update')
export class YtdlpUpdateController {
  constructor(
    private readonly ytdlpUpdateService: YtdlpUpdateService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('status')
  getUpdateStatus() {
    return this.ytdlpUpdateService.getUpdateStatus()
  }

  /**
   * The only mutating route on this controller - a non-dry-run check can
   * replace the yt-dlp binary the whole download pipeline shells out to -
   * which is why it is the one that writes an audit row. The two GET routes
   * below are pure reads and deliberately record nothing.
   *
   * `@OptionalCurrentUser()` rather than a guard, for the same reason as
   * every other mutating route in this service: the container is reachable
   * ungated on the shared Docker network, the scheduler and dev calls arrive
   * with no `X-Forwarded-User` at all, and a guard here would only break
   * those while adding no real restriction. A caller with no identity is
   * recorded as `actor: undefined`, which the audit log stores as
   * `origin: 'service'`.
   */
  @Post('check')
  async checkForUpdates(
    @Query('dryRun') dryRun: string | undefined,
    @OptionalCurrentUser() user: ForwardedUser | undefined,
  ): Promise<UpdateCheckResult> {
    const isDryRun = dryRun === 'true'

    const checked = await this.ytdlpUpdateService.checkForUpdates()

    // In dry-run mode, report what *would* have happened rather than
    // letting the caller read the result as an update that actually ran.
    const result: UpdateCheckResult =
      isDryRun && checked.updateAvailable && checked.canUpdate
        ? {
            ...checked,
            canUpdate: false,
            reason: 'Dry-run mode - update would have proceeded',
          }
        : checked

    // After the check, never on failure: a throw above propagates and there
    // is nothing to record. Synchronous and un-awaited by contract - see
    // AuditLogService.record().
    this.auditLogService.record({
      action: 'ytdlp.check_update',
      actor: user,
      // Only what the handler already holds - no extra service call is made
      // to enrich this.
      metadata: {
        canUpdate: result.canUpdate,
        currentVersion: result.currentVersion,
        dryRun: isDryRun,
        latestVersion: result.latestVersion,
        updateAvailable: result.updateAvailable,
      },
      // No `target` at all: this action targets neither a job nor a media
      // item, and the audit table's CHECK requires target type and id to be
      // null together.
    })

    return result
  }

  @Get('version')
  async getCurrentVersion(): Promise<{ version: string }> {
    try {
      const version = await this.ytdlpUpdateService.getCurrentVersion()
      return { version }
    } catch {
      return { version: 'error' }
    }
  }
}
