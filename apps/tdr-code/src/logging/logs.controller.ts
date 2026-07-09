import { Controller, Get, Query, Req } from '@nestjs/common'
import type { Request } from 'express'

import { parseQuery } from 'src/console/query-params'
import type {
  LogScanPredicate,
  LogSearchResponse,
  LogSource,
  LogWindowResponse,
} from 'src/logging/log-view.types'

import { LogReaderService } from './log-reader.service'
import { LogSearchService } from './log-search.service'
import { LogSourcesService } from './log-sources.service'
import { LogSearchQuerySchema, LogWindowQuerySchema } from './logs.dto'

// BrowserLogsController already declares @Controller('logs') with
// @Post('browser') — Nest allows a second controller on the same prefix
// since method+path pairs don't collide (GET logs/window vs POST
// logs/browser). Both are wired deliberately alongside each other in
// logging.module.ts rather than this being a greenfield 'logs' prefix.
//
// Trust boundary: see bot-status.controller.ts / events.controller.ts.
// Phase D (D6) must enumerate this route for deny-by-default guards — see
// auth/protected-routes.ts's own '/logs/window' and '/logs/sources' entries.
@Controller('logs')
export class LogsController {
  constructor(
    private readonly logReader: LogReaderService,
    private readonly logSources: LogSourcesService,
    private readonly logSearch: LogSearchService,
  ) {}

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

  // No query params, no request body — trivially thin. All three
  // LogStream entries in a fixed order (U3, see log-sources.service.ts).
  @Get('sources')
  async sources(): Promise<LogSource[]> {
    return this.logSources.getSources()
  }

  // Phase 2 U9 — the whole-file streaming scan engine. `cursor` is
  // deliberately NOT destructured through parseQuery's own zod-validated
  // fields the way stream/text/level/process/event are: it is an opaque
  // continuation token whose OWN regex/range validation lives in
  // LogSearchService.scan() (see logs.dto.ts's own comment on why), so this
  // handler passes it through unexamined and lets the service reject a
  // malformed one with its own BadRequestException.
  //
  // `@Req() request` is used ONLY to derive an AbortSignal from the
  // connection's own lifecycle — never for auth (AuthGuard already ran
  // globally before this handler) and never for any other request field.
  // Wiring an abort signal through the whole-file streaming read is what
  // lets a superseding request (the client aborts on every query change,
  // per U11's design) actually stop this scan's in-flight block-read loop
  // instead of a now-abandoned scan continuing to consume file-I/O and CPU
  // in the background for however long the whole range takes to walk — an
  // ordinary HTTP client disconnect (navigating away, changing the search
  // box) fires the request's own 'close' event, which is the standard
  // Node idiom for turning that lifecycle into an AbortSignal.
  @Get('search')
  async search(
    @Query() raw: Record<string, string>,
    @Req() request: Request,
  ): Promise<LogSearchResponse> {
    const {
      stream,
      text,
      level,
      process: processFilter,
      event,
      cursor,
    } = parseQuery(LogSearchQuerySchema, raw)

    const predicate: LogScanPredicate = {
      ...(text !== undefined ? { text } : {}),
      ...(level !== undefined ? { level } : {}),
      ...(processFilter !== undefined ? { process: processFilter } : {}),
      ...(event !== undefined ? { event } : {}),
    }

    const abortController = new AbortController()
    request.on('close', () => abortController.abort())

    return this.logSearch.scan({
      stream,
      predicate,
      cursor,
      signal: abortController.signal,
    })
  }
}
