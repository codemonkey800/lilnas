import { z } from 'zod'

export const MediaTypeClassificationSchema = z.object({
  mediaType: z
    .enum(['movie', 'tv_show'])
    .describe('The classified media type based on the user message'),
  reasoning: z
    .string()
    // Nullable, not optional: OpenAI strict structured output requires every property
    .nullable()
    .describe('Brief explanation of why this classification was chosen'),
})

export type MediaTypeClassification = z.infer<
  typeof MediaTypeClassificationSchema
>
