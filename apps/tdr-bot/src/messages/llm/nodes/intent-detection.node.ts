import { HumanMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { OverallStateAnnotation, ResponseType } from 'src/schemas/graph'
import { ResponseTypeContentSchema } from 'src/schemas/llm.schemas'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { GET_RESPONSE_TYPE_PROMPT } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

@Injectable()
export class IntentDetectionNode {
  private readonly logger = new Logger(IntentDetectionNode.name)

  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly retryService: RetryService,
    private readonly mediaRequestHandler: MediaRequestHandler,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  async invoke({
    userInput,
    userId,
  }: typeof OverallStateAnnotation.State): Promise<
    Partial<typeof OverallStateAnnotation.State>
  > {
    this.logger.log({ userId }, 'Checking response type')

    const message = new HumanMessage({ id: nanoid(), content: userInput })

    const hasActiveContext =
      await this.mediaRequestHandler.hasActiveMediaContext(userId, message)

    if (hasActiveContext) {
      this.logger.log(
        { userId },
        'Active media context detected, skipping intent detection',
      )
      this.metrics.intentDetected(ResponseType.Media)
      return { message, responseType: ResponseType.Media }
    }

    const reasoningModel = this.modelFactory.createReasoningModel()
    const response = await this.retryService.executeWithRetry(
      () => reasoningModel.invoke([GET_RESPONSE_TYPE_PROMPT, message]),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 30000,
      },
      'OpenAI-checkResponseType',
    )

    const responseType = ResponseTypeContentSchema.parse(response.content)
    this.logger.log({ responseType }, 'Got response type')

    this.metrics.intentDetected(responseType)
    return { message, responseType }
  }
}
