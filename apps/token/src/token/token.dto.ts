import { z } from 'zod'

export const CreateTokenSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
})

export type CreateTokenDto = z.infer<typeof CreateTokenSchema>

export const ValidateTokenSchema = z.object({
  appSlug: z.string().min(1),
  value: z.string().min(1),
})

export type ValidateTokenDto = z.infer<typeof ValidateTokenSchema>
