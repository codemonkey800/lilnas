import type {
  Client,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk'

import { getBackendLogger } from 'src/logging/backend-logger'

import type { AcpEventHandlers, DiffContent } from './agent.types'

// The ExitPlanMode gate surfaces as a requestPermission() call whose
// toolCall.kind === 'switch_mode' — see session-manager.service.ts's
// handlePlanApprovalNeeded for what this callback actually does (hold the
// request open, present it in Discord, resolve on a button click or a
// later reactivation). planText is whatever was captured off the preceding
// tool_call/tool_call_update's switch_mode content block, kept local to this
// factory call's closure — see lastPlanText below for why.
export type PlanApprovalCallback = (args: {
  channelId: string
  toolCallId: string
  planText: string
  options: PermissionOption[]
}) => Promise<RequestPermissionResponse>

// Non-DI: this module exports a plain factory, not a Nest-managed provider.
// Uses getBackendLogger() (src/logging/backend-logger.ts) — a real
// object-first pino API, fetched AT LOG TIME (never cached at import time;
// see that file's header comment for why that's load-bearing). This
// supersedes the file's previous rationale for using @nestjs/common's
// interpolated-string Logger: that Logger's methods take a single message
// (string | object | Error) plus an auto-appended context string, so a
// plain fields object passed as the message did NOT merge into flat
// top-level JSON fields the way PinoLogger's object-first calls do.
// getBackendLogger() has no such limitation — every call below is
// `logger.debug({ ...fields }, 'message')`, real structured fields. All
// three call sites here are `debug` (dev-only tracing), which is exempt
// from carrying a registered `event` slug (R3).

export function createAcpClient(
  channelId: string,
  handlers: AcpEventHandlers,
  isReplaying?: () => boolean,
  onPlanApprovalNeeded?: PlanApprovalCallback,
): Client {
  // Plan text for the current/most-recent switch_mode tool call, captured
  // off the tool_call(_update) content block that precedes the
  // requestPermission gate by one event on the same ndjson stream. Kept
  // local to this factory call (one per channel-session) rather than
  // threaded through a separate handler round-trip — avoids a race against
  // Discord's own send latency (see plan discussion: the gate fires
  // moments after the tool_call notification, well before a human could
  // physically click anything).
  let lastPlanText = ''

  return {
    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      if (params.toolCall.kind === 'switch_mode' && onPlanApprovalNeeded) {
        return onPlanApprovalNeeded({
          channelId,
          toolCallId: params.toolCall.toolCallId,
          planText: lastPlanText,
          options: params.options,
        })
      }

      const firstOption = params.options[0]
      if (firstOption) {
        getBackendLogger().debug(
          { channelId, optionId: firstOption.optionId, outcome: 'selected' },
          'Permission request auto-resolved',
        )
        return {
          outcome: { outcome: 'selected', optionId: firstOption.optionId },
        }
      }
      getBackendLogger().debug(
        { channelId, outcome: 'cancelled' },
        'Permission request auto-resolved',
      )
      return { outcome: { outcome: 'cancelled' } }
    },

    async sessionUpdate(params: SessionNotification): Promise<void> {
      // C1/R10: synchronous suppression gate — reads live holder state on every
      // call (no value captured once at construction time). Must sit above the
      // switch so it uniformly suppresses every session/update variant,
      // including session_info_update, during loadSession replay (U4).
      if (isReplaying?.()) return

      getBackendLogger().debug(
        { channelId, sessionUpdate: params.update.sessionUpdate },
        'ACP session update received',
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
          let planText: string | undefined
          if (update.kind === 'switch_mode') {
            const extracted = extractPlanText(update.content)
            if (extracted) {
              lastPlanText = extracted
              planText = extracted
            }
          }
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
            planText,
          )
          break
        }
        case 'tool_call_update': {
          let planText: string | undefined
          if (update.kind === 'switch_mode') {
            const extracted = extractPlanText(update.content)
            if (extracted) {
              lastPlanText = extracted
              planText = extracted
            }
          }
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
            planText,
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

// Sibling to extractDiffs, pulling `type: 'content'` text blocks instead of
// `type: 'diff'` — this is where the ExitPlanMode tool call's plan markdown
// lives (see claude-agent-acp's ExitPlanMode tool metadata: `content: [{
// type: 'content', content: { type: 'text', text: planInput.plan } }]`).
// Only meaningful for a switch_mode tool_call/tool_call_update — callers
// gate on that before calling this. Concatenates every text block found
// (in practice there is exactly one) so a shape change on the wrapper's end
// degrades gracefully instead of silently dropping content.
function extractPlanText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (
      item &&
      typeof item === 'object' &&
      'type' in item &&
      item.type === 'content' &&
      'content' in item &&
      item.content &&
      typeof item.content === 'object' &&
      'type' in item.content &&
      item.content.type === 'text' &&
      'text' in item.content &&
      typeof item.content.text === 'string'
    ) {
      parts.push(item.content.text)
    }
  }
  return parts.join('\n\n')
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
