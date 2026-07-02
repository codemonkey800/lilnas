import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Channel,
  ChannelType,
  Client,
  Events,
  type Message,
  PermissionFlagsBits,
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

// Discord's hard limit on thread names is 100 chars; seed shorter to leave
// headroom for the eventual title-based rename (U6).
const THREAD_NAME_MAX_LENGTH = 90
const FALLBACK_THREAD_NAME = 'New session'
// 24 hours — chosen default autoArchiveDuration (in minutes) for created
// threads (plan Decision, U2).
const THREAD_AUTO_ARCHIVE_MINUTES = 1440
// Discord documents ~2 thread renames per 10 minutes, per thread. Throttling
// to one rename per 5 minutes keeps us comfortably under that limit even
// with imprecise timing (U6, R12).
const THREAD_RENAME_THROTTLE_MS = 5 * 60 * 1000
// A rate-limited ThreadChannel.setName() can silently hang forever (never
// resolve or reject) — race it against this timeout so our bookkeeping
// always proceeds promptly regardless of Discord's behavior (U6).
const THREAD_RENAME_TIMEOUT_MS = 10_000
// Guild channel types that support message.startThread(); GuildForum uses a
// separate thread-creation flow and isn't posted to directly, so it's
// intentionally excluded (treated as non-threadable → inline fallback).
const THREADABLE_CHANNEL_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
])

// Truncate `text` to at most `maxLength` chars, preferring to break at a
// word boundary and appending an ellipsis when truncated. Used to seed a
// Discord thread name from the (already mention-stripped) prompt text.
function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const budget = maxLength - 1 // reserve room for the ellipsis char
  const slice = text.slice(0, budget)
  const lastSpace = slice.lastIndexOf(' ')
  const base = lastSpace > budget * 0.5 ? slice.slice(0, lastSpace) : slice
  return base.trimEnd() + '…'
}

function buildThreadName(strippedText: string): string {
  const truncated = truncateAtWordBoundary(strippedText, THREAD_NAME_MAX_LENGTH)
  return truncated.length > 0 ? truncated : FALLBACK_THREAD_NAME
}

// Per-channel thread-rename tracking (U6): the last title we applied (for
// dedupe), when we last attempted a rename (for throttling), and whether
// we've ever attempted one (the first rename is exempt from the throttle).
interface ThreadRenameState {
  lastAppliedTitle: string
  lastRenameAt: number
  hasRenamedOnce: boolean
}

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
  // Per-channel thread-rename dedupe/throttle state (U6). See ThreadRenameState.
  private readonly threadRenameStates = new Map<string, ThreadRenameState>()

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

  // Renames the channel's Discord thread to the agent-reported session title
  // (U6, R12). Callers (the ACP dispatcher, via CompositeAcpHandler) always
  // pass a real, non-empty title — see agent.types.ts. Stays synchronous per
  // the C1 discipline every handler here follows; the actual fetch+rename is
  // fire-and-forget and must never block or wedge turn processing even if
  // Discord silently hangs the rename (rate-limit failure mode).
  onSessionInfoUpdate(channelId: string, title: string): void {
    void this.renameThread(channelId, title)
  }

  // U5: fired by SessionManagerService.reactivateSession on a genuine
  // reactivation failure (capability absent or loadSession rejects) — NOT
  // fired for the expected /clear-mid-replay case, which stays silent. Posts
  // a fixed, channel-visible one-line notice before the fresh turn's output
  // arrives. Kept synchronous per the C1 discipline every other handler
  // method here follows — the actual fetch+send is fire-and-forget.
  onResumeFailed(channelId: string): void {
    // Honor the cleared-channel guard (same as sendAgentImage): a
    // late-arriving genuine-failure notice for a channel that has ALSO just
    // been /clear'd in the interim shouldn't post into a now-reset channel.
    if (this.clearedTurnId.has(channelId)) return
    void this.fetchChannel(channelId).then(channel => {
      if (!channel) return
      return channel
        .send({
          content:
            "⚠️ Couldn't restore the earlier conversation — starting fresh.",
          allowedMentions: { parse: [] },
        })
        .catch(() => {})
    })
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

    const key = await this.resolveSessionKey(message, text)
    const sessionManager = this.moduleRef.get(SessionManagerService, {
      strict: false,
    })

    this.startTyping(key)

    try {
      const result = await sessionManager.prompt(
        key,
        text,
        message.author.id,
        images,
      )
      if (result.kind === 'queued') {
        await message
          .reply('⏳ Agent is working. Your message has been queued.')
          .catch(() => {})
      } else if (result.kind === 'no_image_support') {
        this.stopTyping(key)
        await message
          .reply(
            'This agent cannot read images, and no text was provided. Please include a text message.',
          )
          .catch(() => {})
      }
    } catch (err) {
      this.stopTyping(key)
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

  // --- Thread-aware routing (U2) ---

  // Resolves the session key for an incoming mention: continue an existing
  // thread, stay inline in a DM, create a new thread for a top-level mention
  // in a threadable channel, or fall back to inline for anything else
  // (non-threadable channel, missing perms, or a startThread failure). The
  // caller's turn is never dropped — every branch resolves to a usable key.
  private async resolveSessionKey(
    message: Message,
    strippedText: string,
  ): Promise<string> {
    const channel = message.channel

    if (channel.isThread()) {
      // R3: continue the existing thread's session.
      return channel.id
    }

    if (channel.isDMBased()) {
      // R4: DMs don't support threads — run inline keyed by the DM channel.
      return message.channelId
    }

    if (this.canCreateThread(message)) {
      try {
        const thread = await message.startThread({
          name: buildThreadName(strippedText),
          autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
        })
        return thread.id
      } catch {
        // Resilience: never drop the user's turn because thread creation
        // failed — fall through to the inline fallback below.
      }
    }

    // Non-threadable channel type, missing perms, or a failed startThread.
    return message.channelId
  }

  // Whether this message's channel is a type that supports startThread() and
  // the bot has the permissions required to create + post in a public thread.
  private canCreateThread(message: Message): boolean {
    const channel = message.channel
    if (!THREADABLE_CHANNEL_TYPES.has(channel.type)) return false

    const me = message.guild?.members.me
    if (!me || !('permissionsFor' in channel)) return false

    const perms = channel.permissionsFor(me)
    if (!perms) return false

    return (
      perms.has(PermissionFlagsBits.CreatePublicThreads) &&
      perms.has(PermissionFlagsBits.SendMessagesInThreads)
    )
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

  // Fetches the channel, confirms it's an actual thread (a title update for
  // an inline/DM session is a no-op), and applies dedupe + throttle before
  // issuing a fire-and-forget, timeout-guarded rename (U6, R12).
  //
  // fetchChannel() is typed as TextChannel for its other (majority) callers,
  // but TextChannel and ThreadChannel are unrelated sibling classes in
  // discord.js, so TextChannel['isThread'] statically narrows to `never` —
  // it can never actually be a thread per the type system, even though at
  // runtime the cache/fetch can return one. Re-view the result as the real
  // discord.js Channel union (which does include thread channel types) so
  // isThread() narrows to an actual renameable ThreadChannel.
  private async renameThread(channelId: string, title: string): Promise<void> {
    const fetched = await this.fetchChannel(channelId)
    const channel = fetched as unknown as Channel | null
    if (!channel || !channel.isThread()) return

    const state = this.threadRenameStates.get(channelId) ?? {
      lastAppliedTitle: '',
      lastRenameAt: 0,
      hasRenamedOnce: false,
    }

    if (title === state.lastAppliedTitle) return

    const now = Date.now()
    const isFirstRename = !state.hasRenamedOnce
    if (
      !isFirstRename &&
      now - state.lastRenameAt < THREAD_RENAME_THROTTLE_MS
    ) {
      // Within the throttle window and not the exempt first rename — drop
      // this title change. Accepted UX lag: the thread keeps its earlier
      // name until the next allowed slot (plan Decision, U6).
      return
    }

    // Update bookkeeping before the rename settles — we're not waiting on
    // confirmation anyway (fire-and-forget), and a hung/rate-limited
    // setName() must not block bookkeeping for the *next* rename attempt.
    state.lastAppliedTitle = title
    state.lastRenameAt = now
    state.hasRenamedOnce = true
    this.threadRenameStates.set(channelId, state)

    // Race against a timeout so a silently-hung setName() (Discord's
    // documented rate-limit failure mode) can never leak — and swallow
    // genuine rejections (e.g. missing Manage Threads permission).
    void Promise.race([
      channel.setName(title),
      this.timeoutPromise(THREAD_RENAME_TIMEOUT_MS),
    ]).catch(() => {})
  }

  private timeoutPromise(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms)
      t.unref()
    })
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
