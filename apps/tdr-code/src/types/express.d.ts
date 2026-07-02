import type { Session, User } from 'better-auth'

// Global augmentation (mirrors apps/yoink/src/types/express.d.ts's own
// Request.user pattern) so auth.guard.ts's `request.user = ...`/
// `request.session = ...` assignments type-check without a cast, and so any
// controller that declares a plain `@Req() req: Request` param sees these
// fields as optional (never present on an unauthenticated request — there
// is none here, since AuthGuard runs globally before every non-@Public()
// handler, but the type itself must not assume that).
//
// Deliberately OPTIONAL here (not required) — the REQUIRED-both-fields
// narrowing lives in auth.guard.ts's AuthedRequest interface +
// isAuthenticated() type guard (the type-guards-over-nonnull-assertions
// convention: a subtype that makes the conditionally-present fields
// non-null, plus a runtime-checked guard — never a global `!`/`as`).
declare global {
  namespace Express {
    interface Request {
      user?: User
      session?: Session
    }
  }
}

export {}
