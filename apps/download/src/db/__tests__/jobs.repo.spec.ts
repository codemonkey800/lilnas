import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { Db } from 'src/db/db.service'
import type { DailyJobCount, RequesterScope } from 'src/db/jobs.repo'
import {
  countCompletedJobsByMediaIds,
  countJobsByDay,
  countJobsByRequester,
  countJobsByStatus,
  countJobsByType,
  getRequesterActivityBounds,
  isRequesterScoped,
  listJobsByStatus,
  listJobsPage,
  listLatestJobsForMediaIds,
  listOpenJobs,
} from 'src/db/jobs.repo'
import type { ListCursor } from 'src/db/list-cursor'
import { jobs } from 'src/db/schema'

import { createTestDb } from './test-utils'

type RowInsert = typeof jobs.$inferInsert

function seedJob(db: Db, overrides: Partial<RowInsert> & { id: string }): void {
  const type = overrides.type ?? 'video'
  const mediaId =
    type === 'movie'
      ? `tmdb:${overrides.id}`
      : type === 'show'
        ? `tvdb:${overrides.id}`
        : `video:${overrides.id}`

  db.insert(jobs)
    .values({
      mediaId,
      origin: 'service',
      status: 'completed',
      type: 'video',
      ...overrides,
    })
    .run()
}

const FILTER_KEY = 'test-filter-key'
const T0 = new Date('2026-01-01T00:00:00.000Z').getTime()

function cursorFrom(row: { createdAt: Date; id: string }): ListCursor {
  return {
    sortKeyMs: row.createdAt.getTime(),
    filterKey: FILTER_KEY,
    id: row.id,
  }
}

describe('listJobsPage', () => {
  it('returns rows newest-first with hasMore and the full filtered total', () => {
    const { db, close } = createTestDb()
    try {
      for (let i = 0; i < 5; i++) {
        seedJob(db, { createdAt: new Date(T0 + i * 1000), id: `job-${i}` })
      }

      const page = listJobsPage(db, { filter: {}, limit: 3 })

      expect(page.rows.map(r => r.id)).toEqual(['job-4', 'job-3', 'job-2'])
      expect(page.hasMore).toBe(true)
      expect(page.total).toBe(5)
    } finally {
      close()
    }
  })

  it('pages through a cursor without a bind error, returning exactly the complement of page 1', () => {
    const { db, close } = createTestDb()
    try {
      for (let i = 0; i < 5; i++) {
        seedJob(db, { createdAt: new Date(T0 + i * 1000), id: `job-${i}` })
      }

      const page1 = listJobsPage(db, { filter: {}, limit: 3 })
      const lastRow = page1.rows.at(-1)
      if (!lastRow) throw new Error('expected page1 to have rows')

      expect(() =>
        listJobsPage(db, {
          cursor: cursorFrom(lastRow),
          filter: {},
          limit: 3,
        }),
      ).not.toThrow()

      const page2 = listJobsPage(db, {
        cursor: cursorFrom(lastRow),
        filter: {},
        limit: 3,
      })

      expect(page2.rows.map(r => r.id)).toEqual(['job-1', 'job-0'])
      expect(page2.hasMore).toBe(false)
      expect(page2.total).toBe(5)

      const allIds = [...page1.rows, ...page2.rows].map(r => r.id)
      expect(new Set(allIds).size).toBe(5)
      expect(allIds.sort()).toEqual(
        ['job-0', 'job-1', 'job-2', 'job-3', 'job-4'].sort(),
      )
    } finally {
      close()
    }
  })

  it('paginates two rows sharing the same created_at without loss or duplication', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { createdAt: new Date(T0 + 1000), id: 'a' })
      seedJob(db, { createdAt: new Date(T0 + 2000), id: 'tie-a' })
      seedJob(db, { createdAt: new Date(T0 + 2000), id: 'tie-b' })
      seedJob(db, { createdAt: new Date(T0 + 3000), id: 'd' })

      const page1 = listJobsPage(db, { filter: {}, limit: 2 })
      expect(page1.rows.map(r => r.id)).toEqual(['d', 'tie-b'])
      expect(page1.hasMore).toBe(true)

      const lastRow = page1.rows.at(-1)
      if (!lastRow) throw new Error('expected page1 to have rows')

      const page2 = listJobsPage(db, {
        cursor: cursorFrom(lastRow),
        filter: {},
        limit: 2,
      })

      expect(page2.rows.map(r => r.id)).toEqual(['tie-a', 'a'])
      expect(page2.hasMore).toBe(false)
      expect(page2.total).toBe(4)
    } finally {
      close()
    }
  })

  it('narrows independently by status', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'completed-1', status: 'completed' })
      seedJob(db, { id: 'failed-1', status: 'failed' })
      seedJob(db, { id: 'downloading-1', status: 'downloading' })

      const page = listJobsPage(db, {
        filter: {
          statuses: [
            DownloadJobStatus.Completed,
            DownloadJobStatus.Downloading,
          ],
        },
        limit: 10,
      })

      expect(page.rows.map(r => r.id).sort()).toEqual([
        'completed-1',
        'downloading-1',
      ])
      expect(page.total).toBe(2)
    } finally {
      close()
    }
  })

  it('narrows independently by type (single)', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'video-1', type: 'video' })
      seedJob(db, { id: 'movie-1', type: 'movie' })

      const page = listJobsPage(db, {
        filter: { types: [DownloadType.Movie] },
        limit: 10,
      })

      expect(page.rows.map(r => r.id)).toEqual(['movie-1'])
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  it('narrows independently by type (multi, OR semantics)', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'video-1', type: 'video' })
      seedJob(db, { id: 'movie-1', type: 'movie' })
      seedJob(db, { id: 'show-1', type: 'show' })

      const page = listJobsPage(db, {
        filter: { types: [DownloadType.Movie, DownloadType.Video] },
        limit: 10,
      })

      expect(page.rows.map(r => r.id).sort()).toEqual(['movie-1', 'video-1'])
      expect(page.total).toBe(2)
    } finally {
      close()
    }
  })

  it('narrows independently by requesterEmail, case-insensitively', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        id: 'alice-job',
        origin: 'web',
        requesterEmail: 'Alice@Example.com',
        requesterUserId: 'u1',
      })
      seedJob(db, {
        id: 'bob-job',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
      })

      const page = listJobsPage(db, {
        filter: { requesterEmail: 'alice@example.com' },
        limit: 10,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-job'])
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  it('narrows independently by createdFrom/createdTo, inclusive on both boundaries', () => {
    const { db, close } = createTestDb()
    try {
      const boundary = new Date(T0)
      seedJob(db, { createdAt: new Date(T0 - 1000), id: 'before' })
      seedJob(db, { createdAt: boundary, id: 'on-boundary' })
      seedJob(db, { createdAt: new Date(T0 + 1000), id: 'after' })

      const page = listJobsPage(db, {
        filter: { createdFrom: boundary, createdTo: boundary },
        limit: 10,
      })

      expect(page.rows.map(r => r.id)).toEqual(['on-boundary'])
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  it('excludeHiddenVideos drops a hidden video but keeps a hidden-flagged movie and a non-hidden video', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        hiddenAttribution: true,
        id: 'hidden-video',
        type: 'video',
      })
      seedJob(db, {
        hiddenAttribution: false,
        id: 'visible-video',
        type: 'video',
      })
      // Semantically shouldn't occur (hiddenAttribution is video-only on the
      // domain types), but the column has no per-type DB constraint - the
      // exclusion predicate must only ever key off `type = 'video'`.
      seedJob(db, {
        hiddenAttribution: true,
        id: 'hidden-flag-movie',
        type: 'movie',
      })

      const page = listJobsPage(db, {
        filter: { excludeHiddenVideos: true },
        limit: 10,
      })

      expect(page.rows.map(r => r.id).sort()).toEqual([
        'hidden-flag-movie',
        'visible-video',
      ])
      expect(page.total).toBe(2)
    } finally {
      close()
    }
  })

  it('returns an empty page for an empty table', () => {
    const { db, close } = createTestDb()
    try {
      const page = listJobsPage(db, { filter: {}, limit: 10 })
      expect(page).toEqual({ hasMore: false, rows: [], total: 0 })
    } finally {
      close()
    }
  })
})

describe('countJobsByRequester', () => {
  it('groups by requester email with correct counts', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        id: 'alice-1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })
      seedJob(db, {
        id: 'alice-2',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })
      seedJob(db, {
        id: 'bob-1',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
      })

      const result = countJobsByRequester(db, {})

      expect(result.sort((a, b) => a.email.localeCompare(b.email))).toEqual([
        { count: 2, email: 'alice@example.com' },
        { count: 1, email: 'bob@example.com' },
      ])
    } finally {
      close()
    }
  })

  it('excludes service-origin rows (no requester) entirely', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'service-1', origin: 'service' })
      seedJob(db, {
        id: 'alice-1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })

      const result = countJobsByRequester(db, {})

      expect(result).toEqual([{ count: 1, email: 'alice@example.com' }])
    } finally {
      close()
    }
  })

  it('excludes a requester whose only row is a hidden video when excludeHiddenVideos is set', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        hiddenAttribution: true,
        id: 'alice-hidden',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'video',
      })
      seedJob(db, {
        id: 'bob-1',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
      })

      const withoutGuard = countJobsByRequester(db, {})
      const withGuard = countJobsByRequester(db, { excludeHiddenVideos: true })

      expect(withoutGuard.map(r => r.email).sort()).toEqual([
        'alice@example.com',
        'bob@example.com',
      ])
      expect(withGuard.map(r => r.email)).toEqual(['bob@example.com'])
    } finally {
      close()
    }
  })

  it('narrows by the date range', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0 - 10_000),
        id: 'before',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'within',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
      })

      const result = countJobsByRequester(db, { createdFrom: new Date(T0) })

      expect(result).toEqual([{ count: 1, email: 'bob@example.com' }])
    } finally {
      close()
    }
  })
})

describe('countJobsByType', () => {
  it('groups by type with correct counts', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'video-1', type: 'video' })
      seedJob(db, { id: 'video-2', type: 'video' })
      seedJob(db, { id: 'movie-1', type: 'movie' })

      const result = countJobsByType(db, {})

      expect(result.sort((a, b) => a.type.localeCompare(b.type))).toEqual([
        { count: 1, type: DownloadType.Movie },
        { count: 2, type: DownloadType.Video },
      ])
    } finally {
      close()
    }
  })

  it('still counts a hidden video (no excludeHiddenVideos guard applies)', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { hiddenAttribution: true, id: 'hidden-1', type: 'video' })

      const result = countJobsByType(db, {})

      expect(result).toEqual([{ count: 1, type: DownloadType.Video }])
    } finally {
      close()
    }
  })

  it('narrows by the date range', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0 - 10_000),
        id: 'before',
        type: 'movie',
      })
      seedJob(db, { createdAt: new Date(T0), id: 'within', type: 'video' })

      const result = countJobsByType(db, { createdFrom: new Date(T0) })

      expect(result).toEqual([{ count: 1, type: DownloadType.Video }])
    } finally {
      close()
    }
  })
})

describe('countJobsByStatus', () => {
  it('groups by status with correct counts', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'completed-1', status: 'completed' })
      seedJob(db, { id: 'completed-2', status: 'completed' })
      seedJob(db, { id: 'failed-1', status: 'failed' })
      seedJob(db, { id: 'downloading-1', status: 'downloading' })

      const result = countJobsByStatus(db, {})

      expect(result.sort((a, b) => a.status.localeCompare(b.status))).toEqual([
        { count: 2, status: DownloadJobStatus.Completed },
        { count: 1, status: DownloadJobStatus.Downloading },
        { count: 1, status: DownloadJobStatus.Failed },
      ])
    } finally {
      close()
    }
  })

  it('omits statuses with no rows rather than zero-filling them', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'pending-1', status: 'pending' })

      const result = countJobsByStatus(db, {})

      expect(result).toEqual([{ count: 1, status: DownloadJobStatus.Pending }])
    } finally {
      close()
    }
  })

  it('narrows by the other filter dimensions it shares with the list query', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'movie-failed', status: 'failed', type: 'movie' })
      seedJob(db, { id: 'video-failed', status: 'failed', type: 'video' })
      seedJob(db, { id: 'video-completed', status: 'completed', type: 'video' })

      const result = countJobsByStatus(db, { types: [DownloadType.Video] })

      expect(result.sort((a, b) => a.status.localeCompare(b.status))).toEqual([
        { count: 1, status: DownloadJobStatus.Completed },
        { count: 1, status: DownloadJobStatus.Failed },
      ])
    } finally {
      close()
    }
  })

  it('narrows by createdFrom', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0 - 10_000),
        id: 'before',
        status: 'failed',
      })
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'within',
        status: 'completed',
      })

      const result = countJobsByStatus(db, { createdFrom: new Date(T0) })

      expect(result).toEqual([
        { count: 1, status: DownloadJobStatus.Completed },
      ])
    } finally {
      close()
    }
  })

  it('returns an empty array for an empty table', () => {
    const { db, close } = createTestDb()
    try {
      expect(countJobsByStatus(db, {})).toEqual([])
    } finally {
      close()
    }
  })
})

describe('countJobsByDay', () => {
  const DAY_1 = '2026-01-01'
  const DAY_2 = '2026-01-02'
  const at = (iso: string): Date => new Date(iso)

  // Rows come back ordered by day only, so the per-type order within a day is
  // whatever sqlite's grouping produces - sort before comparing membership.
  const byDayThenType = (a: DailyJobCount, b: DailyJobCount): number =>
    a.day.localeCompare(b.day) || a.type.localeCompare(b.type)

  it('buckets by UTC day and type, ordered by day ascending', () => {
    const { db, close } = createTestDb()
    try {
      // Seeded newest-first so the ascending day order in the result can only
      // come from the ORDER BY, not from insertion order.
      seedJob(db, {
        createdAt: at('2026-01-02T08:00:00.000Z'),
        id: 'd2-show',
        type: 'show',
      })
      seedJob(db, {
        createdAt: at('2026-01-02T00:00:00.000Z'),
        id: 'd2-video',
        type: 'video',
      })
      seedJob(db, {
        createdAt: at('2026-01-01T23:59:59.999Z'),
        id: 'd1-movie',
        type: 'movie',
      })
      seedJob(db, {
        createdAt: at('2026-01-01T12:00:00.000Z'),
        id: 'd1-video-b',
        type: 'video',
      })
      seedJob(db, {
        createdAt: at('2026-01-01T00:00:00.000Z'),
        id: 'd1-video-a',
        type: 'video',
      })

      const result = countJobsByDay(db, {})

      expect(result.map(r => r.day)).toEqual([DAY_1, DAY_1, DAY_2, DAY_2])
      expect([...result].sort(byDayThenType)).toEqual([
        { count: 1, day: DAY_1, type: DownloadType.Movie },
        { count: 2, day: DAY_1, type: DownloadType.Video },
        { count: 1, day: DAY_2, type: DownloadType.Show },
        { count: 1, day: DAY_2, type: DownloadType.Video },
      ])
      // A (day, type) pair with no rows is absent, not zero-filled.
      expect(
        result.some(r => r.day === DAY_2 && r.type === DownloadType.Movie),
      ).toBe(false)
    } finally {
      close()
    }
  })

  it('splits the UTC midnight boundary: 23:59:59.999Z and 00:00:00.000Z land on adjacent days', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: at('2026-01-01T23:59:59.999Z'),
        id: 'last-ms-of-day-1',
        type: 'video',
      })
      seedJob(db, {
        createdAt: at('2026-01-02T00:00:00.000Z'),
        id: 'first-ms-of-day-2',
        type: 'video',
      })

      const result = countJobsByDay(db, {})

      expect(result).toEqual([
        { count: 1, day: DAY_1, type: DownloadType.Video },
        { count: 1, day: DAY_2, type: DownloadType.Video },
      ])
    } finally {
      close()
    }
  })

  it('keeps day boundaries in UTC regardless of the host timezone', () => {
    const { db, close } = createTestDb()
    const originalTz = process.env.TZ
    try {
      // A UTC-13 zone: 2026-01-01T23:30Z is already 2026-01-02 locally there,
      // so a `'localtime'` modifier would move this row into DAY_2.
      process.env.TZ = 'Pacific/Kiritimati'
      seedJob(db, {
        createdAt: at('2026-01-01T23:30:00.000Z'),
        id: 'late-utc-day-1',
        type: 'video',
      })

      expect(countJobsByDay(db, {})).toEqual([
        { count: 1, day: DAY_1, type: DownloadType.Video },
      ])
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTz
      }
      close()
    }
  })

  it('windows by createdFrom, dropping earlier days entirely', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: at('2026-01-01T12:00:00.000Z'),
        id: 'd1-video',
        type: 'video',
      })
      seedJob(db, {
        createdAt: at('2026-01-02T12:00:00.000Z'),
        id: 'd2-movie',
        type: 'movie',
      })

      const result = countJobsByDay(db, {
        createdFrom: at('2026-01-02T00:00:00.000Z'),
      })

      expect(result).toEqual([
        { count: 1, day: DAY_2, type: DownloadType.Movie },
      ])
    } finally {
      close()
    }
  })

  it('windows by createdTo as well, inclusively', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: at('2026-01-01T23:59:59.999Z'),
        id: 'on-boundary',
        type: 'video',
      })
      seedJob(db, {
        createdAt: at('2026-01-02T00:00:00.000Z'),
        id: 'after-boundary',
        type: 'video',
      })

      const result = countJobsByDay(db, {
        createdTo: at('2026-01-01T23:59:59.999Z'),
      })

      expect(result).toEqual([
        { count: 1, day: DAY_1, type: DownloadType.Video },
      ])
    } finally {
      close()
    }
  })

  it('narrows by the non-date filter dimensions too', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: at('2026-01-01T01:00:00.000Z'),
        id: 'alice-1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'video',
      })
      seedJob(db, {
        createdAt: at('2026-01-01T02:00:00.000Z'),
        id: 'bob-1',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        type: 'video',
      })

      const result = countJobsByDay(db, {
        requesterEmail: 'alice@example.com',
      })

      expect(result).toEqual([
        { count: 1, day: DAY_1, type: DownloadType.Video },
      ])
    } finally {
      close()
    }
  })

  it('returns an empty array for an empty table', () => {
    const { db, close } = createTestDb()
    try {
      expect(countJobsByDay(db, {})).toEqual([])
    } finally {
      close()
    }
  })
})

describe('getRequesterActivityBounds', () => {
  it('returns both bounds null for a requester with no jobs', () => {
    const { db, close } = createTestDb()
    try {
      const result = getRequesterActivityBounds(db, {
        requesterEmail: 'nobody@example.com',
      })

      expect(result).toEqual({
        firstCreatedAtMs: null,
        lastCreatedAtMs: null,
      })
    } finally {
      close()
    }
  })

  it('returns the min and max createdAt across multiple jobs', () => {
    const { db, close } = createTestDb()
    try {
      for (const offset of [5_000, 0, 10_000]) {
        seedJob(db, {
          createdAt: new Date(T0 + offset),
          id: `alice-${offset}`,
          origin: 'web',
          requesterEmail: 'alice@example.com',
          requesterUserId: 'u1',
        })
      }

      const result = getRequesterActivityBounds(db, {
        requesterEmail: 'alice@example.com',
      })

      expect(result).toEqual({
        firstCreatedAtMs: T0,
        lastCreatedAtMs: T0 + 10_000,
      })
    } finally {
      close()
    }
  })

  it('matches the email case-insensitively', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'alice-1',
        origin: 'web',
        requesterEmail: 'Alice@Example.com',
        requesterUserId: 'u1',
      })

      const result = getRequesterActivityBounds(db, {
        requesterEmail: 'ALICE@example.COM',
      })

      expect(result).toEqual({
        firstCreatedAtMs: T0,
        lastCreatedAtMs: T0,
      })
    } finally {
      close()
    }
  })

  it("never counts another requester's jobs", () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'alice-1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 60_000),
        id: 'bob-1',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
      })

      const result = getRequesterActivityBounds(db, {
        requesterEmail: 'alice@example.com',
      })

      expect(result).toEqual({
        firstCreatedAtMs: T0,
        lastCreatedAtMs: T0,
      })
    } finally {
      close()
    }
  })

  it('includes hidden videos in the bounds', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'alice-visible',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'video',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 60_000),
        hiddenAttribution: true,
        id: 'alice-hidden',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'video',
      })

      const result = getRequesterActivityBounds(db, {
        requesterEmail: 'alice@example.com',
      })

      expect(result).toEqual({
        firstCreatedAtMs: T0,
        lastCreatedAtMs: T0 + 60_000,
      })
    } finally {
      close()
    }
  })
})

// Plan 017 §E2: `requesterEmail` and `requesterDiscordUserId` are two spellings
// of one person, so `buildJobWhere` OR-s them rather than AND-ing them. These
// exercise `listJobsPage` because it is the only caller that surfaces both the
// selected rows *and* the `total` computed from the same predicate - the two
// places a filter mistake shows up.
describe('buildJobWhere - requester arms', () => {
  const ALICE_SNOWFLAKE = '111111111111111111'
  const BOB_SNOWFLAKE = '222222222222222222'

  function seedAll(db: Db): void {
    seedJob(db, {
      createdAt: new Date(T0),
      id: 'alice-web',
      origin: 'web',
      requesterEmail: 'Alice@Example.com',
      requesterUserId: 'u-alice',
    })
    seedJob(db, {
      createdAt: new Date(T0 + 1_000),
      discordUserId: ALICE_SNOWFLAKE,
      discordUsername: 'alice',
      id: 'alice-discord',
      origin: 'discord',
    })
    seedJob(db, {
      createdAt: new Date(T0 + 2_000),
      id: 'bob-web',
      origin: 'web',
      requesterEmail: 'bob@example.com',
      requesterUserId: 'u-bob',
    })
    seedJob(db, {
      createdAt: new Date(T0 + 3_000),
      discordUserId: BOB_SNOWFLAKE,
      discordUsername: 'bob',
      id: 'bob-discord',
      origin: 'discord',
    })
    // NULL on both identity columns - neither arm can ever match it.
    seedJob(db, { createdAt: new Date(T0 + 4_000), id: 'service-job' })
  }

  it('matches only the email arm when no snowflake is given', () => {
    const { db, close } = createTestDb()
    try {
      seedAll(db)

      const page = listJobsPage(db, {
        filter: { requesterEmail: 'alice@example.com' },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-web'])
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  it('matches only the discord arm when no email is given', () => {
    const { db, close } = createTestDb()
    try {
      seedAll(db)

      const page = listJobsPage(db, {
        filter: { requesterDiscordUserId: ALICE_SNOWFLAKE },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-discord'])
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  // The headline behaviour: one person, two surfaces, one list. Note this
  // would return *nothing* if the two arms were AND-ed - the
  // `jobs_origin_matches_requester` CHECK makes them mutually exclusive per
  // row, so no row can satisfy both.
  it('unions both surfaces when given both arms', () => {
    const { db, close } = createTestDb()
    try {
      seedAll(db)

      const page = listJobsPage(db, {
        filter: {
          requesterDiscordUserId: ALICE_SNOWFLAKE,
          requesterEmail: 'alice@example.com',
        },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-discord', 'alice-web'])
      expect(page.total).toBe(2)
    } finally {
      close()
    }
  })

  it('keeps the email arm case-insensitive when OR-ed', () => {
    const { db, close } = createTestDb()
    try {
      seedAll(db)

      const page = listJobsPage(db, {
        filter: {
          requesterDiscordUserId: ALICE_SNOWFLAKE,
          requesterEmail: 'ALICE@EXAMPLE.COM',
        },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-discord', 'alice-web'])
    } finally {
      close()
    }
  })

  it('never leaks another identity through either arm', () => {
    const { db, close } = createTestDb()
    try {
      seedAll(db)

      const page = listJobsPage(db, {
        filter: {
          requesterDiscordUserId: ALICE_SNOWFLAKE,
          requesterEmail: 'alice@example.com',
        },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).not.toContain('bob-web')
      expect(page.rows.map(r => r.id)).not.toContain('bob-discord')
      // A service job has NULL in both columns, and no equality comparison
      // matches NULL - so a requester-scoped query necessarily excludes it.
      expect(page.rows.map(r => r.id)).not.toContain('service-job')
    } finally {
      close()
    }
  })

  // ⚠️ The attribution-oracle guard. `excludeHiddenVideos` was written for the
  // `requesterEmail` arm; it has to bite on the Discord arm just as hard, or a
  // requester-keyed lookup could still confirm "this person hid a video" from
  // a non-zero `total` even though every returned row is masked.
  it('applies excludeHiddenVideos to the discord arm, not just the email one', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        hiddenAttribution: true,
        id: 'alice-web-hidden',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u-alice',
        type: 'video',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 1_000),
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice',
        hiddenAttribution: true,
        id: 'alice-discord-hidden',
        origin: 'discord',
        type: 'video',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 2_000),
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice',
        id: 'alice-discord-visible',
        origin: 'discord',
        type: 'video',
      })

      const page = listJobsPage(db, {
        filter: {
          excludeHiddenVideos: true,
          requesterDiscordUserId: ALICE_SNOWFLAKE,
          requesterEmail: 'alice@example.com',
        },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-discord-visible'])
      // `total` is the oracle's other channel, and it has to agree.
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  // The guard is a type-only exclusion: movies/shows have no hiding toggle
  // (see attribution.ts), so a Discord-submitted movie stays visible.
  it('leaves a discord-submitted movie alone under excludeHiddenVideos', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice',
        id: 'alice-discord-movie',
        origin: 'discord',
        type: 'movie',
      })

      const page = listJobsPage(db, {
        filter: {
          excludeHiddenVideos: true,
          requesterDiscordUserId: ALICE_SNOWFLAKE,
        },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-discord-movie'])
    } finally {
      close()
    }
  })

  it('AND-s the OR-ed requester arms with the other filter dimensions', () => {
    const { db, close } = createTestDb()
    try {
      seedAll(db)
      seedJob(db, {
        createdAt: new Date(T0 + 5_000),
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice',
        id: 'alice-discord-failed',
        origin: 'discord',
        status: 'failed',
      })

      // Without the parentheses drizzle's `or()` adds, `status = 'failed'`
      // would bind to only the last OR arm and bob's rows would leak in.
      const page = listJobsPage(db, {
        filter: {
          requesterDiscordUserId: ALICE_SNOWFLAKE,
          requesterEmail: 'alice@example.com',
          statuses: [DownloadJobStatus.Failed],
        },
        limit: 24,
      })

      expect(page.rows.map(r => r.id)).toEqual(['alice-discord-failed'])
      expect(page.total).toBe(1)
    } finally {
      close()
    }
  })

  it("widens getRequesterActivityBounds across both of one person's surfaces", () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0 + 60_000),
        id: 'alice-web',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u-alice',
      })
      seedJob(db, {
        createdAt: new Date(T0),
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice',
        id: 'alice-discord',
        origin: 'discord',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 120_000),
        discordUserId: BOB_SNOWFLAKE,
        discordUsername: 'bob',
        id: 'bob-discord',
        origin: 'discord',
      })

      const result = getRequesterActivityBounds(db, {
        requesterDiscordUserId: ALICE_SNOWFLAKE,
        requesterEmail: 'alice@example.com',
      })

      expect(result).toEqual({
        firstCreatedAtMs: T0,
        lastCreatedAtMs: T0 + 60_000,
      })
    } finally {
      close()
    }
  })
})

describe('isRequesterScoped', () => {
  it.each([
    ['neither arm', {}, false],
    ['the email arm', { requesterEmail: 'alice@example.com' }, true],
    ['the discord arm', { requesterDiscordUserId: '111111111111111111' }, true],
    [
      'both arms',
      {
        requesterDiscordUserId: '111111111111111111',
        requesterEmail: 'alice@example.com',
      },
      true,
    ],
  ])('reports %s as %p', (_label, scope: RequesterScope, expected) => {
    expect(isRequesterScoped(scope)).toBe(expected)
  })
})

/**
 * The gallery's two job-log queries (plan 021): `countCompletedJobsByMediaIds`
 * joins the library's titles onto the job log - the download count, and for a
 * requester-scoped gallery the "titles this requester has" join - and
 * `listLatestJobsForMediaIds` fetches the newest job behind each title under
 * the *same* filter. Together they are where `GalleryItem.downloadCount`,
 * `lastRequester` and `lastDiscordRequester` come from, so the Discord pair has
 * to survive both of them.
 */
describe('the gallery job-log join', () => {
  const SAM_SNOWFLAKE = '273145016936267776'
  const CLIP = 'video:clip'

  it('counts a Discord submission toward its title rather than dropping it', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'web-grab',
        mediaId: CLIP,
        origin: 'web',
        requesterEmail: 'jeremy@lilnas.io',
        requesterUserId: 'u-jeremy',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 1_000),
        discordUserId: SAM_SNOWFLAKE,
        discordUsername: 'sam.pham',
        id: 'discord-grab',
        mediaId: CLIP,
        origin: 'discord',
      })

      // Both grabs count. A Discord submission is a download like any other
      // here - it is only the *facets* that stay email-keyed (plan 017 §E2's
      // deliberate scope cut).
      expect(countCompletedJobsByMediaIds(db, {}, [CLIP])).toEqual(
        new Map([[CLIP, 2]]),
      )
    } finally {
      close()
    }
  })

  it('carries the last requester’s Discord pair, not just the email pair', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'web-grab',
        mediaId: CLIP,
        origin: 'web',
        requesterEmail: 'jeremy@lilnas.io',
        requesterUserId: 'u-jeremy',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 1_000),
        discordUserId: SAM_SNOWFLAKE,
        discordUsername: 'sam.pham',
        id: 'discord-grab',
        mediaId: CLIP,
        origin: 'discord',
      })

      const rows = listLatestJobsForMediaIds(db, {}, [CLIP])
      const newest = rows[0]

      // Newest-first, and the caller takes the first row per media id - so
      // this row is the one the card's attribution is built from.
      expect(rows.map(r => r.id)).toEqual(['discord-grab', 'web-grab'])
      expect(newest?.discordUserId).toBe(SAM_SNOWFLAKE)
      expect(newest?.discordUsername).toBe('sam.pham')
      // The two identity pairs are mutually exclusive per row
      // (`jobs_origin_matches_requester`), so a Discord grab carries no email
      // and the card falls to its unlinked branch until a link resolves it.
      expect(newest?.requesterEmail).toBeNull()
    } finally {
      close()
    }
  })

  it('leaves the Discord pair null on a title last grabbed from the web', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        discordUserId: SAM_SNOWFLAKE,
        discordUsername: 'sam.pham',
        id: 'discord-grab',
        mediaId: CLIP,
        origin: 'discord',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 1_000),
        id: 'web-grab',
        mediaId: CLIP,
        origin: 'web',
        requesterEmail: 'jeremy@lilnas.io',
        requesterUserId: 'u-jeremy',
      })

      const newest = listLatestJobsForMediaIds(db, {}, [CLIP])[0]

      // A card shows the *last* requester, not every requester the title ever
      // had - an earlier Discord grab must not leak a handle onto a title
      // somebody else re-grabbed from the web.
      expect(newest?.id).toBe('web-grab')
      expect(newest?.discordUserId).toBeNull()
      expect(newest?.discordUsername).toBeNull()
    } finally {
      close()
    }
  })

  it('reads the last requester inside the filtered window, through either arm', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        discordUserId: SAM_SNOWFLAKE,
        discordUsername: 'sam.pham',
        id: 'discord-grab',
        mediaId: CLIP,
        origin: 'discord',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 1_000),
        id: 'web-grab',
        mediaId: CLIP,
        origin: 'web',
        requesterEmail: 'jeremy@lilnas.io',
        requesterUserId: 'u-jeremy',
      })

      const filter = { requesterDiscordUserId: SAM_SNOWFLAKE }
      const newest = listLatestJobsForMediaIds(db, filter, [CLIP])[0]

      // Same filter as the count ran under, so "sam's titles" shows sam as
      // the last requester even though somebody else grabbed it later.
      expect(countCompletedJobsByMediaIds(db, filter, [CLIP])).toEqual(
        new Map([[CLIP, 1]]),
      )
      expect(newest?.id).toBe('discord-grab')
    } finally {
      close()
    }
  })

  it('keeps a hidden Discord video out of a requester-scoped gallery, join and rows alike', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        discordUserId: SAM_SNOWFLAKE,
        discordUsername: 'sam.pham',
        hiddenAttribution: true,
        id: 'discord-hidden',
        mediaId: CLIP,
        origin: 'discord',
      })

      const filter = {
        excludeHiddenVideos: true,
        requesterDiscordUserId: SAM_SNOWFLAKE,
      }

      // The attribution oracle: a requester-keyed gallery run by a non-admin
      // must not be able to confirm a hidden video exists for that requester -
      // through the cards, through `total`, or through the follow-up row.
      expect(countCompletedJobsByMediaIds(db, filter, [CLIP])).toEqual(
        new Map(),
      )
      expect(listLatestJobsForMediaIds(db, filter, [CLIP])).toEqual([])
    } finally {
      close()
    }
  })

  it('asks nothing of the DB for an empty page of media ids', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { createdAt: new Date(T0), id: 'web-grab', mediaId: CLIP })

      expect(listLatestJobsForMediaIds(db, {}, [])).toEqual([])
      expect(countCompletedJobsByMediaIds(db, {}, [])).toEqual(new Map())
    } finally {
      close()
    }
  })
})

describe('countCompletedJobsByMediaIds', () => {
  it('counts only completed jobs, whatever statuses the filter carries', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'done-1', mediaId: 'tmdb:1', type: 'movie' })
      seedJob(db, { id: 'done-2', mediaId: 'tmdb:1', type: 'movie' })
      seedJob(db, {
        id: 'failed',
        mediaId: 'tmdb:1',
        status: 'failed',
        type: 'movie',
      })
      seedJob(db, {
        id: 'running',
        mediaId: 'tmdb:2',
        status: 'downloading',
        type: 'movie',
      })

      const counts = countCompletedJobsByMediaIds(
        db,
        { statuses: [DownloadJobStatus.Failed] },
        ['tmdb:1', 'tmdb:2'],
      )

      // `tmdb:2` has jobs, just no completed one - absent, not `0`, so the
      // gallery's join can read `.has()`.
      expect(counts).toEqual(new Map([['tmdb:1', 2]]))
    } finally {
      close()
    }
  })

  it('never counts a title outside `mediaIds`', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'a', mediaId: 'tmdb:1', type: 'movie' })
      seedJob(db, { id: 'b', mediaId: 'tmdb:2', type: 'movie' })

      expect(countCompletedJobsByMediaIds(db, {}, ['tmdb:2'])).toEqual(
        new Map([['tmdb:2', 1]]),
      )
    } finally {
      close()
    }
  })

  it('scopes to one requester, case-insensitively', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        id: 'alice',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'Alice@Example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })
      seedJob(db, {
        id: 'bob',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        type: 'movie',
      })

      expect(
        countCompletedJobsByMediaIds(
          db,
          { requesterEmail: 'alice@example.com' },
          ['tmdb:1'],
        ),
      ).toEqual(new Map([['tmdb:1', 1]]))
    } finally {
      close()
    }
  })

  // A requester-scoped gallery asks about the whole library at once, which
  // can outgrow one `IN (...)` list.
  it('answers for more ids than fit in one IN list', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'first', mediaId: 'tmdb:1', type: 'movie' })
      seedJob(db, { id: 'last', mediaId: 'tmdb:1200', type: 'movie' })

      const ids = Array.from({ length: 1200 }, (_, i) => `tmdb:${i + 1}`)

      expect(countCompletedJobsByMediaIds(db, {}, ids)).toEqual(
        new Map([
          ['tmdb:1', 1],
          ['tmdb:1200', 1],
        ]),
      )
    } finally {
      close()
    }
  })
})

/**
 * Plan 020. A boot path reader: `DownloadStateService.adoptOpenJobs()` needs
 * the whole `needs_attention` bucket, unfiltered and unpaged, to put the rows
 * `reconcileInterruptedJobs()` spared back in the in-memory Map.
 */
describe('listJobsByStatus', () => {
  it('returns only rows at the requested status, newest first', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, {
        createdAt: new Date(T0),
        id: 'attention-old',
        status: 'needs_attention',
      })
      seedJob(db, {
        createdAt: new Date(T0 + 1000),
        id: 'attention-new',
        status: 'needs_attention',
      })
      seedJob(db, { id: 'done-1', status: 'completed' })
      seedJob(db, { id: 'downloading-1', status: 'downloading' })

      const rows = listJobsByStatus(db, DownloadJobStatus.NeedsAttention)

      expect(rows.map(row => row.id)).toEqual([
        'attention-new',
        'attention-old',
      ])
    } finally {
      close()
    }
  })

  it('returns an empty array when no row is at that status', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'done-1', status: 'completed' })

      expect(listJobsByStatus(db, DownloadJobStatus.NeedsAttention)).toEqual([])
    } finally {
      close()
    }
  })
})

/**
 * Plan 021. The other boot path reader: `DownloadStateService.adoptOpenJobs()`
 * re-adopts every open movie/show attempt a restart leaves behind.
 */
describe('listOpenJobs', () => {
  function seedMixed(db: Db): void {
    seedJob(db, {
      createdAt: new Date(T0),
      id: 'movie-downloading',
      status: 'downloading',
      type: 'movie',
    })
    seedJob(db, {
      createdAt: new Date(T0 + 1000),
      id: 'show-paused',
      status: 'paused',
      type: 'show',
    })
    seedJob(db, {
      createdAt: new Date(T0 + 2000),
      id: 'video-attention',
      status: 'needs_attention',
      type: 'video',
    })
    seedJob(db, { id: 'movie-done', status: 'completed', type: 'movie' })
    seedJob(db, { id: 'show-failed', status: 'failed', type: 'show' })
    seedJob(db, { id: 'video-cancelled', status: 'cancelled' })
  }

  it('returns every non-terminal row of every type, newest first, when no types are given', () => {
    const { db, close } = createTestDb()
    try {
      seedMixed(db)

      expect(listOpenJobs(db).map(row => row.id)).toEqual([
        'video-attention',
        'show-paused',
        'movie-downloading',
      ])
    } finally {
      close()
    }
  })

  it('treats an empty types list as no filter', () => {
    const { db, close } = createTestDb()
    try {
      seedMixed(db)

      expect(listOpenJobs(db, []).map(row => row.id)).toEqual([
        'video-attention',
        'show-paused',
        'movie-downloading',
      ])
    } finally {
      close()
    }
  })

  it('narrows to the given types', () => {
    const { db, close } = createTestDb()
    try {
      seedMixed(db)

      expect(
        listOpenJobs(db, [DownloadType.Movie, DownloadType.Show]).map(
          row => row.id,
        ),
      ).toEqual(['show-paused', 'movie-downloading'])
      expect(listOpenJobs(db, [DownloadType.Video]).map(row => row.id)).toEqual(
        ['video-attention'],
      )
    } finally {
      close()
    }
  })

  it('returns an empty array when every row is terminal', () => {
    const { db, close } = createTestDb()
    try {
      seedJob(db, { id: 'done-1', status: 'completed', type: 'movie' })
      seedJob(db, { id: 'failed-1', status: 'failed' })

      expect(listOpenJobs(db)).toEqual([])
      expect(listOpenJobs(db, [DownloadType.Movie])).toEqual([])
    } finally {
      close()
    }
  })
})
