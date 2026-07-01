import { decryptKey, type EncryptedKey } from './key-cipher'
import { validateAndFingerprint } from './ssh-key'

// Row type imported as a structural type only — avoids importing from src/agent
// (bot-plane-only module) from the main-plane controller. Both planes import
// this module downward (Decision #10).
export interface GitIdentityRowLike {
  discordUserId: string
  name: string
  email: string
  keyCiphertext: Buffer
  keyIv: Buffer
  keyAuthTag: Buffer
  keyFingerprint: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Three-state discriminated union for resolved identity (R6, R11, R18).
// ──────────────────────────────────────────────────────────────────────────────

export interface ConfiguredIdentity {
  kind: 'configured'
  name: string
  email: string
  keyPlaintext: Buffer
  fingerprint: string
}

export interface UnconfiguredIdentity {
  kind: 'unconfigured'
}

export interface DecryptFailedIdentity {
  kind: 'decrypt_failed'
  fingerprint: string
}

export type IdentityResolution =
  | ConfiguredIdentity
  | UnconfiguredIdentity
  | DecryptFailedIdentity

export function isConfigured(r: IdentityResolution): r is ConfiguredIdentity {
  return r.kind === 'configured'
}

export function isUnconfigured(
  r: IdentityResolution,
): r is UnconfiguredIdentity {
  return r.kind === 'unconfigured'
}

export function isDecryptFailed(
  r: IdentityResolution,
): r is DecryptFailedIdentity {
  return r.kind === 'decrypt_failed'
}

// ──────────────────────────────────────────────────────────────────────────────

// Resolve a stored identity row (or undefined) to the three-state union.
// - No row → unconfigured
// - Row + successful decrypt/parse → configured (fingerprint recomputed from
//   plaintext at resolve-time, NOT trusted from the stored column, which could
//   diverge from the ciphertext on a partial write)
// - Row + failed decrypt/parse → decrypt_failed (stored fingerprint preserved
//   for the UI's red-badge path, R18)
//
// Must NOT throw — all errors are mapped to decrypt_failed. Callers are in
// framework-free context and must not propagate decryption exceptions.
export function resolveIdentity(
  row: GitIdentityRowLike | undefined,
  masterKey: Buffer,
): IdentityResolution {
  if (!row) {
    return { kind: 'unconfigured' }
  }

  const encrypted: EncryptedKey = {
    iv: row.keyIv,
    authTag: row.keyAuthTag,
    ciphertext: row.keyCiphertext,
  }

  try {
    const keyPlaintext = decryptKey(encrypted, row.discordUserId, masterKey)
    // Recompute fingerprint from decrypted plaintext — do not trust stored column
    const { fingerprint } = validateAndFingerprint(keyPlaintext)

    return {
      kind: 'configured',
      name: row.name,
      email: row.email,
      keyPlaintext,
      fingerprint,
    }
  } catch {
    return {
      kind: 'decrypt_failed',
      fingerprint: row.keyFingerprint,
    }
  }
}
