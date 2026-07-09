import crypto from 'node:crypto'

import {
  type GithubCredentialRowLike,
  isGithubConfigured,
  resolveGithubToken,
} from 'src/crypto/github-token-resolution'
import { encryptKey } from 'src/crypto/key-cipher'

const MASTER_KEY = crypto.randomBytes(32)
const OTHER_MASTER_KEY = crypto.randomBytes(32)
const WRONG_LENGTH_MASTER_KEY = crypto.randomBytes(16)
const USER_ID = 'user-abc123'

function makeRow(userId = USER_ID): GithubCredentialRowLike {
  const plaintext = Buffer.from('gho_faketoken1234567890', 'utf8')
  const encrypted = encryptKey(plaintext, `${userId}:github`, MASTER_KEY)
  return {
    userId,
    githubLogin: 'octocat',
    derivedName: 'The Octocat',
    derivedEmail: '1+octocat@users.noreply.github.com',
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
  }
}

describe('resolveGithubToken', () => {
  it('no row -> unconfigured', () => {
    const result = resolveGithubToken(undefined, MASTER_KEY)
    expect(result.kind).toBe('unconfigured')
  })

  it('row with valid ciphertext -> configured with original plaintext, name, and email', () => {
    const row = makeRow()
    const result = resolveGithubToken(row, MASTER_KEY)

    expect(result.kind).toBe('configured')
    if (!isGithubConfigured(result)) throw new Error('expected configured')

    expect(Buffer.isBuffer(result.tokenPlaintext)).toBe(true)
    expect(result.tokenPlaintext.toString('utf8')).toBe(
      'gho_faketoken1234567890',
    )
    expect(result.derivedName).toBe('The Octocat')
    expect(result.derivedEmail).toBe('1+octocat@users.noreply.github.com')
    expect(result.githubLogin).toBe('octocat')
  })

  it('isGithubConfigured type guard narrows to ConfiguredGithubToken (tokenPlaintext without !)', () => {
    const row = makeRow()
    const result = resolveGithubToken(row, MASTER_KEY)

    if (isGithubConfigured(result)) {
      // This line must compile without a non-null assertion.
      const _: Buffer = result.tokenPlaintext
      expect(_).toBeDefined()
    } else {
      fail('expected configured')
    }
  })

  it('row encrypted under a different master key -> decrypt_failed, not a throw', () => {
    const row = makeRow()
    expect(() => resolveGithubToken(row, OTHER_MASTER_KEY)).not.toThrow()

    const result = resolveGithubToken(row, OTHER_MASTER_KEY)
    expect(result.kind).toBe('decrypt_failed')
  })

  it('row with a corrupted authTag -> decrypt_failed, not a throw', () => {
    const row = makeRow()
    const tampered = {
      ...row,
      tokenAuthTag: Buffer.from(row.tokenAuthTag),
    }
    tampered.tokenAuthTag[0] = tampered.tokenAuthTag[0]! ^ 0xff

    expect(() => resolveGithubToken(tampered, MASTER_KEY)).not.toThrow()

    const result = resolveGithubToken(tampered, MASTER_KEY)
    expect(result.kind).toBe('decrypt_failed')
  })

  it('completely garbage row -> decrypt_failed, never throws', () => {
    const garbage: GithubCredentialRowLike = {
      userId: USER_ID,
      githubLogin: 'x',
      derivedName: 'x',
      derivedEmail: 'x',
      tokenCiphertext: Buffer.alloc(0),
      tokenIv: Buffer.alloc(0),
      tokenAuthTag: Buffer.alloc(0),
    }
    expect(() => resolveGithubToken(garbage, MASTER_KEY)).not.toThrow()
    expect(resolveGithubToken(garbage, MASTER_KEY).kind).toBe('decrypt_failed')
  })

  it('a wrong-length master key rethrows ERR_MASTER_KEY_LENGTH instead of mapping to decrypt_failed', () => {
    const row = makeRow()
    expect(() => resolveGithubToken(row, WRONG_LENGTH_MASTER_KEY)).toThrow(
      RangeError,
    )

    try {
      resolveGithubToken(row, WRONG_LENGTH_MASTER_KEY)
      fail('expected resolveGithubToken to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RangeError)
      expect((err as NodeJS.ErrnoException).code).toBe('ERR_MASTER_KEY_LENGTH')
    }
  })

  it('the AAD is scoped to `${userId}:github` — a row decrypted under a different userId fails', () => {
    // Encrypt directly with a mismatched AAD to prove resolveGithubToken's
    // AAD reconstruction (`${row.userId}:github`) is what makes decryption
    // succeed — swapping in a row claiming a different userId than the one
    // the ciphertext was actually bound to must fail closed, not silently
    // decrypt under the wrong identity.
    const row = makeRow('real-user-id')
    const rowClaimingDifferentUser = { ...row, userId: 'attacker-user-id' }

    const result = resolveGithubToken(rowClaimingDifferentUser, MASTER_KEY)
    expect(result.kind).toBe('decrypt_failed')
  })
})
