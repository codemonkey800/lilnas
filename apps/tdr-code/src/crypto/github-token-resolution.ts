import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

import { decryptKey, type EncryptedKey } from './key-cipher'

// Non-DI (plain exported function, called from both bot-plane and main-plane
// contexts — see identity-resolution.ts's own dual-plane note, which this
// module mirrors exactly). getBackendLogger() is fetched AT LOG TIME inside
// resolveGithubToken's catch block, never at module-eval time.

// Row type imported as a structural type only — avoids importing from
// src/db/schema (this module must stay importable from both planes without
// pulling in a DB dependency) or src/agent (bot-plane-only). Both planes
// import this module downward, mirroring identity-resolution.ts's
// GitIdentityRowLike.
export interface GithubCredentialRowLike {
  userId: string
  githubLogin: string
  derivedName: string
  derivedEmail: string
  tokenCiphertext: Buffer
  tokenIv: Buffer
  tokenAuthTag: Buffer
}

// ──────────────────────────────────────────────────────────────────────────────
// Three-state discriminated union for a resolved GitHub token, mirroring
// identity-resolution.ts's IdentityResolution exactly (configured /
// unconfigured / decrypt_failed).
// ──────────────────────────────────────────────────────────────────────────────

export interface ConfiguredGithubToken {
  kind: 'configured'
  tokenPlaintext: Buffer
  derivedName: string
  derivedEmail: string
  githubLogin: string
}

export interface UnconfiguredGithubToken {
  kind: 'unconfigured'
}

export interface GithubDecryptFailedToken {
  kind: 'decrypt_failed'
}

export type GithubTokenResolution =
  | ConfiguredGithubToken
  | UnconfiguredGithubToken
  | GithubDecryptFailedToken

export function isGithubConfigured(
  r: GithubTokenResolution,
): r is ConfiguredGithubToken {
  return r.kind === 'configured'
}

export function isGithubUnconfigured(
  r: GithubTokenResolution,
): r is UnconfiguredGithubToken {
  return r.kind === 'unconfigured'
}

export function isGithubDecryptFailed(
  r: GithubTokenResolution,
): r is GithubDecryptFailedToken {
  return r.kind === 'decrypt_failed'
}

// ──────────────────────────────────────────────────────────────────────────────

// Resolve a stored github_credential row (or undefined) to the three-state
// union.
// - No row -> unconfigured
// - Row + successful decrypt -> configured
// - Row + failed decrypt -> decrypt_failed
//
// AAD is `${userId}:github` — provider-scoped (unlike git_identity's plain
// discordUserId AAD) since, unlike git_identity, a `user` row could in
// principle grow more than one non-Discord provider row in the future; this
// must match whatever the account-hook unit (U2) uses to encrypt the token
// via encryptKey.
//
// Must NOT throw — all errors are mapped to decrypt_failed, EXCEPT a
// wrong-length master key (ERR_MASTER_KEY_LENGTH), which is a deployment
// misconfiguration that must surface loudly rather than silently becoming
// decrypt_failed for every row — mirrors identity-resolution.ts's
// resolveIdentity exactly. Callers are in framework-free context and must
// not propagate decryption exceptions.
export function resolveGithubToken(
  row: GithubCredentialRowLike | undefined,
  masterKey: Buffer,
): GithubTokenResolution {
  if (!row) {
    return { kind: 'unconfigured' }
  }

  const encrypted: EncryptedKey = {
    iv: row.tokenIv,
    authTag: row.tokenAuthTag,
    ciphertext: row.tokenCiphertext,
  }

  try {
    const tokenPlaintext = decryptKey(
      encrypted,
      `${row.userId}:github`,
      masterKey,
    )

    return {
      kind: 'configured',
      tokenPlaintext,
      derivedName: row.derivedName,
      derivedEmail: row.derivedEmail,
      githubLogin: row.githubLogin,
    }
  } catch (err) {
    // A wrong-length master key is a deployment misconfiguration, not a
    // per-row failure — rethrow so callers see a loud error instead of
    // silent decrypt_failed for every row (which would mask the real
    // cause). Mirrors identity-resolution.ts's identical rethrow.
    if (
      err instanceof RangeError &&
      (err as NodeJS.ErrnoException).code === 'ERR_MASTER_KEY_LENGTH'
    ) {
      throw err
    }
    // C1 (critical, per the structured-logging convention): NEVER log
    // err.message or err.stack here, and NEVER log the raw `err` object
    // itself (pino's default `err` serializer emits .message + the full
    // .stack verbatim). A GCM decrypt failure here is itself secret-free
    // (its message is a fixed string, "Unsupported state or unable to
    // authenticate data"), but this call site can't distinguish that from
    // any other future failure mode reaching this catch without fragile
    // string-matching, so the same coarsening discipline
    // identity-resolution.ts applies to its own (more dangerous) sshpk
    // parse-failure path is applied here unconditionally too — coarsen to
    // err.name/class, never the message.
    //
    // Never-throw guard: resolveGithubToken has a documented never-throw
    // contract (see this function's own header comment). getBackendLogger()
    // called here is just a function call after bootstrap has already run
    // initBackendLogger() — it cannot itself throw in ordinary operation,
    // so this call cannot escape that boundary; no additional try/catch is
    // added around it.
    getBackendLogger().warn(
      {
        event: LOG_EVENTS.githubTokenDecryptFailed,
        userId: row.userId,
        githubLogin: row.githubLogin,
        errName:
          err instanceof Error ? err.name : (err as object)?.constructor?.name,
      },
      'GitHub token decrypt/parse failed',
    )
    return { kind: 'decrypt_failed' }
  }
}
