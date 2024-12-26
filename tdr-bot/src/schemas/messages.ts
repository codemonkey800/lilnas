import { z } from 'zod'

export const MessageResponseSchema = z.object({
  content: z.string().describe('The content of the message'),
  images: z
    .array(
      z.object({
        url: z.string().describe('The URL of the image'),
        title: z.string().describe('The title of the image'),
        description: z.string().describe('The description of the image'),
      }),
    )
    .describe(
      'An array of images to display to the user if the user asks to generate an image using the DALLE tool',
    ),
})

export type MessageResponse = z.infer<typeof MessageResponseSchema>
