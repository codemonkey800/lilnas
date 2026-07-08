import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Headers,
  HttpCode,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { BetterAuthUserIdSchema } from './github-link.dto'
import { GithubLinkService } from './github-link.service'

// Same origin-config source every other console mutating route uses
// (config.controller.ts / git-identity.controller.ts / auth-admin
// .controller.ts / lifecycle.controller.ts) — kept in sync deliberately, not
// independently re-derived.
const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

function requireSameOrigin(origin: string | undefined): void {
  if (origin !== ALLOWED_ORIGIN) {
    throw new ForbiddenException('cross-origin request rejected')
  }
}

// R13: unlink is self-service; break-glass clear is flat-admin (R19, same
// precedent as auth-admin.controller.ts's revoke-sessions route and
// git-identity.controller.ts's delete route — any authenticated guild
// member can clear any OTHER member's GitHub link, no per-identity
// authorization). Both routes are guarded by the global AuthGuard
// (auth.guard.ts, registered as APP_GUARD in app.module.ts) — neither
// carries @Public(), so `request.user` is always populated by the time
// either handler runs.
//
// Never returns tokenCiphertext/tokenIv/tokenAuthTag, a decrypted GitHub
// token, or any token-derived secret (R7) — GithubLinkService.unlink's
// response shape ({ unlinked: boolean }) structurally cannot carry one.
@Controller('git/github')
export class GithubLinkController {
  constructor(private readonly service: GithubLinkService) {}

  // Self-unlink — no body/param; userId is resolved from the authenticated
  // session (req.user.id), the SAME id github_credential.userId/account
  // .userId are keyed on (AuthGuard populates request.user with Better
  // Auth's own `user` row on every successful request — see auth.guard.ts).
  // request.user is typed optional (src/types/express.d.ts's own comment:
  // "no compile-time guarantee AuthGuard already ran"), so this is guarded
  // defensively rather than asserted with `!` — should never actually be
  // undefined here since AuthGuard already ran, but the type doesn't
  // promise that, so the guard mirrors auth.guard.ts's own failure posture
  // (UnauthorizedException) rather than trusting the optional field blindly
  // (docs/solutions/conventions/type-guards-over-nonnull-assertions-on-db-
  // rows-2026-05-30.md's discipline, applied here to a non-DB-row optional
  // field for the same reason: never trust an optional value with `!`).
  @Delete()
  @HttpCode(200)
  async unlinkSelf(
    @Headers('origin') origin: string | undefined,
    @Req() req: Request,
  ) {
    requireSameOrigin(origin)

    const userId = req.user?.id
    if (!userId) {
      throw new UnauthorizedException()
    }

    return this.service.unlink(userId)
  }

  // Break-glass clear — flat-admin, no per-identity authorization. :userId
  // is a Better Auth user id (opaque, library-generated string), NOT a
  // Discord snowflake — DiscordSnowflakeSchema from git-identity.dto.ts must
  // not be reused here.
  @Delete(':userId')
  @HttpCode(200)
  async unlinkOther(
    @Headers('origin') origin: string | undefined,
    @Param('userId') userId: string,
  ) {
    requireSameOrigin(origin)

    const parsed = BetterAuthUserIdSchema.safeParse(userId)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid userId',
      )
    }

    return this.service.unlink(parsed.data)
  }
}
