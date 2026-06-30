import { Controller, Get, Query } from '@nestjs/common'
import { z } from 'zod'

import { EVENT_LEVELS, EVENT_TYPES } from 'src/db/schema'

import type { EventListResponseDto } from './events.dto'
import { EventsService } from './events.service'
import { PaginationSchema, parseQuery } from './query-params'

const EventListQuerySchema = PaginationSchema.extend({
  type: z
    .string()
    .optional()
    .refine(
      v => v === undefined || (EVENT_TYPES as readonly string[]).includes(v),
      { message: `type must be one of: ${EVENT_TYPES.join(', ')}` },
    )
    .transform(v => v as (typeof EVENT_TYPES)[number] | undefined),
  level: z
    .string()
    .optional()
    .refine(
      v => v === undefined || (EVENT_LEVELS as readonly string[]).includes(v),
      { message: `level must be one of: ${EVENT_LEVELS.join(', ')}` },
    )
    .transform(v => v as (typeof EVENT_LEVELS)[number] | undefined),
  channel: z.string().optional(),
})

// Trust boundary: see bot-status.controller.ts.
// Phase D (D6) must enumerate this route for deny-by-default guards.
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list(@Query() raw: Record<string, string>): EventListResponseDto {
    const { cursor, limit, type, level, channel } = parseQuery(
      EventListQuerySchema,
      raw,
    )
    return this.eventsService.listEvents({
      type,
      level,
      channelId: channel,
      cursor,
      limit,
    })
  }
}
