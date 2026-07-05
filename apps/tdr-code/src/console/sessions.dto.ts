import { z } from 'zod'

export const SessionListItemSchema = z.object({
  id: z.number().int(),
  channelId: z.string(),
  triggeringUserId: z.string(),
  createdAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  endReason: z.enum(['evicted', 'teardown', 'interrupted']).nullable(),
})
export type SessionListItemDto = z.infer<typeof SessionListItemSchema>

export const SessionListResponseSchema = z.object({
  items: z.array(SessionListItemSchema),
  nextCursor: z.number().int().nullable(),
})
export type SessionListResponseDto = z.infer<typeof SessionListResponseSchema>

export const TurnContentBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.number().int(),
    kind: z.literal('prompt'),
    text: z.string(),
    images: z.array(z.object({ mimeType: z.string() })).optional(),
  }),
  z.object({
    id: z.number().int(),
    kind: z.literal('agent_text'),
    text: z.string(),
  }),
  z.object({
    id: z.number().int(),
    kind: z.literal('tool_call'),
    title: z.string(),
    toolKind: z.string(),
    status: z.string(),
  }),
  z.object({
    id: z.number().int(),
    kind: z.literal('diff'),
    path: z.string(),
    newText: z.string(),
    oldText: z.string().nullable().optional(),
    // True when newText/oldText were cut to DIFF_PREVIEW_MAX_CHARS
    // (sessions.service.ts) — a future "show full diff" UI affordance can
    // key off this without re-deriving it from field length. Required
    // (not optional) so every diff-block constructor — service code and
    // test fixtures alike — states it explicitly rather than silently
    // defaulting.
    truncated: z.boolean(),
  }),
])
export type TurnContentBlockDto = z.infer<typeof TurnContentBlockSchema>

export const TurnDetailSchema = z.object({
  id: z.number().int(),
  turnIndex: z.number().int(),
  userId: z.string().nullable(),
  status: z.enum([
    'running',
    'completed',
    'cancelled',
    'errored',
    'interrupted',
  ]),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  stopReason: z.string().nullable(),
  content: z.array(TurnContentBlockSchema),
})
export type TurnDetailDto = z.infer<typeof TurnDetailSchema>

export const SessionDetailResponseSchema = z.object({
  session: SessionListItemSchema,
  turns: z.array(TurnDetailSchema),
  droppedBlocks: z.number().int(),
})
export type SessionDetailResponseDto = z.infer<
  typeof SessionDetailResponseSchema
>
