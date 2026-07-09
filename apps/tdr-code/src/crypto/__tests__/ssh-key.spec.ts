import { validateAndFingerprint } from 'src/crypto/ssh-key'

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
