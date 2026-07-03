import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { revokeSessionsForDiscordUser } from 'src/db/auth-session.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'

import type { RevokeSessionsResponseDto } from './auth-admin.dto'
import { DiscordSnowflakeSchema } from './git-identity.dto'

// Same defense-in-depth origin check as config/git-identity/lifecycle — this
// is a mutating route, so it needs the same CSRF backstop alongside the
// session cookie (sameSite: 'lax').
const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

function requireSameOrigin(origin: string | undefined): void {
  if (origin !== ALLOWED_ORIGIN) {
    throw new ForbiddenException('cross-origin request rejected')
  }
}

// U4's "revoke all sessions" break-glass deliverable (see
// src/db/auth-session.repo.ts's header comment for the full rationale: why
// this exists, why it's an HTTP route rather than a shell/SQL operation, and
// why deleting session rows — not touching account/user — is the correct
// remediation).
//
// Flat admin (R19), same precedent as git-identity: no per-identity
// authorization. Any authenticated guild member can revoke any OTHER
// member's sessions — there is no "you can only revoke your own" check,
// matching the git-identity controller's own "no per-identity authorization
// in Phase C" decision. AuthGuard (auth.guard.ts) already guarantees the
// CALLER is authenticated before this handler ever runs; this controller
// adds no further role/scope check on top of that, by design.
@Controller('auth-admin')
export class AuthAdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  @Post('users/:discordUserId/revoke-sessions')
  @HttpCode(200)
  revokeSessions(
    @Headers('origin') origin: string | undefined,
    @Param('discordUserId') discordUserId: string,
  ): RevokeSessionsResponseDto {
    requireSameOrigin(origin)

    const parsed = DiscordSnowflakeSchema.safeParse(discordUserId)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid discordUserId',
      )
    }

    this.logger.warn(
      { targetDiscordUserId: parsed.data, origin },
      'Admin session-revoke requested',
    )
    const sessionsRevoked = revokeSessionsForDiscordUser(this.db, parsed.data)
    this.logger.warn(
      { targetDiscordUserId: parsed.data, sessionsRevoked },
      'Admin session-revoke completed',
    )
    return { discordUserId: parsed.data, sessionsRevoked }
  }
}
