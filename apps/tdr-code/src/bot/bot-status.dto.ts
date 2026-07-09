import { z } from 'zod'

export const BotStatusSchema = z.object({
  status: z.enum([
    'online',
    'starting',
    'offline',
    'offline-failed',
    'never-seen',
  ]),
  lastSeenAt: z.string().datetime().nullable(),
})

export type BotStatusDto = z.infer<typeof BotStatusSchema>
