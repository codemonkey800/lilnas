import type { AuditLogQuery } from '@lilnas/utils/download/types'
import { BadRequestException, Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { register } from 'prom-client'

import { AuditLogService } from 'src/audit/audit-log.service'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { encodeListCursor } from 'src/db/list-cursor'
import { auditLog } from 'src/db/schema'

const AUDIT_WRITE_FAILURES = 'download_audit_write_failures_total'

type RowInsert = typeof auditLog.$inferInsert

/**
 * The counter is module-level (a process-wide `prom-client` singleton), so it
 * is never reset between tests - every assertion below is a delta taken
 * around the call under test rather than an absolute value.
 */
async function readFailureCount(): Promise<number> {
  const metric = register.getSingleMetric(AUDIT_WRITE_FAILURES)
  if (!metric) {
    throw new Error(`${AUDIT_WRITE_FAILURES} is not registered`)
  }

  const snapshot = await metric.get()
  return snapshot.values[0]?.value ?? 0
}

describe('AuditLogService', () => {
  let dbService: DbService
  let service: AuditLogService

  // Direct insert rather than `record()` for the tests that need control of
  // `created_at` - `record()` deliberately stamps `new Date()` itself, so a
  // date-window test can't be written through it.
  function seedRow(overrides: Partial<RowInsert> = {}): void {
    dbService.db
      .insert(auditLog)
      .values({
        action: 'video.create',
        createdAt: new Date('2026-06-15T12:00:00.000Z'),
        origin: 'service',
        ...overrides,
      })
      .run()
  }

  function listQuery(overrides: Partial<AuditLogQuery> = {}): AuditLogQuery {
    return { limit: 10, ...overrides }
  }

  beforeEach(async () => {
    dbService = createTestDbService()

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogService, { provide: DbService, useValue: dbService }],
    }).compile()

    service = module.get(AuditLogService)
  })

  afterEach(() => {
    // Idempotent in better-sqlite3, which matters because the never-throws
    // test closes the handle itself mid-test.
    dbService.onModuleDestroy()
  })

  describe('record', () => {
    it('writes a web-origin row for a forwarded identity', async () => {
      service.record({
        action: 'video.create',
        actor: { email: 'Ada@lilnas.io', userId: 'user-1' },
        metadata: { url: 'https://example.com/watch' },
        target: { id: 'job-1', type: 'job' },
      })

      const page = await service.listAuditLog(listQuery())

      expect(page.total).toBe(1)
      expect(page.items[0]).toEqual({
        action: 'video.create',
        actor: { email: 'Ada@lilnas.io', userId: 'user-1' },
        createdAt: expect.stringMatching(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        ),
        id: expect.any(Number),
        metadata: { url: 'https://example.com/watch' },
        origin: 'web',
        targetId: 'job-1',
        targetType: 'job',
      })
    })

    // `actor: undefined` is the whole of the origin decision - no call site
    // ever passes `origin` itself.
    it('writes a service-origin row when there is no forwarded identity', async () => {
      service.record({ action: 'ytdlp.check_update', actor: undefined })

      const page = await service.listAuditLog(listQuery())

      expect(page.items[0]).toMatchObject({
        action: 'ytdlp.check_update',
        actor: null,
        metadata: null,
        origin: 'service',
        targetId: null,
        targetType: null,
      })
    })

    it('registers the write-failure counter under its documented name', () => {
      expect(register.getSingleMetric(AUDIT_WRITE_FAILURES)).toBeDefined()
    })

    // The contract: an audit write is the tail of an action the caller
    // already succeeded at, so losing the row must never turn into a thrown
    // error at the call site.
    it('never throws when the write fails - it warns and counts instead', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined)
      const before = await readFailureCount()

      // Closing the underlying handle makes the very next insert throw.
      dbService.onModuleDestroy()

      expect(() =>
        service.record({
          action: 'movie.request',
          actor: { email: 'ada@lilnas.io', userId: 'user-1' },
        }),
      ).not.toThrow()

      expect(await readFailureCount()).toBe(before + 1)
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // Asserted by message rather than `toBeInstanceOf(Error)`: errors
      // raised by better-sqlite3's native addon are constructed outside
      // jest's vm sandbox, so they fail `instanceof` against the sandbox's
      // own `Error` global even though they are genuine `TypeError`s.
      const context = warnSpy.mock.calls[0]?.[0] as {
        action: string
        auditAction: string
        error: { message?: string }
      }
      expect(context.action).toBe('record')
      expect(context.auditAction).toBe('movie.request')
      expect(context.error.message).toMatch(/database connection is not open/)
    })
  })

  describe('listAuditLog', () => {
    it('returns rows newest first with the filtered total', async () => {
      seedRow({ createdAt: new Date('2026-06-15T09:00:00.000Z') })
      seedRow({
        action: 'movie.request',
        createdAt: new Date('2026-06-15T11:00:00.000Z'),
      })
      seedRow({
        action: 'show.request',
        createdAt: new Date('2026-06-15T10:00:00.000Z'),
      })

      const page = await service.listAuditLog(listQuery())

      expect(page.items.map(item => item.action)).toEqual([
        'movie.request',
        'show.request',
        'video.create',
      ])
      expect(page.total).toBe(3)
      expect(page.nextCursor).toBeNull()
    })

    it('narrows by action', async () => {
      seedRow({ action: 'video.create' })
      seedRow({ action: 'release.grab' })

      const page = await service.listAuditLog(
        listQuery({ action: 'release.grab' }),
      )

      expect(page.items.map(item => item.action)).toEqual(['release.grab'])
      expect(page.total).toBe(1)
    })

    // The stored email is whatever casing arrived on `X-Forwarded-User`, so
    // an admin typing the address by hand must still match.
    it('narrows by actor email case-insensitively', async () => {
      seedRow({
        actorEmail: 'Ada@lilnas.io',
        actorUserId: 'user-1',
        origin: 'web',
      })
      seedRow({
        actorEmail: 'grace@lilnas.io',
        actorUserId: 'user-2',
        origin: 'web',
      })

      const page = await service.listAuditLog(
        listQuery({ actor: 'ADA@lilnas.io' }),
      )

      expect(page.items.map(item => item.actor?.email)).toEqual([
        'Ada@lilnas.io',
      ])
    })

    it('windows by the from/to date range', async () => {
      seedRow({
        action: 'video.cancel',
        createdAt: new Date('2026-06-14T23:59:59.999Z'),
      })
      seedRow({
        action: 'video.pause',
        createdAt: new Date('2026-06-15T00:00:00.000Z'),
      })
      seedRow({
        action: 'video.resume',
        createdAt: new Date('2026-06-15T23:59:59.999Z'),
      })
      seedRow({
        action: 'movie.delete',
        createdAt: new Date('2026-06-16T00:00:00.000Z'),
      })

      const page = await service.listAuditLog(
        listQuery({
          from: new Date('2026-06-15T00:00:00.000Z'),
          to: new Date('2026-06-15T23:59:59.999Z'),
        }),
      )

      expect(page.items.map(item => item.action).sort()).toEqual([
        'video.pause',
        'video.resume',
      ])
      expect(page.total).toBe(2)
    })

    // Every row here shares a `created_at` millisecond on purpose - that's
    // the case a bare `created_at <` cursor would silently drop or repeat,
    // and the reason the cursor is a composite `(created_at, id)` key.
    it('pages through a filtered set without dropping or repeating rows', async () => {
      const sameInstant = new Date('2026-06-15T12:00:00.000Z')
      for (let i = 0; i < 5; i++) {
        seedRow({
          createdAt: sameInstant,
          targetId: `job-${i}`,
          targetType: 'job',
        })
      }
      seedRow({ action: 'movie.request', createdAt: sameInstant })

      const seen: Array<string | null> = []
      let cursor: string | undefined
      let pages = 0

      do {
        const page = await service.listAuditLog(
          listQuery({ action: 'video.create', cursor, limit: 2 }),
        )
        expect(page.total).toBe(5)
        seen.push(...page.items.map(item => item.targetId))
        cursor = page.nextCursor ?? undefined
        pages++
      } while (cursor)

      expect(pages).toBe(3)
      expect(seen).toEqual(['job-4', 'job-3', 'job-2', 'job-1', 'job-0'])
    })

    it('rejects a cursor that does not decode', async () => {
      seedRow()

      await expect(
        service.listAuditLog(listQuery({ cursor: 'not-a-real-cursor' })),
      ).rejects.toThrow(BadRequestException)
    })

    // Replaying a cursor under a different filter would silently skip or
    // repeat rows, so the embedded filter key has to reject it.
    it('rejects a cursor minted under a different filter', async () => {
      seedRow()
      seedRow()

      const first = await service.listAuditLog(listQuery({ limit: 1 }))
      expect(first.nextCursor).not.toBeNull()

      await expect(
        service.listAuditLog(
          listQuery({
            action: 'video.create',
            cursor: first.nextCursor ?? '',
            limit: 1,
          }),
        ),
      ).rejects.toThrow(BadRequestException)
    })

    // The other half: a cursor that decodes cleanly but carries an id the
    // audit table's integer PK can't be compared against. The repo throws a
    // plain `Error` for this (it is framework-free); the service is what has
    // to turn it into a 400 rather than a 500 - or, worse, a boundary-free
    // scan that hands the cursor row back a second time.
    it('rejects a decodable cursor whose id is not a positive integer', async () => {
      seedRow()
      seedRow()

      const first = await service.listAuditLog(listQuery({ limit: 1 }))
      const raw = Buffer.from(first.nextCursor ?? '', 'base64url').toString(
        'utf8',
      )
      const filterKey = raw.slice(raw.lastIndexOf(':') + 1)

      const tampered = encodeListCursor({
        filterKey,
        id: 'not-a-number',
        sortKeyMs: Date.now(),
      })

      await expect(
        service.listAuditLog(listQuery({ cursor: tampered, limit: 1 })),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
