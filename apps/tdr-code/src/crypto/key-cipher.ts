import crypto from 'node:crypto'

// AES-256-GCM constants.
const ALGORITHM = 'aes-256-gcm' as const
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export interface EncryptedKey {
  iv: Buffer
  authTag: Buffer
  ciphertext: Buffer
}

// Encrypt a private key plaintext with AES-256-GCM. AAD binds the
// ciphertext to its discordUserId so row-swap is detected on decrypt
// (Decision #8). Each call uses a fresh random IV — never reuse.
export function encryptKey(
  plaintext: Buffer,
  aad: string,
  masterKey: Buffer,
): EncryptedKey {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  // Best-effort zeroize the plaintext buffer (defense-in-depth; V8 may have
  // copied, but reduces lingering plaintext in heap dumps).
  plaintext.fill(0)

  return { iv, authTag, ciphertext }
}

// Decrypt a stored key. Throws on any tamper, wrong master key, or bad AAD.
// Callers must map throws to the decrypt_failed state — never let them
// propagate as unhandled errors (Decision #8).
export function decryptKey(
  encrypted: EncryptedKey,
  aad: string,
  masterKey: Buffer,
): Buffer {
  if (encrypted.authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      `[key-cipher] authTag must be exactly ${AUTH_TAG_BYTES} bytes, got ${encrypted.authTag.length}`,
    )
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, encrypted.iv, {
    authTagLength: AUTH_TAG_BYTES,
  })
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(encrypted.authTag)

  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ])

  return plaintext
}
