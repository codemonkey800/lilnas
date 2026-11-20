import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { resolveForwardedUser } from './forwarded-user'
import { IS_PUBLIC_KEY } from './public.decorator'

// Registered globally (AuthModule's APP_GUARD), so every route needs an
// identity unless it is marked @Public(). A request without both
// X-Forwarded-User headers (or the dev fallback) is a 401.
@Injectable()
export class ForwardedUserGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (isPublic) return true

    const req = context.switchToHttp().getRequest<Request>()
    if (!resolveForwardedUser(req)) {
      throw new UnauthorizedException(
        "Missing X-Forwarded-User / X-Forwarded-User-Id: request did not arrive through Traefik's lilnas-auth middleware",
      )
    }
    return true
  }
}
