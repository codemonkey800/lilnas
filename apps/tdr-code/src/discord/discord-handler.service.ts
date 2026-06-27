import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  type Message,
  type TextChannel,
} from 'discord.js'
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
import { extractImages } from 'src/discord/image-attachments'

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
  workingMessage: Message | null
  workingMessageCreating: boolean
  currentTurnId: number
}

@Injectable()
export class DiscordHandlerService
  implements AcpEventHandlers, OnApplicationShutdown
{
  private readonly channelStates = new Map<string, ChannelState>()
  // Cleared-channel guard: channelId → expiry timestamp. Blocks late ACP events
  // from resurrecting state in a just-cleared channel (see plan Decision #5).
  private readonly clearedChannels = new Map<string, number>()
  private static readonly CLEARED_GUARD_MS = 5000
  private readonly typingIntervals = new Map<string, NodeJS.Timeout>()

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
    this.startTyping(channelId)
    const state = this.getOrCreateChannelState(channelId)
    if (!state) return
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
    this.startTyping(channelId)
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
    this.startTyping(channelId)
    const state = this.getOrCreateChannelState(channelId)
    if (!state) return
    state.replyBuffer += text
    this.scheduleFlushReply(channelId, state)
  }

  onPromptStart(channelId: string, turnId: number): void {
    const state = this.getOrCreateChannelState(channelId)
    if (!state) return
    state.currentTurnId = turnId

    if (state.workingMessageCreating) return
    state.workingMessageCreating = true

    void this.sendWorkingMessage(channelId, turnId)
  }

  // C1: onPromptComplete must stay synchronous — it fires void finalizeTurn()
  // and returns. Do NOT make this async or await finalizeTurn here. The
  // executePrompt finally-drain runs synchronously after this call; introducing
  // an await would reopen the cancel-vs-drain race (plan Decision #2 / C1).
  onPromptComplete(channelId: string, stopReason: string): void {
    this.stopTyping(channelId)
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
    const workingMsg = state.workingMessage

    this.channelStates.delete(channelId)

    void this.finalizeTurn(
      channelId,
      buffer,
      replyMsg,
      toolSummaryMsg,
      workingMsg,
      stopReason,
    )
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
    const images = await extractImages(message.attachments.values())

    if (!text && images.length === 0) {
      await message.reply('Please provide a message or image.')
      return
    }

    const channelId = message.channelId
    const sessionManager = this.moduleRef.get(SessionManagerService, {
      strict: false,
    })

    if (sessionManager.isPrompting(channelId)) {
      await message.reply('⏳ Agent is working. Your message has been queued.')
    }

    this.startTyping(channelId)

    try {
      const result = await sessionManager.prompt(
        channelId,
        text,
        message.author.id,
        images,
      )
      if (result === 'no_image_support') {
        this.stopTyping(channelId)
        await message
          .reply(
            'This agent cannot read images, and no text was provided. Please include a text message.',
          )
          .catch(() => {})
      }
    } catch (err) {
      this.stopTyping(channelId)
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

  // --- OnApplicationShutdown ---

  onApplicationShutdown(): void {
    for (const channelId of Array.from(this.typingIntervals.keys())) {
      this.stopTyping(channelId)
    }
  }

  // --- Public interface for /clear (U4) ---

  resetChannel(channelId: string): void {
    const state = this.channelStates.get(channelId)
    if (state) {
      if (state.flushTimer) clearTimeout(state.flushTimer)
      // Best-effort strip the live Stop button so it becomes a visible no-op
      if (state.workingMessage) {
        void state.workingMessage
          .edit({ components: [], allowedMentions: { parse: [] } })
          .catch(() => {})
      }
      this.channelStates.delete(channelId)
    }
    // Set cleared-channel guard so late ACP events cannot resurrect state
    this.clearedChannels.set(
      channelId,
      Date.now() + DiscordHandlerService.CLEARED_GUARD_MS,
    )
  }

  // --- Private helpers ---

  private startTyping(channelId: string): void {
    if (this.typingIntervals.has(channelId)) return
    // Reserve the slot synchronously with a placeholder so concurrent calls
    // see `has(channelId) === true` and short-circuit (R5 dedupe).
    const placeholder = setTimeout(() => {}, 0)
    this.typingIntervals.set(channelId, placeholder)

    void this.fetchChannel(channelId)
      .then(channel => {
        if (!channel) {
          // fetchChannel returned null — clean up only if we still own the slot
          if (this.typingIntervals.get(channelId) === placeholder) {
            this.typingIntervals.delete(channelId)
          }
          return
        }
        // Identity check: if stop+start interleaved across the await, our
        // placeholder was replaced — don't overwrite the new call's handle.
        channel.sendTyping().catch(() => {})
        const interval = setInterval(() => {
          channel.sendTyping().catch(() => {})
        }, 8000)
        if (this.typingIntervals.get(channelId) !== placeholder) {
          // Slot was taken by another call — discard the interval we just created
          clearInterval(interval)
          return
        }
        this.typingIntervals.set(channelId, interval)
      })
      .catch(() => {
        if (this.typingIntervals.get(channelId) === placeholder) {
          this.typingIntervals.delete(channelId)
        }
      })
  }

  private stopTyping(channelId: string): void {
    const interval = this.typingIntervals.get(channelId)
    if (interval !== undefined) {
      clearInterval(interval)
      this.typingIntervals.delete(channelId)
    }
  }

  private getOrCreateChannelState(channelId: string): ChannelState | null {
    // Refuse to resurrect state for a recently-cleared channel (late ACP event guard)
    const expiry = this.clearedChannels.get(channelId)
    if (expiry !== undefined) {
      if (Date.now() < expiry) return null
      this.clearedChannels.delete(channelId)
    }

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
        workingMessage: null,
        workingMessageCreating: false,
        currentTurnId: 0,
      }
      this.channelStates.set(channelId, state)
    }
    return state
  }

  private async sendWorkingMessage(
    channelId: string,
    turnId: number,
  ): Promise<void> {
    const channel = await this.fetchChannel(channelId)
    if (!channel) {
      const s = this.channelStates.get(channelId)
      if (s) s.workingMessageCreating = false
      return
    }

    const stopButton = new ButtonBuilder()
      .setCustomId(`stop/${channelId}/${turnId}`)
      .setLabel('⏹ Stop')
      .setStyle(ButtonStyle.Danger)

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(stopButton)

    const msg = await channel
      .send({
        content: '🔄 Working…',
        components: [row],
        allowedMentions: { parse: [] },
      })
      .catch(() => null)

    // Post-send re-check: if turn already ended while send was in flight, clean up
    const currentState = this.channelStates.get(channelId)
    if (!currentState || currentState.currentTurnId !== turnId) {
      // Turn already finalized — strip the button so it doesn't linger
      if (msg) {
        void msg.edit({ components: [], allowedMentions: { parse: [] } }).catch(() => {})
      }
      return
    }

    currentState.workingMessage = msg
    currentState.workingMessageCreating = false
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
    workingMsg: Message | null,
    stopReason: string,
  ): Promise<void> {
    const noMentions = { parse: [] as const }

    if (stopReason === 'cancelled') {
      // Edit working message to "⏹ Stopped" with button removed (R6, R7)
      if (workingMsg) {
        await workingMsg
          .edit({ content: '⏹ Stopped', components: [], allowedMentions: noMentions })
          .catch(() => {})
      }
    } else if (stopReason === 'error') {
      // Edit working message to "⚠ Error" (R7) — human-readable before teardown
      if (workingMsg) {
        await workingMsg
          .edit({ content: '⚠ Error', components: [], allowedMentions: noMentions })
          .catch(() => {})
      }
    } else {
      // Normal completion — delete working message (R7)
      if (workingMsg) {
        await workingMsg.delete().catch(() => {})
      }
    }

    // Strip components from tool summary (button was on working message, not here)
    if (toolSummaryMsg) {
      await toolSummaryMsg
        .edit({ components: [], allowedMentions: noMentions })
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
