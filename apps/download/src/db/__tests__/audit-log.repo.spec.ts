import type { AuditAction } from '@lilnas/utils/download/types'

import { insertAuditLog, listAuditLogPage } from 'src/db/audit-log.repo'
import type { Db } from 'src/db/db.service'
import type { ListCursor } from 'src/db/list-cursor'
import { auditLog } from 'src/db/schema'

import { createTestDb } from './test-utils'

const FILTER_KEY = 'test-filter-key'
const T0 = new Date('2026-01-01T00:00:00.000Z').getTime()

interface SeedInput {
  action?: AuditAction
  /** `null` seeds a service-origin row; omitted defaults to alice. */
  actorEmail?: string | null
  createdAtMs: number
}

/**
 * Seeds directly through drizzle rather than through `insertAuditLog()` -
 * the repo stamps `createdAt` itself, and every ordering/window assertion
 * below needs a `created_at` it controls to the millisecond.
 */
function seedAuditLog(db: Db, input: SeedInput): void {
  const actorEmail =
    input.actorEmail === undefined ? 'alice@example.com' : input.actorEmail

  db.insert(auditLog)
    .values({
      action: input.action ?? 'video.create',
      actorEmail,
      actorUserId: actorEmail === null ? null : 'user_1',
      createdAt: new Date(input.createdAtMs),
      origin: actorEmail === null ? 'service' : 'web',
    })
    .run()
}

function cursorFrom(row: { createdAt: Date; id: number }): ListCursor {
  return {
    sortKeyMs: row.createdAt.getTime(),
    filterKey: FILTER_KEY,
    id: String(row.id),
  }
}

describe('insertAuditLog', () => {
  it('records a web-origin row with the actor, target and metadata it was given', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAuditLog(db, {
        action: 'movie.request',
        actor: { email: 'alice@example.com', userId: 'user_1' },
        metadata: { quality: '1080p', title: 'Inception' },
        target: { id: 'tmdb:27205', type: 'media' },
      })

      expect(row).toMatchObject({
        action: 'movie.request',
        actorEmail: 'alice@example.com',
        actorUserId: 'user_1',
        // Derived from `actor`, never passed by the caller.
        origin: 'web',
        targetId: 'tmdb:27205',
        targetType: 'media',
      })
      expect(row.metadata).toEqual({ quality: '1080p', title: 'Inception' })
      expect(row.createdAt).toBeInstanceOf(Date)
      expect(typeof row.id).toBe('number')
    } finally {
      close()
    }
  })

  it('records a service-origin row with both actor columns null', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAuditLog(db, {
        action: 'ytdlp.check_update',
        actor: null,
      })

      expect(row).toMatchObject({
        action: 'ytdlp.check_update',
        actorEmail: null,
        actorUserId: null,
        origin: 'service',
      })
    } finally {
      close()
    }
  })

  it('leaves the target pair and metadata null when they are omitted', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAuditLog(db, {
        action: 'ytdlp.check_update',
        actor: null,
      })

      expect(row).toMatchObject({
        metadata: null,
        targetId: null,
        targetType: null,
      })
    } finally {
      close()
    }
  })

  it('round-trips a nested metadata object through the json column', () => {
    const { db, close } = createTestDb()
    try {
      const metadata = {
        counts: [1, 2, 3],
        previous: { status: 'downloading' },
        reason: null,
      }

      const row = insertAuditLog(db, {
        action: 'video.cancel',
        actor: { email: 'alice@example.com', userId: 'user_1' },
        metadata,
        target: { id: 'job-1', type: 'job' },
      })

      expect(row.metadata).toEqual(metadata)
    } finally {
      close()
    }
  })

  it('reads inserted web and service rows back through the list query', () => {
    const { db, close } = createTestDb()
    try {
      insertAuditLog(db, {
        action: 'movie.request',
        actor: { email: 'alice@example.com', userId: 'user_1' },
      })
      insertAuditLog(db, { action: 'ytdlp.check_update', actor: null })

      const page = listAuditLogPage(db, { filter: {}, limit: 10 })

      expect(page.total).toBe(2)
      expect(page.rows.map(r => r.origin).sort()).toEqual(['service', 'web'])
    } finally {
      close()
    }
  })
})

describe('listAuditLogPage', () => {
  it('returns rows newest-first with hasMore and the full filtered total', () => {
    const { db, close } = createTestDb()
    try {
      for (let i = 0; i < 5; i++) {
        seedAuditLog(db, { createdAtMs: T0 + i * 1000 })
      }

      const page = listAuditLogPage(db, { filter: {}, limit: 3 })

      expect(page.rows.map(r => r.createdAt.getTime())).toEqual([
        T0 + 4000,
        T0 + 3000,
        T0 + 2000,
      ])
      expect(page.hasMore).toBe(true)
      expect(page.total).toBe(5)
    } finally {
      close()
    }
  })

  it('returns an empty page with a zero total for an empty log', () => {
    const { db, close } = createTestDb()
    try {
      const page = listAuditLogPage(db, { filter: {}, limit: 10 })

      expect(page).toEqual({ hasMore: false, rows: [], total: 0 })
    } finally {
      close()
    }
  })

  it('walks three pages with no gaps and no duplicates', () => {
    const { db, close } = createTestDb()
    try {
      for (let i = 0; i < 7; i++) {
        seedAuditLog(db, { createdAtMs: T0 + i * 1000 })
      }

      const page1 = listAuditLogPage(db, { filter: {}, limit: 3 })
      const cursor1 = page1.rows.at(-1)
      if (!cursor1) throw new Error('expected page1 to have rows')

      const page2 = listAuditLogPage(db, {
        cursor: cursorFrom(cursor1),
        filter: {},
        limit: 3,
      })
      const cursor2 = page2.rows.at(-1)
      if (!cursor2) throw new Error('expected page2 to have rows')

      const page3 = listAuditLogPage(db, {
        cursor: cursorFrom(cursor2),
        filter: {},
        limit: 3,
      })

      expect(page1.hasMore).toBe(true)
      expect(page2.hasMore).toBe(true)
      expect(page3.hasMore).toBe(false)
      expect(page3.rows).toHaveLength(1)

      // `total` is the whole filtered set on every page, not the page size.
      expect([page1.total, page2.total, page3.total]).toEqual([7, 7, 7])

      const ids = [...page1.rows, ...page2.rows, ...page3.rows].map(r => r.id)
      expect(new Set(ids).size).toBe(7)
      expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])
    } finally {
      close()
    }
  })

  // The row-value tiebreak itself: without `id` in the comparison, the two
  // rows sharing T0+2000 would be dropped or duplicated across the boundary.
  it('paginates rows sharing one created_at without loss or duplication', () => {
    const { db, close } = createTestDb()
    try {
      seedAuditLog(db, { createdAtMs: T0 + 1000 }) // id 1
      seedAuditLog(db, { createdAtMs: T0 + 2000 }) // id 2 (tie)
      seedAuditLog(db, { createdAtMs: T0 + 2000 }) // id 3 (tie)
      seedAuditLog(db, { createdAtMs: T0 + 3000 }) // id 4

      const page1 = listAuditLogPage(db, { filter: {}, limit: 2 })
      expect(page1.rows.map(r => r.id)).toEqual([4, 3])
      expect(page1.hasMore).toBe(true)

      const cursorRow = page1.rows.at(-1)
      if (!cursorRow) throw new Error('expected page1 to have rows')

      const page2 = listAuditLogPage(db, {
        cursor: cursorFrom(cursorRow),
        filter: {},
        limit: 2,
      })

      expect(page2.rows.map(r => r.id)).toEqual([2, 1])
      expect(page2.hasMore).toBe(false)
      expect(page2.total).toBe(4)
    } finally {
      close()
    }
  })

  // The integer-PK trap, at the one boundary where it bites. `ListCursor.id`
  // is a string because it was minted for `jobs.id` (a nanoid), but
  // `audit_log.id` is an INTEGER PRIMARY KEY. Bind a non-numeric id as text
  // into `(created_at, id) < (?, ?)` and SQLite cannot apply the column's
  // NUMERIC affinity to it, so an integer ends up compared against text -
  // and every integer sorts before every string. The predicate goes
  // vacuously true and page 2 silently re-serves id 3, the very row the
  // cursor pointed at. Rejecting beats coercing: `decodeListCursor()`
  // already refuses a malformed timestamp for the same reason.
  it('rejects a non-integer cursor id instead of re-serving the tied row', () => {
    const { db, close } = createTestDb()
    try {
      seedAuditLog(db, { createdAtMs: T0 + 1000 }) // id 1
      seedAuditLog(db, { createdAtMs: T0 + 2000 }) // id 2 (tie)
      seedAuditLog(db, { createdAtMs: T0 + 2000 }) // id 3 (tie)

      const mangled: ListCursor = {
        sortKeyMs: T0 + 2000,
        filterKey: FILTER_KEY,
        id: '3-not-an-integer',
      }

      expect(() =>
        listAuditLogPage(db, { cursor: mangled, filter: {}, limit: 2 }),
      ).toThrow(/not a positive integer/)

      // The well-formed cursor over the same tie does page correctly, so the
      // rejection above is about the id's shape and not about ties at all.
      const page = listAuditLogPage(db, {
        cursor: { ...mangled, id: '3' },
        filter: {},
        limit: 2,
      })
      expect(page.rows.map(r => r.id)).toEqual([2, 1])
    } finally {
      close()
    }
  })

  it('narrows independently by action', () => {
    const { db, close } = createTestDb()
    try {
      seedAuditLog(db, { action: 'movie.request', createdAtMs: T0 + 1000 })
      seedAuditLog(db, { action: 'movie.delete', createdAtMs: T0 + 2000 })
      seedAuditLog(db, { action: 'movie.request', createdAtMs: T0 + 3000 })

      const page = listAuditLogPage(db, {
        filter: { action: 'movie.request' },
        limit: 10,
      })

      expect(page.rows.map(r => r.action)).toEqual([
        'movie.request',
        'movie.request',
      ])
      expect(page.total).toBe(2)
    } finally {
      close()
    }
  })

  it('narrows independently by actor email', () => {
    const { db, close } = createTestDb()
    try {
      seedAuditLog(db, { actorEmail: 'alice@example.com', createdAtMs: T0 })
      seedAuditLog(db, { actorEmail: 'bob@example.com', createdAtMs: T0 + 1 })
      seedAuditLog(db, { actorEmail: null, createdAtMs: T0 + 2 })

      const page = listAuditLogPage(db, {
        filter: { actorEmail: 'alice@example.com' },
        limit: 10,
      })

      expect(page.rows.map(r => r.actorEmail)).toEqual(['alice@example.com'])
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  // The stored casing is whatever arrived on `X-Forwarded-User`; the casing
  // on `?actor=` is whatever the admin typed. Neither normalizes the other.
  it('matches the actor email case-insensitively in both directions', () => {
    const { db, close } = createTestDb()
    try {
      seedAuditLog(db, { actorEmail: 'Alice@Example.COM', createdAtMs: T0 })

      const upperFilter = listAuditLogPage(db, {
        filter: { actorEmail: 'ALICE@EXAMPLE.COM' },
        limit: 10,
      })
      const lowerFilter = listAuditLogPage(db, {
        filter: { actorEmail: 'alice@example.com' },
        limit: 10,
      })

      expect(upperFilter.total).toBe(1)
      expect(lowerFilter.total).toBe(1)
      expect(lowerFilter.rows.map(r => r.actorEmail)).toEqual([
        'Alice@Example.COM',
      ])
    } finally {
      close()
    }
  })

  it('narrows independently by createdFrom and by createdTo', () => {
    const { db, close } = createTestDb()
    try {
      for (let i = 0; i < 5; i++) {
        seedAuditLog(db, { createdAtMs: T0 + i * 1000 })
      }

      // Both bounds are inclusive (`gte`/`lte`).
      const from = listAuditLogPage(db, {
        filter: { createdFrom: new Date(T0 + 3000) },
        limit: 10,
      })
      const to = listAuditLogPage(db, {
        filter: { createdTo: new Date(T0 + 1000) },
        limit: 10,
      })

      expect(from.rows.map(r => r.createdAt.getTime())).toEqual([
        T0 + 4000,
        T0 + 3000,
      ])
      expect(to.rows.map(r => r.createdAt.getTime())).toEqual([T0 + 1000, T0])
    } finally {
      close()
    }
  })

  it('intersects every filter dimension at once', () => {
    const { db, close } = createTestDb()
    try {
      // The one row that satisfies all four.
      seedAuditLog(db, {
        action: 'movie.request',
        actorEmail: 'alice@example.com',
        createdAtMs: T0 + 2000,
      })
      // Each of these misses on exactly one dimension.
      seedAuditLog(db, {
        action: 'movie.delete',
        actorEmail: 'alice@example.com',
        createdAtMs: T0 + 2000,
      })
      seedAuditLog(db, {
        action: 'movie.request',
        actorEmail: 'bob@example.com',
        createdAtMs: T0 + 2000,
      })
      seedAuditLog(db, {
        action: 'movie.request',
        actorEmail: 'alice@example.com',
        createdAtMs: T0,
      })
      seedAuditLog(db, {
        action: 'movie.request',
        actorEmail: 'alice@example.com',
        createdAtMs: T0 + 9000,
      })

      const page = listAuditLogPage(db, {
        filter: {
          action: 'movie.request',
          actorEmail: 'ALICE@example.com',
          createdFrom: new Date(T0 + 1000),
          createdTo: new Date(T0 + 3000),
        },
        limit: 10,
      })

      expect(page.rows).toHaveLength(1)
      expect(page.rows[0]).toMatchObject({
        action: 'movie.request',
        actorEmail: 'alice@example.com',
      })
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  // The page and the total share one `buildAuditLogWhere()` precisely so this
  // can't drift: `total` is the size of the filtered set, not of the page and
  // not of the table.
  it('counts the filtered set in total, not the page and not the table', () => {
    const { db, close } = createTestDb()
    try {
      for (let i = 0; i < 4; i++) {
        seedAuditLog(db, { action: 'movie.request', createdAtMs: T0 + i })
      }
      for (let i = 0; i < 6; i++) {
        seedAuditLog(db, { action: 'video.create', createdAtMs: T0 + 100 + i })
      }

      const page = listAuditLogPage(db, {
        filter: { action: 'movie.request' },
        limit: 2,
      })

      expect(page.rows).toHaveLength(2)
      expect(page.hasMore).toBe(true)
      expect(page.total).toBe(4)
    } finally {
      close()
    }
  })

  // A cursor narrows the page; it must not narrow the count, or the UI's
  // "showing 3 of N" would shrink as the admin pages forward.
  it('keeps total at the filtered size while a cursor advances', () => {
    const { db, close } = createTestDb()
    try {
      for (let i = 0; i < 4; i++) {
        seedAuditLog(db, { action: 'movie.request', createdAtMs: T0 + i })
      }
      seedAuditLog(db, { action: 'video.create', createdAtMs: T0 + 10 })

      const page1 = listAuditLogPage(db, {
        filter: { action: 'movie.request' },
        limit: 2,
      })
      const cursorRow = page1.rows.at(-1)
      if (!cursorRow) throw new Error('expected page1 to have rows')

      const page2 = listAuditLogPage(db, {
        cursor: cursorFrom(cursorRow),
        filter: { action: 'movie.request' },
        limit: 2,
      })

      expect(page2.rows).toHaveLength(2)
      expect(page2.hasMore).toBe(false)
      expect(page2.total).toBe(4)
    } finally {
      close()
    }
  })
})
