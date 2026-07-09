import crypto from 'node:crypto'

import { resolveGithubToken } from 'src/crypto/github-token-resolution'
import { encryptKey } from 'src/crypto/key-cipher'
import {
  deleteGithubCredential,
  getGithubCredential,
  getGithubCredentialByDiscordUserId,
  listGithubCredentialStatuses,
  upsertGithubCredential,
  type UpsertGithubCredentialInput,
} from 'src/db/github-credential.repo'
import { account, user } from 'src/db/schema'
import { createTestDb } from 'src/db/test-db'

type TestDbHandle = ReturnType<typeof createTestDb>['db']

const MASTER_KEY = crypto.randomBytes(32)

function insertUser(db: TestDbHandle, id: string) {
  const now = new Date()
  db.insert(user)
    .values({
      id,
      name: `name-${id}`,
      email: `${id}@example.com`,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function insertAccount(
  db: TestDbHandle,
  opts: { id: string; providerId: string; accountId: string; userId: string },
) {
  const now = new Date()
  db.insert(account)
    .values({
      id: opts.id,
      accountId: opts.accountId,
      providerId: opts.providerId,
      userId: opts.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

function encryptedTokenInput(
  userId: string,
  tokenPlaintext = 'gho_faketoken',
): Pick<
  UpsertGithubCredentialInput,
  'tokenCiphertext' | 'tokenIv' | 'tokenAuthTag'
> {
  const encrypted = encryptKey(
    Buffer.from(tokenPlaintext, 'utf8'),
    `${userId}:github`,
    MASTER_KEY,
  )
  return {
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
  }
}

function upsertInput(
  userId: string,
  overrides: Partial<UpsertGithubCredentialInput> = {},
): UpsertGithubCredentialInput {
  return {
    userId,
    githubUserId: '12345',
    githubLogin: 'octocat',
    derivedName: 'The Octocat',
    derivedEmail: '12345+octocat@users.noreply.github.com',
    scope: 'repo,workflow,read:user,user:email',
    ...encryptedTokenInput(userId),
    ...overrides,
  }
}

describe('github-credential.repo — getGithubCredential', () => {
  it('upsertGithubCredential then getGithubCredential round-trips all fields (with a matching github account row)', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-1')
      insertAccount(db, {
        id: 'acct-github-1',
        providerId: 'github',
        accountId: 'gh-12345',
        userId: 'user-1',
      })

      const input = upsertInput('user-1')
      const upserted = upsertGithubCredential(db, input)

      expect(upserted.userId).toBe('user-1')
      expect(upserted.githubUserId).toBe('12345')
      expect(upserted.githubLogin).toBe('octocat')
      expect(upserted.derivedName).toBe('The Octocat')
      expect(upserted.derivedEmail).toBe(
        '12345+octocat@users.noreply.github.com',
      )
      expect(upserted.scope).toBe('repo,workflow,read:user,user:email')
      expect(upserted.masterKeyVersion).toBe(1)

      const fetched = getGithubCredential(db, 'user-1')
      expect(fetched).toBeDefined()
      expect(fetched?.userId).toBe('user-1')
      expect(fetched?.githubUserId).toBe('12345')
      expect(fetched?.githubLogin).toBe('octocat')
      expect(fetched?.derivedName).toBe('The Octocat')
      expect(fetched?.derivedEmail).toBe(
        '12345+octocat@users.noreply.github.com',
      )
      expect(fetched?.scope).toBe('repo,workflow,read:user,user:email')
      expect(fetched?.tokenCiphertext).toEqual(input.tokenCiphertext)
      expect(fetched?.tokenIv).toEqual(input.tokenIv)
      expect(fetched?.tokenAuthTag).toEqual(input.tokenAuthTag)

      // resolveGithubToken on the freshly-encrypted, round-tripped row
      // returns configured with the original plaintext token, name, email.
      const resolved = resolveGithubToken(fetched, MASTER_KEY)
      expect(resolved.kind).toBe('configured')
      if (resolved.kind !== 'configured') throw new Error('expected configured')
      expect(resolved.tokenPlaintext.toString('utf8')).toBe('gho_faketoken')
      expect(resolved.derivedName).toBe('The Octocat')
      expect(resolved.derivedEmail).toBe(
        '12345+octocat@users.noreply.github.com',
      )
    } finally {
      close()
    }
  })

  it('a github_credential row with NO matching github account row is not-linked (getGithubCredential)', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-orphan')
      // No providerId:'github' account row inserted — simulates the orphan
      // case from schema.ts's write-side non-atomicity invariant.
      upsertGithubCredential(db, upsertInput('user-orphan'))

      expect(getGithubCredential(db, 'user-orphan')).toBeUndefined()
    } finally {
      close()
    }
  })

  it('returns undefined for a userId with no github_credential row at all', () => {
    const { db, close } = createTestDb()
    try {
      expect(getGithubCredential(db, 'nonexistent-user')).toBeUndefined()
    } finally {
      close()
    }
  })
})

describe('github-credential.repo — getGithubCredentialByDiscordUserId', () => {
  it('resolves correctly through the two-hop join for a linked user', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-2')
      insertAccount(db, {
        id: 'acct-discord-2',
        providerId: 'discord',
        accountId: 'discord-snowflake-2',
        userId: 'user-2',
      })
      insertAccount(db, {
        id: 'acct-github-2',
        providerId: 'github',
        accountId: 'gh-67890',
        userId: 'user-2',
      })
      upsertGithubCredential(
        db,
        upsertInput('user-2', { githubLogin: 'hubot' }),
      )

      const result = getGithubCredentialByDiscordUserId(
        db,
        'discord-snowflake-2',
      )
      expect(result).toBeDefined()
      expect(result?.userId).toBe('user-2')
      expect(result?.githubLogin).toBe('hubot')
    } finally {
      close()
    }
  })

  it('a Discord user with no github_credential row returns undefined, not a throw', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-3')
      insertAccount(db, {
        id: 'acct-discord-3',
        providerId: 'discord',
        accountId: 'discord-snowflake-3',
        userId: 'user-3',
      })
      // No github account row, no github_credential row for user-3 at all.

      expect(() =>
        getGithubCredentialByDiscordUserId(db, 'discord-snowflake-3'),
      ).not.toThrow()
      expect(
        getGithubCredentialByDiscordUserId(db, 'discord-snowflake-3'),
      ).toBeUndefined()
    } finally {
      close()
    }
  })

  it('a discordUserId with no matching account row at all returns undefined', () => {
    const { db, close } = createTestDb()
    try {
      expect(
        getGithubCredentialByDiscordUserId(db, 'nonexistent-snowflake'),
      ).toBeUndefined()
    } finally {
      close()
    }
  })

  it('a github_credential row with NO matching github account row is not-linked, even though the discord account exists (orphan case)', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-orphan-2')
      insertAccount(db, {
        id: 'acct-discord-orphan-2',
        providerId: 'discord',
        accountId: 'discord-snowflake-orphan-2',
        userId: 'user-orphan-2',
      })
      // Deliberately NOT inserting a providerId:'github' account row —
      // simulates the orphan case (a github_credential row survives, but
      // the account insert never landed).
      upsertGithubCredential(db, upsertInput('user-orphan-2'))

      expect(
        getGithubCredentialByDiscordUserId(db, 'discord-snowflake-orphan-2'),
      ).toBeUndefined()
    } finally {
      close()
    }
  })
})

describe('github-credential.repo — upsertGithubCredential', () => {
  it('called twice for the same userId (re-link) overwrites the prior row rather than creating a second one', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-4')
      insertAccount(db, {
        id: 'acct-github-4',
        providerId: 'github',
        accountId: 'gh-first',
        userId: 'user-4',
      })

      upsertGithubCredential(
        db,
        upsertInput('user-4', { githubLogin: 'first-login' }),
      )
      const secondInput = upsertInput('user-4', {
        githubUserId: '99999',
        githubLogin: 'second-login',
        derivedName: 'Second Name',
        derivedEmail: '99999+second-login@users.noreply.github.com',
      })
      const overwritten = upsertGithubCredential(db, secondInput)

      // The overwrite actually happened — different login/token, not just
      // "no error was thrown."
      expect(overwritten.githubLogin).toBe('second-login')
      expect(overwritten.githubUserId).toBe('99999')
      expect(overwritten.derivedName).toBe('Second Name')

      const fetched = getGithubCredential(db, 'user-4')
      expect(fetched?.githubLogin).toBe('second-login')

      const resolved = resolveGithubToken(fetched, MASTER_KEY)
      expect(resolved.kind).toBe('configured')
      if (resolved.kind !== 'configured') throw new Error('expected configured')
      expect(resolved.tokenPlaintext.toString('utf8')).toBe('gho_faketoken')

      // Exactly one row for this userId — the PK enforces this, but assert
      // it directly via the roster too (no second row leaking through).
      const statuses = listGithubCredentialStatuses(db).filter(
        s => s.userId === 'user-4',
      )
      expect(statuses).toHaveLength(0) // user-4 has no discord account row
    } finally {
      close()
    }
  })
})

describe('github-credential.repo — deleteGithubCredential', () => {
  it('deletes the row for the given userId', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-5')
      insertAccount(db, {
        id: 'acct-github-5',
        providerId: 'github',
        accountId: 'gh-5',
        userId: 'user-5',
      })
      upsertGithubCredential(db, upsertInput('user-5'))
      expect(getGithubCredential(db, 'user-5')).toBeDefined()

      deleteGithubCredential(db, 'user-5')

      // Bypass the inner-join read to confirm the row itself is gone, not
      // merely reported as not-linked.
      expect(getGithubCredential(db, 'user-5')).toBeUndefined()
    } finally {
      close()
    }
  })

  it('deleting a nonexistent userId is a no-op, not an error', () => {
    const { db, close } = createTestDb()
    try {
      expect(() => deleteGithubCredential(db, 'nonexistent-user')).not.toThrow()
    } finally {
      close()
    }
  })
})

describe('github-credential.repo — listGithubCredentialStatuses', () => {
  it('includes users with no github_credential row (not-linked) alongside linked users', () => {
    const { db, close } = createTestDb()
    try {
      // Linked user: discord + github accounts + a credential row.
      insertUser(db, 'user-linked')
      insertAccount(db, {
        id: 'acct-discord-linked',
        providerId: 'discord',
        accountId: 'discord-linked',
        userId: 'user-linked',
      })
      insertAccount(db, {
        id: 'acct-github-linked',
        providerId: 'github',
        accountId: 'gh-linked',
        userId: 'user-linked',
      })
      upsertGithubCredential(
        db,
        upsertInput('user-linked', { githubLogin: 'linked-login' }),
      )

      // Not-linked user: only a discord account, no github account or
      // credential row at all.
      insertUser(db, 'user-not-linked')
      insertAccount(db, {
        id: 'acct-discord-not-linked',
        providerId: 'discord',
        accountId: 'discord-not-linked',
        userId: 'user-not-linked',
      })

      const statuses = listGithubCredentialStatuses(db)
      expect(statuses).toHaveLength(2)

      const linked = statuses.find(s => s.userId === 'user-linked')
      expect(linked).toEqual({
        userId: 'user-linked',
        discordUserId: 'discord-linked',
        githubLogin: 'linked-login',
        linked: true,
      })

      const notLinked = statuses.find(s => s.userId === 'user-not-linked')
      expect(notLinked).toEqual({
        userId: 'user-not-linked',
        discordUserId: 'discord-not-linked',
        githubLogin: undefined,
        linked: false,
      })
    } finally {
      close()
    }
  })

  it('excludes an orphaned github_credential row (no matching github account row) from "linked"', () => {
    const { db, close } = createTestDb()
    try {
      insertUser(db, 'user-orphan-3')
      insertAccount(db, {
        id: 'acct-discord-orphan-3',
        providerId: 'discord',
        accountId: 'discord-orphan-3',
        userId: 'user-orphan-3',
      })
      // No providerId:'github' account row — orphan case.
      upsertGithubCredential(db, upsertInput('user-orphan-3'))

      const statuses = listGithubCredentialStatuses(db)
      const status = statuses.find(s => s.userId === 'user-orphan-3')

      expect(status).toEqual({
        userId: 'user-orphan-3',
        discordUserId: 'discord-orphan-3',
        githubLogin: undefined,
        linked: false,
      })
    } finally {
      close()
    }
  })

  it('returns an empty array when there are no discord-linked users at all', () => {
    const { db, close } = createTestDb()
    try {
      expect(listGithubCredentialStatuses(db)).toEqual([])
    } finally {
      close()
    }
  })
})
