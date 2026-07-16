import { KeyEncryptedError, parsePrivateKey, PrivateKey } from 'sshpk'

// Maximum allowed size for a PEM/OpenSSH key blob (DoS guard applied before parse).
const MAX_KEY_BYTES = 32_768 // 32 KiB
// Minimum sanity floor (real private keys are at least ~200 bytes).
const MIN_KEY_BYTES = 100

// Result of successful validation.
export interface SshKeyValidation {
  fingerprint: string // SHA256:<base64> — matches ssh-keygen -lf output
}

// Normalize a pasted key blob to the exact byte shape ssh-keygen expects: LF
// line endings, no leading/trailing blank lines or whitespace, exactly one
// trailing newline. sshpk (validateAndFingerprint below) tolerates CRLF, a
// leading blank line, and a missing trailing newline — ssh-keygen's own PEM
// parser does not, and fails with a misleading "error in libcrypto:
// unsupported" or "No such file or directory" instead of a parse error.
// Callers must normalize BEFORE validateAndFingerprint and BEFORE encrypting
// for storage, so the bytes written to disk at commit time are always the
// bytes ssh-keygen will successfully sign with.
export function normalizeKeyBlob(pem: string | Buffer): Buffer {
  const text = typeof pem === 'string' ? pem : pem.toString('utf8')
  return Buffer.from(`${text.replace(/\r\n?/g, '\n').trim()}\n`, 'utf8')
}

// Validate a raw private key blob and return its fingerprint.
// Throws with a distinct message for:
//   - passphrase-protected keys (KeyEncryptedError)
//   - unparseable/invalid/public-key blobs (KeyParseError or wrong key object)
//   - blobs outside the size bounds
export function validateAndFingerprint(pem: string | Buffer): SshKeyValidation {
  const buf = typeof pem === 'string' ? Buffer.from(pem, 'utf8') : pem

  if (buf.length < MIN_KEY_BYTES) {
    throw new Error('SSH key is too short to be a valid private key')
  }
  if (buf.length > MAX_KEY_BYTES) {
    throw new Error(
      `SSH key exceeds the maximum allowed size (${MAX_KEY_BYTES} bytes)`,
    )
  }

  let key: PrivateKey
  try {
    // Never pass a passphrase — we want passphrase-protected keys to throw
    // KeyEncryptedError so they are explicitly rejected (R10).
    const parsed = parsePrivateKey(buf, 'auto')
    key = parsed
  } catch (err) {
    if (err instanceof KeyEncryptedError) {
      throw new Error(
        'Passphrase-protected SSH keys are not supported — provide an unencrypted key',
      )
    }
    // KeyParseError, TypeError, or anything else — invalid / not a private key
    throw new Error(
      `Invalid SSH private key: ${(err as Error).message ?? String(err)}`,
    )
  }

  // Ensure we got a private key, not a public key accidentally parsed.
  if (!(key instanceof PrivateKey)) {
    throw new Error('Provided key is not an SSH private key')
  }

  const fingerprint = key.toPublic().fingerprint('sha256').toString()
  return { fingerprint }
}
