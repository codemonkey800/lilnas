import { z } from 'zod'

export const playgroundChatBodySchema = z
  .strictObject({
    model: z.string().min(1),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(['user', 'assistant']),
          content: z.string().trim().min(1).max(4000),
        }),
      )
      .min(1)
      .max(40),
    systemPromptDraft: z.string().max(20_000).optional(),
    author: z.string().trim().min(1).max(32).optional(),
  })
  .refine(body => body.messages.at(-1)?.role === 'user', {
    path: ['messages'],
    message: 'The last message must be from the user',
  })
