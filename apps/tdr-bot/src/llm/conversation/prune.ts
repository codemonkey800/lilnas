import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
  RemoveMessage,
  ToolMessage,
} from '@langchain/core/messages'

/** Messages a thread keeps in its checkpoint; older turns are deleted. */
export const MAX_THREAD_MESSAGES = 200

/** True when a kept tool result answers a call made before `cut`. */
function splitsToolCall(messages: BaseMessage[], cut: number): boolean {
  const cutCallIds = new Set(
    messages
      .slice(0, cut)
      .flatMap(m => (isAIMessage(m) ? (m.tool_calls ?? []) : []))
      .map(tc => tc.id),
  )
  return messages
    .slice(cut)
    .some(m => ToolMessage.isInstance(m) && cutCallIds.has(m.tool_call_id))
}

/**
 * Removals that shrink a thread to at most `max` messages, applied through
 * the messages reducer. The kept history starts on a human message and never
 * keeps a tool result whose tool call was removed, so it may end up shorter
 * than `max`; a single turn longer than `max` is kept whole.
 */
export function pruneHistory(
  messages: BaseMessage[],
  max = MAX_THREAD_MESSAGES,
): RemoveMessage[] {
  if (messages.length <= max) return []

  let cut = -1
  for (let i = messages.length - max; i < messages.length; i++) {
    if (HumanMessage.isInstance(messages[i]) && !splitsToolCall(messages, i)) {
      cut = i
      break
    }
  }
  if (cut === -1) {
    cut = messages.findLastIndex(m => HumanMessage.isInstance(m))
  }
  if (cut <= 0) return []

  return messages
    .slice(0, cut)
    .filter((m): m is BaseMessage & { id: string } => !!m.id)
    .map(m => new RemoveMessage({ id: m.id }))
}
