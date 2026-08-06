import { env } from '@lilnas/utils/env'
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'

import { EnvKeys } from 'src/env'
import { AccessCacheService } from 'src/verify/access-cache.service'

import { normalizeEmail } from './normalize-email'

// ──────────────────────────────────────────────────────────────────────────────
// U7 (R17, AE5): admin authorization for src/admin/admin.controller.ts's API
// routes. Reads ONLY the signed-in session (via AccessCacheService.
// resolveSession(), the same zero-extra-cost lookup /verify and the SSE
// controller already use) and the ADMIN_EMAILS env allowlist — it NEVER
// touches grants/blocked state. That independence is the entire point of
// R17: an ADMIN_EMAILS address's own admin access must survive an empty or
// fully unreadable grants table (AE5), and must not become revocable by
// anything an admin action itself writes to that table. This is directly
// informed by docs/archive/runbooks/tdr-code-phase-d-forward-auth-cutover.md §5.1 —
// re-adding an edge auth gate does nothing when the APP-OWNED authorization
// layer behind it is present-but-broken; keeping admin authorization on a
// completely separate, minimal code path is what prevents that failure mode
// here.
//
// 401 (UnauthorizedException) for "no session at all", 403
// (ForbiddenException) for "signed in but not an admin email" — this guard
// only governs the API layer. The admin Next.js pages (src/app/admin/*)
// perform their OWN separate, page-level session check and redirect an
// unauthenticated visitor to /login (the user-facing navigation this guard
// itself has no way to produce, since it has no response object to redirect
// with) — see those pages' own header comments.
// ──────────────────────────────────────────────────────────────────────────────
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly accessCache: AccessCacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>()
    const session = await this.accessCache.resolveSession(req.headers.cookie)
    if (!session) {
      throw new UnauthorizedException()
    }
    if (!isAdminEmail(session.email, env(EnvKeys.ADMIN_EMAILS))) {
      throw new ForbiddenException()
    }
    return true
  }
}

// Exported for direct unit testing without constructing a full guard +
// fake ExecutionContext for every case/whitespace variant. Empty entries
// (a trailing comma, or ADMIN_EMAILS set to an empty string) are filtered
// out rather than ever matching an empty-string session email — better-auth
// itself never issues a user row with a blank email, but this keeps the
// allowlist inert against a misconfiguration either way.
export function isAdminEmail(email: string, adminEmailsEnv: string): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return adminEmailsEnv
    .split(',')
    .map(entry => normalizeEmail(entry))
    .filter(Boolean)
    .includes(normalized)
}
