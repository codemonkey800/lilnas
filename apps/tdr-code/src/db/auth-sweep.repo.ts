import { and, eq, sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { user } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// auth-sweep repo — compensating cleanup for U3's guild-gate seam (Option B).
//
// databaseHooks.account.create.before (auth.ts) can reject the `account`
// INSERT for a non-member AFTER Better Auth's internalAdapter.createOAuthUser
// has already committed the paired `user` row (see guild-gate.ts's long
// comment for the file:line trace of why: better-auth/dist/db/internal-
// adapter.mjs's createOAuthUser runs createWithHooks(..., "user", ...)
// BEFORE createWithHooks(..., "account", ...), and only the latter call is
// where our hook can return `false`). This repo deletes exactly the ONE
// accountless row this rejection orphaned (scoped by userId — see below) so
// AE5's "no usable rows" holds under Option B: a `user` row with no
// `account` row can never authenticate (Better Auth's own sign-in paths all
// key off `account.providerId`/`account.accountId`), so it is not itself a
// security hole — but an unswept one is still orphan-row growth under
// anonymous OAuth spam, hence "sweep, don't just accept."
//
// Scoped to a single userId, NOT a blanket "every accountless user" sweep —
// a prior version deleted every such row unconditionally, which meant a
// non-member's rejection could delete a DIFFERENT, concurrently in-flight
// member's own user row (see the next paragraph for exactly how that window
// opens), FK-failing their sign-in with `unable_to_create_user`. Scoping the
// DELETE to the userId this specific rejection produced (available on the
// databaseHooks payload before this call — see auth.ts's call site) removes
// that cross-request blast radius entirely; the row this rejection actually
// orphaned is still deleted the same way.
//
// A `user` row briefly WITHOUT an account row is possible for another
// reason too: another request racing between the two createWithHooks calls
// above. This gap is NOT protected by any real SQL transaction on Better
// Auth's own side, despite internal-adapter.mjs wrapping createOAuthUser in
// runWithTransaction(adapter, ...) (see @better-auth/core's context/
// transaction.mjs:53-81 + db/adapter/factory.mjs:18,404-410): with the
// drizzle adapter's transaction: false (this app's own config, required —
// see the "Do NOT set transaction: true" note in auth.ts), factory.mjs's
// own transaction method resolves `lazyLoadTransaction` to
// `createAsIsTransaction(adapter)`, defined at factory.mjs:18 as literally
// `(adapter) => (fn) => fn(adapter)` — a pass-through with NO `BEGIN`/
// `COMMIT` at all. So the `user` INSERT and the `account` INSERT genuinely
// are two separate, unprotected statements; the only atomicity either one
// gets is better-sqlite3's own IMPLICIT single-statement transaction. That
// implicit atomicity is exactly what this sweep's BEGIN IMMEDIATE (the
// begin-immediate-for-read-then-write-mutations convention) leans on: a
// concurrent in-flight sign-in's `user` row is either fully committed
// (visible, but its OWN account insert hasn't run yet — a real window) or
// not yet committed at all (invisible) — there is no partially-committed
// row this sweep could observe. IMMEDIATE's write lock still matters here:
// it serializes this sweep's read-then-delete against any OTHER writer
// (the bot process, a concurrent sweep) so the "which rows are accountless
// right now" read and the subsequent DELETE act on a consistent,
// non-racing snapshot — it just isn't providing cross-statement atomicity
// for Better Auth's own two inserts, because none exists to preserve.
// ──────────────────────────────────────────────────────────────────────────────

// Deletes the given `userId`'s `user` row IF it has no matching `account`
// row. Scoped to a single id (not a blanket "every accountless user" sweep
// — see this file's header comment for why) and single-purpose by design
// (per the plan: "keep it a single narrow DELETE") — this sweep runs inside
// the OAuth callback request itself and competes with the bot process for
// the WAL write lock (≤5s busy_timeout), so it must stay cheap. Returns the
// number of rows deleted — 0 or 1, never more, since `userId` is unique
// (for logging/observability at the call site — auth.ts logs a rejected
// sign-in either way, so this is not itself the audit trail).
export function sweepAccountlessUsers(db: Db, userId: string): number {
  return db.transaction(
    tx => {
      const result = tx
        .delete(user)
        .where(
          and(
            eq(user.id, userId),
            sql`NOT EXISTS (
              SELECT 1 FROM account WHERE account.user_id = ${user.id}
            )`,
          ),
        )
        .run()
      return result.changes
    },
    { behavior: 'immediate' },
  )
}
