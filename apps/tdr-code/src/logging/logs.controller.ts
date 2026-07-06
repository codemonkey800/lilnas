import { Controller, Get, Query } from '@nestjs/common'

import { parseQuery } from 'src/console/query-params'
import type { LogWindowResponse } from 'src/logging/log-view.types'

import { LogReaderService } from './log-reader.service'
import { LogWindowQuerySchema } from './logs.dto'

// BrowserLogsController already declares @Controller('logs') with
// @Post('browser') — Nest allows a second controller on the same prefix
// since method+path pairs don't collide (GET logs/window vs POST
// logs/browser). Both are wired deliberately alongside each other in
// logging.module.ts rather than this being a greenfield 'logs' prefix.
//
// Trust boundary: see bot-status.controller.ts / events.controller.ts.
// Phase D (D6) must enumerate this route for deny-by-default guards — see
// auth/protected-routes.ts's own '/logs/window' entry.
@Controller('logs')
export class LogsController {
  constructor(private readonly logReader: LogReaderService) {}

  @Get('window')
  async window(
    @Query() raw: Record<string, string>,
  ): Promise<LogWindowResponse> {
    const { stream, anchor, direction, maxBytes } = parseQuery(
      LogWindowQuerySchema,
      raw,
    )
    return this.logReader.readWindow({
      stream,
      anchor,
      direction,
      // parseQuery already validated maxBytes is a positive int when
      // present; the service itself clamps against the env cap regardless
      // of what value reaches it, so an absent client value here defaults
      // to the cap value the service would clamp to anyway.
      maxBytes: maxBytes ?? Number.MAX_SAFE_INTEGER,
    })
  }
}
