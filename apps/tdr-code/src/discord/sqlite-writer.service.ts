import { Inject, Injectable } from '@nestjs/common'

import { mapStopReason } from 'src/agent/acp-event-mapping'
import type {
  AcpEventHandlers,
  DiffContent,
  PromptStartContext,
} from 'src/agent/agent.types'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { insertEvent } from 'src/db/events.repo'
import {
  appendBlock,
  insertToolCall,
  updateToolCallStatus,
} from 'src/db/turn-content.repo'
import { closeTurn, insertTurn, maxTurnIndex } from 'src/db/turns.repo'
import { EnvKeys } from 'src/env'

// ──────────────────────────────────────────────────────────────────────────────
// SqliteWriterService — ACP event → SQLite transcript persistence (B3/B4).
//
// All event methods are synchronous (Decision 1 / C1). No `await` anywhere.
// better-sqlite3 is synchronous so SQLite writes are C1-safe.
//
// Per-channel state: sessionRowId (from onPromptStart context, Decision 3),
// currentTurnRowId (set in onPromptStart, cleared in onPromptComplete),
// turnIndexCounter (seeded from MAX(turn_index) on first prompt, Decision 6).
// ──────────────────────────────────────────────────────────────────────────────

interface ChannelWriterState {
  sessionRowId: number
  currentTurnRowId: number | null
  turnIndexCounter: number
}

@Injectable()
export class SqliteWriterService implements AcpEventHandlers {
  private readonly generationId: number | null
  private readonly channelState = new Map<string, ChannelWriterState>()

  constructor(@Inject(DB) private readonly db: Db) {
    const genIdStr = process.env[EnvKeys.BOT_GENERATION_ID]
    this.generationId = genIdStr ? parseInt(genIdStr, 10) : null
  }

  onToolCall(
    channelId: string,
    toolCallId: string,
    title: string,
    kind: string,
    _status: string,
    diffs: DiffContent[],
  ): void {
    if (this.generationId == null) return
    const state = this.channelState.get(channelId)
    if (!state?.currentTurnRowId) return

    insertToolCall(this.db, {
      turnId: state.currentTurnRowId,
      ref: toolCallId,
      payload: { kind: 'tool_call', title, toolKind: kind, status: 'pending' },
      createdAt: new Date(),
    })

    // Append any diffs that arrived with the initial tool_call event.
    for (const diff of diffs) {
      appendBlock(this.db, {
        turnId: state.currentTurnRowId,
        kind: 'diff',
        payload: {
          kind: 'diff',
          path: diff.path,
          oldText: diff.oldText,
          newText: diff.newText,
        },
        createdAt: new Date(),
      })
    }
  }

  onToolCallUpdate(
    channelId: string,
    toolCallId: string,
    status: string,
    diffs: DiffContent[],
  ): void {
    if (this.generationId == null) return
    const state = this.channelState.get(channelId)
    if (!state?.currentTurnRowId) return

    const changes = updateToolCallStatus(this.db, {
      turnId: state.currentTurnRowId,
      ref: toolCallId,
      status,
    })
    if (changes === 0) {
      console.warn(
        `[sqlite-writer] onToolCallUpdate: 0 rows updated channel=${channelId} ref=${toolCallId} (late/cross-turn, skipping)`,
      )
      return
    }

    // Append diffs from the update.
    for (const diff of diffs) {
      appendBlock(this.db, {
        turnId: state.currentTurnRowId,
        kind: 'diff',
        payload: {
          kind: 'diff',
          path: diff.path,
          oldText: diff.oldText,
          newText: diff.newText,
        },
        createdAt: new Date(),
      })
    }
  }

  onAgentMessageChunk(channelId: string, text: string): void {
    if (this.generationId == null) return
    const state = this.channelState.get(channelId)
    // Mirror DiscordHandlerService clearedTurnId watermark: drop if no open turn.
    if (!state?.currentTurnRowId) {
      console.warn(
        `[sqlite-writer] onAgentMessageChunk: no open turn for channel=${channelId}, dropping chunk`,
      )
      return
    }
    appendBlock(this.db, {
      turnId: state.currentTurnRowId,
      kind: 'agent_text',
      payload: { kind: 'agent_text', text },
      createdAt: new Date(),
    })
  }

  onAgentMessageImage(channelId: string, data: string, mimeType: string): void {
    if (this.generationId == null) return
    const state = this.channelState.get(channelId)
    if (!state?.currentTurnRowId) {
      console.warn(
        `[sqlite-writer] onAgentMessageImage: no open turn for channel=${channelId}, dropping image`,
      )
      return
    }
    appendBlock(this.db, {
      turnId: state.currentTurnRowId,
      kind: 'agent_text',
      payload: {
        kind: 'agent_text',
        text: `[image:${mimeType}:${data.slice(0, 16)}...]`,
      },
      createdAt: new Date(),
    })
  }

  onPromptStart(
    channelId: string,
    turnId: number,
    context: PromptStartContext,
  ): void {
    const genId = this.generationId
    if (genId == null || context.sessionRowId == null) return

    // Seed or update per-channel state.
    const existing = this.channelState.get(channelId)
    let counter: number

    if (!existing || existing.sessionRowId !== context.sessionRowId) {
      // New session or session changed — seed counter from DB.
      counter = maxTurnIndex(this.db, context.sessionRowId)
    } else {
      counter = existing.turnIndexCounter
    }

    const turnIndex = counter + 1

    const turn = insertTurn(this.db, {
      sessionId: context.sessionRowId,
      generationId: genId,
      turnIndex,
      userId: null, // filled from executePrompt via PromptStartContext if needed
      startedAt: new Date(),
    })

    const state: ChannelWriterState = {
      sessionRowId: context.sessionRowId,
      currentTurnRowId: turn.id,
      turnIndexCounter: turnIndex,
    }
    this.channelState.set(channelId, state)

    // Emit turn_started event.
    insertEvent(this.db, {
      generationId: genId,
      sessionId: context.sessionRowId,
      channelId,
      type: 'turn_started',
      level: 'info',
      context: { turnId: turn.id, turnIndex, acpTurnId: turnId },
      createdAt: new Date(),
    })

    // Persist the user's prompt block.
    const { text, images } = context.prompt
    appendBlock(this.db, {
      turnId: turn.id,
      kind: 'prompt',
      payload: {
        kind: 'prompt',
        text,
        images: images.length > 0 ? images : undefined,
      },
      createdAt: new Date(),
    })
  }

  // C1: must stay synchronous — see composite-acp-handler.ts.
  onPromptComplete(channelId: string, stopReason: string): void {
    const genId = this.generationId
    if (genId == null) return

    const state = this.channelState.get(channelId)
    if (!state?.currentTurnRowId) return

    const { status, eventType, unknownReason } = mapStopReason(stopReason)

    closeTurn(this.db, {
      id: state.currentTurnRowId,
      status,
      endedAt: new Date(),
      stopReason,
    })

    insertEvent(this.db, {
      generationId: genId,
      sessionId: state.sessionRowId,
      channelId,
      type: eventType,
      level: unknownReason ? 'warn' : 'info',
      context: { turnId: state.currentTurnRowId, stopReason, unknownReason },
      createdAt: new Date(),
    })

    // Clear the current turn — late chunks will be dropped (F3 guard above).
    this.channelState.set(channelId, {
      ...state,
      currentTurnRowId: null,
    })
  }
}
