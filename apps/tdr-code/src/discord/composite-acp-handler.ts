import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type {
  AcpEventHandlers,
  DiffContent,
  PromptStartContext,
} from 'src/agent/agent.types'
import { errorCode } from 'src/agent/error-code'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { insertEvent } from 'src/db/events.repo'
import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'
import { sessionTopic } from 'src/sse/sse.types'

import { ContextUsageService } from './context-usage.service'
import { DiscordHandlerService } from './discord-handler.service'
import { NotifyEmitterService } from './notify-emitter.service'
import { SqliteWriterService } from './sqlite-writer.service'

// ──────────────────────────────────────────────────────────────────────────────
// CompositeAcpHandler — synchronous fan-out to Discord + SQLite writer (B2).
//
// Design (Decision 1):
//   - Never `async`. An async composite returns a Promise the synchronous caller
//     at executePrompt ignores, turning a child throw into an unhandledRejection.
//   - Discord-first, writer-second. Each child in its own try/catch so a writer
//     fault never breaks Discord output and a Discord fault never starves the
//     writer (Decision 2).
//   - On a writer-side catch, emit a transcript_write_failed event via events.repo
//     (Decision 2b). The event write is itself wrapped so a double-fault degrades
//     to log-only with no retry. context carries only safe identifiers — never the
//     raw SqliteError message (Decision 2b secret-scrub / F10).
//   - U3: after a writer call SUCCEEDS (i.e. inside the try, past the call, never
//     in the catch), notify `session:<id>` for the channel's DB session row —
//     this is the ACP fan-out point for every turn_content/turns INSERT and the
//     two in-place UPDATE paths (onToolCallUpdate -> updateToolCallStatus,
//     onPromptComplete -> closeTurn). The session row id isn't a per-call
//     parameter on most of these methods, so it's tracked locally in
//     channelSessionRowId, seeded from onPromptStart's PromptStartContext (the
//     one method that receives it) — mirrors SqliteWriterService's own
//     per-channel state-tracking shape one file over. onSessionInfoUpdate,
//     onResumeFailed, and onUsageUpdate are deliberately excluded: the writer
//     is a no-op for all three (see sqlite-writer.service.ts), so there is no
//     turn_content/turns change to notify about.
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CompositeAcpHandler implements AcpEventHandlers {
  private readonly generationId: number | null
  // Typed as AcpEventHandlers so TypeScript resolves method calls against the
  // interface (all params present) — the concrete classes may have fewer params.
  private readonly discord: AcpEventHandlers
  private readonly writer: AcpEventHandlers
  private readonly contextUsage: AcpEventHandlers
  // U3: channelId -> sessions.id, seeded by onPromptStart (the only method
  // that receives sessionRowId). Never cleared on session end — a stale
  // mapping surviving past teardown is harmless under snapshot-refetch
  // idempotency (Decision 2A), and the entry is naturally replaced by the
  // channel's next onPromptStart on session recreation/reactivation.
  private readonly channelSessionRowId = new Map<string, number>()

  constructor(
    discord: DiscordHandlerService,
    writer: SqliteWriterService,
    contextUsage: ContextUsageService,
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
    private readonly notifyEmitter: NotifyEmitterService,
  ) {
    this.discord = discord
    this.writer = writer
    this.contextUsage = contextUsage
    const genIdStr = process.env[EnvKeys.BOT_GENERATION_ID]
    this.generationId = genIdStr ? parseInt(genIdStr, 10) : null
  }

  // U3: fire-and-forget notify for the channel's current session row, if
  // known. No-op (nothing to notify) for a channel whose onPromptStart has
  // never run with a non-null sessionRowId (e.g. generationId is null).
  private notifySession(channelId: string): void {
    const sessionRowId = this.channelSessionRowId.get(channelId)
    if (sessionRowId == null) return
    this.notifyEmitter.notify([sessionTopic(sessionRowId)])
  }

  onToolCall(
    channelId: string,
    toolCallId: string,
    title: string,
    kind: string,
    status: string,
    diffs: DiffContent[],
    rawInput?: Record<string, unknown>,
  ): void {
    try {
      this.discord.onToolCall(
        channelId,
        toolCallId,
        title,
        kind,
        status,
        diffs,
        rawInput,
      )
    } catch (err) {
      this.logDiscordError(err, 'onToolCall', channelId)
    }
    try {
      this.writer.onToolCall(
        channelId,
        toolCallId,
        title,
        kind,
        status,
        diffs,
        rawInput,
      )
      this.notifySession(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onToolCall', channelId)
    }
  }

  onToolCallUpdate(
    channelId: string,
    toolCallId: string,
    status: string,
    diffs: DiffContent[],
    rawInput?: Record<string, unknown>,
    title?: string,
  ): void {
    try {
      this.discord.onToolCallUpdate(
        channelId,
        toolCallId,
        status,
        diffs,
        rawInput,
        title,
      )
    } catch (err) {
      this.logDiscordError(err, 'onToolCallUpdate', channelId)
    }
    try {
      this.writer.onToolCallUpdate(
        channelId,
        toolCallId,
        status,
        diffs,
        rawInput,
        title,
      )
      // R5: this is the in-place UPDATE path (updateToolCallStatus) — the
      // notify covers it just as it covers a plain INSERT, so a tool-status
      // flip pushes just as fast as new transcript content.
      this.notifySession(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onToolCallUpdate', channelId)
    }
  }

  onAgentMessageChunk(channelId: string, text: string): void {
    try {
      this.discord.onAgentMessageChunk(channelId, text)
    } catch (err) {
      this.logDiscordError(err, 'onAgentMessageChunk', channelId)
    }
    try {
      this.writer.onAgentMessageChunk(channelId, text)
      this.notifySession(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onAgentMessageChunk', channelId)
    }
  }

  onAgentMessageImage(channelId: string, data: string, mimeType: string): void {
    try {
      this.discord.onAgentMessageImage(channelId, data, mimeType)
    } catch (err) {
      this.logDiscordError(err, 'onAgentMessageImage', channelId)
    }
    try {
      this.writer.onAgentMessageImage(channelId, data, mimeType)
      this.notifySession(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onAgentMessageImage', channelId)
    }
  }

  onPromptStart(
    channelId: string,
    turnId: number,
    context: PromptStartContext,
  ): void {
    try {
      this.discord.onPromptStart(channelId, turnId, context)
    } catch (err) {
      this.logDiscordError(err, 'onPromptStart', channelId, { turnId })
    }
    try {
      this.writer.onPromptStart(channelId, turnId, context)
      // U3: seed/refresh the channel's session-row mapping from the one
      // method that carries it, BEFORE notifying, so this call's own notify
      // (and every later chokepoint for this channel) resolves the correct
      // session:<id> topic.
      if (context.sessionRowId != null) {
        this.channelSessionRowId.set(channelId, context.sessionRowId)
      }
      this.notifySession(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onPromptStart', channelId)
    }
  }

  // C1: onPromptComplete must stay synchronous — see discord-handler.service.ts.
  onPromptComplete(channelId: string, stopReason: string): void {
    try {
      this.discord.onPromptComplete(channelId, stopReason)
    } catch (err) {
      this.logDiscordError(err, 'onPromptComplete', channelId, { stopReason })
    }
    try {
      this.writer.onPromptComplete(channelId, stopReason)
      // R5: this is the in-place UPDATE path (closeTurn) — a turn closing
      // (completed/cancelled/aborted/error) is exactly the kind of change an
      // id-only cursor can't see, so the notify here is what makes it appear
      // live instead of waiting for the data_version fallback.
      this.notifySession(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onPromptComplete', channelId)
    }
  }

  onSessionInfoUpdate(channelId: string, title: string): void {
    try {
      this.discord.onSessionInfoUpdate(channelId, title)
    } catch (err) {
      this.logDiscordError(err, 'onSessionInfoUpdate', channelId, { title })
    }
    try {
      this.writer.onSessionInfoUpdate(channelId, title)
    } catch (err) {
      this.handleWriterError(err, 'onSessionInfoUpdate', channelId)
    }
  }

  onResumeFailed(channelId: string): void {
    try {
      this.discord.onResumeFailed(channelId)
    } catch (err) {
      this.logDiscordError(err, 'onResumeFailed', channelId)
    }
    try {
      this.writer.onResumeFailed(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onResumeFailed', channelId)
    }
  }

  // Per-turn GitHub application & enforcement plan — U5: fan-out for the
  // block-notice method, mirroring onResumeFailed's exact shape immediately
  // above — Discord-first (real user-visible notice), writer-second (a
  // no-op today, but fanned out unconditionally per this file's established
  // "always fan out to both regardless of what writer does with it"
  // convention, matching onSessionInfoUpdate/onResumeFailed rather than
  // special-casing "no-op" methods).
  onGitOperationBlocked(
    channelId: string,
    kind: 'ssh' | 'github',
    reason: 'unconfigured' | 'decrypt_failed',
  ): void {
    try {
      this.discord.onGitOperationBlocked(channelId, kind, reason)
    } catch (err) {
      this.logDiscordError(err, 'onGitOperationBlocked', channelId, {
        kind,
        reason,
      })
    }
    try {
      this.writer.onGitOperationBlocked(channelId, kind, reason)
    } catch (err) {
      this.handleWriterError(err, 'onGitOperationBlocked', channelId)
    }
  }

  onUsageUpdate(channelId: string, used: number, size: number): void {
    try {
      this.discord.onUsageUpdate(channelId, used, size)
    } catch (err) {
      this.logDiscordError(err, 'onUsageUpdate', channelId)
    }
    try {
      this.writer.onUsageUpdate(channelId, used, size)
    } catch (err) {
      this.handleWriterError(err, 'onUsageUpdate', channelId)
    }
    // ContextUsageService's failures are not a "transcript write failed"
    // case (it isn't a writer), so it gets its own log line rather than
    // routing through handleWriterError's transcript_write_failed event.
    try {
      this.contextUsage.onUsageUpdate(channelId, used, size)
    } catch (err) {
      this.logger.error(
        { event: LOG_EVENTS.contextUsageHandlerFault, err, channelId },
        'ContextUsage handler error in onUsageUpdate',
      )
    }
  }

  // Shared by every AcpEventHandlers method above — logs a Discord-side fan-out
  // failure without letting it break the writer/contextUsage fan-out siblings.
  private logDiscordError(
    err: unknown,
    method: string,
    channelId: string,
    extra?: Record<string, unknown>,
  ): void {
    this.logger.error(
      { event: LOG_EVENTS.discordFault, err, channelId, ...extra },
      `Discord handler error in ${method}`,
    )
  }

  // Emit a transcript_write_failed event for operator-visibility (Decision 2b).
  // context carries only safe identifiers — never the raw error message (F10).
  private handleWriterError(err: unknown, op: string, channelId: string): void {
    const code = errorCode(err)
    this.logger.error(
      { event: LOG_EVENTS.writerFault, err, op, channelId, code },
      'Writer fault',
    )

    const genId = this.generationId
    if (genId == null) return

    // Double-fault guard: if this event INSERT also fails, degrade to log-only.
    try {
      insertEvent(this.db, {
        generationId: genId,
        channelId,
        type: 'transcript_write_failed',
        level: 'error',
        context: { op, channelId, errorCode: code },
        createdAt: new Date(),
      })
    } catch (innerErr) {
      this.logger.error(
        {
          event: LOG_EVENTS.writerFaultEventInsertFailed,
          err: innerErr,
          op,
          channelId,
          code: errorCode(innerErr),
        },
        'transcript_write_failed event also failed (log-only, no retry)',
      )
    }
  }
}
