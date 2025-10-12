import { BaseMessage } from '@langchain/core/messages'

import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

/**
 * MessageUtils - Pure utility functions for message operations
 *
 * This class contains stateless utility functions for working with LangChain messages.
 * All methods are static and have no dependencies on service state.
 *
 * These utilities are extracted from LLMOrchestrationService to improve testability
 * and reduce coupling to implementation details.
 */
export class MessageUtils {
  /**
   * Check if a message contains tool calls
   *
   * @param message - The message to check
   * @returns true if the message has tool_calls with at least one call
   *
   * @example
   * ```typescript
   * const message = new AIMessage({ content: 'test', tool_calls: [{ name: 'search', args: {} }] })
   * MessageUtils.isToolsMessage(message) // true
   * ```
   */
  static isToolsMessage(message: BaseMessage): boolean {
    return (
      'tool_calls' in message &&
      message.tool_calls !== undefined &&
      message.tool_calls !== null &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0
    )
  }

  /**
   * Trim messages to keep within token limits
   *
   * Keeps the system prompt (identified by TDR_SYSTEM_PROMPT_ID) at the start
   * and retains the most recent messages up to the specified count.
   *
   * @param messages - Array of messages to trim
   * @param maxMessageCount - Maximum number of non-system messages to keep (default: 50)
   * @returns Trimmed array with system prompt first (if present) followed by recent messages
   *
   * @example
   * ```typescript
   * const messages = [systemPrompt, msg1, msg2, msg3, msg4, msg5]
   * const trimmed = MessageUtils.trimMessages(messages, 3)
   * // Result: [systemPrompt, msg3, msg4, msg5]
   * ```
   */
  static trimMessages(
    messages: BaseMessage[],
    maxMessageCount: number = 50,
  ): BaseMessage[] {
    const systemPrompt = messages.find(m => m.id === TDR_SYSTEM_PROMPT_ID)
    const otherMessages = messages.filter(m => m.id !== TDR_SYSTEM_PROMPT_ID)

    const keepCount = Math.min(otherMessages.length, maxMessageCount)
    // Handle edge case: slice(-0) returns all elements, but we want empty array
    const trimmedMessages = keepCount > 0 ? otherMessages.slice(-keepCount) : []

    return systemPrompt ? [systemPrompt, ...trimmedMessages] : trimmedMessages
  }

  /**
   * Get the names of all tool calls in a message
   *
   * @param message - The message to extract tool call names from
   * @returns Array of tool names, or empty array if no tool calls
   *
   * @example
   * ```typescript
   * const message = new AIMessage({
   *   content: 'test',
   *   tool_calls: [
   *     { name: 'search', args: {} },
   *     { name: 'calculator', args: {} }
   *   ]
   * })
   * MessageUtils.getToolCallNames(message) // ['search', 'calculator']
   * ```
   */
  static getToolCallNames(message: BaseMessage): string[] {
    if (!MessageUtils.isToolsMessage(message)) {
      return []
    }

    // Type assertion is safe here because isToolsMessage verified tool_calls exists
    const toolCalls = (
      message as BaseMessage & { tool_calls: Array<{ name: string }> }
    ).tool_calls
    return toolCalls?.map(tc => tc.name) ?? []
  }

  /**
   * Count messages by type
   *
   * @param messages - Array of messages to count
   * @returns Object with counts for each message type
   *
   * @example
   * ```typescript
   * const messages = [
   *   new HumanMessage('hi'),
   *   new AIMessage('hello'),
   *   new SystemMessage('system'),
   *   new ToolMessage('result', 'tool_call_id')
   * ]
   * MessageUtils.countMessagesByType(messages)
   * // { human: 1, ai: 1, system: 1, tool: 1, other: 0 }
   * ```
   */
  static countMessagesByType(messages: BaseMessage[]): {
    human: number
    ai: number
    system: number
    tool: number
    other: number
  } {
    const counts = {
      human: 0,
      ai: 0,
      system: 0,
      tool: 0,
      other: 0,
    }

    for (const message of messages) {
      const type = message._getType()
      if (type === 'human') counts.human++
      else if (type === 'ai') counts.ai++
      else if (type === 'system') counts.system++
      else if (type === 'tool') counts.tool++
      else counts.other++
    }

    return counts
  }
}
