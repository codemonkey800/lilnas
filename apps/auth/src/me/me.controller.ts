import { env } from '@lilnas/utils/env'
import {
  Controller,
  Get,
  Inject,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { isAdminEmail } from 'src/admin/admin.guard'
import { DB, type Db } from 'src/db/database.module'
import { EnvKeys } from 'src/env'
import { findUserById, listGrantsForUser } from 'src/grants/grants.repo'
import { listPendingRequestsForUser } from 'src/requests/requests.repo'
import { AccessCacheService } from 'src/verify/access-cache.service'

// ──────────────────────────────────────────────────────────────────────────────
// The self-service counterpart to admin.controller.ts's admin-only routes:
// any AUTHENTICATED user's own profile, current grants, and pending
// requests — what the redesigned home and pending pages render. Registered
// flat in app.module.ts's `controllers` array, matching every other
// controller in this app (there are no per-feature modules). Guarded only
// by AccessCacheService.resolveSession() directly, the same "401 if no
// session" pattern every other controller already uses — there is no
// AdminGuard here and no 403 case, since this route is for any signed-in
// user, not just admins.
//
// `isAdmin` is DERIVED from the same ADMIN_EMAILS allowlist AdminGuard
// checks (isAdminEmail(), re-exported from admin.guard.ts — no circular
// import, since that file never imports from src/me), never a stored role
// — this app's schema has no DB-backed role, and adding one for a single
// boolean the allowlist already answers would duplicate a source of truth
// that already exists.
// ──────────────────────────────────────────────────────────────────────────────

export type MeResponse = {
  name: string
  email: string
  image: string | null
  isAdmin: boolean
  blockedAt: string | null
  createdAt: string
  // Every service this user currently has standing access to — just the
  // hosts, mirroring AdminUserEntry.services' own shape (admin.controller.ts).
  grants: string[]
  // This user's own currently-pending requests (there can be more than one
  // — a person may have requested several gated services). The pending
  // page matches its own serviceHost against this list to show "Requested
  // {time}".
  pendingRequests: { serviceHost: string; createdAt: string }[]
}

@Controller()
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly accessCache: AccessCacheService,
  ) {}

  @Get('me')
  async me(@Req() req: Request): Promise<MeResponse> {
    const session = await this.accessCache.resolveSession(req.headers.cookie)
    if (!session) {
      throw new UnauthorizedException()
    }

    const user = findUserById(this.db, session.userId)
    if (!user) {
      // Should be unreachable in practice — a resolved session's userId
      // foreign-keys to a real `user` row with ON DELETE CASCADE
      // (schema.ts), so a session existing at all implies its user row
      // still does too. Handled defensively rather than assumed
      // impossible, matching this app's general fail-safe posture.
      throw new UnauthorizedException()
    }

    return {
      name: user.name,
      email: user.email,
      image: user.image,
      isAdmin: isAdminEmail(user.email, env(EnvKeys.ADMIN_EMAILS)),
      blockedAt: user.blockedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      grants: listGrantsForUser(this.db, session.userId).map(
        grant => grant.serviceHost,
      ),
      pendingRequests: listPendingRequestsForUser(this.db, session.userId).map(
        request => ({
          serviceHost: request.serviceHost,
          createdAt: request.createdAt.toISOString(),
        }),
      ),
    }
  }
}
