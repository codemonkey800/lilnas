import { Inject, Injectable } from '@nestjs/common'

import type {
  AcpEventHandlers,
  DiffContent,
  PromptStartContext,
} from 'src/agent/agent.types'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { insertEvent } from 'src/db/events.repo'
import { EnvKeys } from 'src/env'

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

  constructor(
    discord: DiscordHandlerService,
    writer: SqliteWriterService,
    @Inject(DB) private readonly db: Db,
  ) {
    this.discord = discord
    this.writer = writer
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
      this.handleWriterError(err, 'onToolCall', channelId, null)
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
      this.handleWriterError(err, 'onToolCallUpdate', channelId, null)
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
      this.handleWriterError(err, 'onAgentMessageChunk', channelId, null)
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
      this.handleWriterError(err, 'onAgentMessageImage', channelId, null)
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
      this.handleWriterError(err, 'onPromptStart', channelId, null)
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
      this.handleWriterError(err, 'onPromptComplete', channelId, null)
    }
  }

  // Emit a transcript_write_failed event for operator-visibility (Decision 2b).
  // context carries only safe identifiers — never the raw error message (F10).
  private handleWriterError(
    err: unknown,
    op: string,
    channelId: string,
    turnId: number | null,
  ): void {
    const errorCode =
      err instanceof Error
        ? ((err as NodeJS.ErrnoException).code ?? err.name)
        : 'UNKNOWN'
    console.error(
      `[composite] Writer fault in ${op} channel=${channelId}: code=${errorCode}`,
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
        context: { op, channelId, turnId, errorCode },
        createdAt: new Date(),
      })
    } catch (innerErr) {
      const innerCode =
        innerErr instanceof Error
          ? ((innerErr as NodeJS.ErrnoException).code ?? innerErr.name)
          : 'UNKNOWN'
      console.error(
        `[composite] transcript_write_failed event also failed: code=${innerCode} (log-only, no retry)`,
      )
    }
  }
}
