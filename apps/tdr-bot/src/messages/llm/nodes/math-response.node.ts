import { Injectable, Logger } from '@nestjs/common'

import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { getTools } from 'src/messages/llm/tools'
import { OverallStateAnnotation } from 'src/schemas/graph'
import { EquationImageService } from 'src/services/equation-image.service'
import {
  GET_CHAT_MATH_RESPONSE,
  GET_MATH_RESPONSE_PROMPT,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

@Injectable()
export class MathResponseNode {
  private readonly logger = new Logger(MathResponseNode.name)

  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly retryService: RetryService,
    private readonly equationImage: EquationImageService,
  ) {}

  async invoke({
    message,
    messages,
  }: typeof OverallStateAnnotation.State): Promise<
    Partial<typeof OverallStateAnnotation.State>
  > {
    this.logger.log({ message: message.content }, 'Get complex math solution')

    const reasoningModel = this.modelFactory.createReasoningModel()
    const latexResponse = await this.retryService.executeWithRetry(
      () =>
        reasoningModel.invoke(
          messages
            .filter(m => m.id !== TDR_SYSTEM_PROMPT_ID)
            .concat(message)
            .concat(GET_MATH_RESPONSE_PROMPT),
        ),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 30000,
      },
      'OpenAI-getModelMathResponse-latex',
    )

    const latex = latexResponse.content.toString()

    this.logger.log(
      {
        latexLength: latex.length,
        latexPreview: latex.substring(0, 200),
      },
      'Extracted LaTeX for rendering',
    )

    const chatModel = this.modelFactory.createChatModel(getTools())
    const startTime = Date.now()
    const [equationImageResponse, chatResponse] = await Promise.all([
      this.equationImage.getImage(latex),
      this.retryService.executeWithRetry(
        () => chatModel.invoke([...messages, message, GET_CHAT_MATH_RESPONSE]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-getModelMathResponse-chat',
      ),
    ])

    this.logger.log(
      {
        duration: Date.now() - startTime,
        hasEquationImage: !!equationImageResponse,
        equationUrl: equationImageResponse?.url,
      },
      'Completed parallel math response operations',
    )

    return {
      images: equationImageResponse
        ? [
            {
              title: 'the solution',
              url: equationImageResponse.url,
              parentId: chatResponse.id,
            },
          ]
        : [],
      messages: [message, chatResponse],
    }
  }
}
