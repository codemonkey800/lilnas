import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { isConfigured, resolveIdentity } from 'src/crypto/identity-resolution'
import { encryptKey } from 'src/crypto/key-cipher'
import { loadMasterKey } from 'src/crypto/master-key'
import { normalizeKeyBlob, validateAndFingerprint } from 'src/crypto/ssh-key'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import {
  deleteIdentity,
  listIdentities,
  upsertIdentity,
} from 'src/db/git-identity.repo'
import { LOG_EVENTS } from 'src/logging/log-events'

import type {
  GitIdentityItemDto,
  GitIdentityListResponseDto,
  UpsertGitIdentityBodyDto,
  UpsertGitIdentityResponseDto,
} from './git-identity.dto'

@Injectable()
export class GitIdentityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  // List all configured identities with their status. Never returns key material.
  // NOTE: a full resolveIdentity decrypts each private key transiently in the
  // heap (heap exposure). We fill(0) keyPlaintext immediately after fingerprint
  // extraction and never log or return it.
  listIdentities(): GitIdentityListResponseDto {
    const masterKey = loadMasterKey()
    const rows = listIdentities(this.db)

    return rows.map(row => {
      const resolution = resolveIdentity(row, masterKey)
      if (isConfigured(resolution)) {
        // Best-effort zeroize the plaintext buffer.
        resolution.keyPlaintext.fill(0)
        return {
          discordUserId: row.discordUserId,
          name: row.name,
          email: row.email,
          fingerprint: resolution.fingerprint,
          status: 'configured' as const,
        } satisfies GitIdentityItemDto
      }
      return {
        discordUserId: row.discordUserId,
        name: row.name,
        email: row.email,
        fingerprint: row.keyFingerprint,
        status: 'decrypt_failed' as const,
      } satisfies GitIdentityItemDto
    })
  }

  // Upsert a git identity. Validates, encrypts, stores. Never returns the key.
  // U5: discordUserId is now resolved by the CONTROLLER from the acting
  // user's own session (self-service only — R2) and passed explicitly,
  // rather than read off `body` — UpsertGitIdentityBodyDto no longer even
  // has a discordUserId field (see git-identity.dto.ts).
  upsertIdentity(
    discordUserId: string,
    body: UpsertGitIdentityBodyDto,
  ): UpsertGitIdentityResponseDto {
    const masterKey = loadMasterKey()
    // Normalize BEFORE validating/encrypting — sshpk (validateAndFingerprint)
    // tolerates CRLF, a leading blank line, and a missing trailing newline;
    // ssh-keygen (the actual commit signer, invoked later via the git PATH
    // wrapper's gpg.ssh.program) does not. Without this, a key that passes
    // validation here can still fail to sign every commit at turn time.
    const plaintext = normalizeKeyBlob(body.privateKey)

    let fingerprint: string
    try {
      const validated = validateAndFingerprint(plaintext)
      fingerprint = validated.fingerprint
    } catch {
      // Never forward the underlying error message: sshpk's parse-error text
      // can embed decoded private-key bytes (see identity-resolution.ts C1).
      throw new BadRequestException('Invalid SSH private key')
    }
    this.logger.info(
      {
        discordUserId,
        fingerprint,
        event: LOG_EVENTS.gitIdentityKeyValidated,
      },
      'Git identity upsert: key validated',
    )

    const encrypted = encryptKey(plaintext, discordUserId, masterKey)

    upsertIdentity(this.db, {
      discordUserId,
      name: body.name,
      email: body.email,
      keyCiphertext: encrypted.ciphertext,
      keyIv: encrypted.iv,
      keyAuthTag: encrypted.authTag,
      keyFingerprint: fingerprint,
    })
    this.logger.info(
      {
        discordUserId,
        fingerprint,
        event: LOG_EVENTS.gitIdentityUpserted,
      },
      'Git identity upserted',
    )

    return {
      discordUserId,
      fingerprint,
      status: 'configured',
    }
  }

  deleteIdentity(discordUserId: string): void {
    deleteIdentity(this.db, discordUserId)
    this.logger.warn(
      { discordUserId, event: LOG_EVENTS.gitIdentityDeleted },
      'Git identity deleted',
    )
  }
}
