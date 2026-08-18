import { Inject, Injectable } from '@nestjs/common'

import {
  isGithubConfigured,
  resolveGithubToken,
} from 'src/crypto/github-token-resolution'
import {
  isConfigured,
  isDecryptFailed,
  resolveIdentity,
} from 'src/crypto/identity-resolution'
import { loadMasterKey } from 'src/crypto/master-key'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { listIdentities } from 'src/db/git-identity.repo'
import { listGithubCredentialRows } from 'src/db/github-credential.repo'

import { DiscordDirectoryService } from './discord-directory.service'
import type {
  GithubRosterStatus,
  RosterEntryDto,
  RosterResponseDto,
  SshRosterStatus,
} from './git-roster.dto'

// Joins listGithubCredentialRows (U1) with DiscordDirectoryService's guild
// member list into one roster row per guild member. GitHub status is
// matched by discordUserId (listGithubCredentialRows' own account.accountId
// for providerId 'discord'); a guild member absent from that list entirely
// (no account row of ANY kind, GitHub or otherwise) is 'not-linked' — the
// same "missing means not configured" posture applied to a user with no
// github_credential row.
//
// BOTH axes mirror GitTurnContext.begin()'s EXACT resolution call shape
// (loadMasterKey() -> get*(db, userId) -> resolve*(row, masterKey)) so a
// decrypt failure is distinguishable from not-configured on the roster
// exactly as it would be at turn time — never a raw row-exists-or-not check
// (which cannot tell "no key/token" apart from "key/token exists but its
// master-key-encrypted blob no longer decrypts"). GitHub status previously
// WAS a raw row-exists-or-not check (listGithubCredentialStatuses' old
// `linked: credential !== undefined`); see github-link.dto.ts's
// GithubStatusResponseSchema comment for the incident that gap caused.
@Injectable()
export class GitRosterService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly discordDirectory: DiscordDirectoryService,
  ) {}

  async listRoster(): Promise<RosterResponseDto> {
    const members = await this.discordDirectory.listGuildMembers()
    const githubRows = listGithubCredentialRows(this.db)

    // Keyed by discordUserId — carries the raw credential row (or
    // undefined) plus the Better Auth userId behind it, so status can be
    // resolved below via the SAME resolveGithubToken() call GitTurnContext
    // makes at turn time, not a row-exists-or-not check.
    const githubByDiscordUserId = new Map(
      githubRows
        .filter(row => row.discordUserId !== undefined)
        .map(row => [
          row.discordUserId as string,
          { credential: row.credential, userId: row.userId },
        ]),
    )

    const masterKey = loadMasterKey()
    // Batch-load all identity rows in one query — building a Map avoids N
    // per-member DB lookups and eliminates all crypto work for the majority
    // of members who have no identity row at all.
    const allIdentityRows = listIdentities(this.db)
    const identityByDiscordUserId = new Map(
      allIdentityRows.map(row => [row.discordUserId, row]),
    )

    return members.map(member => {
      const githubEntry = githubByDiscordUserId.get(member.id)

      let github: GithubRosterStatus
      if (!githubEntry?.credential) {
        github = 'not-linked'
      } else {
        const resolution = resolveGithubToken(githubEntry.credential, masterKey)
        if (isGithubConfigured(resolution)) {
          // Best-effort zeroize (mirrors this file's own SSH-axis handling
          // below and GithubLinkService.getStatus/unlink) — the roster only
          // needs status, never the plaintext token bytes themselves.
          resolution.tokenPlaintext.fill(0)
          github = 'linked'
        } else {
          github = 'decrypt-failed'
        }
      }

      const identityRow = identityByDiscordUserId.get(member.id)
      const resolution = resolveIdentity(identityRow, masterKey)
      let ssh: SshRosterStatus
      if (isConfigured(resolution)) {
        // Best-effort zeroize (mirrors git-identity.service.ts and
        // git-turn-context.ts — same decrypt-then-discard shape; the roster
        // only needs status, never the plaintext key bytes themselves).
        resolution.keyPlaintext.fill(0)
        ssh = 'configured'
      } else if (isDecryptFailed(resolution)) {
        ssh = 'decrypt-failed'
      } else {
        ssh = 'not-configured'
      }

      return {
        discordUserId: member.id,
        displayName: member.displayName,
        github,
        ssh,
        // Present whenever a credential row exists, linked or
        // decrypt-failed — a broken row must still be break-glass-clearable
        // (see git-roster.dto.ts's betterAuthUserId doc comment).
        betterAuthUserId:
          github === 'not-linked' ? undefined : githubEntry?.userId,
      } satisfies RosterEntryDto
    })
  }
}
