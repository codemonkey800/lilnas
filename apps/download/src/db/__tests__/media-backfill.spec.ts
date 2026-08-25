import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { applyPragmas } from 'src/db/pragmas'
import * as schema from 'src/db/schema'
import { jobs, videos } from 'src/db/schema'

import { applyMigrationFiles, applyRemainingMigrationFiles } from './test-utils'

// Applies the real migration `0002`/`0003` files against hand-seeded legacy
// rows (plan §2.3) - the only way to exercise the backfill against the
// pre-media-id `jobs` shape, since `createTestDb()` always applies every
// migration and drizzle's typed insert API can't target an intermediate
// schema state.
interface LegacyJobInput {
  createdAt: number
  description?: string | null
  downloadUrls?: string[] | null
  id: string
  timeRange?: { end: string; start: string } | null
  title?: string | null
  type: 'movie' | 'show' | 'video'
  updatedAt: number
  url: string
}

function seedLegacyJob(
  sqlite: BetterSqlite3.Database,
  input: LegacyJobInput,
): void {
  sqlite
    .prepare(
      `INSERT INTO jobs
         (id, type, status, origin, hidden_attribution, url, title, description, time_range, download_urls, created_at, updated_at)
       VALUES
         (@id, @type, 'completed', 'service', 0, @url, @title, @description, @timeRange, @downloadUrls, @createdAt, @updatedAt)`,
    )
    .run({
      createdAt: input.createdAt,
      description: input.description ?? null,
      downloadUrls: input.downloadUrls
        ? JSON.stringify(input.downloadUrls)
        : null,
      id: input.id,
      timeRange: input.timeRange ? JSON.stringify(input.timeRange) : null,
      title: input.title ?? null,
      type: input.type,
      updatedAt: input.updatedAt,
      url: input.url,
    })
}

const PRE_BACKFILL_TAGS = ['0000_late_reavers', '0001_daffy_mordo']
const BACKFILL_TAGS = [
  '0002_sticky_miss_america',
  '0003_backfill_videos_and_media_ids',
]

function setUpPreBackfillDb(seed: (sqlite: BetterSqlite3.Database) => void) {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  applyMigrationFiles(sqlite, PRE_BACKFILL_TAGS)
  seed(sqlite)
  applyMigrationFiles(sqlite, BACKFILL_TAGS)
  // The assertions below read through the *current* drizzle schema, so the
  // table has to be brought up to it - stopping at 0003 would leave every
  // column added since (Phase 4's `jobs.scope`) missing from the table but
  // present in the SELECT list. The backfill has already run by this point,
  // so the later migrations only reshape what it produced.
  applyRemainingMigrationFiles(sqlite, [...PRE_BACKFILL_TAGS, ...BACKFILL_TAGS])
  const db = drizzle(sqlite, { schema })
  return { close: () => sqlite.close(), db, sqlite }
}

describe('media backfill (migrations 0002 + 0003)', () => {
  it('creates two distinct `videos` rows for a full-length download and a clip of the same URL', () => {
    const { close, db } = setUpPreBackfillDb(sqlite => {
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-full',
        title: 'Full',
        type: 'video',
        updatedAt: 1000,
        url: 'https://example.com/a',
      })
      seedLegacyJob(sqlite, {
        createdAt: 2000,
        id: 'job-clip',
        timeRange: { end: '00:01:00', start: '00:00:10' },
        title: 'Clip',
        type: 'video',
        updatedAt: 2000,
        url: 'https://example.com/a',
      })
    })
    try {
      const rows = db.select().from(videos).all()
      expect(rows).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('collapses two jobs downloading the same clip onto one `videos` row, created_at = the earlier job', () => {
    const timeRange = { end: '00:01:00', start: '00:00:10' }
    const { close, db } = setUpPreBackfillDb(sqlite => {
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-first',
        timeRange,
        title: 'First',
        type: 'video',
        updatedAt: 1000,
        url: 'https://example.com/a',
      })
      seedLegacyJob(sqlite, {
        createdAt: 2000,
        id: 'job-second',
        timeRange,
        title: 'Second',
        type: 'video',
        updatedAt: 2000,
        url: 'https://example.com/a',
      })
    })
    try {
      const videoRows = db.select().from(videos).all()
      expect(videoRows).toHaveLength(1)
      expect(videoRows[0]?.createdAt).toEqual(new Date(1000))

      const jobRows = db.select().from(jobs).all()
      const mediaIds = new Set(jobRows.map(row => row.mediaId))
      expect(mediaIds.size).toBe(1)
      expect([...mediaIds][0]).toBe(`video:${videoRows[0]?.id}`)
    } finally {
      close()
    }
  })

  it('produces two `videos` rows for two jobs sharing a URL with different time ranges', () => {
    const { close, db } = setUpPreBackfillDb(sqlite => {
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-a',
        timeRange: { end: '00:01:00', start: '00:00:00' },
        title: 'A',
        type: 'video',
        updatedAt: 1000,
        url: 'https://example.com/a',
      })
      seedLegacyJob(sqlite, {
        createdAt: 2000,
        id: 'job-b',
        timeRange: { end: '00:02:00', start: '00:01:30' },
        title: 'B',
        type: 'video',
        updatedAt: 2000,
        url: 'https://example.com/a',
      })
    })
    try {
      const videoRows = db.select().from(videos).all()
      expect(videoRows).toHaveLength(2)
      const jobRows = db.select().from(jobs).all()
      expect(new Set(jobRows.map(row => row.mediaId)).size).toBe(2)
    } finally {
      close()
    }
  })

  it("derives a movie job's media_id from its synthetic radarr:// url and writes no videos row", () => {
    const { close, db } = setUpPreBackfillDb(sqlite => {
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-movie',
        type: 'movie',
        updatedAt: 1000,
        url: 'radarr://tmdb/438631',
      })
    })
    try {
      const job = db.select().from(jobs).all()[0]
      expect(job?.mediaId).toBe('tmdb:438631')
      expect(db.select().from(videos).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  it("derives a show job's media_id from its synthetic sonarr:// url", () => {
    const { close, db } = setUpPreBackfillDb(sqlite => {
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-show',
        type: 'show',
        updatedAt: 1000,
        url: 'sonarr://tvdb/121361',
      })
    })
    try {
      const job = db.select().from(jobs).all()[0]
      expect(job?.mediaId).toBe('tvdb:121361')
    } finally {
      close()
    }
  })

  it('falls back the `videos.title` NOT NULL column to the source URL when the legacy job had no title', () => {
    const { close, db } = setUpPreBackfillDb(sqlite => {
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-no-title',
        title: null,
        type: 'video',
        updatedAt: 1000,
        url: 'https://example.com/no-title',
      })
    })
    try {
      const video = db.select().from(videos).all()[0]
      expect(video?.title).toBe('https://example.com/no-title')
    } finally {
      close()
    }
  })

  it('leaves every job with a non-NULL, well-formed media_id after the backfill', () => {
    const { close, db } = setUpPreBackfillDb(sqlite => {
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-movie',
        type: 'movie',
        updatedAt: 1000,
        url: 'radarr://tmdb/1',
      })
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-show',
        type: 'show',
        updatedAt: 1000,
        url: 'sonarr://tvdb/2',
      })
      seedLegacyJob(sqlite, {
        createdAt: 1000,
        id: 'job-video',
        title: 'A video',
        type: 'video',
        updatedAt: 1000,
        url: 'https://example.com/v',
      })
    })
    try {
      const rows = db.select().from(jobs).all()
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.mediaId).not.toBeNull()
        expect(row.mediaId).toMatch(/^(tmdb|tvdb|video):.+$/)
        expect(
          row.mediaId?.startsWith(
            `${row.type === 'movie' ? 'tmdb' : row.type === 'show' ? 'tvdb' : 'video'}:`,
          ),
        ).toBe(true)
      }
    } finally {
      close()
    }
  })
})
