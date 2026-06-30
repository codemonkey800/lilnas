import { Inject, Injectable } from '@nestjs/common'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { listEvents } from 'src/db/events.repo'
import type { EventLevel, EventType } from 'src/db/schema'

import type { EventItemDto } from './events.dto'
import { paginate, type Paginated } from './pagination'

@Injectable()
export class EventsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  listEvents(opts: {
    type?: EventType
    level?: EventLevel
    channelId?: string
    cursor?: number
    limit: number
  }): Paginated<EventItemDto> {
    const rows = listEvents(this.db, opts)
    return paginate(
      rows.map(r => ({
        id: r.id,
        type: r.type,
        level: r.level,
        channelId: r.channelId ?? null,
        sessionId: r.sessionId ?? null,
        context: r.context as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      })),
      opts.limit,
    )
  }
}
