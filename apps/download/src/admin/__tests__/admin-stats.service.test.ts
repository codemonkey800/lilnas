import { Test, TestingModule } from '@nestjs/testing'

import {
  AdminStatsService,
  TOP_REQUESTERS_LIMIT,
} from 'src/admin/admin-stats.service'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs } from 'src/db/schema'

type RowInsert = typeof jobs.$inferInsert

const MS_PER_DAY = 24 * 60 * 60 * 1000

// Frozen so "N days ago" is a fixed calendar day rather than whatever day
// the suite happens to run on - the per-day buckets are UTC calendar days
// (countJobsByDay), so a real clock would make the expected `day` strings
// depend on when CI runs.
const NOW = new Date('2026-06-15T12:00:00.000Z')

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY)
}

describe('AdminStatsService', () => {
  let dbService: DbService
  let service: AdminStatsService

  // `createdAt` is always explicit: the whole point of most of these tests is
  // where a row falls relative to the window, which the column's
  // `$defaultFn(() => new Date())` would decide for us.
  function seedJob(overrides: Partial<RowInsert> & { id: string }): void {
    dbService.db
      .insert(jobs)
      .values({
        createdAt: NOW,
        mediaId: `video:${overrides.id}`,
        origin: 'service',
        status: 'completed',
        type: 'video',
        ...overrides,
      })
      .run()
  }

  beforeEach(async () => {
    // Only `Date.now` is pinned, rather than jest's full fake-timer suite:
    // that is the single clock read `getStats()` makes, and faking
    // setImmediate/nextTick as well would put Nest's async `compile()` below
    // on a clock nothing in this file advances. `restoreMocks: true`
    // (jest.config.js) puts it back after each test.
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
    dbService = createTestDbService()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStatsService,
        { provide: DbService, useValue: dbService },
      ],
    }).compile()

    service = module.get(AdminStatsService)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('empty database', () => {
    it('answers with zeros and empty arrays rather than throwing', () => {
      expect(service.getStats({ days: 30 })).toEqual({
        jobsPerDay: [],
        topRequesters: [],
        totalJobs: 0,
        totalsByStatus: [],
        totalsByType: [],
        windowDays: 30,
      })
    })
  })

  describe('window math', () => {
    it('keeps a job older than the window out of jobsPerDay but inside the totals', () => {
      seedJob({ createdAt: daysAgo(2), id: 'recent' })
      seedJob({ createdAt: daysAgo(40), id: 'ancient' })

      const stats = service.getStats({ days: 7 })

      // Only the recent job is bucketed...
      expect(stats.jobsPerDay).toEqual([
        { count: 1, day: '2026-06-13', type: 'video' },
      ])
      // ...but both are counted everywhere else, because the totals and the
      // leaderboard are all-time by design.
      expect(stats.totalJobs).toBe(2)
      expect(stats.totalsByType).toEqual([{ count: 2, type: 'video' }])
      expect(stats.totalsByStatus).toEqual([{ count: 2, status: 'completed' }])
    })

    it('leaves top requesters unwindowed - a lifetime leaderboard', () => {
      seedJob({
        createdAt: daysAgo(300),
        id: 'old',
        origin: 'web',
        requesterEmail: 'ada@lilnas.io',
        requesterUserId: 'u-1',
      })

      const stats = service.getStats({ days: 1 })

      expect(stats.jobsPerDay).toEqual([])
      expect(stats.topRequesters).toEqual([
        { count: 1, requesterEmail: 'ada@lilnas.io' },
      ])
    })

    it('echoes the applied window as windowDays', () => {
      expect(service.getStats({ days: 90 }).windowDays).toBe(90)
    })

    it('measures the window from now, not from midnight', () => {
      // 12:00Z minus one day is 2026-06-14T12:00Z, so a job stamped 06-14 at
      // 06:00Z is outside a 1-day window even though it shares a calendar
      // day with the window's start.
      seedJob({ createdAt: new Date('2026-06-14T06:00:00.000Z'), id: 'early' })
      seedJob({ createdAt: new Date('2026-06-14T18:00:00.000Z'), id: 'late' })

      expect(service.getStats({ days: 1 }).jobsPerDay).toEqual([
        { count: 1, day: '2026-06-14', type: 'video' },
      ])
    })
  })

  describe('jobsPerDay', () => {
    it('buckets by UTC calendar day and type, ascending by day', () => {
      seedJob({ createdAt: daysAgo(2), id: 'v1' })
      seedJob({ createdAt: daysAgo(2), id: 'v2' })
      seedJob({
        createdAt: daysAgo(1),
        id: 'm1',
        mediaId: 'tmdb:550',
        type: 'movie',
      })

      const stats = service.getStats({ days: 30 })

      expect(stats.jobsPerDay).toEqual([
        { count: 2, day: '2026-06-13', type: 'video' },
        { count: 1, day: '2026-06-14', type: 'movie' },
      ])
    })

    // Documents the chosen contract: the response passes the repo's sparse
    // GROUP BY output straight through. A day inside the window with no jobs
    // is absent, not `{ count: 0 }` - see AdminStatsService.getStats().
    it('does not zero-fill days inside the window that have no jobs', () => {
      seedJob({ createdAt: daysAgo(5), id: 'lonely' })

      const stats = service.getStats({ days: 30 })

      expect(stats.jobsPerDay).toHaveLength(1)
      expect(stats.jobsPerDay[0]).toEqual({
        count: 1,
        day: '2026-06-10',
        type: 'video',
      })
    })

    it('does not zero-fill a type that has no jobs on a day that does', () => {
      seedJob({ id: 'v1' })

      expect(service.getStats({ days: 30 }).jobsPerDay).toEqual([
        { count: 1, day: '2026-06-15', type: 'video' },
      ])
    })
  })

  describe('totals', () => {
    it('breaks down by status without inventing absent statuses', () => {
      seedJob({ id: 'a', status: 'completed' })
      seedJob({ id: 'b', status: 'completed' })
      seedJob({ id: 'c', status: 'failed' })

      const stats = service.getStats({ days: 30 })

      expect(stats.totalsByStatus).toEqual(
        expect.arrayContaining([
          { count: 2, status: 'completed' },
          { count: 1, status: 'failed' },
        ]),
      )
      // 'cancelled', 'downloading', 'searching', ... are simply absent.
      expect(stats.totalsByStatus).toHaveLength(2)
    })

    it('derives totalJobs by summing totalsByType', () => {
      seedJob({ id: 'v1' })
      seedJob({ id: 'm1', mediaId: 'tmdb:550', type: 'movie' })
      seedJob({ id: 'm2', mediaId: 'tmdb:551', type: 'movie' })
      seedJob({ id: 's1', mediaId: 'tvdb:121361', type: 'show' })

      const stats = service.getStats({ days: 30 })

      expect(stats.totalJobs).toBe(4)
      expect(stats.totalsByType.reduce((sum, row) => sum + row.count, 0)).toBe(
        stats.totalJobs,
      )
    })

    it('counts hidden-attribution jobs like any other - this surface is admin-only', () => {
      seedJob({
        hiddenAttribution: true,
        id: 'hidden',
        origin: 'web',
        requesterEmail: 'ada@lilnas.io',
        requesterUserId: 'u-1',
      })

      const stats = service.getStats({ days: 30 })

      expect(stats.totalJobs).toBe(1)
      expect(stats.jobsPerDay).toEqual([
        { count: 1, day: '2026-06-15', type: 'video' },
      ])
      // The hidden uploader is named, not masked - that is the whole point
      // of putting this behind AdminGuard.
      expect(stats.topRequesters).toEqual([
        { count: 1, requesterEmail: 'ada@lilnas.io' },
      ])
    })
  })

  describe('topRequesters', () => {
    function seedFor(email: string, count: number, idPrefix: string): void {
      for (let i = 0; i < count; i++) {
        seedJob({
          id: `${idPrefix}-${i}`,
          origin: 'web',
          requesterEmail: email,
          requesterUserId: `uid-${idPrefix}`,
        })
      }
    }

    it('ranks by count descending', () => {
      seedFor('bob@lilnas.io', 1, 'bob')
      seedFor('ada@lilnas.io', 3, 'ada')
      seedFor('cy@lilnas.io', 2, 'cy')

      expect(service.getStats({ days: 30 }).topRequesters).toEqual([
        { count: 3, requesterEmail: 'ada@lilnas.io' },
        { count: 2, requesterEmail: 'cy@lilnas.io' },
        { count: 1, requesterEmail: 'bob@lilnas.io' },
      ])
    })

    it('breaks ties on email so the ranking is stable across requests', () => {
      seedFor('zoe@lilnas.io', 2, 'zoe')
      seedFor('ada@lilnas.io', 2, 'ada')

      expect(service.getStats({ days: 30 }).topRequesters).toEqual([
        { count: 2, requesterEmail: 'ada@lilnas.io' },
        { count: 2, requesterEmail: 'zoe@lilnas.io' },
      ])
    })

    it(`caps the list at ${TOP_REQUESTERS_LIMIT} entries, keeping the highest counts`, () => {
      // 25 requesters, each with a distinct count from 25 down to 1, so the
      // cut is unambiguous.
      for (let i = 0; i < 25; i++) {
        seedFor(`user-${String(i).padStart(2, '0')}@lilnas.io`, 25 - i, `u${i}`)
      }

      const { topRequesters } = service.getStats({ days: 30 })

      expect(topRequesters).toHaveLength(TOP_REQUESTERS_LIMIT)
      expect(topRequesters[0]).toEqual({
        count: 25,
        requesterEmail: 'user-00@lilnas.io',
      })
      expect(topRequesters.at(-1)).toEqual({
        count: 6,
        requesterEmail: 'user-19@lilnas.io',
      })
    })

    it('omits service-origin jobs, which have no requester', () => {
      seedJob({ id: 'service-1' })
      seedFor('ada@lilnas.io', 1, 'ada')

      const stats = service.getStats({ days: 30 })

      expect(stats.topRequesters).toEqual([
        { count: 1, requesterEmail: 'ada@lilnas.io' },
      ])
      // Still counted in the totals - only the leaderboard drops them.
      expect(stats.totalJobs).toBe(2)
    })
  })
})
