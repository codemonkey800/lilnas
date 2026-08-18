import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

import { type ForwardedUser, resolveForwardedUser } from './forwarded-user'

// Non-throwing counterpart to @CurrentUser(): apps/tdr-bot calls
// DownloadController's job-creation routes via
// DownloadClient.dockerInstance with no forwarded-user header at all, so
// none of those routes can hard-guard on identity the way @CurrentUser()
// does. Returns `undefined` for a service caller instead of throwing —
// callers record that as `requester: null` / `origin: 'service'`.
export function extractOptionalCurrentUser(
  ctx: ExecutionContext,
): ForwardedUser | undefined {
  const req = ctx.switchToHttp().getRequest<Request>()
  return resolveForwardedUser(req)
}

export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => extractOptionalCurrentUser(ctx),
)
