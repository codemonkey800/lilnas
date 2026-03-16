import { AIMessage } from '@langchain/core/messages'
import { DallEAPIWrapper } from '@langchain/openai'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { getTools } from 'src/messages/llm/tools'
import {
  ImageQuerySchema,
  ImageResponse,
  ImageResponseSchema,
  OverallStateAnnotation,
} from 'src/schemas/graph'
import { LLMStringContentSchema } from 'src/schemas/llm.schemas'
import { EXTRACT_IMAGE_QUERIES_PROMPT, IMAGE_RESPONSE } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

@Injectable()
export class ImageResponseNode {
  private readonly logger = new Logger(ImageResponseNode.name)

  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly retryService: RetryService,
  ) {}

  async invoke({
    message,
    messages,
  }: typeof OverallStateAnnotation.State): Promise<
    Partial<typeof OverallStateAnnotation.State>
  > {
    this.logger.log({ message: message.content }, 'Extracting image queries')

    try {
      const reasoningModel = this.modelFactory.createReasoningModel()
      const extractResponse = await this.retryService.executeWithRetry(
        () => reasoningModel.invoke([EXTRACT_IMAGE_QUERIES_PROMPT, message]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-getModelImageResponse-extract',
      )

      const contentString = LLMStringContentSchema.parse(
        extractResponse.content,
      )
      const imageQueries = ImageQuerySchema.parse(JSON.parse(contentString))

      this.logger.log(
        {
          queryCount: imageQueries.length,
          queries: imageQueries.map(q => ({
            title: q.title,
            query: q.query,
          })),
        },
        'Extracted image queries, starting generation',
      )

      const dalle = new DallEAPIWrapper()
      const startTime = Date.now()
      const images: ImageResponse[] = []
      for (const { title, query } of imageQueries) {
        this.logger.log({ title, query }, 'Generating image with DALL-E')

        const url = await this.retryService.executeWithRetry(
          () => dalle.invoke(query),
          {
            maxAttempts: 3,
            baseDelay: 2000,
            maxDelay: 60000,
            timeout: 60000,
          },
          `DallE-generate-${title}`,
        )

        this.logger.log({ title, url }, 'Successfully generated image')
        images.push(ImageResponseSchema.parse({ title, url }))
      }

      this.logger.log(
        {
          imageCount: images.length,
          duration: Date.now() - startTime,
          images: images.map(img => ({ title: img.title, url: img.url })),
        },
        'All images generated successfully',
      )

      const chatModel = this.modelFactory.createChatModel(getTools())
      const chatResponse = await this.retryService.executeWithRetry(
        () => chatModel.invoke([...messages, IMAGE_RESPONSE]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-getModelImageResponse-chat',
      )

      return {
        images: images.map(image => ({
          ...image,
          parentId: chatResponse.id,
        })),
        messages: [message, chatResponse],
      }
    } catch (err) {
      this.logger.error(
        {
          error: getErrorMessage(err),
          originalMessage: message.content,
          messageLength:
            typeof message.content === 'string' ? message.content.length : 0,
        },
        'Failed to generate images - returning error message to user',
      )

      const errorMessage = new AIMessage({
        id: nanoid(),
        content:
          "Sorry, I couldn't generate the image. Please try again later.",
      })

      return {
        images: [],
        messages: [message, errorMessage],
      }
    }
  }
}
