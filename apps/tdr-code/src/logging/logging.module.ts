import { Module } from '@nestjs/common'

import { BrowserLogsController } from './browser-logs.controller'
import { BrowserLogsService } from './browser-logs.service'

// Main-process-only (see app.module.ts — not imported by bot.module.ts,
// which has no HTTP surface at all).
@Module({
  controllers: [BrowserLogsController],
  providers: [BrowserLogsService],
})
export class LoggingModule {}
