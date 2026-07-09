import crypto from 'node:crypto'

import { decryptKey, encryptKey } from 'src/crypto/key-cipher'

function makeKey() {
  return crypto.randomBytes(32)
}

function makePlaintext() {
  return Buffer.from(
    '-----BEGIN OPENSSH PRIVATE KEY-----\nfakekeymaterial\n-----END OPENSSH PRIVATE KEY-----\n',
  )
}

describe('key-cipher', () => {
  describe('encryptKey / decryptKey round-trip', () => {
    it('round-trips exact plaintext bytes with correct AAD', () => {
      const masterKey = makeKey()
      const plaintext = makePlaintext()
      const original = Buffer.from(plaintext) // copy before encryption zeroizes it

      const encrypted = encryptKey(
        Buffer.from(plaintext),
        'discord-user-123',
        masterKey,
      )
      const decrypted = decryptKey(encrypted, 'discord-user-123', masterKey)

      expect(decrypted).toEqual(original)
    })

    it('each encrypt call produces a different IV', () => {
      const masterKey = makeKey()
      const e1 = encryptKey(makePlaintext(), 'user-1', masterKey)
      const e2 = encryptKey(makePlaintext(), 'user-1', masterKey)
      expect(e1.iv).not.toEqual(e2.iv)
    })
  })

  describe('tamper / wrong-key detection', () => {
    it('decrypt with a different master key throws', () => {
      const masterKey = makeKey()
      const otherKey = makeKey()
      const encrypted = encryptKey(makePlaintext(), 'user-1', masterKey)

      expect(() => decryptKey(encrypted, 'user-1', otherKey)).toThrow()
    })

    it('decrypt with mismatched AAD (row-swap) throws', () => {
      const masterKey = makeKey()
      const encrypted = encryptKey(makePlaintext(), 'user-1', masterKey)

      expect(() => decryptKey(encrypted, 'user-2', masterKey)).toThrow()
    })

    it('tampered ciphertext throws', () => {
      const masterKey = makeKey()
      const encrypted = encryptKey(makePlaintext(), 'user-1', masterKey)
      // Flip a byte in the ciphertext
      encrypted.ciphertext[0] = encrypted.ciphertext[0]! ^ 0xff

      expect(() => decryptKey(encrypted, 'user-1', masterKey)).toThrow()
    })

    it('tampered authTag throws', () => {
      const masterKey = makeKey()
      const encrypted = encryptKey(makePlaintext(), 'user-1', masterKey)
      encrypted.authTag[0] = encrypted.authTag[0]! ^ 0xff

      expect(() => decryptKey(encrypted, 'user-1', masterKey)).toThrow()
    })

    it('tampered IV throws', () => {
      const masterKey = makeKey()
      const encrypted = encryptKey(makePlaintext(), 'user-1', masterKey)
      encrypted.iv[0] = encrypted.iv[0]! ^ 0xff

      expect(() => decryptKey(encrypted, 'user-1', masterKey)).toThrow()
    })

    it('authTag length != 16 bytes is rejected before any decryption attempt', () => {
      const masterKey = makeKey()
      const encrypted = encryptKey(makePlaintext(), 'user-1', masterKey)

      expect(() =>
        decryptKey(
          { ...encrypted, authTag: encrypted.authTag.slice(0, 8) },
          'user-1',
          masterKey,
        ),
      ).toThrow(/authTag must be exactly 16 bytes/)
    })
  })
})
