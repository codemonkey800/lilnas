import { BadRequestException, Inject, Injectable } from '@nestjs/common'

import { encryptKey } from 'src/crypto/key-cipher'
import { loadMasterKey } from 'src/crypto/master-key'
import { resolveIdentity, isConfigured } from 'src/crypto/identity-resolution'
import { validateAndFingerprint } from 'src/crypto/ssh-key'
import {
  deleteIdentity,
  getIdentity,
  listIdentities,
  upsertIdentity,
} from 'src/db/git-identity.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'

import type {
  GitIdentityItemDto,
  GitIdentityListResponseDto,
  UpsertGitIdentityBodyDto,
  UpsertGitIdentityResponseDto,
} from './git-identity.dto'

@Injectable()
export class GitIdentityService {
  constructor(@Inject(DB) private readonly db: Db) {}

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
  upsertIdentity(body: UpsertGitIdentityBodyDto): UpsertGitIdentityResponseDto {
    const masterKey = loadMasterKey()
    const plaintext = Buffer.from(body.privateKey, 'utf8')

    let fingerprint: string
    try {
      const validated = validateAndFingerprint(plaintext)
      fingerprint = validated.fingerprint
    } catch (err) {
      throw new BadRequestException(
        (err as Error).message ?? 'Invalid SSH private key',
      )
    }

    const encrypted = encryptKey(plaintext, body.discordUserId, masterKey)

    upsertIdentity(this.db, {
      discordUserId: body.discordUserId,
      name: body.name,
      email: body.email,
      keyCiphertext: encrypted.ciphertext,
      keyIv: encrypted.iv,
      keyAuthTag: encrypted.authTag,
      keyFingerprint: fingerprint,
    })

    return {
      discordUserId: body.discordUserId,
      fingerprint,
      status: 'configured',
    }
  }

  deleteIdentity(discordUserId: string): void {
    deleteIdentity(this.db, discordUserId)
  }

  // Health-check for a single identity (used for status badge in list view).
  getStatus(discordUserId: string): 'configured' | 'decrypt_failed' | 'not_configured' {
    const masterKey = loadMasterKey()
    const row = getIdentity(this.db, discordUserId)
    if (!row) return 'not_configured'
    const resolution = resolveIdentity(row, masterKey)
    if (isConfigured(resolution)) {
      resolution.keyPlaintext.fill(0)
      return 'configured'
    }
    return 'decrypt_failed'
  }
}
