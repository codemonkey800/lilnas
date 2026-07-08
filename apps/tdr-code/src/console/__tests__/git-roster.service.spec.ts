import type { DiscordDirectoryService } from 'src/console/discord-directory.service'
import { GitRosterService } from 'src/console/git-roster.service'
import { encryptKey } from 'src/crypto/key-cipher'
import { upsertIdentity } from 'src/db/git-identity.repo'
import { upsertGithubCredential } from 'src/db/github-credential.repo'
import { account, user } from 'src/db/schema'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'

// Mocking src/crypto/master-key (rather than provisioning a real chmod-600
// key file on disk) mirrors git-turn-context.spec.ts's own established
// pattern (see github-link.service.spec.ts's identical rationale) —
// GitRosterService calls the REAL loadMasterKey() internally.
const FAKE_MASTER_KEY = Buffer.alloc(32, 11)
jest.mock('src/crypto/master-key', () => ({
  loadMasterKey: jest.fn().mockReturnValue(Buffer.alloc(32, 11)),
}))

function seedUser(db: TestDb['db'], id: string): void {
  const now = new Date()
  db.insert(user)
    .values({
      id,
      name: `Test User ${id}`,
      email: `${id}@example.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function seedDiscordAccount(
  db: TestDb['db'],
  opts: { userId: string; discordUserId: string },
): void {
  const now = new Date()
  db.insert(account)
    .values({
      id: `discord-${opts.discordUserId}-row`,
      accountId: opts.discordUserId,
      providerId: 'discord',
      userId: opts.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function seedGithubAccount(db: TestDb['db'], userId: string): void {
  const now = new Date()
  db.insert(account)
    .values({
      id: `github-${userId}-row`,
      accountId: `github-account-id-${userId}`,
      providerId: 'github',
      userId,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

// Fully links GitHub for a userId that already has a Discord account row
// (mirroring a real linkSocial round-trip).
function linkGithub(
  db: TestDb['db'],
  userId: string,
  masterKey: Buffer = FAKE_MASTER_KEY,
): void {
  seedGithubAccount(db, userId)
  const encrypted = encryptKey(
    Buffer.from(`fake-token-${userId}`, 'utf8'),
    `${userId}:github`,
    masterKey,
  )
  upsertGithubCredential(db, {
    userId,
    githubUserId: `gh-${userId}`,
    githubLogin: `octocat-${userId}`,
    derivedName: `Octocat ${userId}`,
    derivedEmail: `${userId}@users.noreply.github.com`,
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    scope: 'repo,workflow,read:user,user:email',
  })
}

// Configures an SSH git_identity row for a Discord user id (keyed on
// discordUserId, unlike github_credential which is keyed on the Better Auth
// userId — git_identity.repo.ts's own schema, unchanged by this plan).
function configureSsh(
  db: TestDb['db'],
  discordUserId: string,
  masterKey: Buffer = FAKE_MASTER_KEY,
): void {
  // A real Ed25519 OpenSSH private key generated once for this suite's
  // fixture use — validateAndFingerprint (inside resolveIdentity) requires
  // real, parseable key bytes, not an arbitrary buffer.
  const fixtureKey = ED25519_TEST_KEY
  const encrypted = encryptKey(
    Buffer.from(fixtureKey, 'utf8'),
    discordUserId,
    masterKey,
  )
  upsertIdentity(db, {
    discordUserId,
    name: `SSH User ${discordUserId}`,
    email: `${discordUserId}@example.com`,
    keyCiphertext: encrypted.ciphertext,
    keyIv: encrypted.iv,
    keyAuthTag: encrypted.authTag,
    keyFingerprint: 'SHA256:fixture-fingerprint',
  })
}

function makeDiscordDirectoryService(
  members: { id: string; username: string; displayName: string }[],
): DiscordDirectoryService {
  return {
    listGuildMembers: jest.fn().mockResolvedValue(members),
  } as unknown as DiscordDirectoryService
}

// Real Ed25519 OpenSSH private key (unencrypted) — the SAME fixture
// identity-resolution.spec.ts uses as its TEST_KEY_PEM. validateAndFingerprint
// (called inside resolveIdentity) parses real key bytes via sshpk, so an
// arbitrary/fabricated buffer will not do.
const ED25519_TEST_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQAAALBYegssWHoL
LAAAAAtzc2gtZWQyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQ
AAAEDjjCG4LkwqWl6PemDgYqlKSELyGT7LjUg8fWwH94X/yUPW1Fg2R17NnHAMMp1hS/rC
lYu8/Zyg8ts89VypYsWpAAAAKWplcmVteWFzdW5jaW9ubmV0ZmxpeC5jb21AamVyZW15LW
5mbHgtbWFjAQIDBA==
-----END OPENSSH PRIVATE KEY-----`

describe('GitRosterService.listRoster', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('returns correct combined GitHub+SSH status for members with both, one, or neither configured', async () => {
    const { db } = testDb

    // Member 1: both GitHub linked AND SSH configured.
    seedUser(db, 'user-both')
    seedDiscordAccount(db, {
      userId: 'user-both',
      discordUserId: 'discord-both',
    })
    linkGithub(db, 'user-both')
    configureSsh(db, 'discord-both')

    // Member 2: GitHub linked only.
    seedUser(db, 'user-github-only')
    seedDiscordAccount(db, {
      userId: 'user-github-only',
      discordUserId: 'discord-github-only',
    })
    linkGithub(db, 'user-github-only')

    // Member 3: SSH configured only.
    seedUser(db, 'user-ssh-only')
    seedDiscordAccount(db, {
      userId: 'user-ssh-only',
      discordUserId: 'discord-ssh-only',
    })
    configureSsh(db, 'discord-ssh-only')

    // Member 4: neither configured.
    seedUser(db, 'user-neither')
    seedDiscordAccount(db, {
      userId: 'user-neither',
      discordUserId: 'discord-neither',
    })

    const discordDirectory = makeDiscordDirectoryService([
      { id: 'discord-both', username: 'both', displayName: 'Both User' },
      {
        id: 'discord-github-only',
        username: 'github-only',
        displayName: 'GitHub Only',
      },
      { id: 'discord-ssh-only', username: 'ssh-only', displayName: 'SSH Only' },
      { id: 'discord-neither', username: 'neither', displayName: 'Neither' },
    ])

    const service = new GitRosterService(db, discordDirectory)
    const roster = await service.listRoster()

    expect(roster).toHaveLength(4)
    // linkedUserId (the Better Auth id behind a linked GitHub credential —
    // see RosterEntryDto's own doc comment; deliberately not named
    // githubUserId, which means GitHub's own numeric id elsewhere in this
    // codebase) is present for BOTH linked members, and is each member's OWN
    // userId, not shared/aliased between rows.
    expect(roster.find(r => r.discordUserId === 'discord-both')).toEqual({
      discordUserId: 'discord-both',
      displayName: 'Both User',
      github: 'linked',
      ssh: 'configured',
      linkedUserId: 'user-both',
    })
    expect(roster.find(r => r.discordUserId === 'discord-github-only')).toEqual(
      {
        discordUserId: 'discord-github-only',
        displayName: 'GitHub Only',
        github: 'linked',
        ssh: 'not-configured',
        linkedUserId: 'user-github-only',
      },
    )
    // Not-linked members never carry a linkedUserId — nothing to
    // break-glass-clear.
    expect(roster.find(r => r.discordUserId === 'discord-ssh-only')).toEqual({
      discordUserId: 'discord-ssh-only',
      displayName: 'SSH Only',
      github: 'not-linked',
      ssh: 'configured',
      linkedUserId: undefined,
    })
    expect(roster.find(r => r.discordUserId === 'discord-neither')).toEqual({
      discordUserId: 'discord-neither',
      displayName: 'Neither',
      github: 'not-linked',
      ssh: 'not-configured',
      linkedUserId: undefined,
    })
  })

  // Edge case: a guild member with no account/github_credential rows at all
  // (not even a Discord account row locally — e.g. a guild member who has
  // never signed in to the console) shows github: 'not-linked',
  // ssh: 'not-configured'. Covered implicitly by 'user-neither' above, but
  // asserted standalone here for a member with ZERO local rows whatsoever
  // (no user/account row of any kind), which is the more extreme case.
  it('a guild member with no local rows at all shows not-linked/not-configured', async () => {
    const { db } = testDb

    const discordDirectory = makeDiscordDirectoryService([
      {
        id: 'discord-unknown',
        username: 'unknown',
        displayName: 'Unknown Member',
      },
    ])

    const service = new GitRosterService(db, discordDirectory)
    const roster = await service.listRoster()

    expect(roster).toEqual([
      {
        discordUserId: 'discord-unknown',
        displayName: 'Unknown Member',
        github: 'not-linked',
        ssh: 'not-configured',
      },
    ])
  })

  // Edge case: a guild member with a git_identity row encrypted under a
  // DIFFERENT master key shows ssh: 'decrypt-failed', not 'not-configured'
  // or a thrown error — mirrors GitTurnContext.begin()'s own
  // decrypt-failure-is-distinguishable-from-unconfigured guarantee.
  it('shows decrypt-failed (not not-configured, and does not throw) for a git_identity row encrypted under a different master key', async () => {
    const { db } = testDb

    seedUser(db, 'user-corrupt-ssh')
    seedDiscordAccount(db, {
      userId: 'user-corrupt-ssh',
      discordUserId: 'discord-corrupt-ssh',
    })
    // Encrypted under a DIFFERENT 32-byte key than the mocked
    // loadMasterKey() will return at roster-read time.
    const wrongKey = Buffer.alloc(32, 222)
    configureSsh(db, 'discord-corrupt-ssh', wrongKey)

    const discordDirectory = makeDiscordDirectoryService([
      {
        id: 'discord-corrupt-ssh',
        username: 'corrupt',
        displayName: 'Corrupt SSH',
      },
    ])

    const service = new GitRosterService(db, discordDirectory)
    const roster = await service.listRoster()

    expect(roster).toEqual([
      {
        discordUserId: 'discord-corrupt-ssh',
        displayName: 'Corrupt SSH',
        github: 'not-linked',
        ssh: 'decrypt-failed',
      },
    ])
  })
})
