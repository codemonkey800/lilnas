import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs } from 'src/db/schema'
import { ProfileService } from 'src/download/profile.service'

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

describe('ProfileService', () => {
  let dbService: DbService
  let service: ProfileService

  // `createdAt` is always explicit: several of these tests hinge on where a
  // row falls relative to the window, which the column's
  // `$defaultFn(() => new Date())` would decide for us.
  function seedJob(overrides: Partial<RowInsert> & { id: string }): void {
    dbService.db
      .insert(jobs)
      .values({
        createdAt: NOW,
        mediaId: `video:${overrides.id}`,
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u-alice',
        status: 'completed',
        type: 'video',
        ...overrides,
      })
      .run()
  }

  beforeEach(async () => {
    // Only `Date.now` is pinned, rather than jest's full fake-timer suite:
    // that is the single clock read `getProfile()` makes, and faking
    // setImmediate/nextTick as well would put Nest's async `compile()` below
    // on a clock nothing in this file advances. `restoreMocks: true`
    // (jest.config.js) puts it back after each test.
    jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime())
    dbService = createTestDbService()

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProfileService, { provide: DbService, useValue: dbService }],
    }).compile()

    service = module.get(ProfileService)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('empty profile', () => {
    it('answers with nulls and empty arrays rather than throwing', () => {
      expect(
        service.getProfile({ days: 30, email: 'nobody@example.com' }),
      ).toEqual({
        user: { email: 'nobody@example.com' },
        firstDownloadAt: null,
        lastDownloadAt: null,
        jobsPerDay: [],
        totalsByStatus: [],
        totalsByType: [],
        windowDays: 30,
      })
    })
  })

  describe('scoping', () => {
    it("never counts another user's jobs", () => {
      seedJob({ id: 'alice-1' })
      seedJob({
        id: 'bob-1',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u-bob',
      })

      const profile = service.getProfile({
        days: 30,
        email: 'alice@example.com',
      })

      expect(profile.totalsByType).toEqual([{ count: 1, type: 'video' }])
      expect(profile.jobsPerDay).toEqual([
        { count: 1, day: '2026-06-15', type: 'video' },
      ])
    })

    it('echoes the target email verbatim, matching it case-insensitively', () => {
      seedJob({ id: 'alice-1' })

      const profile = service.getProfile({
        days: 30,
        email: 'ALICE@Example.COM',
      })

      expect(profile.user).toEqual({ email: 'ALICE@Example.COM' })
      expect(profile.totalsByType).toEqual([{ count: 1, type: 'video' }])
    })

    it("includes the caller's own hidden videos in the totals", () => {
      seedJob({ id: 'visible' })
      seedJob({ hiddenAttribution: true, id: 'hidden' })

      const profile = service.getProfile({
        days: 30,
        email: 'alice@example.com',
      })

      expect(profile.totalsByType).toEqual([{ count: 2, type: 'video' }])
    })
  })

  describe('window math', () => {
    it('keeps a job older than the window out of jobsPerDay but inside the totals and bounds', () => {
      seedJob({ createdAt: daysAgo(2), id: 'recent' })
      seedJob({ createdAt: daysAgo(40), id: 'ancient' })

      const profile = service.getProfile({
        days: 7,
        email: 'alice@example.com',
      })

      // Only the recent job is bucketed...
      expect(profile.jobsPerDay).toEqual([
        { count: 1, day: '2026-06-13', type: 'video' },
      ])
      // ...but both are counted everywhere else, because the totals and the
      // first/last timestamps are all-time by design.
      expect(profile.totalsByType).toEqual([{ count: 2, type: 'video' }])
      expect(profile.totalsByStatus).toEqual([
        { count: 2, status: 'completed' },
      ])
      expect(profile.firstDownloadAt).toBe(daysAgo(40).toISOString())
      expect(profile.lastDownloadAt).toBe(daysAgo(2).toISOString())
    })

    it('echoes the applied window as windowDays', () => {
      expect(
        service.getProfile({ days: 90, email: 'alice@example.com' }).windowDays,
      ).toBe(90)
    })
  })

  describe('aggregates', () => {
    it('passes the sparse per-day and status breakdowns straight through', () => {
      seedJob({ createdAt: daysAgo(2), id: 'v1' })
      seedJob({ createdAt: daysAgo(2), id: 'v2' })
      seedJob({
        createdAt: daysAgo(1),
        id: 'm1',
        mediaId: 'tmdb:550',
        status: 'failed',
        type: 'movie',
      })

      const profile = service.getProfile({
        days: 30,
        email: 'alice@example.com',
      })

      expect(profile.jobsPerDay).toEqual([
        { count: 2, day: '2026-06-13', type: 'video' },
        { count: 1, day: '2026-06-14', type: 'movie' },
      ])
      expect(profile.totalsByStatus).toEqual(
        expect.arrayContaining([
          { count: 2, status: 'completed' },
          { count: 1, status: 'failed' },
        ]),
      )
      expect(profile.totalsByStatus).toHaveLength(2)
      expect(profile.totalsByType).toEqual(
        expect.arrayContaining([
          { count: 1, type: 'movie' },
          { count: 2, type: 'video' },
        ]),
      )
      expect(profile.totalsByType).toHaveLength(2)
    })
  })
})
