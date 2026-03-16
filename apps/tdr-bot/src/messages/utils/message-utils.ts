import { BaseMessage } from '@langchain/core/messages'

import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'
import { hasToolCalls } from 'src/utils/type-guards'

export class MessageUtils {
  static isToolsMessage(message: BaseMessage): boolean {
    return hasToolCalls(message)
  }

  static trimMessages(
    messages: BaseMessage[],
    maxMessageCount: number = 50,
  ): BaseMessage[] {
    const systemPrompt = messages.find(m => m.id === TDR_SYSTEM_PROMPT_ID)
    const otherMessages = messages.filter(m => m.id !== TDR_SYSTEM_PROMPT_ID)

    const keepCount = Math.min(otherMessages.length, maxMessageCount)
    // slice(-0) returns all elements, but we want empty array
    const trimmedMessages = keepCount > 0 ? otherMessages.slice(-keepCount) : []

    return systemPrompt ? [systemPrompt, ...trimmedMessages] : trimmedMessages
  }
}
