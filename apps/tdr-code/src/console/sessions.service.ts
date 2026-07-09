import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { narrowTurnContentPayload, type SessionRow } from 'src/db/schema'
import { getSessionById, listSessions } from 'src/db/sessions.repo'
import { listBlocksByTurns } from 'src/db/turn-content.repo'
import { listTurnsBySession } from 'src/db/turns.repo'
import { LOG_EVENTS } from 'src/logging/log-events'

import { DiscordDirectoryService } from './discord-directory.service'
import { paginate, type Paginated } from './pagination'
import type {
  SessionDetailResponseDto,
  SessionListItemDto,
  TurnContentBlockDto,
  TurnDetailDto,
} from './sessions.dto'

// Bounded preview length for diff.newText/oldText in the transcript DTO
// (chars, not bytes — string.slice() uses UTF-16 code units, which is fine
// for a display preview; this is NOT the reconcile.service.ts MAX_JSONL_BYTES
// case, which needs byte-exact precision to resume a file read). Under
// snapshot-refetch (Decision 2A), every signal-triggered refetch re-reads and
// re-sends the WHOLE transcript, so an uncapped diff body is resent in full
// on every burst even though the UI already clamps the visible area to
// `max-h-40 overflow-auto` (session detail page's ContentBlock). 4000 chars
// is several screens' worth of clamped-box scrolling — comfortably more than
// what a user scrolling a fixed-height preview will ever read — while
// cutting the dominant per-refetch byte cost for large file diffs.
const DIFF_PREVIEW_MAX_CHARS = 4000

function truncateDiffText(text: string): { text: string; truncated: boolean } {
  if (text.length <= DIFF_PREVIEW_MAX_CHARS) {
    return { text, truncated: false }
  }
  return { text: text.slice(0, DIFF_PREVIEW_MAX_CHARS), truncated: true }
}

@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly discordDirectory: DiscordDirectoryService,
    private readonly logger: PinoLogger,
  ) {}

  async listSessions(opts: {
    channelId?: string
    cursor?: number
    limit: number
  }): Promise<Paginated<SessionListItemDto>> {
    const rows = listSessions(this.db, opts)
    const paginated = paginate(
      rows.map(r => this.mapSessionItem(r)),
      opts.limit,
    )

    const uniqueChannelIds = [...new Set(paginated.items.map(i => i.channelId))]
    const [channelNameEntries, members] = await Promise.all([
      Promise.all(
        uniqueChannelIds.map(async id =>
          [id, await this.discordDirectory.getChannelName(id).catch(() => null)] as const,
        ),
      ),
      this.discordDirectory.listGuildMembers().catch(() => []),
    ])

    const channelNameMap = new Map(channelNameEntries)
    const memberMap = new Map(members.map(m => [m.id, m.displayName]))

    return {
      ...paginated,
      items: paginated.items.map(item => ({
        ...item,
        channelName: channelNameMap.get(item.channelId) ?? null,
        triggeringUserDisplayName: memberMap.get(item.triggeringUserId) ?? null,
      })),
    }
  }

  getSessionTranscript(sessionId: number): SessionDetailResponseDto {
    // Wrap session + turns + blocks in one DEFERRED snapshot so the bot cannot
    // commit between queries and yield an internally-inconsistent view.
    const result = this.db.transaction(
      () => {
        const session = getSessionById(this.db, sessionId)
        if (!session) return null
        const turns = listTurnsBySession(this.db, session.id)
        const turnIds = turns.map(t => t.id)
        const blocks = listBlocksByTurns(this.db, turnIds)
        return { session, turns, blocks }
      },
      { behavior: 'deferred' },
    )

    if (!result) {
      throw new NotFoundException(`Session ${sessionId} not found`)
    }

    const { session, turns, blocks } = result

    // Group blocks by turnId.
    const blocksByTurnId = new Map<number, typeof blocks>()
    for (const b of blocks) {
      const list = blocksByTurnId.get(b.turnId) ?? []
      list.push(b)
      blocksByTurnId.set(b.turnId, list)
    }

    let droppedBlocks = 0
    const turnDtos: TurnDetailDto[] = turns.map(turn => {
      const turnBlocks = blocksByTurnId.get(turn.id) ?? []
      const content: TurnContentBlockDto[] = []
      for (const block of turnBlocks) {
        const narrowed = narrowTurnContentPayload(block.payload, block.kind)
        if (!narrowed) {
          droppedBlocks++
          this.logger.warn(
            {
              blockId: block.id,
              turnId: block.turnId,
              kind: block.kind,
              event: LOG_EVENTS.turnContentBlockDropped,
            },
            'Dropped un-narrowable turn_content block in transcript',
          )
          continue
        }
        content.push(this.mapBlock(block.id, narrowed))
      }

      // Merge consecutive agent_text blocks — streaming writes one row per chunk.
      const merged: TurnContentBlockDto[] = []
      for (const block of content) {
        const last = merged[merged.length - 1]
        if (block.kind === 'agent_text' && last?.kind === 'agent_text') {
          merged[merged.length - 1] = { ...last, text: last.text + block.text }
        } else {
          merged.push(block)
        }
      }

      return {
        id: turn.id,
        turnIndex: turn.turnIndex,
        userId: turn.userId ?? null,
        status: turn.status,
        startedAt: turn.startedAt.toISOString(),
        endedAt: turn.endedAt?.toISOString() ?? null,
        stopReason: turn.stopReason ?? null,
        content: merged,
      }
    })

    return {
      session: this.mapSessionItem(session),
      turns: turnDtos,
      droppedBlocks,
    }
  }

  private mapSessionItem(
    row: Pick<
      SessionRow,
      | 'id'
      | 'channelId'
      | 'triggeringUserId'
      | 'createdAt'
      | 'endedAt'
      | 'endReason'
    >,
  ): SessionListItemDto {
    return {
      id: row.id,
      channelId: row.channelId,
      channelName: null,
      triggeringUserId: row.triggeringUserId,
      triggeringUserDisplayName: null,
      createdAt: row.createdAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      endReason: row.endReason ?? null,
    }
  }

  private mapBlock(
    id: number,
    payload: ReturnType<typeof narrowTurnContentPayload>,
  ): TurnContentBlockDto {
    if (!payload) throw new Error('mapBlock called with null payload')
    switch (payload.kind) {
      case 'prompt':
        return {
          id,
          kind: 'prompt',
          text: payload.text,
          images: payload.images?.map(img => ({ mimeType: img.mimeType })),
        }
      case 'agent_text':
        return { id, kind: 'agent_text', text: payload.text }
      case 'tool_call':
        return {
          id,
          kind: 'tool_call',
          title: payload.title,
          toolKind: payload.toolKind,
          status: payload.status,
        }
      case 'diff': {
        const newText = truncateDiffText(payload.newText)
        // A genuinely absent oldText (new-file creation) must stay null,
        // never become a truncated-empty-string artifact — only run the
        // truncation when oldText is a real string.
        const oldText =
          payload.oldText != null ? truncateDiffText(payload.oldText) : null
        return {
          id,
          kind: 'diff',
          path: payload.path,
          newText: newText.text,
          oldText: oldText ? oldText.text : null,
          truncated: newText.truncated || (oldText?.truncated ?? false),
        }
      }
    }
  }
}
