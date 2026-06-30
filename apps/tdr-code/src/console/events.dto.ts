import { z } from 'zod'

import { EVENT_LEVELS, EVENT_TYPES } from 'src/db/schema'

export const EventItemSchema = z.object({
  id: z.number().int(),
  type: z.enum(EVENT_TYPES),
  level: z.enum(EVENT_LEVELS),
  channelId: z.string().nullable(),
  sessionId: z.number().int().nullable(),
  context: z.record(z.unknown()),
  createdAt: z.string().datetime(),
})
export type EventItemDto = z.infer<typeof EventItemSchema>

export const EventListResponseSchema = z.object({
  items: z.array(EventItemSchema),
  nextCursor: z.number().int().nullable(),
})
export type EventListResponseDto = z.infer<typeof EventListResponseSchema>
