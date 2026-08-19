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

// Everything except `origin` (dropped by hydrateJobRow - see its own
// comment) and the two timestamp columns (buildJobRow doesn't emit
// `createdAt` at all, and stamps `updatedAt` fresh on every call) must
// survive a row -> hydrateJobRow -> buildJobRow round trip unchanged.
function withoutRoundTripExclusions(row: RowInsert | JobRow) {
  const {
    createdAt: _createdAt,
    origin: _origin,
    updatedAt: _updatedAt,
    ...rest
  } = row as JobRow
  // Referenced only to satisfy no-unused-vars - see the destructure above.
  void _createdAt
  void _origin
  void _updatedAt
  return rest
}

describe('job-row codec', () => {
  const fixtures: Record<string, RowInsert> = {
    'video-full (web origin, hidden)': {
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      description: 'a video description',
      downloadUrls: ['https://example.com/a.mp4'],
      error: null,
      filePath: null,
      hiddenAttribution: true,
      id: 'video-full',
      mediaTitle: null,
      origin: 'web',
      overview: null,
      posterUrl: null,
      queueSnapshot: null,
      radarrId: null,
      requesterEmail: 'alice@example.com',
      requesterUserId: 'user_1',
      sonarrId: null,
      status: 'completed',
      timeRange: { start: '00:00:00', end: '00:01:00' },
      title: 'A video',
      type: 'video',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      url: 'https://example.com/video',
    },
    'video-minimal (service origin)': {
      completedAt: null,
      description: null,
      downloadUrls: null,
      error: null,
      filePath: null,
      hiddenAttribution: false,
      id: 'video-minimal',
      mediaTitle: null,
      origin: 'service',
      overview: null,
      posterUrl: null,
      queueSnapshot: null,
      radarrId: null,
      requesterEmail: null,
      requesterUserId: null,
      sonarrId: null,
      status: 'pending',
      timeRange: null,
      title: null,
      type: 'video',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      url: 'https://example.com/video-minimal',
    },
    'movie-full (web origin)': {
      completedAt: new Date('2026-01-02T00:00:00.000Z'),
      description: 'a movie description',
      downloadUrls: null,
      error: null,
      filePath: '/movies/a.mkv',
      hiddenAttribution: false,
      id: 'movie-full',
      mediaTitle: 'A Movie',
      origin: 'web',
      overview: 'a movie overview',
      posterUrl: 'https://example.com/poster.jpg',
      queueSnapshot: { progress: 42, status: 'downloading' },
      radarrId: 7,
      requesterEmail: 'bob@example.com',
      requesterUserId: 'user_2',
      sonarrId: null,
      status: 'downloading',
      timeRange: null,
      title: 'A Movie Title',
      type: 'movie',
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      url: 'radarr://tmdb/1',
    },
    'show-full (web origin)': {
      completedAt: null,
      description: 'a show description',
      downloadUrls: null,
      error: 'transient error',
      filePath: '/shows/a',
      hiddenAttribution: false,
      id: 'show-full',
      mediaTitle: 'A Show',
      origin: 'web',
      overview: 'a show overview',
      posterUrl: 'https://example.com/show-poster.jpg',
      queueSnapshot: { progress: 10, timeLeft: '5m' },
      radarrId: null,
      requesterEmail: 'carol@example.com',
      requesterUserId: 'user_3',
      sonarrId: 9,
      status: 'importing',
      timeRange: null,
      title: 'A Show Title',
      type: 'show',
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      url: 'sonarr://tvdb/1',
    },
    'service-origin (show, no requester)': {
      completedAt: null,
      description: null,
      downloadUrls: null,
      error: null,
      filePath: null,
      hiddenAttribution: false,
      id: 'show-service-origin',
      mediaTitle: 'A Service Show',
      origin: 'service',
      overview: null,
      posterUrl: null,
      queueSnapshot: null,
      radarrId: null,
      requesterEmail: null,
      requesterUserId: null,
      sonarrId: 11,
      status: 'searching',
      timeRange: null,
      title: null,
      type: 'show',
      updatedAt: new Date('2026-01-04T00:00:00.000Z'),
      url: 'sonarr://tvdb/2',
    },
    'web-origin (video, not hidden)': {
      completedAt: null,
      description: null,
      downloadUrls: ['https://example.com/b.mp4'],
      error: null,
      filePath: null,
      hiddenAttribution: false,
      id: 'video-web-origin',
      mediaTitle: null,
      origin: 'web',
      overview: null,
      posterUrl: null,
      queueSnapshot: null,
      radarrId: null,
      requesterEmail: 'dave@example.com',
      requesterUserId: 'user_4',
      sonarrId: null,
      status: 'uploading',
      timeRange: { start: '00:00:05', end: '00:00:10' },
      title: null,
      type: 'video',
      updatedAt: new Date('2026-01-05T00:00:00.000Z'),
      url: 'https://example.com/web-origin',
    },
  }

  it.each(Object.entries(fixtures))(
    'round-trips %s through hydrateJobRow -> buildJobRow, modulo createdAt/updatedAt/origin',
    (_name, fixture) => {
      const { db, close } = createTestDb()
      try {
        const row = insertAndRead(db, fixture)

        const job = hydrateJobRow(row)
        const rebuilt = buildJobRow(job)

        expect(withoutRoundTripExclusions(rebuilt)).toEqual(
          withoutRoundTripExclusions(row),
        )
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
      const row = insertAndRead(db, fixtures['video-minimal (service origin)']!)
      const job = hydrateJobRow(row)
      expect(job.requester).toBeNull()
    } finally {
      close()
    }
  })

  it('reconstructs requester as an object when both requester columns are set', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['movie-full (web origin)']!)
      const job = hydrateJobRow(row)
      expect(job.requester).toEqual({
        email: 'bob@example.com',
        userId: 'user_2',
      })
    } finally {
      close()
    }
  })

  it('maps every null optional column to undefined (video-minimal)', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['video-minimal (service origin)']!)
      const job = hydrateJobRow(row)

      if (job.type !== 'video') throw new Error('expected a video job')
      expect(job.completedAt).toBeUndefined()
      expect(job.description).toBeUndefined()
      expect(job.downloadUrls).toBeUndefined()
      expect(job.error).toBeUndefined()
      expect(job.timeRange).toBeUndefined()
      expect(job.title).toBeUndefined()
    } finally {
      close()
    }
  })

  it('ignores hiddenAttribution on a movie row and re-serializes it as false', () => {
    const { sqlite, db, close } = createTestDb()
    try {
      // Inserted via raw SQL rather than drizzle's typed insert - the
      // `hidden_attribution` column has no per-type constraint at the DB
      // layer even though it's video-only on the domain types, so this
      // simulates a row that (in practice) should never occur but must
      // still hydrate safely if it did.
      const nowMs = Date.now()
      sqlite
        .prepare(
          `INSERT INTO jobs (id, type, status, origin, hidden_attribution, url, created_at, updated_at)
           VALUES (?, 'movie', 'requested', 'service', 1, ?, ?, ?)`,
        )
        .run('movie-hidden-flag', 'radarr://tmdb/99', nowMs, nowMs)

      const row = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'movie-hidden-flag'))
        .all()[0]
      if (!row) throw new Error('failed to read back raw-inserted row')
      expect(row.hiddenAttribution).toBe(true)

      const job = hydrateJobRow(row)
      expect(job).not.toHaveProperty('hiddenAttribution')

      const rebuilt = buildJobRow(job)
      expect(rebuilt.hiddenAttribution).toBe(false)
    } finally {
      close()
    }
  })
})
