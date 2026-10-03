import { AIMessage, BaseMessage } from '@langchain/core/messages'

import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

import type { ConversationMessage } from './api.types'

function requestIdOf(message: BaseMessage): string | undefined {
  const id = message.additional_kwargs?.requestId
  return typeof id === 'string' ? id : undefined
}

function contentToString(content: BaseMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

/** Maps checkpointed thread messages to their API shape, hiding the system prompt. */
export function toConversationMessages(
  messages: BaseMessage[],
): ConversationMessage[] {
  return messages
    .filter(m => m.id !== TDR_SYSTEM_PROMPT_ID)
    .map(message => ({
      id: message.id,
      type: message.getType(),
      content: contentToString(message.content),
      ...(message.name ? { name: message.name } : {}),
      ...(requestIdOf(message) ? { requestId: requestIdOf(message) } : {}),
      ...(AIMessage.isInstance(message) && message.tool_calls?.length
        ? {
            toolCalls: message.tool_calls.map(call => ({
              id: call.id,
              name: call.name,
              args: call.args,
            })),
          }
        : {}),
    }))
}
