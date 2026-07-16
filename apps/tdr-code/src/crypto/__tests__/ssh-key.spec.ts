import { normalizeKeyBlob, validateAndFingerprint } from 'src/crypto/ssh-key'

// Unencrypted ed25519 OpenSSH key generated for this test.
// Golden fingerprint: SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY
const TEST_ED25519_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQAAALBYegssWHoL
LAAAAAtzc2gtZWQyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQ
AAAEDjjCG4LkwqWl6PemDgYqlKSELyGT7LjUg8fWwH94X/yUPW1Fg2R17NnHAMMp1hS/rC
lYu8/Zyg8ts89VypYsWpAAAAKWplcmVteWFzdW5jaW9ubmV0ZmxpeC5jb21AamVyZW15LW
5mbHgtbWFjAQIDBA==
-----END OPENSSH PRIVATE KEY-----`

// AES-128-CBC encrypted ed25519 key (classic PEM passphrase format).
const PASSPHRASE_ENCRYPTED_CLASSIC_PEM = `-----BEGIN EC PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: AES-128-CBC,ABCDEF0123456789ABCDEF0123456789

AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END EC PRIVATE KEY-----`

// OpenSSH format encrypted key (ed25519 with bcrypt KDF, aes256-ctr cipher).
// Generated with: ssh-keygen -t ed25519 -N "testpassphrase" -f /tmp/test_key
// sshpk detects the bcrypt KDF and throws KeyEncryptedError (not a parse error).
const OPENSSH_ENCRYPTED = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABDc+p0isI
m5KII5wq+ZY785AAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIFHwYs6nM9YPZBCi
7jXxRf8cYS8prT4ZKdcMcQkHEUbfAAAAsLY052/RzEtN6dz5MroPFf9lk/R85hExC731MK
OSseuy4+YK9mRUFXlf1x/Vi4azvCgTef7WMOPyf0dg4V2neg8MMdO5fD5sjZCLMMHFp4v6
Z0R/RC8JW1xZgZAE/CjmGbwp9w/cJvkP/bAhcm7I4VOM5Dk2c2Sm6ztjVopJTWmqJlx2sn
gmvr+iRaJD0T0eEg+JnJmu6HgfOSZXD3S8/w8ySBPgjReVpIH4Nz7KrCPM
-----END OPENSSH PRIVATE KEY-----`

describe('ssh-key — validateAndFingerprint', () => {
  it('golden fingerprint: known ed25519 key matches ssh-keygen -lf output', () => {
    const result = validateAndFingerprint(TEST_ED25519_KEY)
    expect(result.fingerprint).toBe(
      'SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY',
    )
  })

  it('rejects input below the minimum size floor', () => {
    expect(() => validateAndFingerprint('tiny')).toThrow()
  })

  it('rejects input above the maximum size cap (DoS guard)', () => {
    const oversized = 'A'.repeat(33_000)
    expect(() => validateAndFingerprint(oversized)).toThrow(
      /maximum allowed size/,
    )
  })

  it('rejects garbage / unparseable input', () => {
    const garbage = Buffer.alloc(200).fill(0x41) // 200 'A' bytes
    expect(() => validateAndFingerprint(garbage)).toThrow()
  })

  it('rejects a Proc-Type: 4,ENCRYPTED classic PEM key with passphrase message', () => {
    // sshpk sees Proc-Type: 4,ENCRYPTED and throws KeyEncryptedError
    expect(() =>
      validateAndFingerprint(PASSPHRASE_ENCRYPTED_CLASSIC_PEM),
    ).toThrow(/[Pp]assphrase/)
  })

  it('rejects OpenSSH encrypted key (bcrypt KDF) with passphrase message', () => {
    // sshpk parses the OpenSSH header, detects bcrypt KDF, throws KeyEncryptedError
    expect(() => validateAndFingerprint(OPENSSH_ENCRYPTED)).toThrow(
      /[Pp]assphrase/,
    )
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// normalizeKeyBlob — closes the gap between sshpk (lenient, used to validate
// at upsert time) and ssh-keygen (strict, the actual commit signer). Each
// malformed shape below is one sshpk silently accepts today but ssh-keygen
// refuses to load at sign time — reproduced against the real ssh-keygen
// binary during the flexecute/tdr-code signing-key incident (2026-07-16).
// TEST_ED25519_KEY itself already lacks a trailing newline (its template
// literal ends right at `-----END...-----` with no `\n` before the closing
// backtick), so it doubles as the "missing trailing newline" fixture.
// ──────────────────────────────────────────────────────────────────────────────
describe('ssh-key — normalizeKeyBlob', () => {
  const CANONICAL = `${TEST_ED25519_KEY}\n`

  it('adds a trailing newline when missing (TEST_ED25519_KEY itself has none)', () => {
    expect(normalizeKeyBlob(TEST_ED25519_KEY).toString('utf8')).toBe(CANONICAL)
  })

  it('strips a leading blank line (the real-world trigger: browser/chat paste prepending an empty line)', () => {
    const withLeadingBlank = `\n${TEST_ED25519_KEY}`
    expect(normalizeKeyBlob(withLeadingBlank).toString('utf8')).toBe(CANONICAL)
  })

  it('converts CRLF line endings to LF', () => {
    const crlf = TEST_ED25519_KEY.replace(/\n/g, '\r\n')
    expect(normalizeKeyBlob(crlf).toString('utf8')).toBe(CANONICAL)
  })

  it('is idempotent on already-canonical input', () => {
    expect(normalizeKeyBlob(CANONICAL).toString('utf8')).toBe(CANONICAL)
  })

  it('normalizes a key with all three defects at once (leading blank line + CRLF + no trailing newline)', () => {
    const mangled = `\n${TEST_ED25519_KEY.replace(/\n/g, '\r\n')}`
    expect(normalizeKeyBlob(mangled).toString('utf8')).toBe(CANONICAL)
  })

  it('composes with validateAndFingerprint: normalizing a malformed key does not change its fingerprint', () => {
    const withLeadingBlank = `\n${TEST_ED25519_KEY}`
    const normalized = normalizeKeyBlob(withLeadingBlank)
    expect(validateAndFingerprint(normalized).fingerprint).toBe(
      'SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY',
    )
  })

  it('accepts a Buffer input, not just a string', () => {
    const buf = Buffer.from(`\n${TEST_ED25519_KEY}`, 'utf8')
    expect(normalizeKeyBlob(buf).toString('utf8')).toBe(CANONICAL)
  })
})
