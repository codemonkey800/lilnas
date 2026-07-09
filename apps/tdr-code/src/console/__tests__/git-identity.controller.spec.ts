import crypto from 'node:crypto'

import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { GitIdentityController } from 'src/console/git-identity.controller'
import type {
  GitIdentityListResponseDto,
  UpsertGitIdentityResponseDto,
} from 'src/console/git-identity.dto'
import {
  GitIdentityService,
  GitIdentityService as SvcClass,
} from 'src/console/git-identity.service'
import type { Db } from 'src/db/database.module'
import { getDiscordUserIdForUser } from 'src/db/github-credential.repo'

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
const BETTER_AUTH_USER_ID = 'better-auth-user-id-abc123'

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
  } as unknown as jest.Mocked<GitIdentityService>
}

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

// The controller now resolves discordUserId via
// getDiscordUserIdForUser(db, userId) rather than reading it off the
// request body (U5, R2) — mocked at the module level (mirrors this file's
// pre-existing jest.mock('src/crypto/master-key', ...) pattern below for
// GitIdentityService's own tests) since this is a real DB-reading function,
// not an injected service the controller could otherwise take a fake for.
// `db` itself is never dereferenced by these tests — an empty object is a
// valid stand-in wherever the controller only forwards it opaquely into the
// (mocked) getDiscordUserIdForUser call.
jest.mock('src/db/github-credential.repo', () => ({
  getDiscordUserIdForUser: jest.fn(),
}))
const mockGetDiscordUserIdForUser = getDiscordUserIdForUser as jest.Mock
const FAKE_DB = {} as Db

// Minimal fake Express Request carrying only the `.user.id` field the
// controller actually reads (req.user?.id) — no other controller spec in
// this codebase yet constructs a request object at all (the pre-U5
// signature took no @Req()), so this is new ground; kept intentionally
// small rather than importing/mirroring auth.guard.spec.ts's much larger
// FakeRequest (that file's shape also carries session/originalUrl fields
// this controller never reads).
function makeRequest(userId: string | undefined): Request {
  return { user: userId ? { id: userId } : undefined } as unknown as Request
}

describe('GitIdentityController', () => {
  beforeEach(() => {
    mockGetDiscordUserIdForUser.mockReset()
  })

  describe('GET /git-identity', () => {
    it('returns list without private keys', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      const result = ctrl.listIdentities()
      expect(result).toEqual(MOCK_LIST_RESPONSE)
      // Ensure no private key field in the response
      for (const item of result) {
        expect(item).not.toHaveProperty('privateKey')
        expect(item).not.toHaveProperty('keyCiphertext')
      }
    })
  })

  // U5 (R2): the "pick a user" dropdown's backing route is removed entirely,
  // not merely hidden client-side — GitIdentityController no longer has a
  // listDiscordMembers handler at all, so there is nothing left to unit-test
  // here beyond confirming the method doesn't exist on the class.
  it('no longer exposes a discord-members listing method (GET /git-identity/discord-members is removed)', () => {
    const ctrl = new GitIdentityController(makeService(), FAKE_DB)
    expect(
      (ctrl as unknown as Record<string, unknown>)['listDiscordMembers'],
    ).toBeUndefined()
  })

  describe('POST /git-identity (upsert, self-service only)', () => {
    it('valid body with no discordUserId resolves it from the session and returns fingerprint/status — no private key in response', () => {
      mockGetDiscordUserIdForUser.mockReturnValue(VALID_SNOWFLAKE)
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)

      const result = ctrl.upsertIdentity(
        ALLOWED,
        makeRequest(BETTER_AUTH_USER_ID),
        { name: 'Test User', email: 'test@example.com', privateKey: TEST_KEY },
      )

      expect(mockGetDiscordUserIdForUser).toHaveBeenCalledWith(
        FAKE_DB,
        BETTER_AUTH_USER_ID,
      )
      expect(result.fingerprint).toContain('SHA256:')
      expect(result).not.toHaveProperty('privateKey')
      expect(svc.upsertIdentity).toHaveBeenCalledWith(VALID_SNOWFLAKE, {
        name: 'Test User',
        email: 'test@example.com',
        privateKey: TEST_KEY,
      })
    })

    it('cross-origin → ForbiddenException, discordUserId never resolved', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.upsertIdentity(
          'https://evil.example.com',
          makeRequest(BETTER_AUTH_USER_ID),
          { name: 'x', email: 'x@x.com', privateKey: TEST_KEY },
        ),
      ).toThrow(ForbiddenException)
      expect(mockGetDiscordUserIdForUser).not.toHaveBeenCalled()
      expect(svc.upsertIdentity).not.toHaveBeenCalled()
    })

    it('no req.user (unauthenticated) → UnauthorizedException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.upsertIdentity(ALLOWED, makeRequest(undefined), {
          name: 'x',
          email: 'x@x.com',
          privateKey: TEST_KEY,
        }),
      ).toThrow(UnauthorizedException)
      expect(mockGetDiscordUserIdForUser).not.toHaveBeenCalled()
      expect(svc.upsertIdentity).not.toHaveBeenCalled()
    })

    it('session user has no linked Discord account → UnauthorizedException, nothing stored', () => {
      mockGetDiscordUserIdForUser.mockReturnValue(undefined)
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.upsertIdentity(ALLOWED, makeRequest(BETTER_AUTH_USER_ID), {
          name: 'x',
          email: 'x@x.com',
          privateKey: TEST_KEY,
        }),
      ).toThrow(UnauthorizedException)
      expect(svc.upsertIdentity).not.toHaveBeenCalled()
    })

    it('invalid email → BadRequestException', () => {
      mockGetDiscordUserIdForUser.mockReturnValue(VALID_SNOWFLAKE)
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.upsertIdentity(ALLOWED, makeRequest(BETTER_AUTH_USER_ID), {
          name: 'Test',
          email: 'not-an-email',
          privateKey: TEST_KEY,
        }),
      ).toThrow(BadRequestException)
      expect(svc.upsertIdentity).not.toHaveBeenCalled()
    })

    it('empty privateKey → BadRequestException', () => {
      mockGetDiscordUserIdForUser.mockReturnValue(VALID_SNOWFLAKE)
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.upsertIdentity(ALLOWED, makeRequest(BETTER_AUTH_USER_ID), {
          name: 'Test',
          email: 'test@x.com',
          privateKey: '',
        }),
      ).toThrow(BadRequestException)
      expect(svc.upsertIdentity).not.toHaveBeenCalled()
    })

    // R2's own closed gap: a client-supplied discordUserId in the body must
    // be silently ignored (the schema no longer has the field at all — Zod
    // strips unknown keys by default), never used to override the
    // session-resolved id, even on a "break-glass" basis. There is no
    // upsert-on-behalf-of-another-user path in this design at all.
    it('a discordUserId smuggled into the body is ignored — the session-resolved id always wins', () => {
      mockGetDiscordUserIdForUser.mockReturnValue(VALID_SNOWFLAKE)
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)

      ctrl.upsertIdentity(ALLOWED, makeRequest(BETTER_AUTH_USER_ID), {
        discordUserId: '999999999999999999',
        name: 'Test',
        email: 'test@x.com',
        privateKey: TEST_KEY,
      } as unknown as Record<string, unknown>)

      expect(svc.upsertIdentity).toHaveBeenCalledWith(
        VALID_SNOWFLAKE,
        expect.not.objectContaining({ discordUserId: expect.anything() }),
      )
    })
  })

  describe('DELETE /git-identity (self-clear, no id)', () => {
    it('resolves discordUserId from the session and clears that identity', () => {
      mockGetDiscordUserIdForUser.mockReturnValue(VALID_SNOWFLAKE)
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)

      const result = ctrl.deleteOwnIdentity(
        ALLOWED,
        makeRequest(BETTER_AUTH_USER_ID),
      )

      expect(mockGetDiscordUserIdForUser).toHaveBeenCalledWith(
        FAKE_DB,
        BETTER_AUTH_USER_ID,
      )
      expect(svc.deleteIdentity).toHaveBeenCalledWith(VALID_SNOWFLAKE)
      expect(result).toEqual({ accepted: true })
    })

    it('cross-origin → ForbiddenException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.deleteOwnIdentity(
          'https://evil.com',
          makeRequest(BETTER_AUTH_USER_ID),
        ),
      ).toThrow(ForbiddenException)
      expect(svc.deleteIdentity).not.toHaveBeenCalled()
    })

    it('no req.user (unauthenticated) → UnauthorizedException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.deleteOwnIdentity(ALLOWED, makeRequest(undefined)),
      ).toThrow(UnauthorizedException)
      expect(svc.deleteIdentity).not.toHaveBeenCalled()
    })

    it('session user has no linked Discord account → UnauthorizedException', () => {
      mockGetDiscordUserIdForUser.mockReturnValue(undefined)
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.deleteOwnIdentity(ALLOWED, makeRequest(BETTER_AUTH_USER_ID)),
      ).toThrow(UnauthorizedException)
      expect(svc.deleteIdentity).not.toHaveBeenCalled()
    })
  })

  describe('DELETE /git-identity/:discordUserId (break-glass clear, unchanged)', () => {
    it('valid snowflake calls deleteIdentity — never resolves via the session', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      ctrl.deleteIdentity(ALLOWED, VALID_SNOWFLAKE)
      expect(svc.deleteIdentity).toHaveBeenCalledWith(VALID_SNOWFLAKE)
      expect(mockGetDiscordUserIdForUser).not.toHaveBeenCalled()
    })

    it('cross-origin → ForbiddenException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() =>
        ctrl.deleteIdentity('https://evil.com', VALID_SNOWFLAKE),
      ).toThrow(ForbiddenException)
      expect(svc.deleteIdentity).not.toHaveBeenCalled()
    })

    it('invalid snowflake param → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new GitIdentityController(svc, FAKE_DB)
      expect(() => ctrl.deleteIdentity(ALLOWED, 'bad')).toThrow(
        BadRequestException,
      )
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// GitIdentityService — write-only + key rejection
// ──────────────────────────────────────────────────────────────────────────────

import { loadMasterKey } from 'src/crypto/master-key'

// Mock loadMasterKey to avoid needing a real key file in tests
jest.mock('src/crypto/master-key', () => ({
  loadMasterKey: jest.fn().mockReturnValue(crypto.randomBytes(32)),
}))

function makeDbMock() {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    from: jest.fn(),
    get: jest.fn().mockReturnValue(undefined),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ changes: 1 }),
  }
  for (const k of [
    'values',
    'set',
    'where',
    'returning',
    'orderBy',
    'limit',
    'onConflictDoUpdate',
    'from',
    'onConflictDoUpdate',
  ]) {
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

    const svc = new SvcClass(db as unknown as Db, makeLogger())
    const result = svc.upsertIdentity(VALID_SNOWFLAKE, {
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
    const svc = new SvcClass(db as unknown as Db, makeLogger())

    const ENCRYPTED_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAGYmNyeXB0AAAAGAAAABBjxcz3h3LxPJ+7v3JWvVz4AAAAE
AAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAINxF1B3C5iyTZjAiJXenqRBJOjXaBfx1lD5u
Rb9dUOLCAAAAoH2+z8Q1oXFqaIf3rGcJkzHMvQ==
-----END OPENSSH PRIVATE KEY-----`

    expect(() =>
      svc.upsertIdentity(VALID_SNOWFLAKE, {
        name: 'Test',
        email: 'test@x.com',
        privateKey: ENCRYPTED_KEY,
      }),
    ).toThrow(BadRequestException)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('upsertIdentity with garbage key → BadRequestException, nothing stored', () => {
    const db = makeDbMock()
    const svc = new SvcClass(db as unknown as Db, makeLogger())

    expect(() =>
      svc.upsertIdentity(VALID_SNOWFLAKE, {
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
        keyCiphertext: Buffer.alloc(32, 0xab),
        keyIv: Buffer.alloc(12),
        keyAuthTag: Buffer.alloc(16),
        keyFingerprint: 'SHA256:stored-fingerprint',
        keyVersion: 1,
        masterKeyVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const svc = new SvcClass(db as unknown as Db, makeLogger())
    const result = svc.listIdentities()

    expect(result).toHaveLength(1)
    expect(result[0]!.status).toBe('decrypt_failed')
    expect(result[0]).not.toHaveProperty('privateKey')
  })
})
