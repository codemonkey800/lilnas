import { z } from 'zod'

export const RevokeSessionsResponseSchema = z.object({
  discordUserId: z.string(),
  sessionsRevoked: z.number().int().nonnegative(),
})
export type RevokeSessionsResponseDto = z.infer<
  typeof RevokeSessionsResponseSchema
>
