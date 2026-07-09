import { Module } from '@nestjs/common'

import { BrowserLogsController } from './browser-logs.controller'
import { BrowserLogsService } from './browser-logs.service'
import { LogReaderService } from './log-reader.service'
import { LogSearchService } from './log-search.service'
import { LogSourcesService } from './log-sources.service'
import { LogTailController } from './log-tail.controller'
import { LogTailService } from './log-tail.service'
import { LogsController } from './logs.controller'

// Main-process-only (see app.module.ts — not imported by bot.module.ts,
// which has no HTTP surface at all). LogsController (U2 windowed reads, U3
// sources, Phase 2 U9 whole-file search) and LogTailController (Phase 2 U8,
// append-delta tail push) join BrowserLogsController here rather than a
// standalone logs.module.ts — this module is already wired into
// app.module.ts's imports, so no further app.module.ts edit is needed for
// any of these routes. LogTailController is a SEPARATE controller class
// from LogsController (see its own header comment) so its @Sse('tail')
// composes to exactly '/logs/tail', not a second method colliding with
// LogsController's existing @Get() routes; LogSearchService, in contrast, is
// just a third constructor dependency on the EXISTING LogsController (its
// @Get('search') composes to '/logs/search' alongside window/sources with no
// such collision risk).
@Module({
  controllers: [BrowserLogsController, LogsController, LogTailController],
  providers: [
    BrowserLogsService,
    LogReaderService,
    LogSearchService,
    LogSourcesService,
    LogTailService,
  ],
})
export class LoggingModule {}
