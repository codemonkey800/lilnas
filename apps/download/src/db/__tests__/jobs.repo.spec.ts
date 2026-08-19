import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { Db } from 'src/db/db.service'
import type { JobCursor } from 'src/db/job-cursor'
import {
  countJobsByRequester,
  countJobsByType,
  listJobsPage,
} from 'src/db/jobs.repo'
import { jobs } from 'src/db/schema'

import { createTestDb } from './test-utils'

type RowInsert = typeof jobs.$inferInsert

function seedJob(db: Db, overrides: Partial<RowInsert> & { id: string }): void {
  db.insert(jobs)
    .values({
      origin: 'service',
      status: 'completed',
      type: 'video',
      url: `https://example.com/${overrides.id}`,
      ...overrides,
    })
    .run()
}

const FILTER_KEY = 'test-filter-key'
const T0 = new Date('2026-01-01T00:00:00.000Z').getTime()

function cursorFrom(row: { createdAt: Date; id: string }): JobCursor {
  return {
    createdAtMs: row.createdAt.getTime(),
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
