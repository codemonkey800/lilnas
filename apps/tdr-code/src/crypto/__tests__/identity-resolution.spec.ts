import crypto from 'node:crypto'

import { encryptKey } from 'src/crypto/key-cipher'
import {
  isConfigured,
  isDecryptFailed,
  isUnconfigured,
  resolveIdentity,
} from 'src/crypto/identity-resolution'

const MASTER_KEY = crypto.randomBytes(32)
const OTHER_MASTER_KEY = crypto.randomBytes(32)
const DISCORD_USER_ID = '123456789012345678'

// Real ed25519 test key (unencrypted).
const TEST_KEY_PEM = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQAAALBYegssWHoL
LAAAAAtzc2gtZWQyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQ
AAAEDjjCG4LkwqWl6PemDgYqlKSELyGT7LjUg8fWwH94X/yUPW1Fg2R17NnHAMMp1hS/rC
lYu8/Zyg8ts89VypYsWpAAAAKWplcmVteWFzdW5jaW9ubmV0ZmxpeC5jb21AamVyZW15LW
5mbHgtbWFjAQIDBA==
-----END OPENSSH PRIVATE KEY-----`

function makeRow(discordUserId = DISCORD_USER_ID) {
  const plaintext = Buffer.from(TEST_KEY_PEM, 'utf8')
  const encrypted = encryptKey(Buffer.from(plaintext), discordUserId, MASTER_KEY)
  return {
    discordUserId,
    name: 'Test User',
    email: 'test@example.com',
    keyCiphertext: encrypted.ciphertext,
    keyIv: encrypted.iv,
    keyAuthTag: encrypted.authTag,
    keyFingerprint: 'SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY',
  }
}

describe('resolveIdentity', () => {
  it('no row → unconfigured', () => {
    const result = resolveIdentity(undefined, MASTER_KEY)
    expect(result.kind).toBe('unconfigured')
    expect(isUnconfigured(result)).toBe(true)
  })

  it('row with valid ciphertext → configured with keyPlaintext and recomputed fingerprint', () => {
    const row = makeRow()
    const result = resolveIdentity(row, MASTER_KEY)

    expect(result.kind).toBe('configured')
    if (!isConfigured(result)) throw new Error('expected configured')

    expect(result.name).toBe('Test User')
    expect(result.email).toBe('test@example.com')
    expect(Buffer.isBuffer(result.keyPlaintext)).toBe(true)
    // Fingerprint is recomputed from decrypted plaintext, matches golden value
    expect(result.fingerprint).toBe(
      'SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY',
    )
  })

  it('row + wrong master key → decrypt_failed, stored fingerprint preserved', () => {
    const row = makeRow()
    const result = resolveIdentity(row, OTHER_MASTER_KEY)

    expect(result.kind).toBe('decrypt_failed')
    expect(isDecryptFailed(result)).toBe(true)
    if (!isDecryptFailed(result)) throw new Error('expected decrypt_failed')
    expect(result.fingerprint).toBe(row.keyFingerprint)
  })

  it('decrypt_failed with tampered ciphertext preserves stored fingerprint', () => {
    const row = makeRow()
    // Tamper with one byte of the ciphertext
    const tampered = { ...row, keyCiphertext: Buffer.from(row.keyCiphertext) }
    tampered.keyCiphertext[0] = tampered.keyCiphertext[0]! ^ 0xff

    const result = resolveIdentity(tampered, MASTER_KEY)
    expect(result.kind).toBe('decrypt_failed')
    if (!isDecryptFailed(result)) throw new Error('expected decrypt_failed')
    expect(result.fingerprint).toBe(row.keyFingerprint)
  })

  it('isConfigured type guard narrows to ConfiguredIdentity (keyPlaintext without !)', () => {
    const row = makeRow()
    const result = resolveIdentity(row, MASTER_KEY)

    if (isConfigured(result)) {
      // This line must compile without a non-null assertion
      const _: Buffer = result.keyPlaintext
      expect(_).toBeDefined()
    } else {
      fail('expected configured')
    }
  })

  it('resolveIdentity never throws — maps all errors to decrypt_failed', () => {
    // Completely garbage row
    const garbage = {
      discordUserId: DISCORD_USER_ID,
      name: 'x',
      email: 'x',
      keyCiphertext: Buffer.alloc(0),
      keyIv: Buffer.alloc(0),
      keyAuthTag: Buffer.alloc(0),
      keyFingerprint: 'SHA256:fake',
    }
    expect(() => resolveIdentity(garbage, MASTER_KEY)).not.toThrow()
    const result = resolveIdentity(garbage, MASTER_KEY)
    expect(result.kind).toBe('decrypt_failed')
  })
})
