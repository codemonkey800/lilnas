import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { getDiscordUserIdForUser } from 'src/db/github-credential.repo'

import {
  DiscordSnowflakeSchema,
  UpsertGitIdentityBodySchema,
} from './git-identity.dto'
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
//
// U5 (R2): POST /git-identity and DELETE /git-identity (self-clear) are now
// PURELY self-service — there is no "act on the SSH key of another user"
// upsert or self-styled clear path at all, mirroring github-link
// .controller.ts's own self/break-glass asymmetry (linking/self-clear is
// self-only; only the break-glass CLEAR route still takes an explicit id).
// GET /git-identity/discord-members (the "pick a user" dropdown backing
// route) is removed entirely, not just hidden client-side — this closes R2
// for real, not just in the UI. DELETE /git-identity/:discordUserId remains
// flat-admin (no per-identity authorization), same posture as before.
@Controller('git-identity')
export class GitIdentityController {
  constructor(
    private readonly service: GitIdentityService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get()
  listIdentities() {
    return this.service.listIdentities()
  }

  // Self-service upsert — discordUserId is resolved from the authenticated
  // session (req.user.id -> account.accountId via getDiscordUserIdForUser),
  // never accepted from the request body (R2; UpsertGitIdentityBodySchema no
  // longer has a discordUserId field at all). request.user is typed optional
  // (src/types/express.d.ts: "no compile-time guarantee AuthGuard already
  // ran"), so this is guarded defensively rather than asserted with `!` —
  // mirrors github-link.controller.ts's identical req.user?.id posture
  // (docs/solutions/conventions/type-guards-over-nonnull-assertions-on-db-
  // rows-2026-05-30.md's discipline, applied to a non-DB-row optional field
  // for the same reason: never trust an optional value with `!`). Should
  // never actually be undefined in practice — Discord is this app's only
  // sign-in provider — but this is a read path, not an invariant-enforcing
  // one, so it degrades to a thrown UnauthorizedException rather than a
  // silent wrong-user write.
  @Post()
  @HttpCode(200)
  upsertIdentity(
    @Headers('origin') origin: string | undefined,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    requireSameOrigin(origin)

    const userId = req.user?.id
    if (!userId) {
      throw new UnauthorizedException()
    }

    const discordUserId = getDiscordUserIdForUser(this.db, userId)
    if (!discordUserId) {
      throw new UnauthorizedException()
    }

    const parsed = UpsertGitIdentityBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid git-identity body',
      )
    }

    return this.service.upsertIdentity(discordUserId, parsed.data)
  }

  // Self-clear — no id param; discordUserId is resolved from the
  // authenticated session, the SAME way upsertIdentity above resolves it.
  @Delete()
  @HttpCode(200)
  deleteOwnIdentity(
    @Headers('origin') origin: string | undefined,
    @Req() req: Request,
  ) {
    requireSameOrigin(origin)

    const userId = req.user?.id
    if (!userId) {
      throw new UnauthorizedException()
    }

    const discordUserId = getDiscordUserIdForUser(this.db, userId)
    if (!discordUserId) {
      throw new UnauthorizedException()
    }

    this.service.deleteIdentity(discordUserId)
    return { accepted: true }
  }

  // Break-glass clear — flat-admin, no per-identity authorization, explicit
  // Discord snowflake param. Unchanged behavior from pre-U5.
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
