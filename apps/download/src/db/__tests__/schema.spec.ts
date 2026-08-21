import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { checkIntegrity, runMigrations } from 'src/db/migrate'
import { applyPragmas } from 'src/db/pragmas'
import * as schema from 'src/db/schema'
import { jobs, videos } from 'src/db/schema'

import { createTestDb } from './test-utils'

describe('schema + migrations', () => {
  it('applies migrations cleanly, creating exactly the `jobs` and `videos` tables', () => {
    const { sqlite, close } = createTestDb()
    try {
      const tableNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)
        .sort()

      expect(tableNames).toEqual(['jobs', 'videos'])
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

  it('round-trips every column kind on the `videos` table, including both JSON columns', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date('2026-01-01T00:00:00.000Z')

      db.insert(videos)
        .values({
          createdAt: now,
          downloadUrls: ['https://example.com/a.mp4'],
          id: 'video-1',
          naturalKey: 'https://example.com/a#00:00:00-00:01:00',
          overview: 'an overview',
          posterUrl: 'https://example.com/poster.jpg',
          runtime: 62,
          sourceUrl: 'https://example.com/a',
          timeRange: { end: '00:01:00', start: '00:00:00' },
          title: 'A title',
          updatedAt: now,
        })
        .run()

      const row = db.select().from(videos).all()[0]

      expect(row).toMatchObject({
        createdAt: now,
        downloadUrls: ['https://example.com/a.mp4'],
        id: 'video-1',
        naturalKey: 'https://example.com/a#00:00:00-00:01:00',
        overview: 'an overview',
        posterUrl: 'https://example.com/poster.jpg',
        runtime: 62,
        sourceUrl: 'https://example.com/a',
        timeRange: { end: '00:01:00', start: '00:00:00' },
        title: 'A title',
        updatedAt: now,
      })
    } finally {
      close()
    }
  })

  it('`videos_natural_key_idx` rejects a duplicate natural key', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(videos)
        .values({
          id: 'video-1',
          naturalKey: 'https://example.com/a#-',
          sourceUrl: 'https://example.com/a',
          title: 'A',
        })
        .run()

      expect(() =>
        db
          .insert(videos)
          .values({
            id: 'video-2',
            naturalKey: 'https://example.com/a#-',
            sourceUrl: 'https://example.com/a',
            title: 'A again',
          })
          .run(),
      ).toThrow(/UNIQUE constraint failed/)
    } finally {
      close()
    }
  })

  it('`jobs_media_id_matches_type` rejects a `movie` row with a `video:` media_id', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(jobs)
          .values({
            id: 'job-1',
            mediaId: 'video:should-be-tmdb',
            origin: 'service',
            status: 'pending',
            type: 'movie',
            url: 'radarr://tmdb/1',
          })
          .run(),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  })

  it('`jobs_media_id_matches_type` accepts a `movie` row with a `tmdb:` media_id', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(jobs)
        .values({
          id: 'job-1',
          mediaId: 'tmdb:438631',
          origin: 'service',
          status: 'pending',
          type: 'movie',
          url: 'radarr://tmdb/438631',
        })
        .run()

      const row = db.select().from(jobs).all()[0]
      expect(row?.mediaId).toBe('tmdb:438631')
    } finally {
      close()
    }
  })

  it('`jobs_media_id_matches_type` still allows a NULL media_id (pre-backfill rows)', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(jobs)
        .values({
          id: 'job-1',
          origin: 'service',
          status: 'pending',
          type: 'video',
          url: 'https://example.com/video',
        })
        .run()

      const row = db.select().from(jobs).all()[0]
      expect(row?.mediaId).toBeNull()
    } finally {
      close()
    }
  })

  it('creates the `jobs_type_media_id_idx` composite index', () => {
    const { sqlite, close } = createTestDb()
    try {
      const indexNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs'`,
        )
        .all()
        .map(row => (row as { name: string }).name)

      expect(indexNames).toContain('jobs_type_media_id_idx')
    } finally {
      close()
    }
  })
})
