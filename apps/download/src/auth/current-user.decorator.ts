import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { type ForwardedUser, resolveForwardedUser } from './forwarded-user'

// Exported separately so a unit test can call it directly with a minimal
// fake ExecutionContext, without going through createParamDecorator()'s
// wrapper.
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

// Independently enforces presence (throws) rather than trusting that
// ForwardedUserGuard already ran — @CurrentUser() alone, with no
// @UseGuards(ForwardedUserGuard), is therefore already safe; stacking both
// is harmless (belt-and-suspenders, not redundant risk).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => extractCurrentUser(ctx),
)
