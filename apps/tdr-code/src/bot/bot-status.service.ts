import { Inject, Injectable } from '@nestjs/common'

import { latestGeneration } from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { isEndedGeneration, isRunningGeneration } from 'src/db/schema'

import type { BotStatusDto } from './bot-status.dto'
import { staleThresholdMs } from './staleness'

@Injectable()
export class BotStatusService {
  constructor(@Inject(DB) private readonly db: Db) {}

  getStatus(now: Date = new Date()): BotStatusDto {
    const row = latestGeneration(this.db)
    if (!row) {
      return { status: 'never-seen', lastSeenAt: null }
    }

    if (isEndedGeneration(row)) {
      if (row.status === 'failed') {
        return {
          status: 'offline-failed',
          lastSeenAt: row.endedAt.toISOString(),
        }
      }
      return {
        status: 'offline',
        lastSeenAt: row.endedAt.toISOString(),
      }
    }

    // Not ended (ended_at IS NULL) — check status.
    if (row.status === 'failed') {
      return {
        status: 'offline-failed',
        lastSeenAt: row.lastHeartbeatAt?.toISOString() ?? null,
      }
    }

    if (isRunningGeneration(row)) {
      const ageSinceHeartbeat = now.getTime() - row.lastHeartbeatAt.getTime()
      if (ageSinceHeartbeat > staleThresholdMs()) {
        return {
          status: 'offline',
          lastSeenAt: row.lastHeartbeatAt.toISOString(),
        }
      }
      return { status: 'online', lastSeenAt: null }
    }

    // starting / stopping / stopped (not ended) → starting.
    return { status: 'starting', lastSeenAt: null }
  }
}
