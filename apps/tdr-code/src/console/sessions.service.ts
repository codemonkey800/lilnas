import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { narrowTurnContentPayload, type SessionRow } from 'src/db/schema'
import { getSessionById, listSessions } from 'src/db/sessions.repo'
import { listBlocksByTurns } from 'src/db/turn-content.repo'
import { listTurnsBySession } from 'src/db/turns.repo'

import { paginate, type Paginated } from './pagination'
import type {
  SessionDetailResponseDto,
  SessionListItemDto,
  TurnContentBlockDto,
  TurnDetailDto,
} from './sessions.dto'

@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  listSessions(opts: {
    channelId?: string
    cursor?: number
    limit: number
  }): Paginated<SessionListItemDto> {
    const rows = listSessions(this.db, opts)
    return paginate(
      rows.map(r => this.mapSessionItem(r)),
      opts.limit,
    )
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
            { blockId: block.id, turnId: block.turnId, kind: block.kind },
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
      triggeringUserId: row.triggeringUserId,
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
      case 'diff':
        return {
          id,
          kind: 'diff',
          path: payload.path,
          newText: payload.newText,
          oldText: payload.oldText ?? null,
        }
    }
  }
}
