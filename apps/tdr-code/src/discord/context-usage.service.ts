import { Inject, Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { AttachmentBuilder, ChannelType, Client } from 'discord.js'
import { PinoLogger } from 'nestjs-pino'

import type { AcpEventHandlers } from 'src/agent/agent.types'
import { SessionManagerService } from 'src/agent/session-manager.service'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import type { AgentTextPayload } from 'src/db/schema'
import { narrowTurnContentPayload } from 'src/db/schema'
import {
  clearAcpSessionId,
  getLatestSessionForChannel,
} from 'src/db/sessions.repo'
import { blocksByTurn } from 'src/db/turn-content.repo'
import { listTurnsBySession } from 'src/db/turns.repo'
import {
  buildThreadName,
  THREAD_AUTO_ARCHIVE_MINUTES,
} from 'src/discord/discord-handler.service'
import { fetchChannel } from 'src/discord/fetch-channel'

// Ascending — onUsageUpdate relies on this order to find the *highest*
// newly-crossed threshold (so a 0%→96% jump in one update notifies 95% only,
// not all four in sequence).
const THRESHOLDS = [25, 50, 75, 95] as const
type Threshold = (typeof THRESHOLDS)[number]
const HANDOFF_THRESHOLD: Threshold = 95

// Exported so tests can advance fake timers by the exact tunable values
// rather than duplicating magic numbers.
export const HANDOFF_POLL_INTERVAL_MS = 1_000
export const HANDOFF_POLL_TIMEOUT_MS = 90_000

const HANDOFF_SUMMARY_PROMPT = `We're at ${HANDOFF_THRESHOLD}%+ of this session's context window. Before we continue in a fresh session, write a concise handoff summary in Markdown covering:
1. The original goal/task
2. Key decisions made and why
3. Current state — what's done and verified
4. Remaining next steps
5. Any critical file paths, commands, or context needed to pick this up cold

Write ONLY the summary — do not use any tools, do not read files, do not make edits. This will seed a brand new session with no memory of this conversation, so keep it self-contained.`

function buildSeedPrompt(summary: string): string {
  return `Continuing from a previous session that reached its context limit. Here is the handoff summary:\n\n---\n\n${summary}\n\n---\n\nPlease continue the work from here.`
}

interface ContextUsageState {
  notifiedThreshold: 0 | Threshold
  handoffInFlight: boolean
}

interface ContinuationTarget {
  newChannelId: string
  newThreadMention: string
  inline: boolean
}

// ──────────────────────────────────────────────────────────────────────────────
// ContextUsageService — owns all context-window-usage behavior: the 25/50/75%
// Discord notices and the 95% auto-handoff (summarize + continue in a new
// thread). Every other AcpEventHandlers method is a genuine no-op; this
// service exists solely to react to `usage_update`.
//
// Reaches SessionManagerService via moduleRef.get(..., {strict:false}) rather
// than constructor injection for the same reason DiscordHandlerService does:
// this service is a CompositeAcpHandler fan-out child, and
// SessionManagerService depends (transitively, via ACP_EVENT_HANDLERS) on
// CompositeAcpHandler — constructor-injecting it here would be circular.
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class ContextUsageService implements AcpEventHandlers {
  private readonly channelState = new Map<string, ContextUsageState>()

  constructor(
    @Inject(Client) private readonly client: Client,
    private readonly moduleRef: ModuleRef,
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  // --- AcpEventHandlers implementation ---

  // Must stay synchronous (C1 discipline, same as every other
  // AcpEventHandlers method in this codebase) — the real work below is all
  // fire-and-forget.
  onUsageUpdate(channelId: string, used: number, size: number): void {
    if (size <= 0) return
    const pct = (used / size) * 100

    const state = this.channelState.get(channelId) ?? {
      notifiedThreshold: 0,
      handoffInFlight: false,
    }
    this.channelState.set(channelId, state)

    if (state.handoffInFlight) return

    let crossed: Threshold | undefined
    for (const t of THRESHOLDS) {
      if (t <= pct && t > state.notifiedThreshold) crossed = t
    }
    if (crossed === undefined) return

    // Commit the dedupe state synchronously, before any await, so a rapid
    // double-fire of usage_update can't double-notify.
    state.notifiedThreshold = crossed

    if (crossed === HANDOFF_THRESHOLD) {
      state.handoffInFlight = true
      this.logger.info(
        { channelId, used, size },
        'Context handoff triggered (95% threshold crossed)',
      )
      void this.runHandoff(channelId).catch(err => {
        this.logger.error({ err, channelId }, 'runHandoff failed')
        const s = this.channelState.get(channelId)
        if (s) s.handoffInFlight = false
      })
    } else {
      void this.postThresholdNotice(channelId, crossed, used, size)
    }
  }

  // No-ops — context-usage notifications and the handoff are the only thing
  // this service does; it has no reason to react to any other ACP event.
  onToolCall(): void {}
  onToolCallUpdate(): void {}
  onAgentMessageChunk(): void {}
  onAgentMessageImage(): void {}
  onPromptStart(): void {}
  onPromptComplete(): void {}
  onSessionInfoUpdate(): void {}
  onResumeFailed(): void {}

  // Clears this channel's threshold-dedupe state. Called by ClearCommandService
  // on /clear (a forced-fresh session must not inherit a stale
  // notifiedThreshold) and by this service's own handoff once it tears down
  // the OLD channel id (the continuation id, if different, starts fresh on
  // its own on first usage_update).
  resetChannel(channelId: string): void {
    this.channelState.delete(channelId)
  }

  // --- Handoff flow ---

  private async postThresholdNotice(
    channelId: string,
    threshold: Threshold,
    used: number,
    size: number,
  ): Promise<void> {
    const pct = Math.floor((used / size) * 100)
    await this.notify(
      channelId,
      `📊 Context usage at ${threshold}% (${used.toLocaleString()}/${size.toLocaleString()} tokens, ~${pct}%).`,
    )
  }

  private async runHandoff(channelId: string): Promise<void> {
    await this.notify(
      channelId,
      `🚨 Context usage at ${HANDOFF_THRESHOLD}%+ — generating a handoff summary and starting a fresh thread…`,
    )

    const latestRow = getLatestSessionForChannel(this.db, channelId)
    const triggeringUserId = latestRow?.triggeringUserId
    if (!triggeringUserId) {
      await this.abortHandoff(
        channelId,
        "⚠️ Couldn't find this channel's session record — leaving this thread as-is.",
      )
      return
    }

    const sessionManager = this.getSessionManager()
    const outcome = await sessionManager.prompt(
      channelId,
      HANDOFF_SUMMARY_PROMPT,
      triggeringUserId,
    )

    if (outcome.kind === 'queued') {
      // Expected/common outcome: usage_update for a turn arrives before that
      // turn's connection.prompt() promise resolves (verified against the
      // actual claude-agent-acp wrapper), so session.prompting is still true
      // here — this prompt call was queued behind the in-flight turn (and any
      // messages the user had already queued themselves). Wait for it to
      // actually run and drain rather than assuming it did.
      const settled = await this.waitUntilIdle(sessionManager, channelId)
      if (!settled) {
        await this.abortHandoff(
          channelId,
          '⚠️ Handoff summary is taking too long — leaving this thread as-is for now; context usage remains high.',
        )
        return
      }
    } else if (
      outcome.kind === 'shutting_down' ||
      outcome.kind === 'no_image_support'
    ) {
      await this.abortHandoff(
        channelId,
        "⚠️ Couldn't generate a handoff summary right now — leaving this thread as-is.",
      )
      return
    }
    // 'completed' falls straight through to the read-back below.

    const summary = this.readBackSummary(channelId)
    if (!summary || summary.trim().length === 0) {
      // Covers both a cancelled synthetic turn (user hit Stop — Stop has no
      // concept of "this turn is special") and a degenerate empty response.
      // Do NOT teardown the old session in this path — the whole point of
      // aborting is leaving the still-functional session usable.
      await this.abortHandoff(
        channelId,
        '⚠️ Handoff summary came back empty — leaving this thread as-is; context usage remains high.',
      )
      return
    }

    const oldChannel = await fetchChannel(this.client, channelId)
    const target = await this.resolveContinuationTarget(oldChannel, channelId)

    // Teardown the OLD session before starting the new one: avoids
    // evictIfNeeded() collateral-damaging an unrelated channel under a low
    // maxConcurrentSessions, and avoids any race between severing the resume
    // link (below) and the new session's first prompt. 'teardown', not
    // 'evicted' — this is a deliberate feature-driven close, not
    // idle-timeout/max-concurrent-sessions eviction.
    sessionManager.teardown(channelId, 'teardown', {
      reason: 'context_limit',
    })
    sessionManager.cancelPending(channelId)

    if (target.inline) {
      // Load-bearing: without this, the next prompt on this same channel id
      // would find the just-closed row's acpSessionId still set and try to
      // REACTIVATE via ACP loadSession, replaying the entire prior (huge)
      // transcript straight back in — completely defeating the point of the
      // handoff. Mirrors exactly what /clear does for the same reason.
      clearAcpSessionId(this.db, channelId)
    }

    const doc = this.buildSummaryDoc(channelId, summary)

    if (target.inline) {
      await this.notify(
        channelId,
        '📄 Context limit reached — continuing in this thread with a fresh session (previous conversation summarized below).',
        [doc],
      )
    } else {
      await this.notify(
        channelId,
        `📄 Context limit reached — conversation summary attached. Continuing in ${target.newThreadMention}.`,
        [doc],
      )
      await this.notify(
        target.newChannelId,
        '📄 Continuing from a prior conversation that hit its context limit. Handoff summary attached.',
        [doc],
      )
    }

    // The NEW/continued id starts fresh on its own first usage_update; only
    // the OLD id's stale state needs clearing (matters even in the inline
    // case, where old === new — that's exactly the id that must reset).
    this.resetChannel(channelId)

    // Fire-and-forget: this function's job is done once the seed turn is
    // dispatched. A hung/errored seed turn shouldn't leave anything
    // permanently marked in-flight (handoffInFlight was already cleared by
    // resetChannel above).
    sessionManager
      .prompt(target.newChannelId, buildSeedPrompt(summary), triggeringUserId)
      .catch(err => {
        this.logger.error(
          { err, channelId: target.newChannelId },
          'Seed prompt failed',
        )
      })
  }

  private async abortHandoff(
    channelId: string,
    message: string,
  ): Promise<void> {
    await this.notify(channelId, message)
    const state = this.channelState.get(channelId)
    if (state) state.handoffInFlight = false
  }

  private async waitUntilIdle(
    sessionManager: SessionManagerService,
    channelId: string,
  ): Promise<boolean> {
    const deadline = Date.now() + HANDOFF_POLL_TIMEOUT_MS
    while (sessionManager.isPrompting(channelId)) {
      if (Date.now() >= deadline) return false
      await this.sleep(HANDOFF_POLL_INTERVAL_MS)
    }
    return true
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms)
      t.unref()
    })
  }

  // Reads back the exact text the agent just produced for the handoff-summary
  // turn (the most recent turn for this channel's latest session row) by
  // reusing the same persistence the ordinary transcript view relies on —
  // no new plumbing needed to "capture" a live ACP response.
  private readBackSummary(channelId: string): string | null {
    const row = getLatestSessionForChannel(this.db, channelId)
    if (!row) return null
    const turns = listTurnsBySession(this.db, row.id)
    const lastTurn = turns[turns.length - 1]
    if (!lastTurn) return null
    const blocks = blocksByTurn(this.db, lastTurn.id)
    return blocks
      .map(b => narrowTurnContentPayload(b.payload, b.kind))
      .filter((p): p is AgentTextPayload => p?.kind === 'agent_text')
      .map(p => p.text)
      .join('')
  }

  // Resolves where the conversation continues: a new sibling thread when the
  // old channel is a thread off a plain text/announcement parent (the only
  // parent types this app ever creates threads on — GuildForum/Media use a
  // different, message-required creation flow and are deliberately excluded,
  // mirroring THREADABLE_CHANNEL_TYPES in discord-handler.service.ts), else
  // inline on the same channel id. Any failure creating the thread falls back
  // to inline — never drop the migration, matching resolveSessionKey's
  // existing "never drop the user's turn" philosophy.
  private async resolveContinuationTarget(
    oldChannel: Awaited<ReturnType<typeof fetchChannel>>,
    channelId: string,
  ): Promise<ContinuationTarget> {
    if (oldChannel?.isThread()) {
      const parent = oldChannel.parent
      if (
        parent &&
        (parent.type === ChannelType.GuildText ||
          parent.type === ChannelType.GuildAnnouncement)
      ) {
        try {
          const newThread = await parent.threads.create({
            name: buildThreadName(`Continued: ${oldChannel.name}`),
            autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
            reason: 'Context handoff — continuing from a prior thread',
          })
          return {
            newChannelId: newThread.id,
            newThreadMention: `<#${newThread.id}>`,
            inline: false,
          }
        } catch (err) {
          this.logger.warn(
            { err, channelId },
            'Continuation thread creation failed, falling back to inline',
          )
        }
      }
    }
    return {
      newChannelId: channelId,
      newThreadMention: 'this thread',
      inline: true,
    }
  }

  private buildSummaryDoc(
    channelId: string,
    summary: string,
  ): AttachmentBuilder {
    const header =
      `# Handoff summary\n\n` +
      `Channel: ${channelId}\n` +
      `Generated: ${new Date().toISOString()}\n` +
      `Trigger: context usage reached ${HANDOFF_THRESHOLD}%\n\n---\n\n`
    return new AttachmentBuilder(Buffer.from(header + summary, 'utf-8'), {
      name: 'handoff-summary.md',
    })
  }

  private async notify(
    channelId: string,
    content: string,
    files: AttachmentBuilder[] = [],
  ): Promise<void> {
    const channel = await fetchChannel(this.client, channelId)
    // 'send' in channel (not isTextBased()) — mirrors the same union-
    // narrowing trick canCreateThread() already uses for 'permissionsFor' in
    // discord-handler.service.ts. isTextBased() alone still leaves
    // PartialDMChannel/PartialGroupDMChannel/StageChannel/VoiceChannel in the
    // narrowed union, none of which have .send() in discord.js's types.
    if (!channel || !('send' in channel)) return
    await channel
      .send({ content, files, allowedMentions: { parse: [] } })
      .catch(() => {})
  }

  private getSessionManager(): SessionManagerService {
    return this.moduleRef.get(SessionManagerService, { strict: false })
  }
}
