import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { type ForwardedUser, resolveForwardedUser } from './forwarded-user'

// Exported separately so a unit test can call it with a minimal fake
// ExecutionContext.
export function extractCurrentUser(ctx: ExecutionContext): ForwardedUser {
  const req = ctx.switchToHttp().getRequest<Request>()
  const user = resolveForwardedUser(req)
  if (!user) {
    throw new UnauthorizedException(
      'Missing X-Forwarded-User / X-Forwarded-User-Id',
    )
  }
  return user
}

// Enforces presence itself rather than trusting that ForwardedUserGuard ran.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => extractCurrentUser(ctx),
)
