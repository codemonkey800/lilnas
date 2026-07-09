import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { BotStatusService } from 'src/bot/bot-status.service'
import { isBotOffline, staleThresholdMs } from 'src/bot/staleness'
import { latestGeneration } from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { listLive } from 'src/db/live-status.repo'
import { isRunningGeneration } from 'src/db/schema'
import { LOG_EVENTS } from 'src/logging/log-events'

import { DiscordDirectoryService } from './discord-directory.service'
import type { LiveChannelItemDto, LiveResponseDto } from './live.dto'

@Injectable()
export class LiveService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly botStatus: BotStatusService,
    private readonly discordDirectory: DiscordDirectoryService,
    private readonly logger: PinoLogger,
  ) {}

  async getLive(now: Date = new Date()): Promise<LiveResponseDto> {
    const status = this.botStatus.getStatus(now)
    const botOffline = isBotOffline(status.status)

    // Read latestGeneration + listLive in one DEFERRED snapshot so the bot cannot
    // commit a generation transition between the two reads (same pattern as getSessionTranscript).
    const snapshot = this.db.transaction(
      () => {
        const gen = latestGeneration(this.db)
        if (!gen) return null
        return { gen, rows: listLive(this.db, gen.id) }
      },
      { behavior: 'deferred' },
    )

    if (!snapshot) {
      return { botOffline: true, globalStatus: 'never-seen', items: [] }
    }

    const { gen: latestGen, rows } = snapshot
    const isRunning = isRunningGeneration(latestGen)
    const threshold = staleThresholdMs()

    const baseItems = rows.map(row => {
      const ageSinceHeartbeat = now.getTime() - row.lastHeartbeatAt.getTime()
      const stale = ageSinceHeartbeat > threshold

      let state: LiveChannelItemDto['state']
      if (!isRunning || botOffline) {
        state = 'last-known'
      } else if (stale) {
        state = 'stale'
        this.logger.warn(
          {
            channelId: row.channelId,
            ageSinceHeartbeat,
            event: LOG_EVENTS.liveRowStale,
          },
          'Live row is stale — degrade-to-last-known',
        )
      } else {
        state = row.prompting ? 'working' : 'idle'
      }

      return {
        channelId: row.channelId,
        triggeringUserId: row.triggeringUserId ?? null,
        state,
        queueDepth: row.queueDepth,
        lastActivityAt: row.lastActivityAt.toISOString(),
        lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
      }
    })

    const [members, channelNames] = await Promise.all([
      this.discordDirectory.listGuildMembers().catch(() => []),
      Promise.all(
        baseItems.map(item =>
          this.discordDirectory.getChannelName(item.channelId).catch(() => null),
        ),
      ),
    ])

    const memberMap = new Map(members.map(m => [m.id, m.displayName]))

    const items: LiveChannelItemDto[] = baseItems.map((item, i) => ({
      ...item,
      channelName: channelNames[i],
      triggeringUserDisplayName: item.triggeringUserId
        ? (memberMap.get(item.triggeringUserId) ?? null)
        : null,
    }))

    const globalStatus = botOffline ? 'offline' : 'online'
    return { botOffline, globalStatus, items }
  }
}
