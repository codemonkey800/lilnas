import { BaseMessage } from '@langchain/core/messages'

import { hasToolCalls } from 'src/utils/type-guards'

export class MessageUtils {
  static isToolsMessage(message: BaseMessage): boolean {
    return hasToolCalls(message)
  }
}
