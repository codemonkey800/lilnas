import crypto from 'node:crypto'
import { BadRequestException, ForbiddenException } from '@nestjs/common'

import { GitIdentityController } from 'src/console/git-identity.controller'
import { GitIdentityService } from 'src/console/git-identity.service'
import type {
  UpsertGitIdentityResponseDto,
  GitIdentityListResponseDto,
} from 'src/console/git-identity.dto'

const ALLOWED =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

// Real unencrypted ed25519 key for validation tests.
const TEST_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQAAALBYegssWHoL
LAAAAAtzc2gtZWQyNTUxOQAAACBD1tRYNkdezZxwDDKdYUv6wpWLvP2coPLbPPVcqWLFqQ
AAAEDjjCG4LkwqWl6PemDgYqlKSELyGT7LjUg8fWwH94X/yUPW1Fg2R17NnHAMMp1hS/rC
lYu8/Zyg8ts89VypYsWpAAAAKWplcmVteWFzdW5jaW9ubmV0ZmxpeC5jb21AamVyZW15LW
5mbHgtbWFjAQIDBA==
-----END OPENSSH PRIVATE KEY-----`

const VALID_SNOWFLAKE = '123456789012345678'

const MOCK_UPSERT_RESPONSE: UpsertGitIdentityResponseDto = {
  discordUserId: VALID_SNOWFLAKE,
  fingerprint: 'SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY',
  status: 'configured',
}

const MOCK_LIST_RESPONSE: GitIdentityListResponseDto = [
  {
    discordUserId: VALID_SNOWFLAKE,
    name: 'Test User',
    email: 'test@example.com',
    fingerprint: 'SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY',
    status: 'configured',
  },
]

function makeService(): jest.Mocked<GitIdentityService> {
  return {
    listIdentities: jest.fn().mockReturnValue(MOCK_LIST_RESPONSE),
    upsertIdentity: jest.fn().mockReturnValue(MOCK_UPSERT_RESPONSE),
    deleteIdentity: jest.fn(),
    getStatus: jest.fn().mockReturnValue('configured'),
  } as unknown as jest.Mocked<GitIdentityService>
}

describe('GitIdentityController', () => {
  describe('GET /git-identity', () => {
    it('returns list without private keys', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      const result = ctrl.listIdentities()
      expect(result).toEqual(MOCK_LIST_RESPONSE)
      // Ensure no private key field in the response
      for (const item of result) {
        expect(item).not.toHaveProperty('privateKey')
        expect(item).not.toHaveProperty('keyCiphertext')
      }
    })
  })

  describe('POST /git-identity (upsert)', () => {
    it('valid body returns fingerprint and status — no private key in response', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      const result = ctrl.upsertIdentity(ALLOWED, {
        discordUserId: VALID_SNOWFLAKE,
        name: 'Test User',
        email: 'test@example.com',
        privateKey: TEST_KEY,
      })
      expect(result.fingerprint).toContain('SHA256:')
      expect(result).not.toHaveProperty('privateKey')
      expect(svc.upsertIdentity).toHaveBeenCalled()
    })

    it('cross-origin → ForbiddenException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      expect(() =>
        ctrl.upsertIdentity('https://evil.example.com', {
          discordUserId: VALID_SNOWFLAKE,
          name: 'x',
          email: 'x@x.com',
          privateKey: TEST_KEY,
        }),
      ).toThrow(ForbiddenException)
      expect(svc.upsertIdentity).not.toHaveBeenCalled()
    })

    it('invalid snowflake → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      expect(() =>
        ctrl.upsertIdentity(ALLOWED, {
          discordUserId: 'not-a-snowflake',
          name: 'x',
          email: 'x@x.com',
          privateKey: TEST_KEY,
        }),
      ).toThrow(BadRequestException)
      expect(svc.upsertIdentity).not.toHaveBeenCalled()
    })

    it('invalid email → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      expect(() =>
        ctrl.upsertIdentity(ALLOWED, {
          discordUserId: VALID_SNOWFLAKE,
          name: 'Test',
          email: 'not-an-email',
          privateKey: TEST_KEY,
        }),
      ).toThrow(BadRequestException)
    })

    it('empty privateKey → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      expect(() =>
        ctrl.upsertIdentity(ALLOWED, {
          discordUserId: VALID_SNOWFLAKE,
          name: 'Test',
          email: 'test@x.com',
          privateKey: '',
        }),
      ).toThrow(BadRequestException)
    })
  })

  describe('DELETE /git-identity/:discordUserId (clear)', () => {
    it('valid snowflake calls deleteIdentity', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      ctrl.deleteIdentity(ALLOWED, VALID_SNOWFLAKE)
      expect(svc.deleteIdentity).toHaveBeenCalledWith(VALID_SNOWFLAKE)
    })

    it('cross-origin → ForbiddenException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      expect(() => ctrl.deleteIdentity('https://evil.com', VALID_SNOWFLAKE)).toThrow(
        ForbiddenException,
      )
      expect(svc.deleteIdentity).not.toHaveBeenCalled()
    })

    it('invalid snowflake param → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc)
      expect(() => ctrl.deleteIdentity(ALLOWED, 'bad')).toThrow(
        BadRequestException,
      )
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// GitIdentityService — write-only + key rejection
// ──────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GitIdentityService as SvcClass } from 'src/console/git-identity.service'
import type { Db } from 'src/db/database.module'
import { loadMasterKey } from 'src/crypto/master-key'

// Mock loadMasterKey to avoid needing a real key file in tests
jest.mock('src/crypto/master-key', () => ({
  loadMasterKey: jest.fn().mockReturnValue(crypto.randomBytes(32)),
}))

function makeDbMock() {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(), set: jest.fn(), where: jest.fn(), returning: jest.fn(),
    orderBy: jest.fn(), limit: jest.fn(), onConflictDoUpdate: jest.fn(), from: jest.fn(),
    get: jest.fn().mockReturnValue(undefined),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ changes: 1 }),
  }
  for (const k of ['values', 'set', 'where', 'returning', 'orderBy', 'limit', 'onConflictDoUpdate', 'from', 'onConflictDoUpdate']) {
    chain[k]!.mockReturnValue(chain)
  }
  return {
    insert: jest.fn().mockReturnValue(chain),
    update: jest.fn().mockReturnValue(chain),
    select: jest.fn().mockReturnValue(chain),
    delete: jest.fn().mockReturnValue(chain),
    _chain: chain,
  }
}

describe('GitIdentityService', () => {
  it('upsertIdentity with valid key succeeds and never returns the key', () => {
    const db = makeDbMock()
    // Mock the insert + returning chain to return a fake row
    db._chain.get.mockReturnValue({
      discordUserId: VALID_SNOWFLAKE,
      name: 'Test',
      email: 'test@x.com',
      keyCiphertext: Buffer.alloc(16),
      keyIv: Buffer.alloc(12),
      keyAuthTag: Buffer.alloc(16),
      keyFingerprint: 'SHA256:bwCR+3Vl8Ma8ShBUT6zIrk+RAN+kUa+SgbeLJJcNKcY',
      keyVersion: 1,
      masterKeyVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const svc = new SvcClass(db as unknown as Db)
    const result = svc.upsertIdentity({
      discordUserId: VALID_SNOWFLAKE,
      name: 'Test',
      email: 'test@x.com',
      privateKey: TEST_KEY,
    })

    expect(result).not.toHaveProperty('privateKey')
    expect(result.fingerprint).toContain('SHA256:')
    expect(result.status).toBe('configured')
  })

  it('upsertIdentity with passphrase-protected key → BadRequestException, nothing stored', () => {
    const db = makeDbMock()
    const svc = new SvcClass(db as unknown as Db)

    const ENCRYPTED_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAGYmNyeXB0AAAAGAAAABBjxcz3h3LxPJ+7v3JWvVz4AAAAE
AAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAINxF1B3C5iyTZjAiJXenqRBJOjXaBfx1lD5u
Rb9dUOLCAAAAoH2+z8Q1oXFqaIf3rGcJkzHMvQ==
-----END OPENSSH PRIVATE KEY-----`

    expect(() =>
      svc.upsertIdentity({
        discordUserId: VALID_SNOWFLAKE,
        name: 'Test',
        email: 'test@x.com',
        privateKey: ENCRYPTED_KEY,
      }),
    ).toThrow(BadRequestException)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('upsertIdentity with garbage key → BadRequestException, nothing stored', () => {
    const db = makeDbMock()
    const svc = new SvcClass(db as unknown as Db)

    expect(() =>
      svc.upsertIdentity({
        discordUserId: VALID_SNOWFLAKE,
        name: 'Test',
        email: 'test@x.com',
        privateKey: 'A'.repeat(200),
      }),
    ).toThrow(BadRequestException)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('listIdentities reports decrypt_failed for a row that cannot be decrypted', () => {
    const db = makeDbMock()
    const OTHER_MASTER_KEY = crypto.randomBytes(32)
    // loadMasterKey now returns a different key than what encrypted the row
    ;(loadMasterKey as jest.Mock).mockReturnValueOnce(OTHER_MASTER_KEY)

    db._chain.all.mockReturnValue([
      {
        discordUserId: VALID_SNOWFLAKE,
        name: 'Test',
        email: 'test@x.com',
        keyCiphertext: Buffer.alloc(32, 0xAB),
        keyIv: Buffer.alloc(12),
        keyAuthTag: Buffer.alloc(16),
        keyFingerprint: 'SHA256:stored-fingerprint',
        keyVersion: 1,
        masterKeyVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const svc = new SvcClass(db as unknown as Db)
    const result = svc.listIdentities()

    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('decrypt_failed')
    expect(result[0]).not.toHaveProperty('privateKey')
  })
})
