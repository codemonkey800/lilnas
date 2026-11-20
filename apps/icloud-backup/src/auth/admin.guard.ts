import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { AdminCheckService } from './admin-check.service'
import { resolveForwardedUser } from './forwarded-user'

// Admin-only gating for whole controllers/routes, layered on the same identity
// primitive as ForwardedUserGuard: missing identity is a 401, a resolved
// non-admin identity is a 403. The dev fallback identity still goes through
// the admin check like any other email. Fail-closed behaviour on an auth
// outage lives in AdminCheckService.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly adminCheckService: AdminCheckService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    const user = resolveForwardedUser(req)
    if (!user) {
      throw new UnauthorizedException(
        "Missing X-Forwarded-User / X-Forwarded-User-Id — request did not arrive through Traefik's lilnas-auth middleware",
      )
    }

    if (!(await this.adminCheckService.checkIsAdmin(user.email))) {
      throw new ForbiddenException('Admin access required')
    }

    return true
  }
}
