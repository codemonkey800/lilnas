import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

import { type DiscordRequester, getDiscordRequester } from './discord-user'

// Discord-side counterpart to @OptionalCurrentUser(). Always optional, never
// throwing: browser traffic arriving via Traefik carries no Discord headers at
// all, and only apps/tdr-bot's job-creation calls set them. Returns
// `undefined` for every non-Discord caller instead of throwing — callers fall
// back to the forwarded identity (or to `requester: null` / `origin:
// 'service'`) exactly as they do today.
export function extractOptionalDiscordUser(
  ctx: ExecutionContext,
): DiscordRequester | undefined {
  const req = ctx.switchToHttp().getRequest<Request>()
  return getDiscordRequester(req)
}

export const OptionalDiscordUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => extractOptionalDiscordUser(ctx),
)
