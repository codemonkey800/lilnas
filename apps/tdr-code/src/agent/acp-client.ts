import type {
  Client,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'

import type { AcpEventHandlers, DiffContent } from './agent.types'

export function createAcpClient(
  channelId: string,
  handlers: AcpEventHandlers,
): Client {
  return {
    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      const firstOption = params.options[0]
      if (firstOption) {
        return {
          outcome: { outcome: 'selected', optionId: firstOption.optionId },
        }
      }
      return { outcome: { outcome: 'cancelled' } }
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      const update = params.update
      switch (update.sessionUpdate) {
        case 'agent_message_chunk': {
          if (update.content.type === 'text') {
            handlers.onAgentMessageChunk(channelId, update.content.text)
          }
          break
        }
        case 'tool_call': {
          const toolCallDiffs = extractDiffs(update.content)
          const rawVal = (update as Record<string, unknown>).rawInput
          const rawInput =
            typeof rawVal === 'object' &&
            rawVal !== null &&
            !Array.isArray(rawVal)
              ? (rawVal as Record<string, unknown>)
              : undefined
          handlers.onToolCall(
            channelId,
            update.toolCallId,
            update.title ?? 'Unknown',
            update.kind ?? 'other',
            update.status ?? 'pending',
            toolCallDiffs,
            rawInput,
          )
          break
        }
        case 'tool_call_update': {
          const updateDiffs = extractDiffs(update.content)
          const updateRawVal = (update as Record<string, unknown>).rawInput
          const updateRawInput =
            typeof updateRawVal === 'object' &&
            updateRawVal !== null &&
            !Array.isArray(updateRawVal)
              ? (updateRawVal as Record<string, unknown>)
              : undefined
          handlers.onToolCallUpdate(
            channelId,
            update.toolCallId,
            update.status ?? 'in_progress',
            updateDiffs,
            updateRawInput,
          )
          break
        }
      }
    },
  }
}

function extractDiffs(content: unknown): DiffContent[] {
  if (!Array.isArray(content)) return []
  const diffs: DiffContent[] = []
  for (const item of content) {
    if (
      item &&
      typeof item === 'object' &&
      'type' in item &&
      item.type === 'diff'
    ) {
      const { path, oldText, newText } = item as Record<string, unknown>
      if (typeof path !== 'string' || typeof newText !== 'string') continue
      if (
        oldText !== undefined &&
        oldText !== null &&
        typeof oldText !== 'string'
      )
        continue
      diffs.push({ path, oldText: (oldText as string | null) ?? null, newText })
    }
  }
  return diffs
}
