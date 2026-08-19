import { DownloadType } from '@lilnas/utils/download/types'
import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs } from 'src/db/schema'
import { JobQueryService } from 'src/download/job-query.service'

type RowInsert = typeof jobs.$inferInsert

describe('JobQueryService', () => {
  let dbService: DbService
  let service: JobQueryService

  function seedJob(overrides: Partial<RowInsert> & { id: string }): void {
    dbService.db
      .insert(jobs)
      .values({
        origin: 'service',
        status: 'completed',
        type: 'video',
        url: `https://example.com/${overrides.id}`,
        ...overrides,
      })
      .run()
  }

  beforeEach(async () => {
    dbService = createTestDbService()

    const module: TestingModule = await Test.createTestingModule({
      providers: [JobQueryService, { provide: DbService, useValue: dbService }],
    }).compile()

    service = module.get(JobQueryService)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('listActivity', () => {
    it('excludes terminal rows (completed/cancelled/failed)', () => {
      seedJob({ id: 'downloading-1', status: 'downloading' })
      seedJob({ id: 'searching-1', status: 'searching' })
      seedJob({ id: 'completed-1', status: 'completed' })
      seedJob({ id: 'cancelled-1', status: 'cancelled' })
      seedJob({ id: 'failed-1', status: 'failed' })

      const page = service.listActivity({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => i.id).sort()).toEqual([
        'downloading-1',
        'searching-1',
      ])
      expect(page.total).toBe(2)
    })

    it('narrows by type when provided', () => {
      seedJob({ id: 'video-downloading', status: 'downloading', type: 'video' })
      seedJob({ id: 'movie-downloading', status: 'downloading', type: 'movie' })

      const page = service.listActivity({
        isAdmin: false,
        limit: 10,
        types: [DownloadType.Movie],
      })

      expect(page.items.map(i => i.id)).toEqual(['movie-downloading'])
    })
  })

  describe('listGallery', () => {
    it('returns only completed rows', () => {
      seedJob({ id: 'completed-1', status: 'completed' })
      seedJob({ id: 'downloading-1', status: 'downloading' })
      seedJob({ id: 'failed-1', status: 'failed' })

      const page = service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => i.id)).toEqual(['completed-1'])
      expect(page.total).toBe(1)
    })

    it('masks a hidden video for a non-admin and reveals it for an admin, from the same seeded page', () => {
      seedJob({
        hiddenAttribution: true,
        id: 'hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
      })

      const nonAdminPage = service.listGallery({ isAdmin: false, limit: 10 })
      const adminPage = service.listGallery({ isAdmin: true, limit: 10 })

      expect(nonAdminPage.items[0]?.requester).toBeNull()
      expect(adminPage.items[0]?.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('applies excludeHiddenVideos for a non-admin requester-scoped lookup, hiding both the row and reducing total', () => {
      seedJob({
        hiddenAttribution: true,
        id: 'alice-hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
      })
      seedJob({
        id: 'alice-visible-movie',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
        type: 'movie',
      })

      const nonAdminPage = service.listGallery({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
      })
      const adminPage = service.listGallery({
        isAdmin: true,
        limit: 10,
        requesterEmail: 'alice@example.com',
      })

      expect(nonAdminPage.items.map(i => i.id)).toEqual(['alice-visible-movie'])
      expect(nonAdminPage.total).toBe(1)

      expect(adminPage.items.map(i => i.id).sort()).toEqual([
        'alice-hidden-video',
        'alice-visible-movie',
      ])
      expect(adminPage.total).toBe(2)
    })
  })

  describe('listHistory', () => {
    it('scopes by email and includes failures', () => {
      seedJob({
        id: 'alice-completed',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
      })
      seedJob({
        id: 'alice-failed',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'failed',
      })
      seedJob({
        id: 'bob-completed',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        status: 'completed',
      })

      const page = service.listHistory({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
      })

      expect(page.items.map(i => i.id).sort()).toEqual([
        'alice-completed',
        'alice-failed',
      ])
      expect(page.total).toBe(2)
    })
  })

  describe('pagination', () => {
    it('returns nextCursor: null on the last page, and round-trips into the correct page 2', () => {
      for (let i = 0; i < 3; i++) {
        seedJob({
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          id: `job-${i}`,
        })
      }

      const galleryPage1 = service.listGallery({ isAdmin: false, limit: 2 })
      expect(galleryPage1.items.map(i => i.id)).toEqual(['job-2', 'job-1'])
      expect(galleryPage1.nextCursor).not.toBeNull()

      const galleryPage2 = service.listGallery({
        cursor: galleryPage1.nextCursor ?? undefined,
        isAdmin: false,
        limit: 2,
      })
      expect(galleryPage2.items.map(i => i.id)).toEqual(['job-0'])
      expect(galleryPage2.nextCursor).toBeNull()
    })

    it('throws BadRequestException for a malformed cursor', () => {
      seedJob({ id: 'job-1' })

      expect(() =>
        service.listGallery({
          cursor: 'not-a-real-cursor',
          isAdmin: false,
          limit: 10,
        }),
      ).toThrow(BadRequestException)
    })

    it('throws BadRequestException for a cursor minted under a different filter (wrong filterKey)', () => {
      seedJob({ id: 'job-1', status: 'completed' })

      expect(() =>
        service.listGallery({
          cursor: Buffer.from('123:job-1:some-other-filter-key').toString(
            'base64url',
          ),
          isAdmin: false,
          limit: 10,
        }),
      ).toThrow(BadRequestException)
    })
  })

  describe('getGalleryFacets', () => {
    it('reports correct counts for both aggregates', () => {
      seedJob({
        id: 'alice-movie',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
        type: 'movie',
      })
      seedJob({
        id: 'bob-video',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        status: 'completed',
        type: 'video',
      })

      const facets = service.getGalleryFacets({ isAdmin: false })

      expect(
        facets.uploaders.sort((a, b) => a.email.localeCompare(b.email)),
      ).toEqual([
        { count: 1, email: 'alice@example.com' },
        { count: 1, email: 'bob@example.com' },
      ])
      expect(facets.types.sort((a, b) => a.type.localeCompare(b.type))).toEqual(
        [
          { count: 1, type: 'movie' },
          { count: 1, type: 'video' },
        ],
      )
    })

    it('omits an uploader whose only completed row is a hidden video, for a non-admin', () => {
      seedJob({
        hiddenAttribution: true,
        id: 'alice-hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
        type: 'video',
      })

      const nonAdminFacets = service.getGalleryFacets({ isAdmin: false })
      const adminFacets = service.getGalleryFacets({ isAdmin: true })

      expect(nonAdminFacets.uploaders).toEqual([])
      expect(adminFacets.uploaders).toEqual([
        { count: 1, email: 'alice@example.com' },
      ])
      // The type aggregate is never guarded - it leaks no identity.
      expect(nonAdminFacets.types).toEqual([{ count: 1, type: 'video' }])
    })

    it('excludes service-origin rows from the uploader facet', () => {
      seedJob({ id: 'service-job', origin: 'service', status: 'completed' })

      const facets = service.getGalleryFacets({ isAdmin: true })

      expect(facets.uploaders).toEqual([])
      expect(facets.types).toEqual([{ count: 1, type: 'video' }])
    })

    it('narrows both aggregates by the date range', () => {
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        id: 'before',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
      })
      seedJob({
        createdAt: new Date(Date.UTC(2026, 5, 1)),
        id: 'within',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        status: 'completed',
      })

      const facets = service.getGalleryFacets({
        createdFrom: new Date(Date.UTC(2026, 2, 1)),
        isAdmin: true,
      })

      expect(facets.uploaders).toEqual([{ count: 1, email: 'bob@example.com' }])
    })
  })
})
