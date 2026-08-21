import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { eq } from 'drizzle-orm'

import { buildJobRow, hydrateJobRow } from 'src/db/job-row'
import { type JobRow, jobs } from 'src/db/schema'

import { createTestDb } from './test-utils'

type RowInsert = typeof jobs.$inferInsert

function insertAndRead(
  db: ReturnType<typeof createTestDb>['db'],
  row: RowInsert,
): JobRow {
  db.insert(jobs).values(row).run()
  const inserted = db.select().from(jobs).where(eq(jobs.id, row.id)).all()[0]
  if (!inserted) {
    throw new Error(`failed to insert/read back test row '${row.id}'`)
  }
  return inserted
}

// The columns a `DownloadJobRecord` actually carries. `origin` is excluded
// (write-only, re-derived from `requester`) and `updatedAt` is excluded
// (stamped fresh on every buildJobRow call). Everything else here must
// survive a row -> hydrateJobRow -> buildJobRow round trip unchanged.
const ROUND_TRIP_COLUMNS = [
  'completedAt',
  'createdAt',
  'error',
  'hiddenAttribution',
  'id',
  'mediaId',
  'requesterEmail',
  'requesterUserId',
  'status',
  'type',
] as const

function roundTripSubset(row: RowInsert | JobRow) {
  return Object.fromEntries(
    ROUND_TRIP_COLUMNS.map(key => [key, (row as JobRow)[key]]),
  )
}

describe('job-row codec', () => {
  const fixtures: Record<string, RowInsert> = {
    'video (web origin, hidden, completed)': {
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      error: null,
      hiddenAttribution: true,
      id: 'video-full',
      mediaId: 'video:v1',
      origin: 'web',
      requesterEmail: 'alice@example.com',
      requesterUserId: 'user_1',
      status: 'completed',
      type: 'video',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      url: 'video:v1',
    },
    'video (service origin, minimal)': {
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      error: null,
      hiddenAttribution: false,
      id: 'video-minimal',
      mediaId: 'video:v2',
      origin: 'service',
      requesterEmail: null,
      requesterUserId: null,
      status: 'pending',
      type: 'video',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      url: 'video:v2',
    },
    'movie (web origin)': {
      completedAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      error: null,
      hiddenAttribution: false,
      id: 'movie-full',
      mediaId: 'tmdb:1',
      origin: 'web',
      requesterEmail: 'bob@example.com',
      requesterUserId: 'user_2',
      status: 'downloading',
      type: 'movie',
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      url: 'tmdb:1',
    },
    'show (web origin, errored)': {
      completedAt: null,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      error: 'transient error',
      hiddenAttribution: false,
      id: 'show-full',
      mediaId: 'tvdb:1',
      origin: 'web',
      requesterEmail: 'carol@example.com',
      requesterUserId: 'user_3',
      status: 'importing',
      type: 'show',
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      url: 'tvdb:1',
    },
  }

  it.each(Object.entries(fixtures))(
    'round-trips %s through hydrateJobRow -> buildJobRow, modulo updatedAt/origin',
    (_name, fixture) => {
      const { db, close } = createTestDb()
      try {
        const row = insertAndRead(db, fixture)
        const rebuilt = buildJobRow(hydrateJobRow(row))

        expect(roundTripSubset(rebuilt)).toEqual(roundTripSubset(row))
        // The property that makes dropping `origin` on hydrate safe: it's
        // fully re-derivable from `requester`'s presence on the way back.
        expect(rebuilt.origin).toBe(row.origin)
      } finally {
        close()
      }
    },
  )

  it('reconstructs requester as null (not undefined) when both requester columns are null', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(
        db,
        fixtures['video (service origin, minimal)']!,
      )
      expect(hydrateJobRow(row).requester).toBeNull()
    } finally {
      close()
    }
  })

  it('reconstructs requester as an object when both requester columns are set', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['movie (web origin)']!)
      expect(hydrateJobRow(row).requester).toEqual({
        email: 'bob@example.com',
        userId: 'user_2',
      })
    } finally {
      close()
    }
  })

  it('carries timestamps as ISO strings, not Dates', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(
        db,
        fixtures['video (web origin, hidden, completed)']!,
      )
      const record = hydrateJobRow(row)

      expect(record.createdAt).toBe('2026-01-01T00:00:00.000Z')
      expect(record.completedAt).toBe('2026-01-01T00:00:00.000Z')
      expect(record.status).toBe(DownloadJobStatus.Completed)
      expect(record.type).toBe(DownloadType.Video)
    } finally {
      close()
    }
  })

  it('leaves completedAt null (not undefined) when the column is null', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['show (web origin, errored)']!)
      expect(hydrateJobRow(row).completedAt).toBeNull()
    } finally {
      close()
    }
  })

  // The backfill migration populates `media_id` for every pre-existing row,
  // but a row written between the schema migration and the backfill (or by
  // an older build mid-deploy) can still have it null. Recovering the key
  // from the legacy synthetic `url` means such a row hydrates correctly
  // rather than resolving to an empty media key.
  it('recovers media_id from a legacy synthetic url when the column is null', () => {
    const { sqlite, db, close } = createTestDb()
    try {
      const nowMs = Date.now()
      sqlite
        .prepare(
          `INSERT INTO jobs (id, type, status, origin, hidden_attribution, url, created_at, updated_at)
           VALUES (?, 'movie', 'requested', 'service', 0, ?, ?, ?)`,
        )
        .run('legacy-movie', 'radarr://tmdb/438631', nowMs, nowMs)

      const row = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'legacy-movie'))
        .all()[0]
      if (!row) throw new Error('failed to read back raw-inserted row')
      expect(row.mediaId).toBeNull()

      expect(hydrateJobRow(row).mediaId).toBe('tmdb:438631')
    } finally {
      close()
    }
  })

  // The twelve columns the next migration deletes are written as explicit
  // nulls rather than omitted, because drizzle's upsert `set:` makes every
  // key optional - omitting them would leave a pre-Media row's stale
  // title/poster/overview in place forever.
  it('nulls every legacy media column so an upsert cannot leave a stale value', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['movie (web origin)']!)
      const rebuilt = buildJobRow(hydrateJobRow(row))

      for (const column of [
        'description',
        'downloadUrls',
        'filePath',
        'mediaTitle',
        'overview',
        'posterUrl',
        'queueSnapshot',
        'radarrId',
        'sonarrId',
        'timeRange',
        'title',
      ] as const) {
        expect(rebuilt[column]).toBeNull()
      }

      // `url` is the one legacy column that's still NOT NULL, so it carries
      // the media key. Nothing reads it.
      expect(rebuilt.url).toBe('tmdb:1')
    } finally {
      close()
    }
  })
})
