import { Controller, Get, Post, Query } from '@nestjs/common'

import { UpdateCheckResult } from './types'
import { YtdlpUpdateService } from './ytdlp-update.service'

@Controller('api/ytdlp-update')
export class YtdlpUpdateController {
  constructor(private readonly ytdlpUpdateService: YtdlpUpdateService) {}

  @Get('status')
  getUpdateStatus() {
    return this.ytdlpUpdateService.getUpdateStatus()
  }

  @Post('check')
  async checkForUpdates(
    @Query('dryRun') dryRun?: string,
  ): Promise<UpdateCheckResult> {
    if (dryRun === 'true') {
      // In dry-run mode, simulate the check without performing actual update
      const result = await this.ytdlpUpdateService.checkForUpdates()

      // Override the result to prevent actual updates in dry-run mode
      if (result.updateAvailable && result.canUpdate) {
        return {
          ...result,
          canUpdate: false,
          reason: 'Dry-run mode - update would have proceeded',
        }
      }

      return result
    }

    return this.ytdlpUpdateService.checkForUpdates()
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
