import { env } from '@lilnas/utils/env'
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

import { SessionManagerService } from 'src/agent/session-manager.service'
import { claimPending } from 'src/db/command.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { insertEvent } from 'src/db/events.repo'
import { EnvKeys } from 'src/env'

// Discord snowflake: 17–20 digit numeric string.
const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Must be a Discord snowflake (17–20 digits)')

// Deny-by-default: only allowlisted (type, target-shape) pairs dispatch.
// Unknown or invalid commands are recorded as anomalies, never silently consumed.
const TeardownChannelSchema = z.object({
  type: z.literal('teardown_channel'),
  target: DiscordSnowflakeSchema,
})

const RereadConfigSchema = z.object({
  type: z.literal('reread_config'),
  target: z.null(),
})

// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class CommandPollerService implements OnModuleInit, OnModuleDestroy {
  private pollTimer: NodeJS.Timeout | null = null
  private generationId: number | null = null
  private readonly pollIntervalMs: number

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sessionManager: SessionManagerService,
    private readonly logger: PinoLogger,
  ) {
    this.pollIntervalMs = parseInt(env(EnvKeys.BOT_COMMAND_POLL_MS, '1500'), 10)
    const genIdStr = process.env[EnvKeys.BOT_GENERATION_ID]
    this.generationId = genIdStr ? parseInt(genIdStr, 10) : null
  }

  onModuleInit(): void {
    if (this.generationId == null) {
      this.logger.warn('BOT_GENERATION_ID not set — command poller inactive')
      return
    }
    this.armPoll()
  }

  onModuleDestroy(): void {
    this.stopPoll()
  }

  private armPoll(): void {
    this.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs)
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
  }

  private poll(): void {
    const genId = this.generationId
    if (genId == null) return
    try {
      const claimed = claimPending(this.db, genId)
      for (const row of claimed) {
        this.dispatch(row)
      }
      this.logger.debug(
        { generationId: genId, claimedCount: claimed.length },
        'Command poll tick complete',
      )
    } catch (err) {
      this.logger.warn(
        { err, generationId: genId },
        'Command poll error — will retry next tick',
      )
    }
    this.armPoll()
  }

  private dispatch(row: {
    type: string
    target: string | null
    id: number
  }): void {
    const result = this.validate(row)
    if (!result.ok) {
      this.logger.warn(
        {
          commandId: row.id,
          type: row.type,
          target: row.target,
          reason: result.reason,
          generationId: this.generationId,
        },
        'Command validation anomaly — deny-by-default, not dispatched',
      )
      const genId = this.generationId
      if (genId != null) {
        try {
          insertEvent(this.db, {
            generationId: genId,
            type: 'command_anomaly',
            level: 'warn',
            context: {
              commandId: row.id,
              type: row.type,
              reason: result.reason,
            },
            createdAt: new Date(),
          })
        } catch (err) {
          this.logger.warn(
            { err, generationId: genId },
            'Failed to write command_anomaly event',
          )
        }
      }
      return
    }
    switch (result.command.type) {
      case 'teardown_channel':
        this.sessionManager.teardown(result.command.target)
        this.logger.info(
          {
            channelId: result.command.target,
            commandId: row.id,
            generationId: this.generationId,
          },
          'Dispatched teardown_channel',
        )
        break
      case 'reread_config':
        this.sessionManager.rereadConfig()
        this.logger.info(
          { commandId: row.id, generationId: this.generationId },
          'Dispatched reread_config',
        )
        break
    }
  }

  private validate(row: { type: string; target: string | null; id: number }):
    | {
        ok: true
        command:
          | z.infer<typeof TeardownChannelSchema>
          | z.infer<typeof RereadConfigSchema>
      }
    | { ok: false; reason: string } {
    if (row.type === 'teardown_channel') {
      const parsed = TeardownChannelSchema.safeParse({
        type: row.type,
        target: row.target,
      })
      if (parsed.success) {
        return { ok: true, command: parsed.data }
      }
      return {
        ok: false,
        reason: parsed.error.issues.map(i => i.message).join('; '),
      }
    }
    if (row.type === 'reread_config') {
      const parsed = RereadConfigSchema.safeParse({
        type: row.type,
        target: row.target,
      })
      if (parsed.success) {
        return { ok: true, command: parsed.data }
      }
      return {
        ok: false,
        reason: parsed.error.issues.map(i => i.message).join('; '),
      }
    }
    return { ok: false, reason: `Unknown command type: ${row.type}` }
  }
}
