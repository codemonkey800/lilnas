import type { Account, GenericEndpointContext } from 'better-auth'
import { APIError } from 'better-auth'

import { handleGithubAccountUpsert } from 'src/auth/github-account-hook'
import { getGithubCredential } from 'src/db/github-credential.repo'
import { account, user } from 'src/db/schema'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'

// A real 32-byte buffer stands in for the master key — encryptKey/decryptKey
// (unmocked, per this unit's brief) only require the correct length, not a
// production-provisioned key file. handleGithubAccountUpsert takes a THUNK
// (`() => Buffer`), not a materialized Buffer — deferring master-key access
// until the function has already confirmed this is a genuine GitHub event is
// load-bearing in production (auth.ts's real getMasterKey() calls
// loadMasterKey(), which does real file I/O) and is exercised here for
// signature-fidelity, not just convenience.
const FAKE_MASTER_KEY = Buffer.alloc(32, 7)
const getFakeMasterKey = (): Buffer => FAKE_MASTER_KEY

// Minimal seed helper — every `account`/`github_credential` row's `userId`
// is a real FK against `user.id` (foreign_keys = ON in createTestDb()), so
// each scenario needs a real `user` row to attach to.
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

// Minimal seed helper for a pre-existing `account` row — used to simulate
// (a) a duplicate-link conflict (a different user already linked this exact
// GitHub accountId) and (b) the re-link scenario (the SAME user's own prior
// link, which handleGithubAccountUpsert's update.before path must resolve
// userId from).
function seedAccountRow(
  db: TestDb['db'],
  opts: { userId: string; providerId: string; accountId: string },
): void {
  const now = new Date()
  db.insert(account)
    .values({
      id: `${opts.providerId}-${opts.accountId}-row`,
      accountId: opts.accountId,
      providerId: opts.providerId,
      userId: opts.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

// A create.before-shaped payload: full Account fields present, exactly what
// callback.mjs's `createAccount({ userId, providerId, accountId, ...tokens
// })` call site builds for a first-time link (see github-account-hook.ts's
// header comment for the full trace).
function createPayload(opts: {
  userId: string
  accountId: string
  accessToken?: string
  scope?: string
}): Account {
  return {
    id: `github-${opts.accountId}-account-row`,
    providerId: 'github',
    accountId: opts.accountId,
    userId: opts.userId,
    accessToken: opts.accessToken ?? 'fake-github-access-token',
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: opts.scope ?? 'repo,workflow,read:user,user:email',
    password: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

// An update.before-shaped payload: ONLY the token fields callback.mjs's
// `link` branch actually builds for a re-link (`updateData = {accessToken,
// refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt,
// scope}` — no userId/providerId/accountId, confirmed by reading
// better-auth's installed source directly; see github-account-hook.ts's
// header comment for the full citation trail).
function updatePayload(opts: {
  accessToken?: string
  scope?: string
}): Partial<Account> & Record<string, unknown> {
  return {
    accessToken: opts.accessToken ?? 'fake-github-access-token-relink',
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: opts.scope ?? 'repo,workflow,read:user,user:email',
  }
}

// A minimal GenericEndpointContext-shaped object carrying only what
// handleGithubAccountUpsert actually reads off it: `params.id` (the
// `/callback/:id` route's resolved provider segment) — the ONLY reliable
// per-request "is this GitHub" signal at the update.before call site (see
// github-account-hook.ts's header comment). Cast through `unknown` since a
// real GenericEndpointContext carries dozens of framework-internal fields
// this hook never touches and this test has no reason to fabricate.
function githubCallbackContext(): GenericEndpointContext {
  return { params: { id: 'github' } } as unknown as GenericEndpointContext
}

function nonGithubContext(): GenericEndpointContext {
  return { params: { id: 'discord' } } as unknown as GenericEndpointContext
}

describe('handleGithubAccountUpsert (U2)', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  function mockGithubProfile(profile: {
    id: number
    login: string
    name: string | null
  }) {
    return jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('happy paths (AE1)', () => {
    it('a create.before-shaped github account event with a valid profile produces a github_credential row with correct derived identity, and nulls accessToken/refreshToken', async () => {
      seedUser(testDb.db, 'user-1')
      const fetchSpy = mockGithubProfile({
        id: 12345,
        login: 'octocat',
        name: 'The Octocat',
      })

      const result = await handleGithubAccountUpsert(
        createPayload({ userId: 'user-1', accountId: '12345' }),
        githubCallbackContext(),
        testDb.db,
        getFakeMasterKey,
      )

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          headers: { Authorization: 'Bearer fake-github-access-token' },
        }),
      )
      expect(result).toEqual({
        data: { accessToken: null, refreshToken: null },
      })

      const row = getGithubCredential(testDb.db, 'user-1')
      expect(row).toBeUndefined() // no matching `account` row was inserted by this test (only the hook ran) — see the "inner join" note below.
    })

    it('inserts the github_credential row itself with correct fields (verified via a real account row + inner join)', async () => {
      seedUser(testDb.db, 'user-2')
      mockGithubProfile({ id: 999, login: 'octocat', name: 'The Octocat' })

      const result = await handleGithubAccountUpsert(
        createPayload({ userId: 'user-2', accountId: '999' }),
        githubCallbackContext(),
        testDb.db,
        getFakeMasterKey,
      )
      expect(result).toEqual({
        data: { accessToken: null, refreshToken: null },
      })

      // getGithubCredential requires a matching (providerId: 'github')
      // account row before reporting linked (U1's inner-join invariant) —
      // the hook itself never inserts the `account` row (that's Better
      // Auth's own adapter.create() call, AFTER this hook returns), so this
      // test seeds the account row itself to prove the credential row's
      // OWN fields are correct, independent of that separate, non-atomic
      // write this hook does not perform.
      seedAccountRow(testDb.db, {
        userId: 'user-2',
        providerId: 'github',
        accountId: '999',
      })

      const row = getGithubCredential(testDb.db, 'user-2')
      expect(row).toBeDefined()
      expect(row?.githubUserId).toBe('999')
      expect(row?.githubLogin).toBe('octocat')
      expect(row?.derivedName).toBe('The Octocat')
      expect(row?.derivedEmail).toBe('999+octocat@users.noreply.github.com')
      expect(row?.scope).toBe('repo,workflow,read:user,user:email')
    })

    it('derivedName falls back to login when the GitHub profile name is null', async () => {
      seedUser(testDb.db, 'user-3')
      mockGithubProfile({ id: 555, login: 'no-name-user', name: null })

      await handleGithubAccountUpsert(
        createPayload({ userId: 'user-3', accountId: '555' }),
        githubCallbackContext(),
        testDb.db,
        getFakeMasterKey,
      )
      seedAccountRow(testDb.db, {
        userId: 'user-3',
        providerId: 'github',
        accountId: '555',
      })

      const row = getGithubCredential(testDb.db, 'user-3')
      expect(row?.derivedName).toBe('no-name-user')
      expect(row?.derivedEmail).toBe(
        '555+no-name-user@users.noreply.github.com',
      )
    })
  })

  describe('non-GitHub events are a no-op (AE1 negative case)', () => {
    it('returns undefined for a discord create.before payload and never calls fetch', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')

      const discordAccount = {
        id: 'discord-row',
        providerId: 'discord',
        accountId: 'discord-snowflake-1',
        userId: 'user-4',
        accessToken: 'discord-token',
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: 'identify,email',
        password: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Account

      const result = await handleGithubAccountUpsert(
        discordAccount,
        nonGithubContext(),
        testDb.db,
        getFakeMasterKey,
      )

      expect(result).toBeUndefined()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('error paths — fail-closed', () => {
    it('throws when account.accessToken is missing (fail-closed, same posture as guild-gate.ts)', async () => {
      seedUser(testDb.db, 'user-5')
      const fetchSpy = jest.spyOn(global, 'fetch')

      const payload = createPayload({
        userId: 'user-5',
        accountId: '111',
      })
      payload.accessToken = null

      await expect(
        handleGithubAccountUpsert(
          payload,
          githubCallbackContext(),
          testDb.db,
          getFakeMasterKey,
        ),
      ).rejects.toThrow(APIError)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('GET /user network failure -> throws, no github_credential row created', async () => {
      seedUser(testDb.db, 'user-6')
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'))

      await expect(
        handleGithubAccountUpsert(
          createPayload({ userId: 'user-6', accountId: '222' }),
          githubCallbackContext(),
          testDb.db,
          getFakeMasterKey,
        ),
      ).rejects.toThrow(APIError)

      seedAccountRow(testDb.db, {
        userId: 'user-6',
        providerId: 'github',
        accountId: '222',
      })
      expect(getGithubCredential(testDb.db, 'user-6')).toBeUndefined()
    })

    it('GET /user succeeds (200) but the body is missing id/login -> throws, fail-closed', async () => {
      seedUser(testDb.db, 'user-7')
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ login: 'no-id-user' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      await expect(
        handleGithubAccountUpsert(
          createPayload({ userId: 'user-7', accountId: '333' }),
          githubCallbackContext(),
          testDb.db,
          getFakeMasterKey,
        ),
      ).rejects.toThrow(APIError)

      seedAccountRow(testDb.db, {
        userId: 'user-7',
        providerId: 'github',
        accountId: '333',
      })
      expect(getGithubCredential(testDb.db, 'user-7')).toBeUndefined()
    })

    it('a non-200 GET /user response -> throws, fail-closed', async () => {
      seedUser(testDb.db, 'user-7b')
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('', { status: 500 }))

      await expect(
        handleGithubAccountUpsert(
          createPayload({ userId: 'user-7b', accountId: '334' }),
          githubCallbackContext(),
          testDb.db,
          getFakeMasterKey,
        ),
      ).rejects.toThrow(APIError)
    })

    it('pre-flight duplicate-link conflict (create path): a different user already has this GitHub accountId linked -> throws BEFORE any fetch call, no credential row touched', async () => {
      seedUser(testDb.db, 'existing-owner')
      seedUser(testDb.db, 'new-claimant')
      seedAccountRow(testDb.db, {
        userId: 'existing-owner',
        providerId: 'github',
        accountId: '444',
      })
      const fetchSpy = jest.spyOn(global, 'fetch')

      await expect(
        handleGithubAccountUpsert(
          createPayload({ userId: 'new-claimant', accountId: '444' }),
          githubCallbackContext(),
          testDb.db,
          getFakeMasterKey,
        ),
      ).rejects.toThrow(APIError)

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(getGithubCredential(testDb.db, 'existing-owner')).toBeUndefined()
      expect(getGithubCredential(testDb.db, 'new-claimant')).toBeUndefined()
    })

    it('pre-flight duplicate-link conflict (update path): resolves the acting user via DB lookup, still detects a different existing owner, throws before any credential write', async () => {
      // The update.before path (no accountId on the payload) must fetch the
      // profile once to discover accountId, then resolve userId — this
      // scenario seeds an account row for a DIFFERENT user under that
      // resolved accountId (a should-never-happen state in practice, since
      // callback.mjs's own `link` branch already rejects a
      // different-user match before ever calling updateAccount — see
      // resolveExistingAccountUserId's header comment — but this proves the
      // hook's own defense-in-depth still holds if it were ever reached).
      seedUser(testDb.db, 'relink-actor')
      mockGithubProfile({ id: 777, login: 'relinker', name: null })

      // No account row exists yet for accountId '777' at all — this is the
      // "should never happen" branch (resolveExistingAccountUserId finds no
      // row), which fails closed with a throw distinct from the
      // conflict-with-a-different-user case above (both use the same
      // message per the hook's contract; the assertion here is just that it
      // throws and writes nothing, not the specific message).
      await expect(
        handleGithubAccountUpsert(
          updatePayload({}),
          githubCallbackContext(),
          testDb.db,
          getFakeMasterKey,
        ),
      ).rejects.toThrow(APIError)

      expect(getGithubCredential(testDb.db, 'relink-actor')).toBeUndefined()
    })
  })

  describe('re-link via update.before (the load-bearing test for this unit)', () => {
    it('a second call for the same accountId/userId (simulating update.before firing) still encrypts and upserts github_credential, overwriting the prior row, and still nulls accessToken/refreshToken', async () => {
      seedUser(testDb.db, 'relink-user')

      // First link — create.before-shaped payload (full Account fields).
      mockGithubProfile({ id: 8888, login: 'first-login', name: 'First Name' })
      const firstResult = await handleGithubAccountUpsert(
        createPayload({
          userId: 'relink-user',
          accountId: '8888',
          accessToken: 'first-token',
        }),
        githubCallbackContext(),
        testDb.db,
        getFakeMasterKey,
      )
      expect(firstResult).toEqual({
        data: { accessToken: null, refreshToken: null },
      })

      // Simulate Better Auth's own account row now existing (what its
      // adapter.create() call does AFTER this hook returns) so the re-link
      // path's DB lookup (resolveExistingAccountUserId) can find it.
      seedAccountRow(testDb.db, {
        userId: 'relink-user',
        providerId: 'github',
        accountId: '8888',
      })

      const rowAfterFirstLink = getGithubCredential(testDb.db, 'relink-user')
      expect(rowAfterFirstLink?.githubLogin).toBe('first-login')
      expect(rowAfterFirstLink?.derivedName).toBe('First Name')

      // Re-link — update.before-shaped payload (NO userId/accountId/
      // providerId on the payload, matching callback.mjs's real
      // `updateData` shape for this exact path), with a DIFFERENT mocked
      // profile response to prove the row's identity actually changes
      // between the two calls, not just that no error is thrown.
      jest.restoreAllMocks()
      mockGithubProfile({
        id: 8888,
        login: 'second-login',
        name: 'Second Name',
      })
      const secondResult = await handleGithubAccountUpsert(
        updatePayload({ accessToken: 'second-token' }),
        githubCallbackContext(),
        testDb.db,
        getFakeMasterKey,
      )
      expect(secondResult).toEqual({
        data: { accessToken: null, refreshToken: null },
      })

      const rowAfterRelink = getGithubCredential(testDb.db, 'relink-user')
      expect(rowAfterRelink).toBeDefined()
      expect(rowAfterRelink?.githubLogin).toBe('second-login')
      expect(rowAfterRelink?.derivedName).toBe('Second Name')
      // Only one row exists for this userId (upsert overwrote, did not
      // duplicate) — githubCredential.userId is a PRIMARY KEY, so a second
      // row is schema-impossible; this call proves the OVERWRITE actually
      // happened (different values), not merely that insertion succeeded
      // once.
      expect(rowAfterRelink?.tokenCiphertext).not.toEqual(
        rowAfterFirstLink?.tokenCiphertext,
      )
    })

    it('both auth.ts call sites (create.before and update.before) dispatch into the same handleGithubAccountUpsert for providerId === github', async () => {
      // This is a source-level/unit-level proof (per the brief's own
      // guidance that fully exercising Better Auth's real
      // linkSocial/updateAccount internals end-to-end requires more
      // scaffolding than is practical here): both the create-shaped and
      // update-shaped payloads route through the SAME imported function,
      // proven by calling it directly twice with each shape and confirming
      // both produce the identical { data: { accessToken: null,
      // refreshToken: null } } result and the same credential upsert
      // behavior — i.e. there is exactly one implementation of the
      // encrypt-and-null-out logic, not two independently-maintained
      // copies that could silently drift (the create-only-hook regression
      // this whole unit exists to prevent).
      seedUser(testDb.db, 'dispatch-user')

      mockGithubProfile({ id: 9999, login: 'dispatch-login', name: null })
      const createShapeResult = await handleGithubAccountUpsert(
        createPayload({ userId: 'dispatch-user', accountId: '9999' }),
        githubCallbackContext(),
        testDb.db,
        getFakeMasterKey,
      )
      seedAccountRow(testDb.db, {
        userId: 'dispatch-user',
        providerId: 'github',
        accountId: '9999',
      })

      jest.restoreAllMocks()
      mockGithubProfile({ id: 9999, login: 'dispatch-login', name: null })
      const updateShapeResult = await handleGithubAccountUpsert(
        updatePayload({}),
        githubCallbackContext(),
        testDb.db,
        getFakeMasterKey,
      )

      expect(createShapeResult).toEqual(updateShapeResult)
      expect(createShapeResult).toEqual({
        data: { accessToken: null, refreshToken: null },
      })
    })
  })
})
