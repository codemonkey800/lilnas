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

// Admin-only gating for whole controllers/routes, layered on the same
// identity primitive as ForwardedUserGuard: missing identity is a 401 (the
// request never proved who it is), a resolved non-admin identity is a 403
// (we know who it is, they just aren't allowed).
//
// Resolves identity via resolveForwardedUser() rather than trusting request
// mutation from another guard, so this can be used ALONE and still reject
// missing identity — the same independence @CurrentUser() and
// ForwardedUserGuard have from each other. That also means the dev fallback
// identity (DEV_USER_EMAIL/DEV_USER_ID) still goes through the admin check
// like any other email: it is a way to *have* an identity in dev, not a way
// to be an admin.
//
// Fail-closed behavior on an auth outage lives in AdminCheckService (it
// caches `false` for a short TTL); deliberately no retry or bypass here.
//
// Not a fit for every admin-flavored rule: DownloadController.getHistory()
// keeps its inline 403 because its "admins may query others, everyone may
// query themselves" rule depends on the parsed query, which a
// class/route-level guard runs too early to see.
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
