import { HumanMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { ModelFactoryService } from 'src/messages/llm/model-factory.service'
import { REMINDER_CONTEXT_TYPE } from 'src/reminders/reminder.constants'
import { REMINDER_TOPIC_SWITCH_PROMPT } from 'src/reminders/reminder.prompts'
import { OverallStateAnnotation, ResponseType } from 'src/schemas/graph'
import { ResponseTypeContentSchema } from 'src/schemas/llm.schemas'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { GET_RESPONSE_TYPE_PROMPT } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

/**
 * LangGraph node that classifies user messages into a
 * {@link ResponseType} (default, image, math, media, or reminder).
 *
 * Before invoking the reasoning model it checks for active
 * conversational contexts (reminder or media) so that follow-up
 * messages are routed correctly without re-classification.
 */
@Injectable()
export class IntentDetectionNode {
  private readonly logger = new Logger(IntentDetectionNode.name)

  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly retryService: RetryService,
    private readonly mediaRequestHandler: MediaRequestHandler,
    private readonly contextService: ContextManagementService,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  /**
   * Classifies the user's message and returns the resolved
   * {@link ResponseType} alongside a stamped {@link HumanMessage}.
   */
  async invoke({
    userInput,
    userId,
  }: typeof OverallStateAnnotation.State): Promise<
    Partial<typeof OverallStateAnnotation.State>
  > {
    this.logger.log({ userId }, 'Checking response type')

    const message = new HumanMessage({ id: nanoid(), content: userInput })

    // Check active reminder context first
    const reminderContextType = await this.contextService.getContextType(userId)
    if (reminderContextType === REMINDER_CONTEXT_TYPE) {
      const isContinuing = await this.detectReminderTopicSwitch(userInput)

      if (isContinuing) {
        this.logger.log(
          { userId },
          'Active reminder context detected, routing to reminder node',
        )

        this.metrics.intentDetected(ResponseType.Reminder)
        return {
          message,
          responseType: ResponseType.Reminder,
        }
      }

      this.logger.log(
        { userId },
        'User switched topic, clearing reminder context',
      )

      await this.contextService.clearContext(userId)
    }

    const hasActiveMediaContext =
      await this.mediaRequestHandler.hasActiveMediaContext(userId, message)

    if (hasActiveMediaContext) {
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

  /**
   * Asks the LLM whether the user is still providing reminder details
   * ("CONTINUE") or has switched to an unrelated topic ("SWITCH").
   *
   * @returns `true` if the user is continuing the reminder flow.
   */
  private async detectReminderTopicSwitch(userInput: string): Promise<boolean> {
    try {
      const reasoningModel = this.modelFactory.createReasoningModel()
      const response = await this.retryService.executeWithRetry(
        () =>
          reasoningModel.invoke([
            REMINDER_TOPIC_SWITCH_PROMPT,
            new HumanMessage(userInput),
          ]),
        { maxAttempts: 2, baseDelay: 500, maxDelay: 5000, timeout: 15000 },
        'OpenAI-reminderTopicSwitch',
      )
      const result = String(response.content).trim().toUpperCase()
      return result === 'CONTINUE'
    } catch (err) {
      this.logger.warn(
        { err },
        'Topic switch detection failed, clearing reminder context',
      )
      return false
    }
  }
}
