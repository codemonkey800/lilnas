import { Inject, Injectable } from '@nestjs/common'

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

import { ContextUsageService } from './context-usage.service'
import { DiscordHandlerService } from './discord-handler.service'
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
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CompositeAcpHandler implements AcpEventHandlers {
  private readonly generationId: number | null
  // Typed as AcpEventHandlers so TypeScript resolves method calls against the
  // interface (all params present) — the concrete classes may have fewer params.
  private readonly discord: AcpEventHandlers
  private readonly writer: AcpEventHandlers
  private readonly contextUsage: AcpEventHandlers

  constructor(
    discord: DiscordHandlerService,
    writer: SqliteWriterService,
    contextUsage: ContextUsageService,
    @Inject(DB) private readonly db: Db,
  ) {
    this.discord = discord
    this.writer = writer
    this.contextUsage = contextUsage
    const genIdStr = process.env[EnvKeys.BOT_GENERATION_ID]
    this.generationId = genIdStr ? parseInt(genIdStr, 10) : null
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
      console.error(
        '[composite] Discord handler error in onToolCall:',
        err instanceof Error ? err.message : String(err),
      )
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
  ): void {
    try {
      this.discord.onToolCallUpdate(
        channelId,
        toolCallId,
        status,
        diffs,
        rawInput,
      )
    } catch (err) {
      console.error(
        '[composite] Discord handler error in onToolCallUpdate:',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      this.writer.onToolCallUpdate(
        channelId,
        toolCallId,
        status,
        diffs,
        rawInput,
      )
    } catch (err) {
      this.handleWriterError(err, 'onToolCallUpdate', channelId)
    }
  }

  onAgentMessageChunk(channelId: string, text: string): void {
    try {
      this.discord.onAgentMessageChunk(channelId, text)
    } catch (err) {
      console.error(
        '[composite] Discord handler error in onAgentMessageChunk:',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      this.writer.onAgentMessageChunk(channelId, text)
    } catch (err) {
      this.handleWriterError(err, 'onAgentMessageChunk', channelId)
    }
  }

  onAgentMessageImage(channelId: string, data: string, mimeType: string): void {
    try {
      this.discord.onAgentMessageImage(channelId, data, mimeType)
    } catch (err) {
      console.error(
        '[composite] Discord handler error in onAgentMessageImage:',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      this.writer.onAgentMessageImage(channelId, data, mimeType)
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
      console.error(
        '[composite] Discord handler error in onPromptStart:',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      this.writer.onPromptStart(channelId, turnId, context)
    } catch (err) {
      this.handleWriterError(err, 'onPromptStart', channelId)
    }
  }

  // C1: onPromptComplete must stay synchronous — see discord-handler.service.ts.
  onPromptComplete(channelId: string, stopReason: string): void {
    try {
      this.discord.onPromptComplete(channelId, stopReason)
    } catch (err) {
      console.error(
        '[composite] Discord handler error in onPromptComplete:',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      this.writer.onPromptComplete(channelId, stopReason)
    } catch (err) {
      this.handleWriterError(err, 'onPromptComplete', channelId)
    }
  }

  onSessionInfoUpdate(channelId: string, title: string): void {
    try {
      this.discord.onSessionInfoUpdate(channelId, title)
    } catch (err) {
      console.error(
        '[composite] Discord handler error in onSessionInfoUpdate:',
        err instanceof Error ? err.message : String(err),
      )
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
      console.error(
        '[composite] Discord handler error in onResumeFailed:',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      this.writer.onResumeFailed(channelId)
    } catch (err) {
      this.handleWriterError(err, 'onResumeFailed', channelId)
    }
  }

  onUsageUpdate(channelId: string, used: number, size: number): void {
    try {
      this.discord.onUsageUpdate(channelId, used, size)
    } catch (err) {
      console.error(
        '[composite] Discord handler error in onUsageUpdate:',
        err instanceof Error ? err.message : String(err),
      )
    }
    try {
      this.writer.onUsageUpdate(channelId, used, size)
    } catch (err) {
      this.handleWriterError(err, 'onUsageUpdate', channelId)
    }
    // ContextUsageService's failures are not a "transcript write failed"
    // case (it isn't a writer), so it gets its own plain console.error rather
    // than routing through handleWriterError's transcript_write_failed event.
    try {
      this.contextUsage.onUsageUpdate(channelId, used, size)
    } catch (err) {
      console.error(
        '[composite] ContextUsage handler error in onUsageUpdate:',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  // Emit a transcript_write_failed event for operator-visibility (Decision 2b).
  // context carries only safe identifiers — never the raw error message (F10).
  private handleWriterError(err: unknown, op: string, channelId: string): void {
    const code = errorCode(err)
    console.error(
      `[composite] Writer fault in ${op} channel=${channelId}: code=${code}`,
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
      console.error(
        `[composite] transcript_write_failed event also failed: code=${errorCode(innerErr)} (log-only, no retry)`,
      )
    }
  }
}
