import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  ActionRowBuilder,
  AttachmentBuilder,
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
  PromptStartContext,
  ToolStatus,
} from 'src/agent/agent.types'
import {
  formatDiff,
  formatToolSummary,
  splitMessage,
} from 'src/agent/message-bridge'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { extractImages, MAX_IMAGE_BYTES } from 'src/discord/image-attachments'
import { stopButtonId } from 'src/discord/stop-button-id'

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
  pendingFlush: Promise<void> | null
  workingMessage: Message | null
  workingMessageCreating: boolean
  currentTurnId: number
}

@Injectable()
export class DiscordHandlerService
  implements AcpEventHandlers, OnApplicationShutdown
{
  private readonly channelStates = new Map<string, ChannelState>()
  // Cleared-channel guard: channelId → cleared turnId watermark. Blocks late ACP
  // events from the killed turn from resurrecting state. Cleared when a new turn
  // starts via onPromptStart (see plan Decision #5).
  private readonly clearedTurnId = new Map<string, number>()
  private readonly typingIntervals = new Map<string, NodeJS.Timeout>()
  // Per-channel outbound send chain: serializes image sends (and any other tasks
  // enqueued via enqueueSend) to prevent out-of-order delivery and text-loss races.
  private readonly sendChains = new Map<string, Promise<void>>()

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

  onAgentMessageImage(channelId: string, data: string, mimeType: string): void {
    this.enqueueSend(channelId, () =>
      this.sendAgentImage(channelId, data, mimeType),
    )
  }

  // context is used by SqliteWriterService; accepted here to match the interface.
  onPromptStart(
    channelId: string,
    turnId: number,
    _context: PromptStartContext,
  ): void {
    void _context
    // A new turn starting means the old cleared session's events are moot —
    // clear the watermark so the new turn can create state.
    const clearedAt = this.clearedTurnId.get(channelId)
    if (clearedAt !== undefined && turnId > clearedAt) {
      this.clearedTurnId.delete(channelId)
    }
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

    // C1 stays satisfied: synchronous fire-and-forget. finalizeTurn handles
    // state deletion and awaits any in-flight flush before reading replyMessage.
    void this.finalizeTurn(channelId, state, stopReason)
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

    this.startTyping(channelId)

    try {
      const result = await sessionManager.prompt(
        channelId,
        text,
        message.author.id,
        images,
      )
      if (result.kind === 'queued') {
        await message
          .reply('⏳ Agent is working. Your message has been queued.')
          .catch(() => {})
      } else if (result.kind === 'no_image_support') {
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
    // Stamp watermark: block late ACP events from this turn (or 0 if no active
    // state — teardown already deleted it). Cleared on the next onPromptStart.
    this.clearedTurnId.set(channelId, state?.currentTurnId ?? 0)
    // Safety cleanup for channels that are never mentioned again
    const t = setTimeout(() => this.clearedTurnId.delete(channelId), 60_000)
    t.unref()
    // Drop the stale send-chain tail — in-flight tasks still check the guard and
    // return early, so they won't post into the cleared channel.
    this.sendChains.delete(channelId)
  }

  // --- Private helpers ---

  private startTyping(channelId: string): void {
    if (this.typingIntervals.has(channelId)) return
    // Reserve the slot synchronously with a placeholder so concurrent calls
    // see `has(channelId) === true` and short-circuit (R5 dedupe).
    const placeholder = setTimeout(() => {}, 0)
    placeholder.unref()
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
        interval.unref()
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
    // Refuse to create state while the watermark is set (late ACP event guard).
    // The watermark is cleared in onPromptStart when a new turn begins.
    if (this.clearedTurnId.has(channelId)) return null

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
        pendingFlush: null,
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
      .setCustomId(stopButtonId(channelId, turnId))
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
      // Turn already finalized — delete the orphan so "🔄 Working…" doesn't linger
      if (msg) void msg.delete().catch(() => {})
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
      state.pendingFlush = this.flushReply(channelId, false)
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
        // Slice off only the prefix we captured — any text appended to replyBuffer
        // during the awaits above is preserved for the next flush.
        currentState.replyBuffer = currentState.replyBuffer.slice(buffer.length)
      }

      const chunks = splitMessage(buffer)
      for (const chunk of chunks) {
        await channel.send(chunk).catch(() => {})
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
    state: ChannelState,
    stopReason: string,
  ): Promise<void> {
    const noMentions = { parse: [] as const }

    const buffer = state.replyBuffer
    const toolSummaryMsg = state.toolSummaryMessage
    const workingMsg = state.workingMessage

    // Remove from the active map synchronously (before any await) so late ACP
    // events can't create new state for this channel. The state object itself
    // stays alive — this function and any in-flight flushReply both hold
    // references to it, so flushReply can still write state.replyMessage even
    // after this delete.
    this.channelStates.delete(channelId)

    if (stopReason === 'cancelled') {
      // Edit working message to "⏹ Stopped" with button removed (R6, R7)
      if (workingMsg) {
        await workingMsg
          .edit({
            content: '⏹ Stopped',
            components: [],
            allowedMentions: noMentions,
          })
          .catch(() => {})
      }
    } else if (stopReason === 'error') {
      // Edit working message to "⚠ Error" (R7) — human-readable before teardown
      if (workingMsg) {
        await workingMsg
          .edit({
            content: '⚠ Error',
            components: [],
            allowedMentions: noMentions,
          })
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

    // Wait for any in-flight timer-triggered flush. The flush may be mid-send
    // (channel.send in flight when onPromptComplete fired); awaiting here ensures
    // its write to state.replyMessage completes before we read it below.
    if (state.pendingFlush) {
      await state.pendingFlush.catch(() => {})
    }

    // Delete streaming placeholder (may have just been written by the flush above)
    const replyMsg = state.replyMessage
    if (replyMsg) await replyMsg.delete().catch(() => {})

    const chunks = splitMessage(buffer)
    for (const chunk of chunks) {
      await channel.send(chunk)
    }
  }

  private enqueueSend(channelId: string, task: () => Promise<void>): void {
    const prev = this.sendChains.get(channelId) ?? Promise.resolve()
    const next = prev.then(task, task).catch(() => {})
    this.sendChains.set(channelId, next)
  }

  private async sendAgentImage(
    channelId: string,
    data: string,
    mimeType: string,
  ): Promise<void> {
    // Honor cleared-channel guard so a late image can't resurrect output (Decision #5)
    if (this.clearedTurnId.has(channelId)) return
    // Flush buffered text first so the image appears in order (R14)
    await this.flushReply(channelId, true)

    const channel = await this.fetchChannel(channelId)
    if (!channel) return

    const buf = Buffer.from(data, 'base64')
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      console.warn(
        `[discord] channel=${channelId}: dropping outbound image (${buf.byteLength} bytes > cap)`,
      )
      return
    }
    const ext = mimeType.split('/')[1] ?? 'png'
    const attachment = new AttachmentBuilder(buf, {
      name: `image.${ext}`,
    })
    await channel.send({ files: [attachment] }).catch(() => {})
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
