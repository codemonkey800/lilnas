import type {
  Client,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'
import { Logger } from '@nestjs/common'

import type { AcpEventHandlers, DiffContent } from './agent.types'

// Non-DI: this module exports a plain factory, not a Nest-managed provider.
// `Logger` from '@nestjs/common' is globally overridden to route through the
// same pino sink once bootstrap.ts/bot-bootstrap.ts call
// `app.useLogger(app.get(Logger))` — see src/logger.ts's header comment.
// Unlike the DI-injected PinoLogger elsewhere, this Logger's methods take a
// single message (string | object | Error) plus a context string appended
// automatically — passing a plain fields object as the message does NOT
// merge into flat top-level JSON fields the way PinoLogger's object-first
// calls do, so messages here are one interpolated string, not {fields, msg}.
const logger = new Logger('AcpClient')

export function createAcpClient(
  channelId: string,
  handlers: AcpEventHandlers,
  isReplaying?: () => boolean,
): Client {
  return {
    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      const firstOption = params.options[0]
      if (firstOption) {
        logger.debug(
          `Permission request auto-resolved channel=${channelId} optionId=${firstOption.optionId} outcome=selected`,
        )
        return {
          outcome: { outcome: 'selected', optionId: firstOption.optionId },
        }
      }
      logger.debug(
        `Permission request auto-resolved channel=${channelId} outcome=cancelled`,
      )
      return { outcome: { outcome: 'cancelled' } }
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      // C1/R10: synchronous suppression gate — reads live holder state on every
      // call (no value captured once at construction time). Must sit above the
      // switch so it uniformly suppresses every session/update variant,
      // including session_info_update, during loadSession replay (U4).
      if (isReplaying?.()) return

      logger.debug(
        `ACP session update received channel=${channelId} sessionUpdate=${params.update.sessionUpdate}`,
      )

      const update = params.update
      switch (update.sessionUpdate) {
        case 'agent_message_chunk': {
          if (update.content.type === 'text') {
            handlers.onAgentMessageChunk(channelId, update.content.text)
          } else if (update.content.type === 'image') {
            handlers.onAgentMessageImage(
              channelId,
              update.content.data,
              update.content.mimeType,
            )
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
            update.title || undefined,
          )
          break
        }
        case 'session_info_update': {
          // title is string | null | undefined per the ACP SDK; only forward a
          // real, non-empty title — there's nothing useful to report otherwise.
          if (update.title) {
            handlers.onSessionInfoUpdate(channelId, update.title)
          }
          break
        }
        case 'usage_update': {
          handlers.onUsageUpdate(channelId, update.used, update.size)
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
