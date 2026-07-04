import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

import { decryptKey, type EncryptedKey } from './key-cipher'
import { validateAndFingerprint } from './ssh-key'

// Non-DI (plain exported function, called from both bot-plane and main-plane
// contexts — see the file's own dual-plane note below). getBackendLogger()
// is fetched AT LOG TIME inside resolveIdentity's catch block, never at
// module-eval time — see backend-logger.ts's header comment for why that's
// load-bearing: a dual-plane file gets the correct per-process logger
// automatically only if it never caches the root at import time.

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
  } catch (err) {
    // A wrong-length master key is a deployment misconfiguration, not a per-row
    // failure — rethrow so callers see a loud error instead of silent decrypt_failed
    // for every row (which would mask the real cause).
    if (
      err instanceof RangeError &&
      (err as NodeJS.ErrnoException).code === 'ERR_MASTER_KEY_LENGTH'
    ) {
      throw err
    }
    // C1 (critical): NEVER log err.message or err.stack here, and NEVER log
    // the raw `err` object itself (pino's default `err` serializer emits
    // .message + the full .stack verbatim — exactly the leak this avoids).
    // validateAndFingerprint's underlying sshpk parse-failure path can throw
    // a message that embeds decoded private-key byte content on malformed-
    // key input — that string is un-pathable by redaction (it lives inside a
    // human-readable interpolated string, not a keyed field), so the only
    // safe rule at this call site is to coarsen unconditionally to
    // err.name/class, never the message. This holds even though the OTHER
    // failure mode reaching this catch (a GCM decrypt failure, message
    // "Unsupported state or unable to authenticate data") is itself
    // secret-free — call sites here can't tell the two failure modes apart
    // without fragile string-matching, so both are logged identically safe.
    // Mirrors console/git-identity.service.ts's discipline of only ever
    // logging { discordUserId, fingerprint }-shaped context around
    // key-handling code, never error content.
    //
    // Never-throw guard: resolveIdentity has a documented never-throw
    // contract (see this function's own header comment). getBackendLogger()
    // called here is just a function call after bootstrap has already run
    // initBackendLogger() (see backend-logger.ts's own invariant) — it
    // cannot itself throw in ordinary operation, so this call cannot escape
    // that boundary; no additional try/catch is added around it.
    getBackendLogger().warn(
      {
        event: LOG_EVENTS.identityDecryptFailed,
        discordUserId: row.discordUserId,
        keyFingerprint: row.keyFingerprint,
        errName:
          err instanceof Error ? err.name : (err as object)?.constructor?.name,
      },
      'Identity decrypt/parse failed',
    )
    return {
      kind: 'decrypt_failed',
      fingerprint: row.keyFingerprint,
    }
  }
}
