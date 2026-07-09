import { z } from 'zod'

export const LiveChannelStateSchema = z.enum([
  'working',
  'idle',
  'stale',
  'last-known',
])
export type LiveChannelState = z.infer<typeof LiveChannelStateSchema>

export const LiveChannelItemSchema = z.object({
  channelId: z.string(),
  channelName: z.string().nullable(),
  triggeringUserId: z.string().nullable(),
  triggeringUserDisplayName: z.string().nullable(),
  state: LiveChannelStateSchema,
  queueDepth: z.number().int(),
  lastActivityAt: z.string().datetime(),
  lastHeartbeatAt: z.string().datetime(),
})
export type LiveChannelItemDto = z.infer<typeof LiveChannelItemSchema>

export const LiveResponseSchema = z.object({
  botOffline: z.boolean(),
  // 'never-seen' when no generation exists at all; 'offline' or 'online' otherwise.
  globalStatus: z.enum(['online', 'offline', 'never-seen']),
  items: z.array(LiveChannelItemSchema),
})
export type LiveResponseDto = z.infer<typeof LiveResponseSchema>
