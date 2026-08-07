import { eq } from 'drizzle-orm'

import type { Db } from './database.module'
import { session } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// S2b: the "revoke all sessions" break-glass deliverable — mirrors
// apps/tdr-code/src/db/auth-session.repo.ts's identical rationale (see that
// file's own header comment for the full "why an HTTP route, why delete
// session rows rather than touch user/account" reasoning, unchanged here),
// adapted for this app's direct userId keying: unlike tdr-code, there is no
// Discord-snowflake indirection to resolve through `account` first —
// `session.userId` already IS the same `userId` admin.controller.ts's
// routes take as their own :userId param.
//
// WHY THIS EXISTS: UsersService.blockUser() (R16/AE6) stops a session from
// passing /verify on its NEXT request via the isBlocked check, but does
// nothing to the session ROW itself, and — critically — does nothing to
// AdminGuard's own deliberately independent session check either (see
// verify.service.ts's S2a header comment for why that independence is a
// load-bearing no-lockout property). A compromised ADMIN session therefore
// keeps full, unrestricted /admin access — approve/reject, block/unblock
// any account — until it naturally expires, unless it is actually revoked.
// This repo function, wired through UsersService.revokeSessions(), is the
// only remediation that closes that gap.
// ──────────────────────────────────────────────────────────────────────────────

// Deletes every `session` row belonging to `userId`. Read-then-write against
// a row the sign-in path can concurrently insert into (a fresh session
// created by the SAME user mid-revocation), wrapped in BEGIN IMMEDIATE per
// docs/archive/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md,
// mirroring every other read-then-write mutation in this app.
//
// Returns the number of session rows deleted (0 is a normal, expected
// outcome — a user with no active sessions — not an error; the caller
// decides whether 0 deserves a distinct response).
export function revokeSessionsForUser(db: Db, userId: string): number {
  return db.transaction(
    tx => {
      const result = tx.delete(session).where(eq(session.userId, userId)).run()
      return result.changes
    },
    { behavior: 'immediate' },
  )
}
