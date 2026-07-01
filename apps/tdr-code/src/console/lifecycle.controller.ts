import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Inject,
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

// Allowed origin for mutating POST routes. The forward-auth cookie is an ambient
// credential; without an Origin check, any *.lilnas.io page can forge these requests.
// Set ALLOWED_CONSOLE_ORIGIN to the dev origin (e.g. http://tdr-code.localhost) when
// running locally.
const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

function requireSameOrigin(origin: string | undefined): void {
  if (origin !== ALLOWED_ORIGIN) {
    throw new ForbiddenException('cross-origin request rejected')
  }
}

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
  restart(@Headers('origin') origin: string | undefined): RestartResponseDto {
    requireSameOrigin(origin)
    const result = this.supervisor.requestRestart()
    if ('error' in result) {
      throw new ConflictException(result.error)
    }
    return { phase: result.phase }
  }

  @Post('channels/:channelId/teardown')
  @HttpCode(202)
  teardown(
    @Headers('origin') origin: string | undefined,
    @Param('channelId') channelId: string,
  ): TeardownResponseDto {
    requireSameOrigin(origin)
    const parsed = DiscordSnowflakeSchema.safeParse(channelId)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid channelId',
      )
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
