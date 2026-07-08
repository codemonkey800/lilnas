import { Inject, Injectable } from '@nestjs/common'

import {
  isConfigured,
  isDecryptFailed,
  resolveIdentity,
} from 'src/crypto/identity-resolution'
import { loadMasterKey } from 'src/crypto/master-key'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { getIdentity } from 'src/db/git-identity.repo'
import { listGithubCredentialStatuses } from 'src/db/github-credential.repo'

import { DiscordDirectoryService } from './discord-directory.service'

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
}

export type RosterResponseDto = RosterEntryDto[]

// Joins listGithubCredentialStatuses (U1) with DiscordDirectoryService's
// guild member list into one roster row per guild member. GitHub status is
// matched by discordUserId (listGithubCredentialStatuses' own
// account.accountId for providerId 'discord'); a guild member absent from
// that list entirely (no account row of ANY kind, GitHub or otherwise) is
// 'not-linked' — the same "missing means not configured" posture
// listGithubCredentialStatuses itself already applies to a user with no
// github_credential row.
//
// SSH status mirrors GitTurnContext.begin()'s EXACT resolution call shape
// (loadMasterKey() -> getIdentity(db, userId) -> resolveIdentity(row,
// masterKey)) so a decrypt failure is distinguishable from not-configured
// on the roster exactly as it would be at turn time — never a raw
// row-exists-or-not check (which cannot tell "no SSH key" apart from "SSH
// key exists but its master-key-encrypted blob no longer decrypts").
@Injectable()
export class GitRosterService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly discordDirectory: DiscordDirectoryService,
  ) {}

  async listRoster(): Promise<RosterResponseDto> {
    const members = await this.discordDirectory.listGuildMembers()
    const githubStatuses = listGithubCredentialStatuses(this.db)

    const githubByDiscordUserId = new Map(
      githubStatuses
        .filter(status => status.discordUserId !== undefined)
        .map(status => [status.discordUserId as string, status.linked]),
    )

    const masterKey = loadMasterKey()

    return members.map(member => {
      const linked = githubByDiscordUserId.get(member.id) ?? false

      const identityRow = getIdentity(this.db, member.id)
      const resolution = resolveIdentity(identityRow, masterKey)
      let ssh: SshRosterStatus
      if (isConfigured(resolution)) {
        ssh = 'configured'
      } else if (isDecryptFailed(resolution)) {
        ssh = 'decrypt-failed'
      } else {
        ssh = 'not-configured'
      }

      return {
        discordUserId: member.id,
        displayName: member.displayName,
        github: linked ? 'linked' : 'not-linked',
        ssh,
      } satisfies RosterEntryDto
    })
  }
}
