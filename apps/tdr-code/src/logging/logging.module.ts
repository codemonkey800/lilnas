import { Module } from '@nestjs/common'

import { BrowserLogsController } from './browser-logs.controller'
import { BrowserLogsService } from './browser-logs.service'
import { LogReaderService } from './log-reader.service'
import { LogsController } from './logs.controller'

// Main-process-only (see app.module.ts — not imported by bot.module.ts,
// which has no HTTP surface at all). LogsController (U2, windowed reads)
// joins BrowserLogsController here rather than a standalone logs.module.ts
// — this module is already wired into app.module.ts's imports, so no
// further app.module.ts edit is needed for the new route.
@Module({
  controllers: [BrowserLogsController, LogsController],
  providers: [BrowserLogsService, LogReaderService],
})
export class LoggingModule {}
