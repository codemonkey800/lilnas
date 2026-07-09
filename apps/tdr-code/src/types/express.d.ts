import type { Session, User } from 'better-auth'

// Global augmentation (mirrors apps/yoink/src/types/express.d.ts's own
// Request.user pattern) so auth.guard.ts's `request.user = ...`/
// `request.session = ...` assignments type-check without a cast, and so any
// controller that declares a plain `@Req() req: Request` param sees these
// fields as optional (never present on an unauthenticated request — there
// is none here, since AuthGuard runs globally before every non-@Public()
// handler, but the type itself must not assume that).
//
// Deliberately OPTIONAL here (not required) — a plain @Req() req: Request
// param has no compile-time guarantee AuthGuard already ran (even though it
// always has, by construction), so a consumer that needs both fields
// guaranteed-present should narrow with its own runtime check rather than
// a global `!`/`as` assertion.
declare global {
  namespace Express {
    interface Request {
      user?: User
      session?: Session
    }
  }
}

export {}
