import {
  type DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
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
// (write-only, re-derived from which attribution the record carries) and
// `updatedAt` is excluded (stamped fresh on every buildJobRow call).
// Everything else here must survive a row -> hydrateJobRow -> buildJobRow
// round trip unchanged.
const ROUND_TRIP_COLUMNS = [
  'completedAt',
  'createdAt',
  'discordUserId',
  'discordUsername',
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
    'video (discord origin)': {
      completedAt: null,
      createdAt: new Date('2026-01-06T00:00:00.000Z'),
      // A real snowflake, as a string: it exceeds
      // `Number.MAX_SAFE_INTEGER`, which is why the column is TEXT.
      discordUserId: '183948273649182736',
      discordUsername: 'jeremy',
      error: null,
      hiddenAttribution: false,
      id: 'video-discord',
      mediaId: 'video:v3',
      origin: 'discord',
      requesterEmail: null,
      requesterUserId: null,
      status: 'downloading',
      type: 'video',
      updatedAt: new Date('2026-01-06T00:00:00.000Z'),
    },
    'video (discord origin, hidden)': {
      completedAt: new Date('2026-01-07T00:00:00.000Z'),
      createdAt: new Date('2026-01-07T00:00:00.000Z'),
      discordUserId: '298374651029384756',
      discordUsername: 'sam.doe',
      error: null,
      hiddenAttribution: true,
      id: 'video-discord-hidden',
      mediaId: 'video:v4',
      origin: 'discord',
      requesterEmail: null,
      requesterUserId: null,
      status: 'completed',
      type: 'video',
      updatedAt: new Date('2026-01-07T00:00:00.000Z'),
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
    // Plan 022: a download someone started in Radarr's own UI, adopted as a
    // job. The same all-NULL attribution as a `service` row - only `origin`
    // tells the two apart.
    'movie (upstream origin)': {
      completedAt: null,
      createdAt: new Date('2026-01-08T00:00:00.000Z'),
      error: null,
      hiddenAttribution: false,
      id: 'movie-upstream',
      mediaId: 'tmdb:2',
      origin: 'upstream',
      requesterEmail: null,
      requesterUserId: null,
      status: 'downloading',
      type: 'movie',
      updatedAt: new Date('2026-01-08T00:00:00.000Z'),
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

  // ---- Phase 018: the Discord half of the codec ----

  it('reconstructs discordRequester as an object when both Discord columns are set', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures['video (discord origin)']!)

      expect(hydrateJobRow(row).discordRequester).toEqual({
        discordUserId: '183948273649182736',
        discordUsername: 'jeremy',
      })
      expect(hydrateJobRow(row).requester).toBeNull()
    } finally {
      close()
    }
  })

  it.each([
    'video (web origin, hidden, completed)',
    'video (service origin, minimal)',
  ])(
    'reconstructs discordRequester as null (not undefined) on a %s row',
    name => {
      const { db, close } = createTestDb()
      try {
        const row = insertAndRead(db, fixtures[name]!)
        expect(hydrateJobRow(row).discordRequester).toBeNull()
      } finally {
        close()
      }
    },
  )

  // `linkedDiscord` has no column behind it - it is resolved from `apps/auth`
  // at read time - so a hydrated record must state that as `null` rather than
  // leave the (required-but-nullable) key off the object entirely.
  it('always hydrates linkedDiscord as null - it has no column to come back from', () => {
    const { db, close } = createTestDb()
    try {
      for (const fixture of Object.values(fixtures)) {
        const row = insertAndRead(db, fixture)
        expect(hydrateJobRow(row).linkedDiscord).toBeNull()
      }
    } finally {
      close()
    }
  })

  // The origin derivation is the whole reason `origin` can be dropped on the
  // way out and rebuilt on the way in. Four arms now: plan 022 added
  // `upstream`, the one origin that comes back as a record field of its own.
  it.each([
    ['video (web origin, hidden, completed)', 'web'],
    ['video (service origin, minimal)', 'service'],
    ['video (discord origin)', 'discord'],
    ['movie (upstream origin)', 'upstream'],
  ] as const)('re-derives origin `%s` -> `%s`', (name, origin) => {
    const { db, close } = createTestDb()
    try {
      const row = insertAndRead(db, fixtures[name]!)
      expect(buildJobRow(hydrateJobRow(row)).origin).toBe(origin)
    } finally {
      close()
    }
  })

  // The round trip is only trustworthy if what it produces is still storable:
  // `jobs_origin_matches_requester` rejects a row whose derived `origin`
  // disagrees with its columns, so re-inserting a rebuilt row is a direct
  // test of the derivation against the DB's own opinion of it.
  it.each(Object.keys(fixtures))(
    're-inserts a rebuilt %s row without tripping the origin CHECK',
    name => {
      const { db, close } = createTestDb()
      try {
        const row = insertAndRead(db, fixtures[name]!)
        const rebuilt = buildJobRow(hydrateJobRow(row))

        expect(() =>
          db
            .insert(jobs)
            .values({ ...rebuilt, id: `${rebuilt.id}-copy` })
            .run(),
        ).not.toThrow()
      } finally {
        close()
      }
    },
  )

  // ---- Plan 022: `startedUpstream` <-> `origin = 'upstream'` ----

  describe('startedUpstream', () => {
    // An adopted Radarr download as the poller would hand it over: no
    // requester of either kind, and the flag saying who started it instead.
    const adopted: DownloadJobRecord = {
      completedAt: null,
      createdAt: '2026-01-08T00:00:00.000Z',
      discordRequester: null,
      hiddenAttribution: false,
      id: 'movie-adopted',
      linkedDiscord: null,
      mediaId: 'tmdb:2',
      requester: null,
      startedUpstream: true,
      status: DownloadJobStatus.Downloading,
      type: DownloadType.Movie,
      updatedAt: '2026-01-08T00:00:00.000Z',
    }

    it('derives origin `upstream` for a requester-less job that Radarr/Sonarr started', () => {
      expect(buildJobRow(adopted)).toMatchObject({
        discordUserId: null,
        discordUsername: null,
        origin: 'upstream',
        requesterEmail: null,
        requesterUserId: null,
      })
    })

    // A person's attribution always wins over the flag - and has to, since
    // the CHECK would reject an `upstream` row carrying one.
    it.each([
      [
        'requester',
        { requester: { email: 'alice@example.com', userId: 'user_1' } },
        'web',
      ],
      [
        'discordRequester',
        {
          discordRequester: {
            discordUserId: '183948273649182736',
            discordUsername: 'jeremy',
          },
        },
        'discord',
      ],
    ] as const)(
      'lets %s win over startedUpstream',
      (_label, attribution, origin) => {
        expect(buildJobRow({ ...adopted, ...attribution }).origin).toBe(origin)
      },
    )

    it('derives `service`, not `upstream`, when the flag is absent or false', () => {
      const unflagged: DownloadJobRecord = { ...adopted }
      delete unflagged.startedUpstream

      expect(buildJobRow(unflagged).origin).toBe('service')
      expect(buildJobRow({ ...adopted, startedUpstream: false }).origin).toBe(
        'service',
      )
    })

    it('stores an `upstream` row the origin CHECK accepts, and hydrates it back to startedUpstream: true', () => {
      const { db, close } = createTestDb()
      try {
        const row = insertAndRead(db, buildJobRow(adopted))

        expect(row.origin).toBe('upstream')
        expect(hydrateJobRow(row).startedUpstream).toBe(true)
      } finally {
        close()
      }
    })

    // Absent, not `false`: the key is optional on the wire, and a `false`
    // on every other job would be noise in every payload.
    it.each(
      Object.keys(fixtures).filter(name => name !== 'movie (upstream origin)'),
    )('leaves startedUpstream off a hydrated %s row entirely', name => {
      const { db, close } = createTestDb()
      try {
        const row = insertAndRead(db, fixtures[name]!)
        expect(hydrateJobRow(row)).not.toHaveProperty('startedUpstream')
      } finally {
        close()
      }
    })
  })
})
