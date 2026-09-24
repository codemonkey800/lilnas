import { env } from '@lilnas/utils/env'
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import type { IncomingMessage } from 'http'

import { EnvKeys } from 'src/env'

const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i

/** Constant-time string comparison; unequal lengths short-circuit to false. */
function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, 'utf8')
  const expectedBuf = Buffer.from(expected, 'utf8')

  if (providedBuf.length !== expectedBuf.length) return false

  return timingSafeEqual(providedBuf, expectedBuf)
}

/**
 * Authenticates Grafana's webhook contact point via
 * `Authorization: Bearer <GRAFANA_WEBHOOK_TOKEN>`.
 *
 * Fails closed: with the token env unset every request is rejected. The
 * token is read per request so rotating it only needs a restart, and it is
 * never logged. Applied per-controller, never globally.
 */
@Injectable()
export class GrafanaWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = env(EnvKeys.GRAFANA_WEBHOOK_TOKEN, '')

    if (!expected) throw new UnauthorizedException()

    const request = context.switchToHttp().getRequest<IncomingMessage>()
    const header = request.headers.authorization
    const match =
      typeof header === 'string' ? BEARER_PATTERN.exec(header) : null

    if (!match || !tokensMatch(match[1], expected)) {
      throw new UnauthorizedException()
    }

    return true
  }
}
