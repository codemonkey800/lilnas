import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { checkIntegrity, runMigrations } from 'src/db/migrate'
import { applyPragmas } from 'src/db/pragmas'
import * as schema from 'src/db/schema'
import { auditLog, badFiles, jobs, videos } from 'src/db/schema'

import { createTestDb } from './test-utils'

describe('schema + migrations', () => {
  it('applies migrations cleanly, creating exactly the `audit_log`, `jobs`, `videos` and `bad_files` tables', () => {
    const { sqlite, close } = createTestDb()
    try {
      const tableNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)
        .sort()

      // `sqlite_sequence` is excluded by the `sqlite_%` filter above -
      // `bad_files` is the first AUTOINCREMENT table in this schema, so
      // migration 0005 is what makes SQLite create it at all.
      expect(tableNames).toEqual(['audit_log', 'bad_files', 'jobs', 'videos'])
    } finally {
      close()
    }
  })

  it('round-trips every column kind on the `jobs` table (boolean, nullable timestamp, enums)', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date('2026-01-01T00:00:00.000Z')

      db.insert(jobs)
        .values({
          completedAt: now,
          error: 'a transient error',
          hiddenAttribution: true,
          id: 'job-1',
          mediaId: 'tmdb:1',
          origin: 'web',
          requesterEmail: 'alice@example.com',
          requesterUserId: 'user_1',
          status: 'completed',
          type: 'movie',
          updatedAt: now,
        })
        .run()

      const row = db.select().from(jobs).all()[0]

      expect(row).toMatchObject({
        completedAt: now,
        error: 'a transient error',
        hiddenAttribution: true,
        id: 'job-1',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'user_1',
        status: 'completed',
        type: 'movie',
        updatedAt: now,
      })
    } finally {
      close()
    }
  })

  // Phase 5 widened `DOWNLOAD_JOB_STATUSES` with `paused`/`pausing` and
  // shipped **no** migration to go with it. This is what proves that was
  // right: `status` is a bare `text NOT NULL` column with no CHECK behind it
  // (the enum exists only in drizzle's TS types), so the real migration files
  // `createTestDb()` runs accept a status they were written before.
  it.each(['paused', 'pausing'] as const)(
    'round-trips a `%s` job through the real migrations - no CHECK rejects a status added without one',
    status => {
      const { db, close } = createTestDb()
      try {
        db.insert(jobs)
          .values({
            id: 'job-paused',
            mediaId: 'video:v1',
            origin: 'service',
            status,
            type: 'video',
          })
          .run()

        expect(db.select().from(jobs).all()[0]?.status).toBe(status)
      } finally {
        close()
      }
    },
  )

  it('has exactly the final `jobs` column list (Phase 7 dropped the twelve legacy media columns)', () => {
    const { sqlite, close } = createTestDb()
    try {
      const columnNames = sqlite
        .prepare(`PRAGMA table_info(jobs)`)
        .all()
        .map(row => (row as { name: string }).name)

      expect(columnNames).toEqual([
        'id',
        'type',
        'status',
        'requester_email',
        'requester_user_id',
        'origin',
        'hidden_attribution',
        'error',
        'media_id',
        // Phase 4: nullable, NULL meaning "the whole series".
        'scope',
        'created_at',
        'updated_at',
        'completed_at',
      ])
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
          mediaId: 'video:v1',
          origin: 'service',
          status: 'pending',
          type: 'video',
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

  it("plans the activity feed's combined filter (status IN + type IN + cursor) with a temp b-tree sort, unlike the single-status list queries above", () => {
    const { sqlite, close } = createTestDb()
    try {
      // Mirrors listActivity()'s filter (job-query.service.ts): every
      // in-progress status, optionally narrowed by type, plus the same
      // `(created_at, id)` cursor as listJobsPage(). A multi-value `IN`
      // filter gives SQLite a seekable index of its own
      // (`jobs_status_idx`/`jobs_type_media_id_idx`) to satisfy the WHERE
      // clause with, which it prefers over walking
      // `jobs_created_at_id_idx` for the ORDER BY - so unlike the bare
      // cursor query above, this shape pays for a temp b-tree sort. An
      // accepted cost at a home-NAS row count, not a regression to chase.
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM jobs
           WHERE status IN ('cancelling', 'cleaning', 'converting', 'downloading', 'importing', 'pending', 'requested', 'searching', 'uploading')
             AND type IN ('movie', 'video')
             AND (created_at, id) < (9999999999999, 'x')
           ORDER BY created_at DESC, id DESC`,
        )
        .all()
        .map(row => (row as { detail: string }).detail)
        .join('\n')

      expect(plan).toContain('TEMP B-TREE')
    } finally {
      close()
    }
  })

  it("plans the gallery's `GROUP BY (type, media_id)` with a temp b-tree sort - `ORDER BY MAX(created_at) DESC` can't be answered from an index", () => {
    const { sqlite, close } = createTestDb()
    try {
      // Mirrors listMediaGroupsPage()'s grouped query (jobs.repo.ts). Unlike
      // every plan test above, this one deliberately asserts the *presence*
      // of a temp b-tree rather than its absence: the sort key is an
      // aggregate (MAX(created_at)) that only exists once a group's rows
      // have all been scanned, so no index can pre-sort it. This is an
      // accepted, documented cost at a home-NAS row count (plan §3.2), not
      // an oversight to fix.
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT type, media_id, count(*), max(created_at)
           FROM jobs
           GROUP BY type, media_id
           ORDER BY max(created_at) DESC, media_id DESC`,
        )
        .all()
        .map(row => (row as { detail: string }).detail)
        .join('\n')

      expect(plan).toContain('jobs_type_media_id_idx')
      expect(plan).toContain('TEMP B-TREE')
    } finally {
      close()
    }
  })

  it('plans both gallery-facet `GROUP BY`s (requester, type) as covering index scans, without a temp b-tree sort', () => {
    const { sqlite, close } = createTestDb()
    try {
      // Mirrors countJobsByRequester() and countJobsByType() (jobs.repo.ts).
      // Neither has an ORDER BY of its own - each GROUP BY's key is a
      // leftmost prefix of an existing index (`jobs_requester_email_idx`,
      // `jobs_type_media_id_idx`), so SQLite satisfies the grouping by
      // walking the index in order rather than sorting a temp b-tree.
      const requesterPlan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT requester_email, count(*) FROM jobs
           WHERE requester_email IS NOT NULL
           GROUP BY requester_email`,
        )
        .all()
        .map(row => (row as { detail: string }).detail)
        .join('\n')

      const typePlan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT type, count(*) FROM jobs
           GROUP BY type`,
        )
        .all()
        .map(row => (row as { detail: string }).detail)
        .join('\n')

      expect(requesterPlan).toContain('jobs_requester_email_idx')
      expect(requesterPlan).not.toContain('TEMP B-TREE')
      expect(typePlan).toContain('jobs_type_media_id_idx')
      expect(typePlan).not.toContain('TEMP B-TREE')
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
        })
        .run()

      const row = db.select().from(jobs).all()[0]
      expect(row?.mediaId).toBe('tmdb:438631')
    } finally {
      close()
    }
  })

  // ---- Phase 4: jobs.scope ----

  it('round-trips a JSON `scope` on a show row', () => {
    const { db, close } = createTestDb()
    try {
      const scope = { episodeId: 4412, episodeNumber: 5, seasonNumber: 3 }

      db.insert(jobs)
        .values({
          id: 'job-1',
          mediaId: 'tvdb:81189',
          origin: 'service',
          scope,
          status: 'searching',
          type: 'show',
        })
        .run()

      expect(db.select().from(jobs).all()[0]?.scope).toEqual(scope)
    } finally {
      close()
    }
  })

  // NULL is the pre-Phase-4 meaning - "the whole series" - which is why the
  // column needed no backfill.
  it('leaves `scope` NULL when an insert omits it', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(jobs)
        .values({
          id: 'job-1',
          mediaId: 'tvdb:81189',
          origin: 'service',
          status: 'searching',
          type: 'show',
        })
        .run()

      expect(db.select().from(jobs).all()[0]?.scope).toBeNull()
    } finally {
      close()
    }
  })

  it.each([
    ['movie', 'tmdb:438631'],
    ['video', 'video:V1StGXR8_Z5'],
  ] as const)(
    '`jobs_scope_only_for_shows` rejects a scope on a `%s` row',
    (type, mediaId) => {
      const { db, close } = createTestDb()
      try {
        expect(() =>
          db
            .insert(jobs)
            .values({
              id: 'job-1',
              mediaId,
              origin: 'service',
              scope: { seasonNumber: 3 },
              status: 'pending',
              type,
            })
            .run(),
        ).toThrow(/CHECK constraint failed/)
      } finally {
        close()
      }
    },
  )

  it('`media_id` is `NOT NULL` - an insert omitting it fails outright rather than landing a pre-Media row', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(jobs)
          .values({
            id: 'job-1',
            origin: 'service',
            status: 'pending',
            type: 'video',
          } as unknown as typeof jobs.$inferInsert)
          .run(),
      ).toThrow(/NOT NULL constraint failed/)
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

  // ---- Phase 3: bad_files ----

  it('round-trips every column kind on the `bad_files` table', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date('2026-01-01T00:00:00.000Z')

      db.insert(badFiles)
        .values({
          createdAt: now,
          flaggedByEmail: 'alice@example.com',
          flaggedByUserId: 'user_1',
          indexerId: 3,
          mediaId: 'tmdb:27205',
          mediaType: 'movie',
          reason: 'Audio desyncs at 40m',
          releaseGuid: 'indexer://abc',
          releaseTitle: 'Inception.2010.1080p',
        })
        .run()

      const row = db.select().from(badFiles).all()[0]

      expect(row).toMatchObject({
        createdAt: now,
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        indexerId: 3,
        mediaId: 'tmdb:27205',
        mediaType: 'movie',
        reason: 'Audio desyncs at 40m',
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Inception.2010.1080p',
      })
      // Autoincrement integer PK, unlike jobs/videos' app-minted TEXT ids.
      expect(typeof row?.id).toBe('number')
    } finally {
      close()
    }
  })

  it('has exactly the expected `bad_files` column list', () => {
    const { sqlite, close } = createTestDb()
    try {
      const columnNames = sqlite
        .prepare(`PRAGMA table_info(bad_files)`)
        .all()
        .map(row => (row as { name: string }).name)

      expect(columnNames).toEqual([
        'id',
        'media_type',
        'media_id',
        'release_guid',
        'indexer_id',
        'release_title',
        'reason',
        'flagged_by_email',
        'flagged_by_user_id',
        'created_at',
      ])
    } finally {
      close()
    }
  })

  it('leaves the optional `bad_files` columns null and defaults `createdAt`', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(badFiles)
        .values({
          flaggedByEmail: 'alice@example.com',
          flaggedByUserId: 'user_1',
          mediaId: 'tvdb:81189',
          mediaType: 'show',
          releaseGuid: 'indexer://abc',
        })
        .run()

      const row = db.select().from(badFiles).all()[0]

      expect(row).toMatchObject({
        indexerId: null,
        reason: null,
        releaseTitle: null,
      })
      expect(row?.createdAt).toBeInstanceOf(Date)
    } finally {
      close()
    }
  })

  it('`bad_files_media_id_release_guid_idx` rejects a duplicate (media_id, guid) - what makes flagging idempotent', () => {
    const { db, close } = createTestDb()
    try {
      const values = {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId: 'tmdb:27205',
        mediaType: 'movie' as const,
        releaseGuid: 'indexer://abc',
      }

      db.insert(badFiles).values(values).run()

      expect(() =>
        db
          .insert(badFiles)
          .values({ ...values, flaggedByEmail: 'bob@example.com' })
          .run(),
      ).toThrow(/UNIQUE constraint failed/)
    } finally {
      close()
    }
  })

  it('allows the same guid under two different media ids - the unique index is on the pair', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(badFiles)
        .values([
          {
            flaggedByEmail: 'alice@example.com',
            flaggedByUserId: 'user_1',
            mediaId: 'tmdb:27205',
            mediaType: 'movie',
            releaseGuid: 'indexer://abc',
          },
          {
            flaggedByEmail: 'alice@example.com',
            flaggedByUserId: 'user_1',
            mediaId: 'tmdb:438631',
            mediaType: 'movie',
            releaseGuid: 'indexer://abc',
          },
        ])
        .run()

      expect(db.select().from(badFiles).all()).toHaveLength(2)
    } finally {
      close()
    }
  })

  it.each([
    ['a `movie` row with a `tvdb:` media_id', 'movie', 'tvdb:81189'],
    ['a `show` row with a `tmdb:` media_id', 'show', 'tmdb:27205'],
    // No `video` arm at all in the CHECK: a video has no indexer releases
    // to flag, so this is rejected rather than merely unused.
    ['a `video` row', 'video', 'video:V1StGXR8_Z5'],
  ])('`bad_files_media_id_matches_type` rejects %s', (_label, type, id) => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(badFiles)
          .values({
            flaggedByEmail: 'alice@example.com',
            flaggedByUserId: 'user_1',
            mediaId: id,
            mediaType: type as 'movie' | 'show' | 'video',
            releaseGuid: 'indexer://abc',
          })
          .run(),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  })

  it('creates both `bad_files` indexes', () => {
    const { sqlite, close } = createTestDb()
    try {
      const indexNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'bad_files'`,
        )
        .all()
        .map(row => (row as { name: string }).name)

      expect(indexNames).toEqual(
        expect.arrayContaining([
          'bad_files_media_id_idx',
          'bad_files_media_id_release_guid_idx',
        ]),
      )
    } finally {
      close()
    }
  })

  // ---- Phase 8: audit_log ----

  it('round-trips every column kind on the `audit_log` table, including the JSON `metadata`', () => {
    const { db, close } = createTestDb()
    try {
      const now = new Date('2026-01-01T00:00:00.000Z')

      db.insert(auditLog)
        .values({
          action: 'movie.request',
          actorEmail: 'alice@example.com',
          actorUserId: 'user_1',
          createdAt: now,
          metadata: { quality: 'HD-1080p', title: 'Inception' },
          origin: 'web',
          targetId: 'tmdb:27205',
          targetType: 'media',
        })
        .run()

      const row = db.select().from(auditLog).all()[0]

      expect(row).toMatchObject({
        action: 'movie.request',
        actorEmail: 'alice@example.com',
        actorUserId: 'user_1',
        createdAt: now,
        metadata: { quality: 'HD-1080p', title: 'Inception' },
        origin: 'web',
        targetId: 'tmdb:27205',
        targetType: 'media',
      })
      // Autoincrement integer PK, like `bad_files` and unlike jobs/videos'
      // app-minted TEXT ids.
      expect(typeof row?.id).toBe('number')
    } finally {
      close()
    }
  })

  it('has exactly the expected `audit_log` column list', () => {
    const { sqlite, close } = createTestDb()
    try {
      const columnNames = sqlite
        .prepare(`PRAGMA table_info(audit_log)`)
        .all()
        .map(row => (row as { name: string }).name)

      expect(columnNames).toEqual([
        'id',
        'origin',
        'actor_email',
        'actor_user_id',
        'action',
        'target_type',
        'target_id',
        'metadata',
        'created_at',
      ])
    } finally {
      close()
    }
  })

  // The `service` half of `audit_log_origin_matches_actor`, and the "no
  // target at all" half of `audit_log_target_pair` - `ytdlp.check_update` is
  // exactly the action that exercises both at once.
  it('accepts a `service` row with no actor and no target, defaulting `createdAt`', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(auditLog)
        .values({ action: 'ytdlp.check_update', origin: 'service' })
        .run()

      const row = db.select().from(auditLog).all()[0]

      expect(row).toMatchObject({
        action: 'ytdlp.check_update',
        actorEmail: null,
        actorUserId: null,
        metadata: null,
        origin: 'service',
        targetId: null,
        targetType: null,
      })
      expect(row?.createdAt).toBeInstanceOf(Date)
    } finally {
      close()
    }
  })

  it('`audit_log_origin_matches_actor` rejects a `web` row with no actor', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(auditLog)
          .values({ action: 'video.create', origin: 'web' })
          .run(),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  })

  it('`audit_log_origin_matches_actor` rejects a `service` row that carries an actor', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(auditLog)
          .values({
            action: 'video.create',
            actorEmail: 'alice@example.com',
            actorUserId: 'user_1',
            origin: 'service',
          })
          .run(),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  })

  it.each([
    ['a `targetType` with no `targetId`', 'job', undefined],
    ['a `targetId` with no `targetType`', undefined, 'job-1'],
  ] as const)(
    '`audit_log_target_pair` rejects %s',
    (_label, targetType, targetId) => {
      const { db, close } = createTestDb()
      try {
        expect(() =>
          db
            .insert(auditLog)
            .values({
              action: 'video.cancel',
              origin: 'service',
              targetId,
              targetType,
            })
            .run(),
        ).toThrow(/CHECK constraint failed/)
      } finally {
        close()
      }
    },
  )

  it('creates all three `audit_log` indexes', () => {
    const { sqlite, close } = createTestDb()
    try {
      const indexNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log' AND name NOT LIKE 'sqlite_%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)
        .sort()

      expect(indexNames).toEqual([
        'audit_log_action_idx',
        'audit_log_actor_email_idx',
        'audit_log_created_at_id_idx',
      ])
    } finally {
      close()
    }
  })

  it("plans the audit list endpoint's cursor query as an ordered index scan, not a temp b-tree sort", () => {
    const { sqlite, close } = createTestDb()
    try {
      // The same keyset shape jobs.repo.ts uses, which is why `audit_log`
      // gets the same `(created_at, id)` composite index.
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM audit_log
           WHERE (created_at, id) < (9999999999999, 999999)
           ORDER BY created_at DESC, id DESC`,
        )
        .all()
        .map(row => (row as { detail: string }).detail)
        .join('\n')

      expect(plan).toContain('audit_log_created_at_id_idx')
      expect(plan).not.toContain('TEMP B-TREE')
    } finally {
      close()
    }
  })
})
