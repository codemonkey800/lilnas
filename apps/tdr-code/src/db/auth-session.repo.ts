import { sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { session } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// auth-session repo — the U4 "revoke all sessions" break-glass deliverable.
//
// WHY THIS EXISTS (see the plan's "Key Technical Decisions" session-TTL
// bullet, which calls this "a required U4 deliverable"): U3's guild check
// runs at sign-in only (D10) — a member who is later kicked or whose account
// is compromised keeps full access to an RCE-equivalent surface
// (PUT /config's claudeArgs/cwd argv-injection vector) until their session's
// 12h expiresIn ceiling. Without an explicit revoke path, the ONLY way to
// cut that access short is rotating BETTER_AUTH_SECRET fleet-wide (which
// signs every session, so rotating it invalidates ALL sessions for ALL
// members, not just the one being revoked) or restarting with a fresh
// SQLite file — neither is a targeted, single-operator remediation.
//
// WHY A NEW HTTP ROUTE (not a CLI/shell operation): the whole point of this
// app is that operators never need to shell into the host or hand-write SQL
// against a live SQLite file the bot process has open (see CLAUDE.md's
// "Container and File Management" note and the app's own console-first
// design) — a break-glass path that requires SSH access defeats that. This
// repo backs a new guarded POST route
// (auth-admin.controller.ts's revokeSessions), consistent with the existing
// git-identity controller's flat-admin precedent ("any admin edits anyone,"
// R19 — authentication IS authorization here, so there is no
// "only I can revoke my own sessions" restriction; any authenticated member
// can revoke any other member's sessions, matching the git-identity
// controller's own "no per-identity authorization in Phase C" decision).
//
// WHY delete session rows (not null the Discord account.accessToken, and
// not touch the user/account rows): Better Auth's session validity is
// determined ENTIRELY by whether a `session` row with a matching token and
// a non-expired expiresAt exists (session.mjs's getSession endpoint —
// AuthGuard's own long comment traces this) — deleting every `session` row
// for a user makes every session cookie that user currently holds resolve
// to "no session" (auth_denied) on their very next request, everywhere,
// immediately. This is the targeted remediation the TTL-decision bullet
// asks for: no BETTER_AUTH_SECRET rotation (which would also log out every
// OTHER member), no restart, no direct SQL.
// ──────────────────────────────────────────────────────────────────────────────

// Deletes every `session` row belonging to the user linked to the given
// Discord snowflake (joined through `account.accountId` — the same raw
// snowflake string git_identity.discordUserId and the bot's
// message.author.id use, per schema.ts's identity invariant). Scoped to
// providerId 'discord' for the same reason session-user.ts's
// discordUserIdForSession is: only the Discord social provider is
// configured today, but a future non-social account row must never be
// mistaken for a Discord identity.
//
// Read-then-write against a row the sign-in path (auth.ts's OAuth callback)
// can concurrently insert into (a fresh session created by the SAME user
// mid-revocation) — wrapped in BEGIN IMMEDIATE per the
// begin-immediate-for-read-then-write-mutations convention so this DELETE's
// snapshot is a consistent one, not a racing DEFERRED read. Narrow and
// single-purpose (auth-sweep.repo.ts's own precedent): one DELETE via a
// correlated subquery, not a two-step select-then-delete-by-id-list.
//
// Returns the number of session rows deleted (0 is a normal, expected
// outcome — a user with no active sessions, or a discordUserId with no
// linked account at all — not an error; the controller call site decides
// whether 0 deserves a distinct response).
export function revokeSessionsForDiscordUser(
  db: Db,
  discordUserId: string,
): number {
  return db.transaction(
    tx => {
      const result = tx
        .delete(session)
        .where(
          sql`${session.userId} IN (
            SELECT account.user_id FROM account
            WHERE account.provider_id = 'discord'
              AND account.account_id = ${discordUserId}
          )`,
        )
        .run()
      return result.changes
    },
    { behavior: 'immediate' },
  )
}
