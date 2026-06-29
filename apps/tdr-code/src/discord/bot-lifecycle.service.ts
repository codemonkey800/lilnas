import { env } from '@lilnas/utils/env'
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { On } from 'necord'
import { PinoLogger } from 'nestjs-pino'

import {
  finalize,
  generationById,
  heartbeat,
  markRunning,
} from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { EnvKeys } from 'src/env'

// ──────────────────────────────────────────────────────────────────────────────
// BotLifecycleService — bot-side half of the generation primitive.
//
// Responsibilities:
// - On Discord gateway-ready: validate BOT_GENERATION_ID, markRunning,
//   arm heartbeat interval.
// - Heartbeat: update last_heartbeat_at on cadence; stop if the row is gone
//   (supervisor finalized / stopped).
// - Graceful shutdown (driven by bot-bootstrap SIGTERM handler): ordered
//   teardown, finalize generation.
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class BotLifecycleService implements OnModuleInit, OnModuleDestroy {
  private generationId: number | null = null
  private shutdownRequested = false
  private heartbeatTimer: NodeJS.Timeout | null = null

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    const idStr = process.env[EnvKeys.BOT_GENERATION_ID]
    if (!idStr) {
      this.logger.warn('BOT_GENERATION_ID not set — bot-lifecycle inactive')
      return
    }
    const id = parseInt(idStr, 10)
    if (isNaN(id)) {
      this.logger.error({ idStr }, 'BOT_GENERATION_ID is not a valid integer')
      process.exit(1)
    }

    // Guard: refuse to adopt a terminal or pid-mismatched generation.
    const row = generationById(this.db, id)
    if (!row) {
      this.logger.error(
        { generationId: id },
        'BOT_GENERATION_ID row not found — fatal',
      )
      process.exit(1)
    }
    if (row.endedAt != null) {
      this.logger.error(
        { generationId: id, status: row.status },
        'BOT_GENERATION_ID points at a terminal generation — fatal',
      )
      process.exit(1)
    }
    if (
      row.status === 'running' &&
      row.pid != null &&
      row.pid !== process.pid
    ) {
      this.logger.error(
        { generationId: id, recordedPid: row.pid, myPid: process.pid },
        'BOT_GENERATION_ID belongs to a different pid — fatal',
      )
      process.exit(1)
    }

    this.generationId = id
    this.logger.info({ generationId: id }, 'Bot lifecycle service initialized')
  }

  onModuleDestroy(): void {
    this.stopHeartbeat()
  }

  // ── Discord gateway ready ─────────────────────────────────────────────────

  @On('ready')
  onReady(): void {
    if (this.shutdownRequested) {
      this.logger.warn('Discord ready fired during shutdown — ignoring')
      return
    }
    const id = this.generationId
    if (id == null) return

    const changes = markRunning(this.db, id, process.pid, new Date())
    if (changes === 0) {
      this.logger.warn(
        { generationId: id },
        'markRunning affected 0 rows — generation already stopped/finalized',
      )
      return
    }
    this.logger.info(
      { generationId: id, pid: process.pid },
      'Bot marked running',
    )
    this.armHeartbeat()
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  private armHeartbeat(): void {
    this.stopHeartbeat()
    const intervalMs = parseInt(env(EnvKeys.BOT_HEARTBEAT_MS, '5000'), 10)
    const beat = () => {
      const id = this.generationId
      if (id == null) return
      const changes = heartbeat(this.db, id, new Date())
      if (changes === 0) {
        // Supervisor finalized/stopped this generation — stop heartbeating.
        this.logger.warn(
          { generationId: id },
          'Heartbeat affected 0 rows — supervisor finalized generation, stopping heartbeat',
        )
        this.stopHeartbeat()
        return
      }
      this.heartbeatTimer = setTimeout(beat, intervalMs)
    }
    this.heartbeatTimer = setTimeout(beat, intervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  markShutdownRequested(): void {
    this.shutdownRequested = true
    this.stopHeartbeat()
  }

  finalizeGeneration(exitCode: number | null): void {
    const id = this.generationId
    if (id == null) return
    finalize(this.db, id, 'stopped', exitCode, new Date())
    this.logger.info({ generationId: id }, 'Bot generation finalized stopped')
  }
}
