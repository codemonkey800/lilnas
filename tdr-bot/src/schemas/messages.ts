import { z } from 'zod'

export const MessageResponseSchema = z.object({
  content: z
    .string()
    .describe(
      'The content of the message. It should not contain any LaTeX code or the step-by-step solution.',
    ),

  latex: z
    .string()
    .optional()
    .describe('The LaTeX code for rendering the solution step-by-step'),

  images: z
    .array(
      z.object({
        url: z.string().describe('The URL of the image'),
        title: z.string().describe('The title of the image'),
      }),
    )
    .optional()
    .describe(
      'An array of images to display to the user if the user asks to generate an image using the DALLE tool.',
    ),
})

export type MessageResponse = z.infer<typeof MessageResponseSchema>
