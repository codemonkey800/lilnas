import { and, eq } from 'drizzle-orm'

import type { Db } from './database.module'
import { account, githubCredential, type GithubCredentialRow } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// github_credential repo — sibling to git-identity.repo.ts, for the encrypted
// GitHub OAuth token rather than an SSH private key.
//
// CRITICAL INVARIANT (see schema.ts's header comment on githubCredential for
// the full write-side non-atomicity trace): every read here that answers
// "is this user linked?" INNER JOINs against `account` (providerId =
// 'github', account.userId = github_credential.userId) before returning a
// row as found. A bare `github_credential` read is never sufficient — the
// hook that writes this table and Better Auth's own `account` insert are
// two independent, non-transactional operations, so an orphaned
// github_credential row with no matching `account` row is a real, expected
// possibility, not a hypothetical. An orphaned row must resolve as
// not-linked everywhere, mirroring the existing Discord guild-gate hook's
// "never trust write-side atomicity across a Better Auth hook boundary"
// posture (see auth/guild-gate.ts and db/auth-sweep.repo.ts).
// ──────────────────────────────────────────────────────────────────────────────

// Returns the credential row for `userId` ONLY if a matching `account` row
// (providerId 'github') also exists — see the file header's inner-join
// invariant. An orphaned github_credential row (no matching account row)
// returns undefined, exactly as if no row existed at all.
export function getGithubCredential(
  db: Db,
  userId: string,
): GithubCredentialRow | undefined {
  const row = db
    .select({ githubCredential })
    .from(githubCredential)
    .innerJoin(
      account,
      and(
        eq(account.userId, githubCredential.userId),
        eq(account.providerId, 'github'),
      ),
    )
    .where(eq(githubCredential.userId, userId))
    .get()
  return row?.githubCredential
}

// Two-hop join: account (providerId 'discord', accountId = discordUserId) ->
// userId -> github_credential row for that userId, ALSO requiring the
// providerId='github' account row per the inner-join invariant above (a
// three-table join in one query, not N+1). Returns undefined for a Discord
// user with no linked GitHub credential, or one whose github_credential row
// is orphaned — never throws.
export function getGithubCredentialByDiscordUserId(
  db: Db,
  discordUserId: string,
): GithubCredentialRow | undefined {
  const discordAccount = db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, 'discord'),
        eq(account.accountId, discordUserId),
      ),
    )
    .get()

  if (!discordAccount) {
    return undefined
  }

  return getGithubCredential(db, discordAccount.userId)
}

// Mirror-direction lookup of getGithubCredentialByDiscordUserId above: given
// a Better Auth `user.id`, find that user's linked Discord snowflake (the
// account row with providerId 'discord'). Added for the U4 frontend unit —
// useSession()'s client-side `user` object exposes only Better Auth's own
// opaque id/name/email/image (schema.ts's `user` table has no snowflake
// column), so the console frontend cannot answer "what is MY Discord
// snowflake" without a server-side round-trip through this exact join.
// Returns undefined for a user with no Discord account row at all (should
// not happen in practice — Discord is this app's only sign-in provider —
// but this is a read path, not an invariant-enforcing one, so it degrades
// to undefined rather than throwing).
export function getDiscordUserIdForUser(
  db: Db,
  userId: string,
): string | undefined {
  const discordAccount = db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'discord')))
    .get()

  return discordAccount?.accountId
}

export interface UpsertGithubCredentialInput {
  userId: string
  githubUserId: string
  githubLogin: string
  derivedName: string
  derivedEmail: string
  tokenCiphertext: Buffer
  tokenIv: Buffer
  tokenAuthTag: Buffer
  scope: string
}

// Insert or overwrite — a re-link (same userId) replaces the prior row's
// token and derived identity entirely rather than creating a second row;
// the PRIMARY KEY on userId is itself the "no multiple-GitHub-accounts per
// user" enforcement (Scope Boundaries). Wrapped in BEGIN IMMEDIATE per the
// begin-immediate-for-read-then-write-mutations convention — this is a pure
// upsert with no preceding read, but the convention's "paired writes must
// roll back together" guidance and this table's role as a hook-boundary
// write target (a concurrent break-glass-clear delete could race this same
// userId) both argue for IMMEDIATE over the DEFERRED default.
export function upsertGithubCredential(
  db: Db,
  input: UpsertGithubCredentialInput,
): GithubCredentialRow {
  return db.transaction(
    tx => {
      const now = new Date()
      return tx
        .insert(githubCredential)
        .values({
          userId: input.userId,
          githubUserId: input.githubUserId,
          githubLogin: input.githubLogin,
          derivedName: input.derivedName,
          derivedEmail: input.derivedEmail,
          tokenCiphertext: input.tokenCiphertext,
          tokenIv: input.tokenIv,
          tokenAuthTag: input.tokenAuthTag,
          scope: input.scope,
          masterKeyVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: githubCredential.userId,
          set: {
            githubUserId: input.githubUserId,
            githubLogin: input.githubLogin,
            derivedName: input.derivedName,
            derivedEmail: input.derivedEmail,
            tokenCiphertext: input.tokenCiphertext,
            tokenIv: input.tokenIv,
            tokenAuthTag: input.tokenAuthTag,
            scope: input.scope,
            masterKeyVersion: 1,
            updatedAt: now,
          },
        })
        .returning()
        .get()
    },
    { behavior: 'immediate' },
  )
}

export function deleteGithubCredential(db: Db, userId: string): void {
  db.delete(githubCredential).where(eq(githubCredential.userId, userId)).run()
}

export interface GithubCredentialStatus {
  userId: string
  discordUserId: string | undefined
  githubLogin: string | undefined
  linked: boolean
}

// Roster source: one row per known Discord-linked user (every account row
// with providerId 'discord'), each resolved to a linked/not-linked status
// via getGithubCredential — so a user with no github_credential row at all
// (or an orphaned one, see this file's header invariant) still appears with
// linked: false, rather than being silently absent from the roster or
// falsely reported as linked. Deliberately reuses getGithubCredential's
// query (rather than a second, hand-rolled LEFT JOIN over
// account+account+github_credential) so "linked" here can never drift from
// what getGithubCredential/getGithubCredentialByDiscordUserId themselves
// report for the same userId — one inner-join implementation, not two that
// must be kept in sync.
export function listGithubCredentialStatuses(db: Db): GithubCredentialStatus[] {
  const discordAccounts = db
    .select({ userId: account.userId, discordUserId: account.accountId })
    .from(account)
    .where(eq(account.providerId, 'discord'))
    .all()

  if (discordAccounts.length === 0) {
    return []
  }

  // The roster is a small, personal-Discord-server-sized list (see
  // discord-directory.service.ts's own "not worth paging past 1000 members"
  // precedent), so one lookup per known Discord user id is not a meaningful
  // cost versus a second, hand-rolled join query (see the header comment).
  return discordAccounts.map(({ userId, discordUserId }) => {
    const credential = getGithubCredential(db, userId)
    return {
      userId,
      discordUserId,
      githubLogin: credential?.githubLogin,
      linked: credential !== undefined,
    }
  })
}
