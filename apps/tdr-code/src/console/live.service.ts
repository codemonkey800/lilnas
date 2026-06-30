import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { BotStatusService } from 'src/bot/bot-status.service'
import { staleThresholdMs } from 'src/bot/staleness'
import { latestGeneration } from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { listLive } from 'src/db/live-status.repo'
import { isRunningGeneration } from 'src/db/schema'

import type { LiveChannelItemDto, LiveResponseDto } from './live.dto'

@Injectable()
export class LiveService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly botStatus: BotStatusService,
    private readonly logger: PinoLogger,
  ) {}

  getLive(now: Date = new Date()): LiveResponseDto {
    const status = this.botStatus.getStatus(now)
    const botOffline =
      status.status !== 'online' && status.status !== 'starting'

    const latestGen = latestGeneration(this.db)
    if (!latestGen) {
      return { botOffline: true, globalStatus: 'never-seen', items: [] }
    }

    const isRunning = isRunningGeneration(latestGen)
    const rows = listLive(this.db, latestGen.id)
    const threshold = staleThresholdMs()

    const items: LiveChannelItemDto[] = rows.map(row => {
      const ageSinceHeartbeat = now.getTime() - row.lastHeartbeatAt.getTime()
      const stale = ageSinceHeartbeat > threshold

      let state: LiveChannelItemDto['state']
      if (!isRunning || botOffline) {
        state = 'last-known'
      } else if (stale) {
        state = 'stale'
        this.logger.warn(
          { channelId: row.channelId, ageSinceHeartbeat },
          'Live row is stale — degrade-to-last-known',
        )
      } else {
        state = row.prompting ? 'working' : 'idle'
      }

      return {
        channelId: row.channelId,
        triggeringUserId: row.triggeringUserId ?? null,
        state,
        prompting: row.prompting,
        queueDepth: row.queueDepth,
        lastActivityAt: row.lastActivityAt.toISOString(),
        lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
      }
    })

    const globalStatus = botOffline ? 'offline' : 'online'
    return { botOffline, globalStatus, items }
  }
}
