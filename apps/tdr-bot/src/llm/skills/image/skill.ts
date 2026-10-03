import { AIMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable } from '@nestjs/common'
import { nanoid } from 'nanoid'

import {
  Skill,
  SkillContext,
  SkillInput,
  SkillOutput,
} from 'src/llm/skills/skill.interface'
import { getTools } from 'src/messages/llm/tools'
import {
  ImageQuerySchema,
  ImageResponse,
  ImageResponseSchema,
} from 'src/schemas/graph'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

import {
  EXTRACT_IMAGE_QUERIES_PROMPT,
  IMAGE_RESPONSE,
  IMAGE_SKILL_DESCRIPTION,
} from './prompts'

@Injectable()
export class ImageSkill implements Skill {
  readonly id = 'image'
  readonly description = IMAGE_SKILL_DESCRIPTION

  constructor(private readonly metrics: TdrBotMetricsService) {}

  async run(
    { message, history }: SkillInput,
    { llm, logger }: SkillContext,
  ): Promise<SkillOutput> {
    logger.log({ message: message.content }, 'Extracting image queries')

    try {
      const { output: imageQueries } = await llm.call({
        operation: 'image.extractQueries',
        role: 'reasoning',
        messages: [EXTRACT_IMAGE_QUERIES_PROMPT, message],
        schema: ImageQuerySchema,
        overrides: { timeoutMs: 30000 },
      })

      logger.log(
        {
          queryCount: imageQueries.length,
          queries: imageQueries.map(q => ({ title: q.title, query: q.query })),
        },
        'Extracted image queries, starting generation',
      )

      const startTime = Date.now()
      const images: ImageResponse[] = []
      for (const { title, query } of imageQueries) {
        logger.log({ title, query }, 'Generating image')
        const { url } = await llm.generateImage({
          operation: 'image.generate',
          prompt: query,
        })
        logger.log({ title, url }, 'Successfully generated image')
        images.push(ImageResponseSchema.parse({ title, url }))
      }

      logger.log(
        {
          imageCount: images.length,
          duration: Date.now() - startTime,
          images: images.map(img => ({ title: img.title, url: img.url })),
        },
        'All images generated successfully',
      )

      const { message: chatResponse } = await llm.call({
        operation: 'image.respond',
        role: 'chat',
        messages: [...history, message, IMAGE_RESPONSE],
        tools: getTools(),
        overrides: { timeoutMs: 30000 },
      })

      this.metrics.imageGeneration('success')
      return {
        messages: [message, chatResponse],
        images: images.map(image => ({ ...image, parentId: chatResponse.id })),
      }
    } catch (err) {
      logger.error(
        {
          error: getErrorMessage(err),
          originalMessage: message.content,
          messageLength:
            typeof message.content === 'string' ? message.content.length : 0,
        },
        'Failed to generate images - returning error message to user',
      )

      this.metrics.imageGeneration('error')

      return {
        messages: [
          message,
          new AIMessage({
            id: nanoid(),
            content:
              "Sorry, I couldn't generate the image. Please try again later.",
          }),
        ],
        images: [],
      }
    }
  }
}
