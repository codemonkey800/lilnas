import { z } from 'zod'

import { UsernameSchema } from './username.schema'

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1, 'Password is required'),
})

export type LoginRequest = z.infer<typeof LoginRequestSchema>
