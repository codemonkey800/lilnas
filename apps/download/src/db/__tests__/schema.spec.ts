import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { checkIntegrity, runMigrations } from 'src/db/migrate'
import { applyPragmas } from 'src/db/pragmas'
import * as schema from 'src/db/schema'
import {
  auditLog,
  badFiles,
  jobs,
  mediaFileReleases,
  videos,
} from 'src/db/schema'

import { createTestDb } from './test-utils'

describe('schema + migrations', () => {
  it('applies migrations cleanly, creating exactly the `audit_log`, `jobs`, `videos`, `bad_files` and `media_file_releases` tables', () => {
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
      expect(tableNames).toEqual([
        'audit_log',
        'bad_files',
        'jobs',
        'media_file_releases',
        'videos',
      ])
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
        // Phase 018: appended next to the requester pair they are mutually
        // exclusive with, not at the end of the table - migration 0002
        // recreates `jobs` wholesale (SQLite cannot ALTER a CHECK), so
        // physical column order was ours to choose.
        'discord_user_id',
        'discord_username',
        'origin',
        'hidden_attribution',
        'error',
        'media_id',
        // Phase 4: nullable, NULL meaning "the whole series".
        'scope',
        'created_at',
        'updated_at',
        'completed_at',
        // No `removed_from_library`: 0003 added it and 0004 drops it again
        // (plan 021 - the gallery is built from the library now).
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

  // ---- `jobs_origin_matches_requester`, Phase 018's three-way form ----

  type JobInsert = typeof jobs.$inferInsert
  type JobOrigin = NonNullable<JobInsert['origin']>
  type JobAttribution = Pick<
    JobInsert,
    'discordUserId' | 'discordUsername' | 'requesterEmail' | 'requesterUserId'
  >

  // A real snowflake, written as a **string** - it exceeds
  // `Number.MAX_SAFE_INTEGER`, so as a numeric literal it would both round and
  // trip eslint's `no-loss-of-precision`. That is the whole reason
  // `discord_user_id` is a TEXT column.
  const DISCORD_ATTRIBUTION: JobAttribution = {
    discordUserId: '183948273649182736',
    discordUsername: 'jeremy',
  }

  const WEB_ATTRIBUTION: JobAttribution = {
    requesterEmail: 'alice@example.com',
    requesterUserId: 'user_1',
  }

  /**
   * The assertion has to run *inside* the `try`, not be returned from it: the
   * `finally` closes the database, and a closure handed back to the caller
   * would execute against a closed handle and throw the wrong error.
   */
  function expectJobRejected(
    origin: JobOrigin,
    attribution: JobAttribution,
  ): void {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(jobs)
          .values({
            id: `job-${origin}`,
            mediaId: 'video:v1',
            origin,
            status: 'pending',
            type: 'video',
            ...attribution,
          })
          .run(),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  }

  // Each arm of the CHECK pins *both* halves - which columns must be set and
  // which must be NULL - so the accept matrix below (one row per origin,
  // carrying exactly its own attribution and nothing else) and the reject
  // matrix after it are testing two genuinely different things, not the same
  // thing twice.
  it.each<[JobOrigin, JobAttribution]>([
    ['service', {}],
    ['web', WEB_ATTRIBUTION],
    ['discord', DISCORD_ATTRIBUTION],
    // Plan 022: an adopted Radarr/Sonarr download - `service`'s all-NULL
    // shape under its own name.
    ['upstream', {}],
  ])(
    '`jobs_origin_matches_requester` accepts a `%s` row carrying exactly its own attribution',
    (origin, attribution) => {
      const { db, close } = createTestDb()
      try {
        db.insert(jobs)
          .values({
            id: `job-${origin}`,
            mediaId: 'video:v1',
            origin,
            status: 'pending',
            type: 'video',
            ...attribution,
          })
          .run()

        expect(db.select().from(jobs).all()[0]).toMatchObject({
          discordUserId: attribution.discordUserId ?? null,
          discordUsername: attribution.discordUsername ?? null,
          origin,
          requesterEmail: attribution.requesterEmail ?? null,
          requesterUserId: attribution.requesterUserId ?? null,
        })
      } finally {
        close()
      }
    },
  )

  it.each<[string, JobOrigin, JobAttribution]>([
    ['a `service` row carrying a web requester', 'service', WEB_ATTRIBUTION],
    [
      'a `service` row carrying a Discord requester',
      'service',
      DISCORD_ATTRIBUTION,
    ],
    ['a `web` row carrying no requester at all', 'web', {}],
    [
      'a `web` row carrying only half its requester',
      'web',
      { requesterEmail: WEB_ATTRIBUTION.requesterEmail },
    ],
    [
      'a `web` row carrying a Discord requester as well',
      'web',
      { ...WEB_ATTRIBUTION, ...DISCORD_ATTRIBUTION },
    ],
    [
      'a `web` row carrying a Discord requester instead',
      'web',
      DISCORD_ATTRIBUTION,
    ],
    ['a `discord` row carrying no identity at all', 'discord', {}],
    [
      'a `discord` row carrying only half its identity',
      'discord',
      { discordUserId: DISCORD_ATTRIBUTION.discordUserId },
    ],
    [
      'a `discord` row carrying a web requester as well',
      'discord',
      { ...WEB_ATTRIBUTION, ...DISCORD_ATTRIBUTION },
    ],
    [
      'a `discord` row carrying a web requester instead',
      'discord',
      WEB_ATTRIBUTION,
    ],
    // Radarr/Sonarr started it, so there is nobody to attribute it to - a
    // person on an `upstream` row means `buildJobRow` derived it wrongly.
    ['an `upstream` row carrying a web requester', 'upstream', WEB_ATTRIBUTION],
    [
      'an `upstream` row carrying a Discord requester',
      'upstream',
      DISCORD_ATTRIBUTION,
    ],
    [
      'an `upstream` row carrying only half a web requester',
      'upstream',
      { requesterUserId: WEB_ATTRIBUTION.requesterUserId },
    ],
  ])(
    '`jobs_origin_matches_requester` rejects %s',
    (_label, origin, attribution) => {
      expectJobRejected(origin, attribution)
    },
  )

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

  it('creates all six `jobs` indexes', () => {
    const { sqlite, close } = createTestDb()
    try {
      const indexNames = (
        sqlite
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs' AND name NOT LIKE 'sqlite_%'`,
          )
          .all() as Array<{ name: string }>
      )
        .map(row => row.name)
        .sort()

      expect(indexNames).toEqual([
        'jobs_created_at_id_idx',
        'jobs_created_at_idx',
        // Phase 018, the Discord-side counterpart of
        // `jobs_requester_email_idx`.
        'jobs_discord_user_id_idx',
        'jobs_requester_email_idx',
        'jobs_status_idx',
        'jobs_type_media_id_idx',
      ])
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
        // Phase 018, same placement reasoning as `jobs.discord_user_id`.
        'actor_discord_user_id',
        'actor_discord_username',
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

  // ---- `audit_log_origin_matches_actor`, the exact mirror of
  // `jobs_origin_matches_requester` above (same three arms, same
  // both-halves-pinned shape), so the matrix below is deliberately the same
  // matrix with `actor_`-prefixed columns.

  type AuditInsert = typeof auditLog.$inferInsert
  // Not `JobOrigin`: `jobs.origin` also allows plan 022's `upstream`, which
  // `audit_log.origin` deliberately does not (see `JOB_ROW_ORIGINS`).
  type AuditOrigin = NonNullable<AuditInsert['origin']>
  type AuditActor = Pick<
    AuditInsert,
    'actorDiscordUserId' | 'actorDiscordUsername' | 'actorEmail' | 'actorUserId'
  >

  const DISCORD_ACTOR: AuditActor = {
    actorDiscordUserId: '183948273649182736',
    actorDiscordUsername: 'jeremy',
  }

  const WEB_ACTOR: AuditActor = {
    actorEmail: 'alice@example.com',
    actorUserId: 'user_1',
  }

  function expectAuditRejected(origin: AuditOrigin, actor: AuditActor): void {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(auditLog)
          .values({ action: 'video.create', origin, ...actor })
          .run(),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  }

  it.each<[AuditOrigin, AuditActor]>([
    ['service', {}],
    ['web', WEB_ACTOR],
    ['discord', DISCORD_ACTOR],
  ])(
    '`audit_log_origin_matches_actor` accepts a `%s` row carrying exactly its own actor',
    (origin, actor) => {
      const { db, close } = createTestDb()
      try {
        db.insert(auditLog)
          .values({ action: 'video.create', origin, ...actor })
          .run()

        expect(db.select().from(auditLog).all()[0]).toMatchObject({
          actorDiscordUserId: actor.actorDiscordUserId ?? null,
          actorDiscordUsername: actor.actorDiscordUsername ?? null,
          actorEmail: actor.actorEmail ?? null,
          actorUserId: actor.actorUserId ?? null,
          origin,
        })
      } finally {
        close()
      }
    },
  )

  it.each<[string, AuditOrigin, AuditActor]>([
    ['a `service` row carrying a web actor', 'service', WEB_ACTOR],
    ['a `service` row carrying a Discord actor', 'service', DISCORD_ACTOR],
    ['a `web` row carrying no actor at all', 'web', {}],
    [
      'a `web` row carrying only half its actor',
      'web',
      { actorEmail: WEB_ACTOR.actorEmail },
    ],
    [
      'a `web` row carrying a Discord actor as well',
      'web',
      { ...WEB_ACTOR, ...DISCORD_ACTOR },
    ],
    ['a `web` row carrying a Discord actor instead', 'web', DISCORD_ACTOR],
    ['a `discord` row carrying no actor at all', 'discord', {}],
    [
      'a `discord` row carrying only half its actor',
      'discord',
      { actorDiscordUserId: DISCORD_ACTOR.actorDiscordUserId },
    ],
    [
      'a `discord` row carrying a web actor as well',
      'discord',
      { ...WEB_ACTOR, ...DISCORD_ACTOR },
    ],
    ['a `discord` row carrying a web actor instead', 'discord', WEB_ACTOR],
  ])('`audit_log_origin_matches_actor` rejects %s', (_label, origin, actor) => {
    expectAuditRejected(origin, actor)
  })

  // Plan 022 widened `jobs.origin` only. Raw SQL, because `AuditOrigin`
  // already refuses the value at compile time - this pins the DB half.
  it('`audit_log_origin_matches_actor` rejects `upstream` - no audit actor is Radarr/Sonarr', () => {
    const { sqlite, close } = createTestDb()
    try {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO audit_log (origin, action, created_at) VALUES ('upstream', 'video.create', 1)`,
          )
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

  it('creates all four `audit_log` indexes', () => {
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
        'audit_log_actor_discord_user_id_idx',
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

  // ---- media_file_releases ----

  it('round-trips every column kind on the `media_file_releases` table', () => {
    const { db, close } = createTestDb()
    try {
      const publishDate = new Date('2025-12-24T09:30:00.000Z')
      const resolvedAt = new Date('2026-01-01T00:00:00.000Z')

      db.insert(mediaFileReleases)
        .values({
          downloadId: 'sabnzbd:9f2c',
          episodeId: 4821,
          indexer: 'NZBgeek',
          indexerId: 3,
          mediaId: 'tvdb:81189',
          mediaType: 'show',
          protocol: 'usenet',
          publishDate,
          releaseGroup: 'NTb',
          releaseGuid: 'indexer://abc',
          releaseTitle: 'Breaking.Bad.S01E01.1080p.BluRay-NTb',
          resolvedAt,
          size: 2_147_483_648,
          upstreamFileId: 42,
        })
        .run()

      const row = db.select().from(mediaFileReleases).all()[0]

      expect(row).toMatchObject({
        downloadId: 'sabnzbd:9f2c',
        episodeId: 4821,
        indexer: 'NZBgeek',
        indexerId: 3,
        mediaId: 'tvdb:81189',
        mediaType: 'show',
        protocol: 'usenet',
        publishDate,
        releaseGroup: 'NTb',
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Breaking.Bad.S01E01.1080p.BluRay-NTb',
        resolvedAt,
        // Sizes are routinely past 2^31, so this column has to survive a
        // value that would overflow a 32-bit int.
        size: 2_147_483_648,
        upstreamFileId: 42,
      })
      // Autoincrement integer PK, like `bad_files` and unlike jobs/videos'
      // app-minted TEXT ids.
      expect(typeof row?.id).toBe('number')
    } finally {
      close()
    }
  })

  it('has exactly the expected `media_file_releases` column list', () => {
    const { sqlite, close } = createTestDb()
    try {
      const columnNames = sqlite
        .prepare(`PRAGMA table_info(media_file_releases)`)
        .all()
        .map(row => (row as { name: string }).name)

      expect(columnNames).toEqual([
        'id',
        'media_type',
        'media_id',
        'upstream_file_id',
        'episode_id',
        'release_guid',
        'indexer_id',
        'indexer',
        'release_title',
        'download_id',
        'protocol',
        'publish_date',
        'size',
        'release_group',
        'resolved_at',
      ])
    } finally {
      close()
    }
  })

  it('leaves every optional `media_file_releases` column null and defaults `resolvedAt`', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(mediaFileReleases)
        .values({
          mediaId: 'tmdb:27205',
          mediaType: 'movie',
          releaseGuid: 'indexer://abc',
          upstreamFileId: 42,
        })
        .run()

      const row = db.select().from(mediaFileReleases).all()[0]

      expect(row).toMatchObject({
        downloadId: null,
        episodeId: null,
        indexer: null,
        indexerId: null,
        protocol: null,
        publishDate: null,
        releaseGroup: null,
        releaseTitle: null,
        size: null,
      })
      expect(row?.resolvedAt).toBeInstanceOf(Date)
    } finally {
      close()
    }
  })

  it('`media_file_releases_type_file_idx` rejects a duplicate (media_type, upstream_file_id) - what makes the resolver idempotent', () => {
    const { db, close } = createTestDb()
    try {
      const values = {
        mediaId: 'tmdb:27205',
        mediaType: 'movie' as const,
        releaseGuid: 'indexer://abc',
        upstreamFileId: 42,
      }

      db.insert(mediaFileReleases).values(values).run()

      expect(() =>
        db
          .insert(mediaFileReleases)
          .values({ ...values, releaseGuid: 'indexer://def' })
          .run(),
      ).toThrow(/UNIQUE constraint failed/)
    } finally {
      close()
    }
  })

  it('allows the same upstream file id under both media types - Radarr and Sonarr number their files independently', () => {
    const { db, close } = createTestDb()
    try {
      db.insert(mediaFileReleases)
        .values([
          {
            mediaId: 'tmdb:27205',
            mediaType: 'movie',
            releaseGuid: 'indexer://abc',
            upstreamFileId: 42,
          },
          {
            mediaId: 'tvdb:81189',
            mediaType: 'show',
            releaseGuid: 'indexer://def',
            upstreamFileId: 42,
          },
        ])
        .run()

      expect(db.select().from(mediaFileReleases).all()).toHaveLength(2)
    } finally {
      close()
    }
  })

  it.each([
    ['a `movie` row with a `tvdb:` media_id', 'movie', 'tvdb:81189'],
    ['a `show` row with a `tmdb:` media_id', 'show', 'tmdb:27205'],
    // No `video` arm at all in the CHECK, exactly as in `bad_files`: a video
    // has no indexer release behind it.
    ['a `video` row', 'video', 'video:V1StGXR8_Z5'],
  ])(
    '`media_file_releases_media_id_matches_type` rejects %s',
    (_label, type, id) => {
      const { db, close } = createTestDb()
      try {
        expect(() =>
          db
            .insert(mediaFileReleases)
            .values({
              mediaId: id,
              mediaType: type as 'movie' | 'show' | 'video',
              releaseGuid: 'indexer://abc',
              upstreamFileId: 42,
            })
            .run(),
        ).toThrow(/CHECK constraint failed/)
      } finally {
        close()
      }
    },
  )

  it('`media_file_releases_episode_only_for_shows` rejects an `episodeId` on a movie row', () => {
    const { db, close } = createTestDb()
    try {
      expect(() =>
        db
          .insert(mediaFileReleases)
          .values({
            episodeId: 4821,
            mediaId: 'tmdb:27205',
            mediaType: 'movie',
            releaseGuid: 'indexer://abc',
            upstreamFileId: 42,
          })
          .run(),
      ).toThrow(/CHECK constraint failed/)
    } finally {
      close()
    }
  })

  it('creates both `media_file_releases` indexes', () => {
    const { sqlite, close } = createTestDb()
    try {
      const indexNames = sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'media_file_releases' AND name NOT LIKE 'sqlite_%'`,
        )
        .all()
        .map(row => (row as { name: string }).name)
        .sort()

      expect(indexNames).toEqual([
        'media_file_releases_media_id_idx',
        'media_file_releases_type_file_idx',
      ])
    } finally {
      close()
    }
  })
})
