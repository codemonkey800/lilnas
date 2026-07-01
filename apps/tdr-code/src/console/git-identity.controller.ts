import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common'
import { z } from 'zod'

import { DiscordSnowflakeSchema, UpsertGitIdentityBodySchema } from './git-identity.dto'
import { GitIdentityService } from './git-identity.service'

// Allowed origin for mutating routes.
const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

function requireSameOrigin(origin: string | undefined): void {
  if (origin !== ALLOWED_ORIGIN) {
    throw new ForbiddenException('cross-origin request rejected')
  }
}

// Trust boundary — Phase D (D6) must enumerate these routes for deny-by-default
// guards. POST /git-identity accepts a private key — the most sensitive route
// in the app; never log or echo the key. Never log or return key material.
// No per-identity authorization in Phase C (Decision #11).
@Controller('git-identity')
export class GitIdentityController {
  constructor(private readonly service: GitIdentityService) {}

  @Get()
  listIdentities() {
    return this.service.listIdentities()
  }

  @Post()
  @HttpCode(200)
  upsertIdentity(
    @Headers('origin') origin: string | undefined,
    @Body() body: unknown,
  ) {
    requireSameOrigin(origin)

    const parsed = UpsertGitIdentityBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid git-identity body',
      )
    }

    return this.service.upsertIdentity(parsed.data)
  }

  @Delete(':discordUserId')
  @HttpCode(200)
  deleteIdentity(
    @Headers('origin') origin: string | undefined,
    @Param('discordUserId') discordUserId: string,
  ) {
    requireSameOrigin(origin)

    const parsed = DiscordSnowflakeSchema.safeParse(discordUserId)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid discordUserId',
      )
    }

    this.service.deleteIdentity(parsed.data)
    return { accepted: true }
  }
}
