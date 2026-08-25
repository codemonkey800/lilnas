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
  'scope',
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
    },
    'show (scoped to one episode)': {
      completedAt: null,
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
      error: null,
      hiddenAttribution: false,
      id: 'show-scoped',
      mediaId: 'tvdb:2',
      origin: 'service',
      requesterEmail: null,
      requesterUserId: null,
      scope: { episodeId: 4412, episodeNumber: 5, seasonNumber: 3 },
      status: 'searching',
      type: 'show',
      updatedAt: new Date('2026-01-04T00:00:00.000Z'),
    },
    'show (scoped to one season)': {
      completedAt: null,
      createdAt: new Date('2026-01-05T00:00:00.000Z'),
      error: null,
      hiddenAttribution: false,
      id: 'show-season',
      mediaId: 'tvdb:3',
      origin: 'service',
      requesterEmail: null,
      requesterUserId: null,
      scope: { seasonNumber: 0 },
      status: 'searching',
      type: 'show',
      updatedAt: new Date('2026-01-05T00:00:00.000Z'),
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

  // Deliberately asymmetric with `completedAt` above: `scope` uses
  // `undefined` on the record (like `error` does) and NULL in the column, so
  // the two directions map rather than pass a value through.
  it('hydrates a NULL scope to undefined, and undefined back to NULL', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['show (web origin, errored)']!)
      const record = hydrateJobRow(row)

      expect(record.scope).toBeUndefined()
      expect(buildJobRow(record).scope).toBeNull()
    } finally {
      close()
    }
  })

  it('hydrates a stored scope back into a plain object', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['show (scoped to one episode)']!)

      expect(hydrateJobRow(row).scope).toEqual({
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      })
    } finally {
      close()
    }
  })

  // Season 0 is specials, and `0` is the one season number a truthiness
  // check would silently turn into "no scope".
  it('keeps a season-0 scope through the round trip', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['show (scoped to one season)']!)

      expect(buildJobRow(hydrateJobRow(row)).scope).toEqual({ seasonNumber: 0 })
    } finally {
      close()
    }
  })
})
