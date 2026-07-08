import { buildAuth } from 'src/auth/auth'
import { GithubLinkService } from 'src/console/github-link.service'
import { encryptKey } from 'src/crypto/key-cipher'
import {
  getGithubCredential,
  upsertGithubCredential,
} from 'src/db/github-credential.repo'
import { account, githubCredential, user } from 'src/db/schema'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'

// These env keys must be set before buildAuth() (the second describe block
// below) is reached — mirrored from auth-mount.spec.ts's own module-scope
// env setup, scoped to THIS file only. All values are obviously-fake test
// values, never real secrets.
process.env.BETTER_AUTH_URL = 'https://tdr-code.lilnas.io'
process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-not-a-real-secret'
process.env.DISCORD_CLIENT_ID = 'test-discord-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-discord-client-secret'
process.env.GITHUB_CLIENT_ID = 'test-github-client-id'
process.env.GITHUB_CLIENT_SECRET = 'test-github-client-secret'

// A real 32-byte buffer stands in for the master key — mirrors
// github-account-hook.spec.ts's own FAKE_MASTER_KEY convention. Mocking
// src/crypto/master-key (rather than provisioning a real chmod-600 key file
// on disk) mirrors git-turn-context.spec.ts's own established pattern for
// specs that need loadMasterKey() to return SOME valid key without
// re-testing loadMasterKey()'s own file-permission logic (already covered
// exhaustively by crypto/__tests__/master-key.spec.ts) — GithubLinkService
// calls the REAL loadMasterKey() internally, so this file must supply one.
const FAKE_MASTER_KEY = Buffer.alloc(32, 9)
jest.mock('src/crypto/master-key', () => ({
  loadMasterKey: jest.fn().mockReturnValue(Buffer.alloc(32, 9)),
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

// Seeds a fully-linked GitHub user: user + account(discord) + account(github)
// + github_credential, exactly the shape a real linkSocial round-trip would
// leave behind. Returns the plaintext token so a test can assert what
// fetch() was called with.
function seedLinkedGithubUser(
  db: TestDb['db'],
  opts: { userId: string; discordUserId: string; tokenPlaintext?: string },
): { tokenPlaintext: string } {
  seedUser(db, opts.userId)
  seedDiscordAccount(db, {
    userId: opts.userId,
    discordUserId: opts.discordUserId,
  })
  seedGithubAccount(db, opts.userId)

  const tokenPlaintext =
    opts.tokenPlaintext ?? `fake-github-token-${opts.userId}`
  const encrypted = encryptKey(
    Buffer.from(tokenPlaintext, 'utf8'),
    `${opts.userId}:github`,
    FAKE_MASTER_KEY,
  )
  upsertGithubCredential(db, {
    userId: opts.userId,
    githubUserId: `gh-${opts.userId}`,
    githubLogin: `octocat-${opts.userId}`,
    derivedName: `Octocat ${opts.userId}`,
    derivedEmail: `${opts.userId}@users.noreply.github.com`,
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    scope: 'repo,workflow,read:user,user:email',
  })

  return { tokenPlaintext }
}

function makeService(db: TestDb['db']): GithubLinkService {
  // GithubLinkService only needs @Inject(DB) db and a PinoLogger — a plain
  // object satisfying the two log methods actually called (warn) is
  // sufficient; this codebase has no existing jest.spyOn(logger, ...)
  // pattern to mirror (confirmed via grep before writing this file), so the
  // log calls themselves are treated as untested implementation detail per
  // this unit's brief — only DB state is asserted.
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
  return new GithubLinkService(
    db,
    logger as unknown as ConstructorParameters<typeof GithubLinkService>[1],
  )
}

describe('GithubLinkService.unlink', () => {
  let testDb: TestDb
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    testDb = createTestDb()
    fetchSpy = jest.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    testDb.close()
  })

  // AE4. Happy path: self-unlink for a linked user deletes both rows; a
  // subsequent status check shows that user as not-linked.
  it('deletes both the github_credential row and the account(github) row for a linked user, and revokes at GitHub', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const { db } = testDb
    seedLinkedGithubUser(db, { userId: 'u1', discordUserId: 'discord-1' })

    const service = makeService(db)
    const result = await service.unlink('u1')

    expect(result).toEqual({ unlinked: true })
    expect(getGithubCredential(db, 'u1')).toBeUndefined()

    // Neither the github_credential row nor the
    // account(providerId='github') row survive; the account(discord) row is
    // untouched (unlink must not touch the Discord sign-in identity).
    const remainingGithubCredentialRows = db
      .select()
      .from(githubCredential)
      .all()
    expect(remainingGithubCredentialRows).toHaveLength(0)

    const remainingAccountRows = db.select().from(account).all()
    expect(remainingAccountRows).toHaveLength(1)
    expect(remainingAccountRows[0]?.providerId).toBe('discord')

    // The revoke call fired with Basic Auth and the plaintext token.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.github.com/applications/test-github-client-id/grant',
    )
    expect(init.method).toBe('DELETE')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toMatch(/^Basic /)
    expect(JSON.parse(init.body as string)).toEqual({
      access_token: 'fake-github-token-u1',
    })
  })

  // AE5. Happy path: break-glass clear "by a different member" is identical
  // in effect to self-unlink — there's no code-level difference at the
  // service layer; only the controller-level userId source differs. This
  // test simulates that by calling unlink() with the target's userId
  // directly, exactly as the break-glass-clear route would.
  it('break-glass clear (unlink called with a target userId, not the caller) has identical effect to self-unlink', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const { db } = testDb
    seedLinkedGithubUser(db, {
      userId: 'target-user',
      discordUserId: 'discord-2',
    })

    const service = makeService(db)
    const result = await service.unlink('target-user')

    expect(result).toEqual({ unlinked: true })
    expect(getGithubCredential(db, 'target-user')).toBeUndefined()
  })

  // Edge case: unlink for a user with no github_credential row is a no-op —
  // no error thrown, unlinked: false, and no revoke call attempted.
  it('is a no-op for a user with no github_credential row', async () => {
    const { db } = testDb
    seedUser(db, 'never-linked')
    seedDiscordAccount(db, {
      userId: 'never-linked',
      discordUserId: 'discord-3',
    })

    const service = makeService(db)
    const result = await service.unlink('never-linked')

    expect(result).toEqual({ unlinked: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    // Discord account row is untouched.
    expect(db.select().from(account).all()).toHaveLength(1)
  })

  // Edge case: an ORPHANED github_credential row (no matching account(github)
  // row) — U1's getGithubCredential reports this as "not found", so unlink
  // is a no-op here too, exactly as documented in this service's header
  // comment.
  it('is a no-op for an orphaned github_credential row (no matching account(github) row)', async () => {
    const { db } = testDb
    seedUser(db, 'orphan-user')
    // No account(providerId='github') row is seeded — only the raw
    // github_credential row, simulating the write-side non-atomicity gap.
    const encrypted = encryptKey(
      Buffer.from('orphaned-token', 'utf8'),
      'orphan-user:github',
      FAKE_MASTER_KEY,
    )
    upsertGithubCredential(db, {
      userId: 'orphan-user',
      githubUserId: 'gh-orphan',
      githubLogin: 'orphan-login',
      derivedName: 'Orphan',
      derivedEmail: 'orphan@users.noreply.github.com',
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      scope: 'repo,workflow',
    })

    const service = makeService(db)
    const result = await service.unlink('orphan-user')

    expect(result).toEqual({ unlinked: false })
    expect(fetchSpy).not.toHaveBeenCalled()
    // The orphaned row is left as-is (this unit deliberately does not clean
    // it up — see this service's header comment for why: it's already
    // invisible everywhere else in the app via U1's inner-join invariant).
    expect(db.select().from(githubCredential).all()).toHaveLength(1)
  })

  // Error path: GitHub's revoke endpoint returns a non-2xx (422) — local
  // rows are STILL deleted regardless.
  it('still deletes local rows when the GitHub revoke call returns 422', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 422 }))

    const { db } = testDb
    seedLinkedGithubUser(db, { userId: 'u-422', discordUserId: 'discord-422' })

    const service = makeService(db)
    const result = await service.unlink('u-422')

    expect(result).toEqual({ unlinked: true })
    expect(getGithubCredential(db, 'u-422')).toBeUndefined()
    expect(db.select().from(githubCredential).all()).toHaveLength(0)
  })

  // Error path: the revoke call itself throws (network failure) — local
  // rows are STILL deleted.
  it('still deletes local rows when the GitHub revoke call throws (network error)', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'))

    const { db } = testDb
    seedLinkedGithubUser(db, {
      userId: 'u-neterr',
      discordUserId: 'discord-neterr',
    })

    const service = makeService(db)
    const result = await service.unlink('u-neterr')

    expect(result).toEqual({ unlinked: true })
    expect(getGithubCredential(db, 'u-neterr')).toBeUndefined()
  })

  // Error path: the stored token cannot be decrypted (a different master
  // key, or corrupted authTag) — the revoke HTTP call is skipped entirely
  // (nothing decryptable to send), and local rows are still deleted.
  it('skips the revoke call entirely when the stored token fails to decrypt, but still deletes local rows', async () => {
    const { db } = testDb
    seedUser(db, 'u-corrupt')
    seedDiscordAccount(db, {
      userId: 'u-corrupt',
      discordUserId: 'discord-corrupt',
    })
    seedGithubAccount(db, 'u-corrupt')

    // Encrypt under a DIFFERENT key than the one loadMasterKey() will
    // resolve at runtime (the shared test-suite master-key file, per
    // src/__tests__/setup.ts) — this makes decryption fail exactly like a
    // corrupted/rotated key would.
    const wrongKey = Buffer.alloc(32, 200)
    const encrypted = encryptKey(
      Buffer.from('unreachable-token', 'utf8'),
      'u-corrupt:github',
      wrongKey,
    )
    upsertGithubCredential(db, {
      userId: 'u-corrupt',
      githubUserId: 'gh-corrupt',
      githubLogin: 'corrupt-login',
      derivedName: 'Corrupt',
      derivedEmail: 'corrupt@users.noreply.github.com',
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      scope: 'repo,workflow',
    })

    const service = makeService(db)
    const result = await service.unlink('u-corrupt')

    expect(result).toEqual({ unlinked: true })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(getGithubCredential(db, 'u-corrupt')).toBeUndefined()
    expect(db.select().from(githubCredential).all()).toHaveLength(0)
  })

  // Integration: unlink followed by a re-link (upsertGithubCredential) for
  // the same userId, called back-to-back (a reasonable proxy for a
  // concurrent race per this unit's brief), leaves the DB in one clean
  // state — never a torn mix (a github_credential row with no matching
  // account row, or vice versa in a way that violates the inner-join
  // invariant).
  it('sequential unlink then re-link leaves consistent state, not a torn row', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }))

    const { db } = testDb
    seedLinkedGithubUser(db, {
      userId: 'u-race',
      discordUserId: 'discord-race',
    })

    const service = makeService(db)
    await service.unlink('u-race')
    expect(getGithubCredential(db, 'u-race')).toBeUndefined()

    // Re-link: the account(github) row must exist again for
    // upsertGithubCredential's write to be observable as "linked" per U1's
    // inner-join invariant — simulate the hook's own re-provisioning of
    // both rows (upsertGithubCredential only ever owns github_credential;
    // the account row is Better Auth's own responsibility).
    seedGithubAccount(db, 'u-race')
    const encrypted = encryptKey(
      Buffer.from('relinked-token', 'utf8'),
      'u-race:github',
      FAKE_MASTER_KEY,
    )
    upsertGithubCredential(db, {
      userId: 'u-race',
      githubUserId: 'gh-race-2',
      githubLogin: 'race-login-2',
      derivedName: 'Race Two',
      derivedEmail: 'race2@users.noreply.github.com',
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      scope: 'repo,workflow',
    })

    // Exactly one github_credential row, matched by exactly one
    // account(github) row for the same user — a clean re-linked state, not
    // a torn mix.
    const credentialRows = db.select().from(githubCredential).all()
    expect(credentialRows).toHaveLength(1)
    expect(credentialRows[0]?.githubLogin).toBe('race-login-2')
    expect(getGithubCredential(db, 'u-race')).toBeDefined()
    expect(getGithubCredential(db, 'u-race')?.githubLogin).toBe('race-login-2')
  })
})

// GithubLinkService.getStatus (U4 addition — see github-link.dto.ts's
// GithubStatusResponseSchema comment for why this method exists: the
// frontend cannot resolve its own Discord snowflake or GitHub-link status
// from useSession()'s client-side user object alone).
describe('GithubLinkService.getStatus', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('returns linked: true with derived identity and discordUserId for a linked user', () => {
    const { db } = testDb
    seedLinkedGithubUser(db, {
      userId: 'u-status-linked',
      discordUserId: 'discord-status-linked',
    })

    const service = makeService(db)
    const status = service.getStatus('u-status-linked')

    expect(status).toEqual({
      discordUserId: 'discord-status-linked',
      linked: true,
      derivedName: 'Octocat u-status-linked',
      derivedEmail: 'u-status-linked@users.noreply.github.com',
    })
  })

  it('returns linked: false with discordUserId (no derived fields) for a user with a Discord account but no GitHub link', () => {
    const { db } = testDb
    seedUser(db, 'u-status-unlinked')
    seedDiscordAccount(db, {
      userId: 'u-status-unlinked',
      discordUserId: 'discord-status-unlinked',
    })

    const service = makeService(db)
    const status = service.getStatus('u-status-unlinked')

    expect(status).toEqual({
      discordUserId: 'discord-status-unlinked',
      linked: false,
    })
  })

  it('returns linked: false and discordUserId: undefined for a userId with no Discord account row at all', () => {
    const { db } = testDb
    seedUser(db, 'u-status-no-discord')

    const service = makeService(db)
    const status = service.getStatus('u-status-no-discord')

    expect(status).toEqual({ discordUserId: undefined, linked: false })
  })

  it('returns linked: false for an orphaned github_credential row (no matching account(github) row)', () => {
    const { db } = testDb
    seedUser(db, 'u-status-orphan')
    seedDiscordAccount(db, {
      userId: 'u-status-orphan',
      discordUserId: 'discord-status-orphan',
    })
    // No account(providerId='github') row seeded — only the raw
    // github_credential row, simulating the write-side non-atomicity gap
    // (see github-credential.repo.ts's header comment).
    const encrypted = encryptKey(
      Buffer.from('orphaned-status-token', 'utf8'),
      'u-status-orphan:github',
      FAKE_MASTER_KEY,
    )
    upsertGithubCredential(db, {
      userId: 'u-status-orphan',
      githubUserId: 'gh-status-orphan',
      githubLogin: 'orphan-status-login',
      derivedName: 'Orphan Status',
      derivedEmail: 'orphan-status@users.noreply.github.com',
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenAuthTag: encrypted.authTag,
      scope: 'repo,workflow',
    })

    const service = makeService(db)
    const status = service.getStatus('u-status-orphan')

    expect(status).toEqual({
      discordUserId: 'discord-status-orphan',
      linked: false,
    })
  })
})

// Covers the stock-route-bypass gap (U3's Approach step 3): Better Auth's
// own POST /unlink-account and GET /list-accounts routes must 404 rather
// than reach Better Auth's stock handlers, which would delete an `account`
// row while leaving github_credential (and the live GitHub grant) behind.
//
// Drives a REAL request through a REAL buildAuth(db).handler — the same
// standard-Fetch-API `Request`/`Response` contract better-auth/dist/auth/
// base.mjs's `handler: async (request) => ...` implements — rather than
// asserting the `disabledPaths` array's literal contents (which would pass
// even if the string format were wrong for what normalizePathname() actually
// produces). This is the empirical verification the unit's brief requires:
// the exact string format ('/unlink-account', no '/api/auth' prefix) was
// confirmed correct by this test passing, not assumed from reading
// better-auth's router source alone.
describe('Better Auth stock unlink-account/list-accounts routes are disabled', () => {
  let testDb: TestDb

  beforeAll(() => {
    testDb = createTestDb()
  })

  afterAll(() => {
    testDb.close()
  })

  it('POST /api/auth/unlink-account 404s (disabled), not a real Better Auth response', async () => {
    const auth = buildAuth(testDb.db)
    const response = await auth.handler(
      new Request('https://tdr-code.lilnas.io/api/auth/unlink-account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId: 'github' }),
      }),
    )

    expect(response.status).toBe(404)
    const body = await response.text()
    expect(body).toBe('Not Found')
  })

  it('GET /api/auth/list-accounts 404s (disabled), not a real Better Auth response', async () => {
    const auth = buildAuth(testDb.db)
    const response = await auth.handler(
      new Request('https://tdr-code.lilnas.io/api/auth/list-accounts', {
        method: 'GET',
      }),
    )

    expect(response.status).toBe(404)
    const body = await response.text()
    expect(body).toBe('Not Found')
  })

  // Control: a route that DOES exist (and is not in disabledPaths) still
  // works, proving the 404s above are the disabledPaths gate firing — not a
  // broader routing regression that 404s everything.
  it('control: POST /api/auth/sign-in/social (an undisabled route) still reaches the real handler', async () => {
    const auth = buildAuth(testDb.db)
    const response = await auth.handler(
      new Request('https://tdr-code.lilnas.io/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://tdr-code.lilnas.io',
        },
        body: JSON.stringify({ provider: 'discord' }),
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { url?: string }
    expect(typeof body.url).toBe('string')
    expect(body.url).toContain('discord.com')
  })
})
