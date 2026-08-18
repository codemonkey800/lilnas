export type GithubRosterStatus = 'linked' | 'not-linked' | 'decrypt-failed'
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
  // Better Auth's own opaque user id for this member's GitHub credential
  // row — present whenever github !== 'not-linked' (i.e. a github_credential
  // row exists, whether or not its token still decrypts), so a
  // 'decrypt-failed' row can still be break-glass-cleared, not just a
  // healthy 'linked' one. Named betterAuthUserId (not linkedUserId, not
  // githubUserId) to distinguish it from both the Discord snowflake in
  // discordUserId above and GitHub's own numeric profile id used elsewhere
  // in the codebase. GithubLinkController's break-glass route (DELETE
  // /git/github/:userId) takes this id, never a snowflake.
  betterAuthUserId?: string
}

export type RosterResponseDto = RosterEntryDto[]
