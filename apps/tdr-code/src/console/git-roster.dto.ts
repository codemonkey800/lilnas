export type GithubRosterStatus = 'linked' | 'not-linked'
export type SshRosterStatus = 'configured' | 'not-configured' | 'decrypt-failed'

// Shared, documented response shape (R3) — the frontend (U4) imports this
// type directly. Read-only; never carries tokenCiphertext/tokenIv/
// tokenAuthTag, a decrypted GitHub token, or decrypted SSH key bytes (R7-
// adjacent — the roster is status only, never secrets).
export interface RosterEntryDto {
  discordUserId: string
  displayName: string
  github: GithubRosterStatus
  ssh: SshRosterStatus
  // Better Auth's own opaque user id for this member's linked GitHub
  // account — present ONLY when github === 'linked'. Deliberately NOT named
  // `githubUserId` (that name is already taken elsewhere in this codebase —
  // schema.ts's githubCredential.githubUserId, UpsertGithubCredentialInput —
  // for GitHub's own numeric profile id, a completely different value).
  // Added for the U4 frontend unit: GithubLinkController's break-glass-clear
  // route (DELETE /git/github/:userId) takes a Better Auth userId, NOT a
  // Discord snowflake, but discordUserId above IS a Discord snowflake — the
  // two are never the same value for any user in this app (schema.ts's
  // `user` table has no snowflake column; a user's Discord identity lives
  // only on its own `account` row). Without this field, the roster's
  // "Clear" action for GitHub would have no valid id to send. Sourced from
  // listGithubCredentialStatuses' own per-row `userId` (already computed
  // server-side, just not previously threaded through to this DTO).
  linkedUserId?: string
}

export type RosterResponseDto = RosterEntryDto[]
