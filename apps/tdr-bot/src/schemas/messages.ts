import { z } from 'zod'

import { ImageResponseSchema } from './graph'

export const MessageResponseSchema = z.object({
  content: z
    .string()
    .describe(
      'The content of the message. It should not contain any LaTeX code or the step-by-step solution.',
    ),

  images: z
    .array(ImageResponseSchema)
    .optional()
    .describe(
      'An array of images to display to the user if the user asks to generate an image using the DALLE tool.',
    ),
})

export type MessageResponse = z.infer<typeof MessageResponseSchema>
