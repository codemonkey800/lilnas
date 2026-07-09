import { Inject, Injectable } from '@nestjs/common'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { listEvents } from 'src/db/events.repo'
import type { EventLevel, EventType } from 'src/db/schema'

import { DiscordDirectoryService } from './discord-directory.service'
import type { EventItemDto } from './events.dto'
import { paginate, type Paginated } from './pagination'

@Injectable()
export class EventsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly discordDirectory: DiscordDirectoryService,
  ) {}

  async listEvents(opts: {
    type?: EventType
    level?: EventLevel
    channelId?: string
    cursor?: number
    limit: number
  }): Promise<Paginated<EventItemDto>> {
    const rows = listEvents(this.db, opts)
    const paginated = paginate(
      rows.map(r => ({
        id: r.id,
        type: r.type,
        level: r.level,
        channelId: r.channelId ?? null,
        channelName: null as string | null,
        sessionId: r.sessionId ?? null,
        context: r.context as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      })),
      opts.limit,
    )

    const uniqueChannelIds = [
      ...new Set(
        paginated.items.map(i => i.channelId).filter((id): id is string => id !== null),
      ),
    ]
    const channelNameEntries = await Promise.all(
      uniqueChannelIds.map(async id =>
        [id, await this.discordDirectory.getChannelName(id).catch(() => null)] as const,
      ),
    )
    const channelNameMap = new Map(channelNameEntries)

    return {
      ...paginated,
      items: paginated.items.map(item => ({
        ...item,
        channelName: item.channelId ? (channelNameMap.get(item.channelId) ?? null) : null,
      })),
    }
  }
}
