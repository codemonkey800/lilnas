import { Inject, Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Client, Events, type Message, type TextChannel } from 'discord.js'
import { Context, type ContextOf, On } from 'necord'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type {
  AcpEventHandlers,
  DiffContent,
  ToolStatus,
} from 'src/agent/agent.types'
import {
  formatDiff,
  formatToolSummary,
  splitMessage,
} from 'src/agent/message-bridge'
import { SessionManagerService } from 'src/agent/session-manager.service'

interface ChannelState {
  toolStates: Map<
    string,
    { title: string; status: ToolStatus; rawInput?: Record<string, unknown> }
  >
  toolSummaryMessage: Message | null
  toolSummaryCreating: boolean
  pendingDiffs: Map<string, DiffContent[]>
  replyBuffer: string
  replyMessage: Message | null
  flushTimer: NodeJS.Timeout | null
}

@Injectable()
export class DiscordHandlerService implements AcpEventHandlers {
  private readonly channelStates = new Map<string, ChannelState>()

  constructor(
    @Inject(Client) private readonly client: Client,
    private readonly moduleRef: ModuleRef,
  ) {}

  // --- AcpEventHandlers implementation ---

  onToolCall(
    channelId: string,
    toolCallId: string,
    title: string,
    _kind: string,
    status: string,
    diffs: DiffContent[],
    rawInput?: Record<string, unknown>,
  ): void {
    const state = this.getOrCreateChannelState(channelId)
    state.toolStates.set(toolCallId, {
      title,
      status: status as ToolStatus,
      rawInput,
    })
    this.accumulateDiffs(state, toolCallId, diffs)
    void this.updateToolSummaryMessage(channelId)
    if (status === 'completed' || status === 'failed') {
      void this.sendDiffsForTool(channelId, toolCallId, state)
    }
  }

  onToolCallUpdate(
    channelId: string,
    toolCallId: string,
    status: string,
    diffs: DiffContent[],
    rawInput?: Record<string, unknown>,
  ): void {
    const state = this.channelStates.get(channelId)
    const tool = state?.toolStates.get(toolCallId)
    if (!tool || !state) return
    tool.status = status as ToolStatus
    if (rawInput && !tool.rawInput) tool.rawInput = rawInput
    this.accumulateDiffs(state, toolCallId, diffs)
    void this.updateToolSummaryMessage(channelId)
    if (status === 'completed' || status === 'failed') {
      void this.sendDiffsForTool(channelId, toolCallId, state)
    }
  }

  onAgentMessageChunk(channelId: string, text: string): void {
    const state = this.getOrCreateChannelState(channelId)
    state.replyBuffer += text
    this.scheduleFlushReply(channelId, state)
  }

  // TODO(U2): real impl posts the working-status message + Stop button
  onPromptStart(_channelId: string, _turnId: number): void {}

  onPromptComplete(channelId: string, _stopReason: string): void {
    const state = this.channelStates.get(channelId)
    if (!state) return

    if (state.flushTimer) {
      clearTimeout(state.flushTimer)
      state.flushTimer = null
    }

    // Capture before deleting state
    const buffer = state.replyBuffer
    const replyMsg = state.replyMessage
    const toolSummaryMsg = state.toolSummaryMessage

    this.channelStates.delete(channelId)

    void this.finalizeTurn(channelId, buffer, replyMsg, toolSummaryMsg)
  }

  // --- Discord event handlers ---

  @On(Events.MessageCreate)
  async onMessage(
    @Context() [message]: ContextOf<'messageCreate'>,
  ): Promise<void> {
    if (message.author.bot) return

    const isMention = message.mentions.has(this.client.user!)
    if (!isMention) return

    const text = message.content.replace(/<@!?\d+>/g, '').trim()
    if (!text) {
      await message.reply('Please provide a message.')
      return
    }

    const channelId = message.channelId
    const sessionManager = this.moduleRef.get(SessionManagerService, {
      strict: false,
    })

    if (sessionManager.isPrompting(channelId)) {
      await message.reply('⏳ Agent is working. Your message has been queued.')
    }

    try {
      await sessionManager.prompt(channelId, text, message.author.id)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('sessions are busy')) {
        await message
          .reply(
            '⏳ All agent sessions are busy. Please wait for the current task to finish.',
          )
          .catch(() => {})
      } else {
        await message
          .reply('An error occurred while processing your request.')
          .catch(() => {})
      }
    }
  }

  // --- Private helpers ---

  private getOrCreateChannelState(channelId: string): ChannelState {
    let state = this.channelStates.get(channelId)
    if (!state) {
      state = {
        toolStates: new Map(),
        toolSummaryMessage: null,
        toolSummaryCreating: false,
        pendingDiffs: new Map(),
        replyBuffer: '',
        replyMessage: null,
        flushTimer: null,
      }
      this.channelStates.set(channelId, state)
    }
    return state
  }

  private accumulateDiffs(
    state: ChannelState,
    toolCallId: string,
    diffs: DiffContent[],
  ): void {
    if (diffs.length === 0) return
    const existing = state.pendingDiffs.get(toolCallId) ?? []
    state.pendingDiffs.set(toolCallId, existing.concat(diffs))
  }

  private async updateToolSummaryMessage(channelId: string): Promise<void> {
    const state = this.channelStates.get(channelId)
    if (!state) return

    const content = formatToolSummary(state.toolStates)

    const existingMsg = state.toolSummaryMessage
    if (!existingMsg) {
      if (state.toolSummaryCreating) return
      state.toolSummaryCreating = true
    }

    const channel = await this.fetchChannel(channelId)
    if (!channel) {
      if (state) state.toolSummaryCreating = false
      return
    }

    const noMentions = { parse: [] as const }
    const toEdit = existingMsg ?? state.toolSummaryMessage
    if (toEdit) {
      await toEdit
        .edit({ content, allowedMentions: noMentions })
        .catch(() => {})
    } else {
      const currentState = this.channelStates.get(channelId)
      if (currentState) {
        const msg = await channel.send({
          content,
          allowedMentions: noMentions,
        })
        currentState.toolSummaryMessage = msg
        currentState.toolSummaryCreating = false
      }
    }
  }

  private async sendDiffsForTool(
    channelId: string,
    toolCallId: string,
    state: ChannelState,
  ): Promise<void> {
    const diffs = state.pendingDiffs.get(toolCallId)
    if (!diffs || diffs.length === 0) return

    const channel = await this.fetchChannel(channelId)
    if (!channel) return

    const messages = formatDiff(diffs)
    for (const msg of messages) {
      await channel.send({
        content: msg,
        allowedMentions: { parse: [] },
      })
    }

    state.pendingDiffs.delete(toolCallId)
  }

  private scheduleFlushReply(channelId: string, state: ChannelState): void {
    if (state.flushTimer) return
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null
      void this.flushReply(channelId, false)
    }, 500)
  }

  private async flushReply(channelId: string, final: boolean): Promise<void> {
    const state = this.channelStates.get(channelId)
    if (!state) return

    if (state.flushTimer) {
      clearTimeout(state.flushTimer)
      state.flushTimer = null
    }

    const buffer = state.replyBuffer
    if (!buffer) return

    const channel = await this.fetchChannel(channelId)
    if (!channel) return

    if (final) {
      const existing = state.replyMessage
      if (existing) await existing.delete().catch(() => {})

      const currentState = this.channelStates.get(channelId)
      if (currentState) {
        currentState.replyMessage = null
        currentState.replyBuffer = ''
      }

      const chunks = splitMessage(buffer)
      for (const chunk of chunks) {
        await channel.send(chunk)
      }
    } else {
      const truncated =
        buffer.length > 2000
          ? buffer.slice(buffer.length - 1900) + '...'
          : buffer
      const existing = state.replyMessage
      if (existing) {
        await existing.edit(truncated).catch(() => {})
      } else {
        const currentState = this.channelStates.get(channelId)
        if (currentState) {
          const msg = await channel.send(truncated)
          currentState.replyMessage = msg
        }
      }
    }
  }

  private async finalizeTurn(
    channelId: string,
    buffer: string,
    replyMsg: Message | null,
    toolSummaryMsg: Message | null,
  ): Promise<void> {
    // Remove components from tool summary (no stop button in this impl)
    if (toolSummaryMsg) {
      await toolSummaryMsg
        .edit({ components: [], allowedMentions: { parse: [] } })
        .catch(() => {})
    }

    if (!buffer) return

    const channel = await this.fetchChannel(channelId)
    if (!channel) return

    // Delete streaming placeholder and send final message(s)
    if (replyMsg) await replyMsg.delete().catch(() => {})

    const chunks = splitMessage(buffer)
    for (const chunk of chunks) {
      await channel.send(chunk)
    }
  }

  private async fetchChannel(channelId: string): Promise<TextChannel | null> {
    const cached = this.client.channels.cache.get(channelId) as
      | TextChannel
      | undefined
    if (cached) return cached
    try {
      const fetched = await this.client.channels.fetch(channelId)
      return fetched as TextChannel
    } catch {
      return null
    }
  }
}

// Re-export token so DiscordModule can reference it
export { ACP_EVENT_HANDLERS }
