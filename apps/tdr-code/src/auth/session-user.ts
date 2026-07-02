import { and, eq } from 'drizzle-orm'

import type { Db } from 'src/db/database.module'
import { account } from 'src/db/schema'

import type { AuthedUser } from './auth.guard'

// Maps an authenticated request's Better Auth `user` row to the Discord
// snowflake that keys git-identity attribution (Phase C) and the bot's own
// `message.author.id` — the identity invariant schema.ts documents:
// account.accountId (providerId 'discord') === git_identity.discordUserId
// === message.author.id. This is the one helper that makes that invariant
// usable from request-handling code, so nav display / git-identity call
// sites read one function instead of re-deriving the join.
//
// Returns `undefined` (not a thrown error) when no Discord account row is
// linked to the session's user — this should be structurally impossible
// post-U3 (every provisioned `user` row that ever completes a real sign-in
// has exactly one 'discord' `account` row; the guild gate rejects and
// sweeps anything that doesn't), but a helper that reads a foreign table on
// every guarded request should not assume a schema invariant holds forever
// without a runtime check — an undefined return lets a call site decide
// whether "no linked Discord account" is a 404/500/log-and-continue, rather
// than this helper picking one on their behalf.
export function discordUserIdForSession(
  db: Db,
  authedUser: AuthedUser,
): string | undefined {
  // Scoped to providerId 'discord' — same defensive discipline as auth.ts's
  // guild-gate hook ("scoped to providerId 'discord' rather than assuming
  // every account row is one"). Only the Discord social provider is
  // configured today (auth.ts's `socialProviders`/`plugins`), so this
  // filter is currently a no-op in practice, but a future non-social
  // provider account row linked to the same user must never be mistaken
  // for the Discord identity this helper exists to resolve.
  const row = db
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(eq(account.userId, authedUser.id), eq(account.providerId, 'discord')),
    )
    .get()
  return row?.accountId
}
