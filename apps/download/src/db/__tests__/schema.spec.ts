import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { checkIntegrity, runMigrations } from 'src/db/migrate'
import { applyPragmas } from 'src/db/pragmas'
import * as schema from 'src/db/schema'
import { jobs } from 'src/db/schema'

import { createTestDb } from './test-utils'

describe('schema + migrations', () => {
  it('applies migrations cleanly, creating exactly the `jobs` table', () => {
    const { sqlite, close } = createTestDb()
    try {
      const tableNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)

      expect(tableNames).toEqual(['jobs'])
    } finally {
      close()
    }
  })

  it('round-trips every column kind on the `jobs` table (JSON, boolean, nullable timestamp, enums)', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date('2026-01-01T00:00:00.000Z')

      db.insert(jobs)
        .values({
          completedAt: now,
          description: 'a description',
          downloadUrls: ['https://example.com/a.mp4'],
          error: undefined,
          filePath: '/videos/a.mp4',
          hiddenAttribution: true,
          id: 'job-1',
          mediaTitle: 'A Movie',
          origin: 'web',
          overview: 'an overview',
          posterUrl: 'https://example.com/poster.jpg',
          queueSnapshot: { progress: 42, status: 'downloading' },
          radarrId: 7,
          requesterEmail: 'alice@example.com',
          requesterUserId: 'user_1',
          sonarrId: undefined,
          status: 'completed',
          timeRange: { start: '00:00:00', end: '00:01:00' },
          title: 'A title',
          type: 'movie',
          updatedAt: now,
          url: 'radarr://tmdb/1',
        })
        .run()

      const row = db.select().from(jobs).all()[0]

      expect(row).toMatchObject({
        completedAt: now,
        description: 'a description',
        downloadUrls: ['https://example.com/a.mp4'],
        filePath: '/videos/a.mp4',
        hiddenAttribution: true,
        id: 'job-1',
        mediaTitle: 'A Movie',
        origin: 'web',
        overview: 'an overview',
        posterUrl: 'https://example.com/poster.jpg',
        queueSnapshot: { progress: 42, status: 'downloading' },
        radarrId: 7,
        requesterEmail: 'alice@example.com',
        requesterUserId: 'user_1',
        sonarrId: null,
        status: 'completed',
        timeRange: { start: '00:00:00', end: '00:01:00' },
        title: 'A title',
        type: 'movie',
        updatedAt: now,
        url: 'radarr://tmdb/1',
      })
    } finally {
      close()
    }
  })

  it('defaults `hiddenAttribution` to false and leaves optional columns null', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(jobs)
        .values({
          id: 'job-2',
          origin: 'service',
          status: 'pending',
          type: 'video',
          url: 'https://example.com/video',
        })
        .run()

      const row = db.select().from(jobs).all()[0]

      expect(row).toMatchObject({
        completedAt: null,
        hiddenAttribution: false,
        requesterEmail: null,
        requesterUserId: null,
      })
      expect(row?.createdAt).toBeInstanceOf(Date)
      expect(row?.updatedAt).toBeInstanceOf(Date)
    } finally {
      close()
    }
  })

  it('re-asserts foreign_keys = ON after migrate()', () => {
    const sqlite = new BetterSqlite3(':memory:')
    applyPragmas(sqlite)
    const db = drizzle(sqlite, { schema })

    const pragmaSpy = jest.spyOn(sqlite, 'pragma')
    runMigrations(db)

    const reassertionCalls = pragmaSpy.mock.calls.filter(
      ([arg]) => arg === 'foreign_keys = ON',
    )
    expect(reassertionCalls.length).toBeGreaterThanOrEqual(1)

    const fkStatus = sqlite.pragma('foreign_keys') as Array<{
      foreign_keys: number
    }>
    expect(fkStatus[0]?.foreign_keys).toBe(1)
    sqlite.close()
  })

  it('checkIntegrity() passes on a freshly migrated database', () => {
    const { db, close } = createTestDb()
    try {
      expect(() => checkIntegrity(db)).not.toThrow()
    } finally {
      close()
    }
  })

  it('checkIntegrity() throws when the underlying check reports a problem', () => {
    const { db, sqlite, close } = createTestDb()
    try {
      jest.spyOn(sqlite, 'prepare').mockReturnValue({
        get: () => ({ integrity_check: 'corruption detected' }),
      } as unknown as ReturnType<BetterSqlite3.Database['prepare']>)

      expect(() => checkIntegrity(db)).toThrow(/integrity_check failed/)
    } finally {
      close()
    }
  })

  it('creates the `jobs_created_at_id_idx` composite index', () => {
    const { sqlite, close } = createTestDb()
    try {
      const indexNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs'`,
        )
        .all()
        .map(row => (row as { name: string }).name)

      expect(indexNames).toContain('jobs_created_at_id_idx')
    } finally {
      close()
    }
  })

  it("plans every list endpoint's cursor query as an ordered index scan, not a temp b-tree sort", () => {
    const { sqlite, close } = createTestDb()
    try {
      // Mirrors jobs.repo.ts's cursor predicate/order exactly: descending
      // row-value comparison on `(created_at, id)`, ordered the same way.
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM jobs
           WHERE (created_at, id) < (9999999999999, 'x')
           ORDER BY created_at DESC, id DESC`,
        )
        .all()
        .map(row => (row as { detail: string }).detail)
        .join('\n')

      expect(plan).toContain('jobs_created_at_id_idx')
      expect(plan).not.toContain('TEMP B-TREE')
    } finally {
      close()
    }
  })

  it('plans the unfiltered list query (no WHERE) as a bare ordered index scan', () => {
    const { sqlite, close } = createTestDb()
    try {
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM jobs
           ORDER BY created_at DESC, id DESC`,
        )
        .all()
        .map(row => (row as { detail: string }).detail)
        .join('\n')

      // A plain, unfiltered scan still avoids a separate sort step by
      // walking the composite index in its natural order - reported as
      // "SCAN jobs USING INDEX ..." rather than "SEARCH", since there's no
      // WHERE clause to seek on, but it's still the index doing the
      // ordering, not a temp b-tree.
      expect(plan).toContain('USING INDEX jobs_created_at_id_idx')
      expect(plan).not.toContain('TEMP B-TREE')
    } finally {
      close()
    }
  })
})
