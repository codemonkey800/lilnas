import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { z } from 'zod'

import { latestGeneration } from 'src/db/bot-generation.repo'
import { enqueue } from 'src/db/command.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { isRunningGeneration } from 'src/db/schema'
import { SupervisorService } from 'src/supervisor/supervisor.service'

import type { RestartResponseDto, TeardownResponseDto } from './lifecycle.dto'

// Discord snowflake: 17–20 digit numeric string.
const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Must be a Discord snowflake (17–20 digits)')

// Trust boundary: see bot-status.controller.ts.
// Phase D (D6) must enumerate these routes for deny-by-default guards.
// /bot/restart and /channels/:id/teardown are mutating — treat as sensitive.
@Controller()
export class LifecycleController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly supervisor: SupervisorService,
  ) {}

  @Post('bot/restart')
  @HttpCode(202)
  restart(): RestartResponseDto {
    const result = this.supervisor.requestRestart()
    if ('error' in result) {
      throw new ConflictException(result.error)
    }
    return { phase: result.phase }
  }

  @Post('channels/:channelId/teardown')
  @HttpCode(202)
  teardown(@Param('channelId') channelId: string): TeardownResponseDto {
    const parsed = DiscordSnowflakeSchema.safeParse(channelId)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid channelId')
    }

    const gen = latestGeneration(this.db)
    if (!gen) {
      throw new ConflictException('bot-offline')
    }
    if (!isRunningGeneration(gen)) {
      // Generation exists but is not yet running (Starting) or has ended.
      const isStarting = gen.status === 'starting'
      if (isStarting) {
        throw new ConflictException('bot-starting')
      }
      throw new ConflictException('bot-offline')
    }

    enqueue(this.db, {
      generationId: gen.id,
      type: 'teardown_channel',
      target: channelId,
      createdAt: new Date(),
    })

    return { accepted: true }
  }
}
