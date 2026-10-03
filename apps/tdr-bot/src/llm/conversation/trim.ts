import {
  BaseMessage,
  isAIMessage,
  SystemMessage,
  ToolMessage,
  trimMessages,
} from '@langchain/core/messages'

export const DEFAULT_TRIM_TOKENS = 24_000

const CHARS_PER_TOKEN = 4
// Rough per-message overhead for role and framing tokens.
const MESSAGE_OVERHEAD_TOKENS = 4

export interface TrimOptions {
  maxTokens: number
  tokenCounter?: (m: BaseMessage[]) => number | Promise<number>
}

function contentLength(message: BaseMessage): number {
  const { content } = message
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  const toolCalls = isAIMessage(message) ? message.tool_calls : undefined
  return (
    text.length + (toolCalls?.length ? JSON.stringify(toolCalls).length : 0)
  )
}

/** Approximates tokens at 4 chars/token, without a tokenizer dependency. */
export const approximateTokenCounter = (messages: BaseMessage[]): number =>
  messages.reduce(
    (total, m) =>
      total +
      Math.ceil(contentLength(m) / CHARS_PER_TOKEN) +
      MESSAGE_OVERHEAD_TOKENS,
    0,
  )

/** Drops AI tool calls whose results were cut, and tool results whose call was cut. */
function dropOrphanedToolMessages(messages: BaseMessage[]): BaseMessage[] {
  const resultIds = new Set(
    messages.filter(ToolMessage.isInstance).map(m => m.tool_call_id),
  )
  const callIds = new Set<string>()
  const answered = messages.filter(m => {
    if (!isAIMessage(m) || !m.tool_calls?.length) return true
    const complete = m.tool_calls.every(tc => tc.id && resultIds.has(tc.id))
    if (complete) m.tool_calls.forEach(tc => tc.id && callIds.add(tc.id))
    return complete
  })
  return answered.filter(
    m => !ToolMessage.isInstance(m) || callIds.has(m.tool_call_id),
  )
}

/**
 * Keeps the system prompt and the most recent messages that fit the token
 * budget. The result starts on a human turn and never splits a tool call from
 * its tool results.
 */
export async function trimConversation(
  messages: BaseMessage[],
  opts: TrimOptions,
): Promise<BaseMessage[]> {
  if (messages.length === 0) return []

  const count = opts.tokenCounter ?? approximateTokenCounter
  const tokenCounter = async (m: BaseMessage[]) => count(m)
  // The system prompt is always kept, so it is split off and only the rest is
  // trimmed against whatever budget it leaves.
  const system = messages.filter(m => SystemMessage.isInstance(m))
  const rest = messages.filter(m => !SystemMessage.isInstance(m))
  const remaining = opts.maxTokens - (await tokenCounter(system))

  if (remaining <= 0 || rest.length === 0) return system

  const trimmed = await trimMessages(rest, {
    maxTokens: remaining,
    tokenCounter,
    strategy: 'last',
    includeSystem: true,
    startOn: 'human',
    allowPartial: false,
  })

  return [...system, ...dropOrphanedToolMessages(trimmed)]
}
