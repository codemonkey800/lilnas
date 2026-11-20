import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import type { Request } from 'express'

/** The header every POST carries; the frontend sends it from `lib/api.ts`. */
export const REQUESTED_WITH_HEADER = 'x-requested-with'
export const REQUESTED_WITH_VALUE = 'icloud-backup'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Refuses a state-changing request that lacks `X-Requested-With:
 * icloud-backup`. A form on another site cannot set a custom header, and a
 * script on another site needs a CORS preflight this server never grants, so
 * neither can post a password or reset an Immich password.
 */
@Injectable()
export class RequestedWithGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    if (SAFE_METHODS.has(req.method)) return true

    if (req.headers[REQUESTED_WITH_HEADER] !== REQUESTED_WITH_VALUE) {
      throw new ForbiddenException('Missing X-Requested-With header.')
    }
    return true
  }
}
