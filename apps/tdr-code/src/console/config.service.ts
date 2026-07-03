import fs from 'node:fs'

import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { latestGeneration } from 'src/db/bot-generation.repo'
import { enqueue } from 'src/db/command.repo'
import { type ConfigPatch, getConfig, updateConfig } from 'src/db/config.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { isRunningGeneration } from 'src/db/schema'

import type { ConfigResponseDto, UpdateConfigBodyDto } from './config.dto'

@Injectable()
export class ConfigService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  getConfig(): ConfigResponseDto {
    const row = getConfig(this.db)
    if (!row) {
      // This should never happen in production (main seeds before bot starts),
      // but is a sensible fallback for the API read path.
      throw new BadRequestException('Config not initialized')
    }
    return this.toDto(row)
  }

  updateConfig(body: UpdateConfigBodyDto): ConfigResponseDto {
    this.validateCwd(body.cwd)

    const patch: ConfigPatch = {
      cwd: body.cwd,
      claudeCommand: body.claudeCommand,
      claudeArgs: body.claudeArgs,
      idleTimeoutSec: body.idleTimeoutSec,
      maxConcurrentSessions: body.maxConcurrentSessions,
    }

    const updated = updateConfig(this.db, patch)
    this.logger.info({ patch }, 'Config updated')

    // Best-effort reread_config signal — only when a running generation exists.
    // The config is persisted regardless; if the bot is offline it reads the new
    // row at next construction (Decision #2, Decision #11).
    try {
      const gen = latestGeneration(this.db)
      if (gen && isRunningGeneration(gen)) {
        enqueue(this.db, {
          generationId: gen.id,
          type: 'reread_config',
          target: null,
          createdAt: new Date(),
        })
        this.logger.debug(
          { generationId: gen.id },
          'Enqueued reread_config for running bot generation',
        )
      }
    } catch (err) {
      // Best-effort: do not fail the request if enqueueing fails
      this.logger.warn({ err }, 'Best-effort reread_config enqueue failed')
    }

    return this.toDto(updated)
  }

  private validateCwd(cwd: string): void {
    try {
      const stat = fs.statSync(cwd)
      if (!stat.isDirectory()) {
        throw new BadRequestException(`cwd is not a directory: ${cwd}`)
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      throw new BadRequestException(
        `cwd does not exist or is not accessible: ${cwd}`,
      )
    }
  }

  private toDto(row: {
    cwd: string
    claudeCommand: string
    claudeArgs: string[]
    idleTimeoutSec: number
    maxConcurrentSessions: number
  }): ConfigResponseDto {
    return {
      cwd: row.cwd,
      claudeCommand: row.claudeCommand,
      claudeArgs: row.claudeArgs,
      idleTimeoutSec: row.idleTimeoutSec,
      maxConcurrentSessions: row.maxConcurrentSessions,
    }
  }
}
