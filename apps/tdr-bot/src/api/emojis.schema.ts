import { z } from 'zod'

export const updateEmojiBodySchema = z.strictObject({
  description: z.string().trim().min(1).max(300),
})
