import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages'
import type { ToolCall } from '@langchain/core/messages/tool'

import { DEFAULT_MESSAGE_IDS } from 'src/message-handler/__tests__/test-constants'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

/**
 * Create a human message with optional ID
 */
export function createHumanMessage(
  content: string,
  id: string = DEFAULT_MESSAGE_IDS.HUMAN,
): HumanMessage {
  return new HumanMessage({
    id,
    content,
  })
}

/**
 * Create an AI message with optional tool calls
 */
export function createAIMessage(
  content: string,
  toolCalls?: ToolCall[],
  id: string = DEFAULT_MESSAGE_IDS.AI,
): AIMessage {
  return new AIMessage({
    id,
    content,
    ...(toolCalls && { tool_calls: toolCalls }),
  })
}

/**
 * Create a system message
 */
export function createSystemMessage(
  content: string,
  id: string = DEFAULT_MESSAGE_IDS.SYSTEM,
): SystemMessage {
  return new SystemMessage({
    id,
    content,
  })
}

/**
 * Create a tool message
 */
export function createToolMessage(
  content: string,
  toolCallId: string,
  id: string = DEFAULT_MESSAGE_IDS.TOOL,
): ToolMessage {
  return new ToolMessage({
    id,
    content,
    tool_call_id: toolCallId,
  })
}

/**
 * Create the TDR system prompt
 */
export function createTdrSystemPrompt(): SystemMessage {
  return new SystemMessage({
    id: TDR_SYSTEM_PROMPT_ID,
    content: 'You are TDR, a helpful AI assistant.',
  })
}

/**
 * Sample conversation without tools
 */
export const SAMPLE_CONVERSATION = [
  createTdrSystemPrompt(),
  createHumanMessage('Hello, how are you?', 'human-1'),
  createAIMessage('I am doing well, thank you!', undefined, 'ai-1'),
  createHumanMessage('What is 2+2?', 'human-2'),
  createAIMessage('2+2 equals 4.', undefined, 'ai-2'),
]

/**
 * Conversation with tool calls
 */
export const CONVERSATION_WITH_TOOLS = [
  createTdrSystemPrompt(),
  createHumanMessage('What is the weather today?', 'human-tool-1'),
  createAIMessage(
    'Let me search for that.',
    [
      {
        name: 'tavily_search',
        args: { query: 'weather today' },
        id: DEFAULT_MESSAGE_IDS.TOOL_CALL,
      },
    ],
    'ai-tool-1',
  ),
  createToolMessage(
    'Weather is sunny, 72°F',
    DEFAULT_MESSAGE_IDS.TOOL_CALL,
    'tool-result-1',
  ),
  createAIMessage(
    'The weather today is sunny with a temperature of 72°F.',
    undefined,
    'ai-tool-2',
  ),
]

/**
 * Long conversation for trimming tests (60 messages)
 */
export const LONG_CONVERSATION = [
  createTdrSystemPrompt(),
  ...Array.from({ length: 59 }, (_, i) => {
    const isHuman = i % 2 === 0
    return isHuman
      ? createHumanMessage(`Message ${i + 1}`, `human-long-${i}`)
      : createAIMessage(`Response ${i + 1}`, undefined, `ai-long-${i}`)
  }),
]

/**
 * Create a tool call object
 */
export function createToolCall(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Matches LangChain's ToolCall.args type
  args: Record<string, any>,
  id: string = DEFAULT_MESSAGE_IDS.TOOL_CALL,
): ToolCall {
  return {
    name,
    args,
    id,
  }
}
