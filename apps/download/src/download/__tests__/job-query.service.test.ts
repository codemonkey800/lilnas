// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports DownloadStateService (which uses
// it for ensureVideo()) must mock it first.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { DownloadType } from '@lilnas/utils/download/types'
import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { createFakeMediaResolver } from 'src/media/__tests__/helpers/fake-media-resolver'
import { MediaResolverService } from 'src/media/media-resolver.service'

type RowInsert = typeof jobs.$inferInsert

describe('JobQueryService', () => {
  let dbService: DbService
  let service: JobQueryService
  let mediaResolver: ReturnType<typeof createFakeMediaResolver>

  // Every seeded row gets a media id, since that's what the gallery groups
  // on. Defaults to a per-job key so a test that doesn't care about grouping
  // still gets one item per job.
  function seedJob(overrides: Partial<RowInsert> & { id: string }): void {
    dbService.db
      .insert(jobs)
      .values({
        mediaId: `video:${overrides.id}`,
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
    mediaResolver = createFakeMediaResolver()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobQueryService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        {
          provide: DownloadGateway,
          useValue: { broadcastPerViewer: jest.fn() },
        },
        { provide: MediaResolverService, useValue: mediaResolver },
      ],
    }).compile()

    service = module.get(JobQueryService)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('listActivity', () => {
    it('excludes terminal rows (completed/cancelled/failed)', async () => {
      seedJob({ id: 'downloading-1', status: 'downloading' })
      seedJob({ id: 'searching-1', status: 'searching' })
      seedJob({ id: 'completed-1', status: 'completed' })
      seedJob({ id: 'cancelled-1', status: 'cancelled' })
      seedJob({ id: 'failed-1', status: 'failed' })

      const page = await service.listActivity({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => i.id).sort()).toEqual([
        'downloading-1',
        'searching-1',
      ])
      expect(page.total).toBe(2)
    })

    it('narrows by type when provided', async () => {
      seedJob({ id: 'video-downloading', status: 'downloading', type: 'video' })
      seedJob({
        id: 'movie-downloading',
        mediaId: 'tmdb:1',
        status: 'downloading',
        type: 'movie',
      })

      const page = await service.listActivity({
        isAdmin: false,
        limit: 10,
        types: [DownloadType.Movie],
      })

      expect(page.items.map(i => i.id)).toEqual(['movie-downloading'])
    })

    // Twenty movie jobs on the activity page must cost one Radarr call, not
    // twenty - the whole reason the resolver batches (plan §4.1).
    it('resolves the whole page in a single resolver call', async () => {
      for (let i = 0; i < 5; i++) {
        seedJob({
          id: `movie-${i}`,
          mediaId: `tmdb:${i + 1}`,
          status: 'downloading',
          type: 'movie',
        })
      }

      const page = await service.listActivity({ isAdmin: false, limit: 10 })

      expect(page.items).toHaveLength(5)
      expect(mediaResolver.resolve).toHaveBeenCalledTimes(1)
    })

    it('returns jobs carrying their resolved media, not a media id', async () => {
      seedJob({
        id: 'movie-1',
        mediaId: 'tmdb:7',
        status: 'downloading',
        type: 'movie',
      })

      const page = await service.listActivity({ isAdmin: false, limit: 10 })

      expect(page.items[0]?.media).toMatchObject({
        id: 'tmdb:7',
        type: DownloadType.Movie,
      })
      expect(page.items[0]).not.toHaveProperty('mediaId')
    })
  })

  describe('listGallery', () => {
    it('returns only completed rows', async () => {
      seedJob({ id: 'completed-1', status: 'completed' })
      seedJob({ id: 'downloading-1', status: 'downloading' })
      seedJob({ id: 'failed-1', status: 'failed' })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => i.media.id)).toEqual(['video:completed-1'])
      expect(page.total).toBe(1)
    })

    // The core of the media-centric reshape: two downloads of the same title
    // are one card, not two rows.
    it('collapses repeat downloads of one title into a single item with a count', async () => {
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        id: 'first-grab',
        mediaId: 'tmdb:42',
        type: 'movie',
      })
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 2)),
        id: 'second-grab',
        mediaId: 'tmdb:42',
        type: 'movie',
      })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items).toHaveLength(1)
      expect(page.total).toBe(1)
      expect(page.items[0]).toMatchObject({
        downloadCount: 2,
        // MAX(created_at) - the later of the two grabs.
        lastDownloadedAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
        media: { id: 'tmdb:42' },
      })
    })

    it('reports the requester of the most recent job for the title', async () => {
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        id: 'older',
        mediaId: 'tmdb:42',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 2)),
        id: 'newer',
        mediaId: 'tmdb:42',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        type: 'movie',
      })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items[0]?.lastRequester).toEqual({
        email: 'bob@example.com',
        userId: 'u2',
      })
    })

    it('masks a hidden video for a non-admin and reveals it for an admin, from the same seeded page', async () => {
      seedJob({
        hiddenAttribution: true,
        id: 'hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
      })

      const nonAdminPage = await service.listGallery({
        isAdmin: false,
        limit: 10,
      })
      const adminPage = await service.listGallery({ isAdmin: true, limit: 10 })

      expect(nonAdminPage.items[0]?.lastRequester).toBeNull()
      expect(adminPage.items[0]?.lastRequester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('never masks a movie title, even when the flag is somehow set', async () => {
      seedJob({
        hiddenAttribution: true,
        id: 'movie-1',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items[0]?.lastRequester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('applies excludeHiddenVideos for a non-admin requester-scoped lookup, hiding both the row and reducing total', async () => {
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
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
        type: 'movie',
      })

      const nonAdminPage = await service.listGallery({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
      })
      const adminPage = await service.listGallery({
        isAdmin: true,
        limit: 10,
        requesterEmail: 'alice@example.com',
      })

      expect(nonAdminPage.items.map(i => i.media.id)).toEqual(['tmdb:1'])
      expect(nonAdminPage.total).toBe(1)

      expect(adminPage.items.map(i => i.media.id).sort()).toEqual([
        'tmdb:1',
        'video:alice-hidden-video',
      ])
      expect(adminPage.total).toBe(2)
    })

    // The filters apply to the grouped-over rows, so the count reflects the
    // filtered window rather than the title's whole history.
    it('counts only the jobs inside the filtered date range', async () => {
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        id: 'january',
        mediaId: 'tmdb:42',
        type: 'movie',
      })
      seedJob({
        createdAt: new Date(Date.UTC(2026, 5, 1)),
        id: 'june',
        mediaId: 'tmdb:42',
        type: 'movie',
      })

      const page = await service.listGallery({
        createdFrom: new Date(Date.UTC(2026, 2, 1)),
        isAdmin: false,
        limit: 10,
      })

      expect(page.items[0]?.downloadCount).toBe(1)
    })
  })

  describe('listHistory', () => {
    it('scopes by email and includes failures', async () => {
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

      const page = await service.listHistory({
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

  describe('listJobsForMedia', () => {
    it('returns every job for one title, newest first', async () => {
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        id: 'older',
        mediaId: 'tmdb:42',
        type: 'movie',
      })
      seedJob({
        createdAt: new Date(Date.UTC(2026, 0, 2)),
        id: 'newer',
        mediaId: 'tmdb:42',
        type: 'movie',
      })
      seedJob({ id: 'unrelated', mediaId: 'tmdb:1', type: 'movie' })

      const jobsForMedia = await service.listJobsForMedia('tmdb:42')

      expect(jobsForMedia.map(job => job.id)).toEqual(['newer', 'older'])
    })

    // The "not downloaded yet" state of GET /media/:id - an empty list, not
    // a 404.
    it('returns an empty list for a title nobody has downloaded', async () => {
      await expect(service.listJobsForMedia('tmdb:999')).resolves.toEqual([])
    })
  })

  describe('pagination', () => {
    it('returns nextCursor: null on the last page, and round-trips into the correct page 2', async () => {
      for (let i = 0; i < 3; i++) {
        seedJob({
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          id: `job-${i}`,
        })
      }

      const page1 = await service.listGallery({ isAdmin: false, limit: 2 })
      expect(page1.items.map(i => i.media.id)).toEqual([
        'video:job-2',
        'video:job-1',
      ])
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await service.listGallery({
        cursor: page1.nextCursor ?? undefined,
        isAdmin: false,
        limit: 2,
      })
      expect(page2.items.map(i => i.media.id)).toEqual(['video:job-0'])
      expect(page2.nextCursor).toBeNull()
    })

    it('paginates the per-job feeds the same way', async () => {
      for (let i = 0; i < 3; i++) {
        seedJob({
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
          id: `job-${i}`,
          status: 'downloading',
        })
      }

      const page1 = await service.listActivity({ isAdmin: false, limit: 2 })
      const page2 = await service.listActivity({
        cursor: page1.nextCursor ?? undefined,
        isAdmin: false,
        limit: 2,
      })

      expect(page1.items.map(i => i.id)).toEqual(['job-2', 'job-1'])
      expect(page2.items.map(i => i.id)).toEqual(['job-0'])
      expect(page2.nextCursor).toBeNull()
    })

    it('throws BadRequestException for a malformed cursor', async () => {
      seedJob({ id: 'job-1' })

      await expect(
        service.listGallery({
          cursor: 'not-a-real-cursor',
          isAdmin: false,
          limit: 10,
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for a cursor minted under a different filter (wrong filterKey)', async () => {
      seedJob({ id: 'job-1', status: 'completed' })

      await expect(
        service.listGallery({
          cursor: Buffer.from('123:job-1:some-other-filter-key').toString(
            'base64url',
          ),
          isAdmin: false,
          limit: 10,
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('getGalleryFacets', () => {
    it('reports correct counts for both aggregates', () => {
      seedJob({
        id: 'alice-movie',
        mediaId: 'tmdb:1',
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
