import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { getForwardedUser } from './forwarded-user'

// The identity primitive every later phase (attribution, admin-gating,
// audit log actor, Emby gating) builds on. Not applied to
// DownloadController in this phase — Phase 1 owns that. Wired into one
// new diagnostic route (AuthDebugController, below) so it has a real,
// curl-testable HTTP path now.
@Injectable()
export class ForwardedUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    if (!getForwardedUser(req)) {
      throw new UnauthorizedException(
        "Missing X-Forwarded-User / X-Forwarded-User-Id — request did not arrive through Traefik's lilnas-auth middleware",
      )
    }
    return true
  }
}
