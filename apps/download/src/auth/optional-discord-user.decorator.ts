import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

import {
  type DiscordRequester,
  getDiscordDisplayName,
  getDiscordRequester,
} from './discord-user'

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

// Deliberately a *second* decorator rather than a widened return from
// `@OptionalDiscordUser()`. The display name is not part of
// `DiscordRequester` and never reaches a job row (see `getDiscordDisplayName`
// for why), so folding it into that decorator's value would put a field on
// the attribution object that must never be persisted - the kind of shape
// that gets spread into a record by accident exactly once.
//
// Only `DownloadController`'s create routes read it, and only to hand it to
// `DiscordLinkService.registerObservedIdentity()` as roster enrichment.
export function extractOptionalDiscordDisplayName(
  ctx: ExecutionContext,
): string | undefined {
  const req = ctx.switchToHttp().getRequest<Request>()
  return getDiscordDisplayName(req)
}

export const OptionalDiscordDisplayName = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    extractOptionalDiscordDisplayName(ctx),
)
