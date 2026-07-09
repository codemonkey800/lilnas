import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// pino ships `export =` merged with a same-named namespace — the
// import/no-named-as-default warning is a known false positive for this
// pattern (see backend-logger.spec.ts's identical precedent).
// eslint-disable-next-line import/no-named-as-default
import pino from 'pino'

import {
  isConfigured,
  isDecryptFailed,
  resolveIdentity,
} from 'src/crypto/identity-resolution'
import { encryptKey } from 'src/crypto/key-cipher'
import * as sshKeyModule from 'src/crypto/ssh-key'
import * as backendLoggerModule from 'src/logging/backend-logger'

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
  const encrypted = encryptKey(
    Buffer.from(plaintext),
    discordUserId,
    MASTER_KEY,
  )
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

// ──────────────────────────────────────────────────────────────────────────────
// C1 (critical, real-serialized-output): proves resolveIdentity's
// decrypt/parse-failure catch block never lets err.message (or err.stack, or
// the raw err object) reach the written log line — the exact leak vector a
// real sshpk KeyParseError creates on malformed-key input (its message
// embeds decoded private-key byte content; see identity-resolution.ts's own
// comment on the log call this test targets for the full threat model).
//
// This test does NOT need the REAL sshpk library to actually throw a
// message containing decoded key bytes — validateAndFingerprint is mocked
// to throw a message containing a planted sentinel, standing in for that
// real failure mode deterministically (independent of sshpk's exact
// internal error-formatting, which is an implementation detail this test
// should not be coupled to). Everything else in resolveIdentity's own code
// path runs for REAL and unmocked: a real successful AES-256-GCM decrypt
// (via the real decryptKey/encryptKey), so this exercises the
// sshpk-parse-failure sub-branch specifically — not the GCM decrypt-failure
// sub-branch, which is a different (and itself secret-free) failure mode.
//
// The write side is proven the same way backend-logger.spec.ts proves
// redaction: a REAL pino instance built from buildBackendLoggerOptions()'s
// exact production config, redirected only at an isolated per-test temp
// file — never the real shared logFilePath('backend') sink multiple
// processes/tests could be concurrently appending to.
// ──────────────────────────────────────────────────────────────────────────────
describe('resolveIdentity — C1: decrypt/parse-failure path never logs err.message (real-serialized-output)', () => {
  const KEY_BYTE_SENTINEL =
    'SENTINEL_DECODED_PRIVATE_KEY_BYTES_c1f2e3d4a5b6c7d8'

  function uniqueTempPath(): string {
    return path.join(
      os.tmpdir(),
      `tdr-code-identity-resolution-c1-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    )
  }

  async function pollForFileContent(
    filePath: string,
    timeoutMs = 5_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8')
        if (content.trim().length > 0) return content
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`${filePath} did not receive content within ${timeoutMs}ms`)
  }

  async function readLastLineFrom(
    outputPath: string,
  ): Promise<Record<string, unknown>> {
    const content = await pollForFileContent(outputPath)
    const lines = content
      .trim()
      .split('\n')
      .filter(line => line.trim().length > 0)
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('a validateAndFingerprint parse failure whose message embeds decoded key bytes never reaches the written log line', async () => {
    // Real row, real master key, real successful decrypt — only
    // validateAndFingerprint's throw is simulated.
    const row = makeRow('999888777666555444')

    const validateSpy = jest
      .spyOn(sshKeyModule, 'validateAndFingerprint')
      .mockImplementation(() => {
        throw new Error(
          `Invalid SSH private key: unable to parse OpenSSH private key: ${KEY_BYTE_SENTINEL}`,
        )
      })

    // Redirect the exact production logger config at an isolated temp file
    // for this one test — buildBackendLoggerOptions('bot') is the SAME
    // config initBackendLogger('bot') builds in real bot-process operation
    // (level/base/redact all real; only `transport`'s destination differs).
    const outputPath = uniqueTempPath()
    const isolatedLogger = pino({
      ...backendLoggerModule.buildBackendLoggerOptions('bot'),
      transport: {
        target: 'pino/file',
        options: { destination: outputPath, mkdir: true },
      },
    })
    const getBackendLoggerSpy = jest
      .spyOn(backendLoggerModule, 'getBackendLogger')
      .mockReturnValue(isolatedLogger)

    try {
      // The real, unmocked resolveIdentity — exercises the real catch block.
      const result = resolveIdentity(row, MASTER_KEY)

      // Sanity: this really is the decrypt-succeeded/parse-failed branch,
      // not a GCM decrypt failure (which would never call
      // validateAndFingerprint at all).
      expect(result.kind).toBe('decrypt_failed')
      expect(validateSpy).toHaveBeenCalled()

      const line = await readLastLineFrom(outputPath)

      // Positive assertions: the fix's intended safe fields are present.
      expect(line.event).toBe('identity-decrypt-failed')
      expect(line.discordUserId).toBe('999888777666555444')
      expect(line.keyFingerprint).toBe(row.keyFingerprint)
      expect(line.errName).toBe('Error')

      // Negative assertions — this is what actually proves the leak is
      // closed. No `message` field at all (pino would add one only if `err`
      // or an Error-shaped value were logged directly).
      expect(line.message).toBeUndefined()
      // No `err`/`stack` field either — confirms the raw err object was
      // never passed to the logger (which would trigger pino's default err
      // serializer and emit .message + the full .stack verbatim).
      expect(line.err).toBeUndefined()
      expect(line.stack).toBeUndefined()

      // The load-bearing assertion: the planted sentinel — standing in for
      // decoded private-key byte content — does not appear ANYWHERE in the
      // raw serialized line, under any field name.
      expect(JSON.stringify(line)).not.toContain(KEY_BYTE_SENTINEL)
    } finally {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      getBackendLoggerSpy.mockRestore()
      validateSpy.mockRestore()
    }
  })

  it('reverting the fix to `${err.message}` interpolation would fail the sentinel assertion above (documents what this test catches)', async () => {
    // This test does not exercise resolveIdentity again — it exists purely
    // as an executable comment proving the ABOVE test is not vacuous: if
    // the C1 fix were reverted to the original
    // `logger.warn(\`... ${err.message}\`)` shape, the sentinel would appear
    // verbatim in the interpolated message string, and the exact assertion
    // this test also uses (`not.toContain(KEY_BYTE_SENTINEL)`) would fail.
    const revertedMessageShape = `Identity decrypt/parse failed discordUserId=999888777666555444 fingerprint=SHA256:x: Invalid SSH private key: unable to parse OpenSSH private key: ${KEY_BYTE_SENTINEL}`
    expect(revertedMessageShape).toContain(KEY_BYTE_SENTINEL)
  })
})
