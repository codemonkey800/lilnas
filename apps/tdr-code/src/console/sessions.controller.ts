import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common'
import { z } from 'zod'

import { PaginationSchema, parseQuery } from './query-params'
import type {
  SessionDetailResponseDto,
  SessionListResponseDto,
} from './sessions.dto'
import { SessionsService } from './sessions.service'

const SessionListQuerySchema = PaginationSchema.extend({
  channel: z.string().optional(),
})

// Trust boundary: see bot-status.controller.ts.
// Phase D (D6) must enumerate these routes for deny-by-default guards.
// GET /sessions/:id/reconcile is the most sensitive route — raw transcript content.
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  async list(@Query() raw: Record<string, string>): Promise<SessionListResponseDto> {
    const { cursor, limit, channel } = parseQuery(SessionListQuerySchema, raw)
    return this.sessionsService.listSessions({
      channelId: channel,
      cursor,
      limit,
    })
  }

  @Get(':id')
  getOne(@Param('id') idStr: string): SessionDetailResponseDto {
    const id = parseInt(idStr, 10)
    if (isNaN(id) || id <= 0) {
      throw new BadRequestException('Session id must be a positive integer')
    }
    return this.sessionsService.getSessionTranscript(id)
  }
}
