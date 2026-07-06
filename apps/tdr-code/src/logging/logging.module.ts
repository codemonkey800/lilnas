import { Module } from '@nestjs/common'

import { BrowserLogsController } from './browser-logs.controller'
import { BrowserLogsService } from './browser-logs.service'
import { LogReaderService } from './log-reader.service'
import { LogSourcesService } from './log-sources.service'
import { LogTailController } from './log-tail.controller'
import { LogTailService } from './log-tail.service'
import { LogsController } from './logs.controller'

// Main-process-only (see app.module.ts — not imported by bot.module.ts,
// which has no HTTP surface at all). LogsController (U2 windowed reads, U3
// sources) and LogTailController (Phase 2 U8, append-delta tail push) join
// BrowserLogsController here rather than a standalone logs.module.ts — this
// module is already wired into app.module.ts's imports, so no further
// app.module.ts edit is needed for either new route. LogTailController is a
// SEPARATE controller class from LogsController (see its own header
// comment) so its @Sse('tail') composes to exactly '/logs/tail', not a
// second method colliding with LogsController's existing @Get() routes.
@Module({
  controllers: [BrowserLogsController, LogsController, LogTailController],
  providers: [
    BrowserLogsService,
    LogReaderService,
    LogSourcesService,
    LogTailService,
  ],
})
export class LoggingModule {}
