import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthService } from '@thallesp/nestjs-better-auth'
import type { Session, User } from 'better-auth'
import { fromNodeHeaders } from 'better-auth/node'
import type { Request } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { IS_PUBLIC_KEY } from './public.decorator'

// Better Auth's own exported model types (better-auth's root package
// re-exports `User`/`Session` from @better-auth/core/db — confirmed by
// reading dist/index.d.mts directly). These are exactly the shape
// auth.api.getSession() resolves `{ user, session }` to (session.mjs's
// getSession endpoint calls parseUserOutput/parseSessionOutput on the DB
// rows before returning them — the same two functions this app's schema.ts
// User/Session Drizzle rows feed into on write).
export type AuthedUser = User
export type AuthedSession = Session

// Two DISTINCT audit-log event names, deliberately not merged into one
// "auth failure" event — the plan calls this out explicitly: a WAL-
// contention lockout (getSession threw) must be distinguishable in Loki
// from "no cookie was sent" (getSession resolved null), because the former
// is an operational signal (the bot process is contending for the SQLite
// write lock) and the latter is routine (every anonymous request, every
// expired session). Exported so auth.guard.spec.ts asserts against these
// exact literals rather than re-typing (and risking silently diverging
// from) copies of the same two strings.
export const AUTH_DENIED_EVENT = 'auth_denied'
export const AUTH_CHECK_ERROR_EVENT = 'auth_check_error'

// Deny-by-default global guard (R19). Registered exactly once, as APP_GUARD,
// in app.module.ts. Every /api/* route requires a valid Better Auth session
// UNLESS annotated with @Public() (currently only GET /health).
//
// Deliberately hand-rolled rather than @thallesp/nestjs-better-auth's own
// AuthGuard (see the plan's "Key Technical Decisions" — that library guard
// is disabled via disableGlobalAuthGuard: true in auth.module.ts): a second,
// independently-sourced @Public() would make "is this route public"
// ambiguous between two metadata keys, and this guard's failure contract
// (below) deliberately diverges from what a generic library guard would do
// on a thrown DB error.
//
// AuthService is @thallesp's own injectable wrapper around the ONE
// betterAuth() instance auth.module.ts builds via buildAuth(db) (confirmed
// by reading the library's compiled dist/index.mjs: its AuthModule provides
// AND exports AuthService, and — load-bearing — its ConfigurableModuleBuilder
// defaults `isGlobal: true`, so the dynamic module auth.module.ts's
// forRootAsync(...) returns is marked `global: true` without auth.module.ts
// needing to say so explicitly; that's what makes AuthService injectable
// here despite AuthGuard never importing AuthModule itself). Calling
// AuthService.api.getSession(...) reuses the SAME auth instance (and its one
// shared DB connection) the mount uses — never a second, redundant
// betterAuth() construction.
//
// Flat admin (R19): this guard checks AUTHENTICATION only. There is no
// role/scope check anywhere in this file, and there must never be one —
// every authenticated guild member (already gated at sign-in by U3) is a
// full admin.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<Request>()

    // getSession's FAILURE CONTRACT (confirmed by reading better-auth's
    // installed dist/api/routes/session.mjs directly, not assumed from
    // docs):
    //   - no session cookie at all -> the endpoint's own early return is a
    //     bare `return null` (no throw) — resolves to `null`.
    //   - a found session row that is expired -> ALSO resolves to `null`
    //     (a second `return ctx.json(null)` a few lines later), not a
    //     throw — an expired cookie is NOT distinguished from "no cookie"
    //     at this API surface.
    //   - a genuine failure reading the session row from SQLite (e.g. a
    //     SQLITE_BUSY contention error from internalAdapter.findSession)
    //     propagates out of the endpoint's own try body and is caught by
    //     its OWN catch block, which re-wraps it as
    //     `APIError.from('INTERNAL_SERVER_ERROR', ...)` and RE-THROWS —
    //     this is a genuine throw out of auth.api.getSession(), not a
    //     resolved value.
    // The distinction this guard must preserve: "null" is a normal,
    // frequent, unauthenticated request (auth_denied); a THROW is an
    // abnormal condition worth its own Loki-distinguishable event
    // (auth_check_error) — per the plan, explicitly NOT mirroring yoink's
    // jwt-auth.guard.ts, which throws InternalServerErrorException (a 500)
    // on a DB read failure here. This guard fails closed to 401 in BOTH
    // cases — a 500 would be worse than a 401 (it tells a prober "something
    // is different about this request" and, more importantly, a flaky
    // getSession must never accidentally ALLOW).
    let result: { user: AuthedUser; session: AuthedSession } | null
    try {
      result = await this.authService.api.getSession({
        headers: fromNodeHeaders(request.headers),
      })
    } catch (error) {
      this.logger.error(
        { err: error, path: request.originalUrl },
        AUTH_CHECK_ERROR_EVENT,
      )
      throw new UnauthorizedException()
    }

    if (!result) {
      this.logger.warn({ path: request.originalUrl }, AUTH_DENIED_EVENT)
      throw new UnauthorizedException()
    }

    // Attach BOTH fields together so a request can never be "half
    // authenticated" (e.g. user set but session missing) even transiently.
    request.user = result.user
    request.session = result.session

    return true
  }
}
