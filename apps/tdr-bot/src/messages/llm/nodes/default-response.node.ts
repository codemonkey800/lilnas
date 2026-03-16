import { Injectable, Logger } from '@nestjs/common'

import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { getTools } from 'src/messages/llm/tools'
import { OverallStateAnnotation } from 'src/schemas/graph'
import { RetryService } from 'src/utils/retry.service'

@Injectable()
export class DefaultResponseNode {
  private readonly logger = new Logger(DefaultResponseNode.name)

  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly retryService: RetryService,
  ) {}

  async invoke({
    messages,
    message,
  }: typeof OverallStateAnnotation.State): Promise<
    Partial<typeof OverallStateAnnotation.State>
  > {
    const allMessages = messages.concat(message)

    this.logger.log('Getting response from model')
    const model = this.modelFactory.createChatModel(getTools())
    const response = await this.retryService.executeWithRetry(
      () => model.invoke(allMessages),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 45000,
      },
      'OpenAI-getModelDefaultResponse',
    )
    this.logger.log('Got response from model')

    return { messages: [message, response] }
  }
}
