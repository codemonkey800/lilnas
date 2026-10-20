import type { ConversationMessage } from 'src/api/api.types'
import type { LlmCallRow } from 'src/db/schema'

export type TranscriptItem =
  | { kind: 'human'; message: ConversationMessage }
  | { kind: 'tool'; name: string; detail: string }
  | { kind: 'assistant'; message: ConversationMessage; calls: LlmCallRow[] }

/** LLM calls grouped by `request_id`, oldest request first. */
export function groupCallsByRequest(calls: LlmCallRow[]): LlmCallRow[][] {
  const groups = new Map<string, LlmCallRow[]>()
  for (const call of calls) {
    const key = call.requestId ?? call.id
    groups.set(key, [...(groups.get(key) ?? []), call])
  }

  const time = (c: LlmCallRow) => new Date(c.createdAt ?? 0).getTime()
  return [...groups.values()]
    .map(group => group.sort((a, b) => time(a) - time(b)))
    .sort((a, b) => time(a[0]) - time(b[0]))
}

function toolItems(message: ConversationMessage): TranscriptItem[] {
  if (message.type === 'tool') {
    return [
      {
        kind: 'tool',
        name: message.name ?? 'tool result',
        detail: message.content,
      },
    ]
  }

  return (message.toolCalls ?? []).map(call => ({
    kind: 'tool',
    name: call.name,
    detail: JSON.stringify(call.args, null, 2),
  }))
}

/**
 * Flattens the thread into bubbles and attaches each request's calls to the
 * final assistant message of a turn (human message → last reply before the
 * next human message).
 *
 * Replies carry the `requestId` of the request that produced them and are
 * joined to that request's calls. Older replies without one get no calls.
 */
export function buildTranscriptItems(
  messages: ConversationMessage[],
  calls: LlmCallRow[],
): TranscriptItem[] {
  const items: TranscriptItem[] = []
  const finalReplyIndexes: number[] = []

  for (const message of messages) {
    if (message.type === 'human') {
      items.push({ kind: 'human', message })
    } else if (message.type === 'ai') {
      items.push(...toolItems(message))
      if (message.content.trim()) {
        items.push({ kind: 'assistant', message, calls: [] })
        finalReplyIndexes.push(items.length - 1)
      }
    } else if (message.type === 'tool') {
      items.push(...toolItems(message))
    }
  }

  // Keep only the last assistant reply of each turn.
  const turnReplies = finalReplyIndexes.filter((index, i) => {
    const next = finalReplyIndexes[i + 1]
    return (
      next === undefined ||
      items.slice(index + 1, next).some(item => item.kind === 'human')
    )
  })

  const groups = new Map(
    groupCallsByRequest(calls).map(group => [group[0].requestId, group]),
  )
  for (const index of turnReplies) {
    const item = items[index]
    if (item.kind !== 'assistant' || !item.message.requestId) continue
    item.calls = groups.get(item.message.requestId) ?? []
  }

  return items
}
