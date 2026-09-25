// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports DownloadStateService (which uses
// it for ensureVideo()) must mock it first.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJobStatus,
  DownloadType,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs, videos } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { createFakeMediaResolver } from 'src/media/__tests__/helpers/fake-media-resolver'
import {
  type LibraryEntry,
  MediaResolverService,
} from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'

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
        ...overrides,
      })
      .run()
  }

  function libraryMovie(tmdbId: number, addedAt: Date): LibraryEntry {
    const media: Movie = {
      addedAt: addedAt.toISOString(),
      filePath: `/movies/${tmdbId}.mkv`,
      id: `tmdb:${tmdbId}`,
      title: `Movie ${tmdbId}`,
      tmdbId,
      type: DownloadType.Movie,
    }
    return { addedAt, media }
  }

  function libraryShow(tvdbId: number, addedAt: Date): LibraryEntry {
    const media: Show = {
      addedAt: addedAt.toISOString(),
      episodeFileCount: 3,
      id: `tvdb:${tvdbId}`,
      title: `Show ${tvdbId}`,
      tvdbId,
      type: DownloadType.Show,
    }
    return { addedAt, media }
  }

  // What `listLibrary()` answers - the Radarr/Sonarr half of the library.
  function setLibrary(
    entries: LibraryEntry[],
    degradedSources: DownloadType[] = [],
  ): void {
    mediaResolver.listLibrary.mockResolvedValue({ degradedSources, entries })
  }

  // The videos half: a `videos` row, with a file unless told otherwise.
  // `updatedAt` is the video's `addedAt` (see `hydrateVideo`).
  function seedVideo(
    id: string,
    updatedAt: Date,
    downloadUrls: string[] | null = [`https://files.example.com/${id}.mp4`],
  ): void {
    dbService.db
      .insert(videos)
      .values({
        createdAt: updatedAt,
        downloadUrls,
        id,
        naturalKey: `https://example.com/${id}#-`,
        sourceUrl: `https://example.com/${id}`,
        title: id,
        updatedAt,
      })
      .run()
  }

  const day = (d: number): Date => new Date(Date.UTC(2026, 0, d))

  beforeEach(async () => {
    dbService = createTestDbService()
    mediaResolver = createFakeMediaResolver()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        fakeAttributionResolutionProvider(),
        JobQueryService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        {
          provide: DownloadGateway,
          useValue: { broadcast: jest.fn(), broadcastPerViewer: jest.fn() },
        },
        { provide: MediaResolverService, useValue: mediaResolver },
        MediaStateService,
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
    it('lists every library title - movies, shows and videos with a file - newest addedAt first', async () => {
      setLibrary([libraryMovie(1, day(1)), libraryShow(2, day(3))])
      seedVideo('clip', day(2))

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => [i.media.id, i.addedAt])).toEqual([
        ['tvdb:2', day(3).toISOString()],
        ['video:clip', day(2).toISOString()],
        ['tmdb:1', day(1).toISOString()],
      ])
      expect(page.total).toBe(3)
      expect(page.nextCursor).toBeNull()
    })

    it('breaks an addedAt tie by media id, ascending', async () => {
      setLibrary([libraryMovie(2, day(1)), libraryMovie(1, day(1))])
      seedVideo('a', day(1))

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => i.media.id)).toEqual([
        'tmdb:1',
        'tmdb:2',
        'video:a',
      ])
    })

    // Plan 021: the library is the source, not the job log - a title with
    // no download through this app is still in it.
    it('lists a title nobody downloaded, with downloadCount 0 and no attribution', async () => {
      setLibrary([libraryMovie(7, day(1))])

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items).toEqual([
        {
          addedAt: day(1).toISOString(),
          downloadCount: 0,
          lastDiscordRequester: null,
          lastDownloadedAt: null,
          lastRequester: null,
          media: expect.objectContaining({ id: 'tmdb:7' }),
        },
      ])
    })

    // The gallery is the library: a title the library no longer has simply
    // isn't listed, however many jobs it has.
    it('drops a title the library no longer holds, even with completed jobs', async () => {
      setLibrary([])
      seedJob({ id: 'grab', mediaId: 'tmdb:42', type: 'movie' })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page).toEqual({ items: [], nextCursor: null, total: 0 })
    })

    it('leaves out a video whose file never landed', async () => {
      seedVideo('in-flight', day(2), null)
      seedJob({ id: 'in-flight', mediaId: 'video:in-flight' })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.total).toBe(0)
    })

    it('counts completed downloads only, and dates the card by the latest one', async () => {
      setLibrary([libraryMovie(42, day(1))])
      seedJob({
        completedAt: day(2),
        createdAt: day(2),
        id: 'first-grab',
        mediaId: 'tmdb:42',
        type: 'movie',
      })
      seedJob({
        completedAt: day(4),
        createdAt: day(3),
        id: 'second-grab',
        mediaId: 'tmdb:42',
        type: 'movie',
      })
      seedJob({
        createdAt: day(5),
        id: 'failed-grab',
        mediaId: 'tmdb:42',
        status: 'failed',
        type: 'movie',
      })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items[0]).toMatchObject({
        addedAt: day(1).toISOString(),
        downloadCount: 2,
        lastDownloadedAt: day(4).toISOString(),
      })
    })

    it('reports the requester of the most recent completed job for the title', async () => {
      setLibrary([libraryMovie(42, day(1))])
      seedJob({
        createdAt: day(1),
        id: 'older',
        mediaId: 'tmdb:42',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })
      seedJob({
        createdAt: day(2),
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
      seedVideo('hidden-video', day(1))
      seedJob({
        hiddenAttribution: true,
        id: 'hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
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

    // Phase 018. `lastDiscordRequester` rides the same masking decision as
    // `lastRequester`: a Discord handle identifies the uploader just as
    // squarely as an email does, so revealing one while hiding the other
    // would make `hiddenAttribution` a no-op for Discord-submitted videos.
    it("carries the last uploader's Discord identity, and masks it alongside `lastRequester`", async () => {
      seedVideo('discord-video', day(1))
      seedJob({
        discordUserId: '183948273649182736',
        discordUsername: 'jeremy',
        hiddenAttribution: true,
        id: 'discord-video',
        origin: 'discord',
      })

      const nonAdminPage = await service.listGallery({
        isAdmin: false,
        limit: 10,
      })
      const adminPage = await service.listGallery({ isAdmin: true, limit: 10 })

      expect(nonAdminPage.items[0]?.lastDiscordRequester).toBeNull()
      expect(adminPage.items[0]?.lastDiscordRequester).toEqual({
        discordUserId: '183948273649182736',
        discordUsername: 'jeremy',
      })
      // The other half of the pair stays null on a Discord row - the two are
      // mutually exclusive at the DB layer.
      expect(adminPage.items[0]?.lastRequester).toBeNull()
    })

    it('leaves `lastDiscordRequester` null (not undefined) on a web-origin item', async () => {
      seedVideo('web-video', day(1))
      seedJob({
        id: 'web-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })

      const page = await service.listGallery({ isAdmin: true, limit: 10 })

      expect(page.items[0]).toHaveProperty('lastDiscordRequester', null)
    })

    it('never masks a movie title, even when the flag is somehow set', async () => {
      setLibrary([libraryMovie(1, day(1))])
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

    // Plan 022 follow-up. An adopted job has both identity slots null, just
    // like a masked one - `lastStartedUpstream` is what tells the card which.
    describe('lastStartedUpstream', () => {
      it('is true, for admins and non-admins alike, when the latest completed job was adopted upstream', async () => {
        setLibrary([libraryMovie(7, day(1)), libraryShow(8, day(2))])
        seedJob({
          id: 'm',
          mediaId: 'tmdb:7',
          origin: 'upstream',
          type: 'movie',
        })
        seedJob({
          id: 's',
          mediaId: 'tvdb:8',
          origin: 'upstream',
          type: 'show',
        })

        for (const isAdmin of [false, true]) {
          const page = await service.listGallery({ isAdmin, limit: 10 })

          expect(page.items).toHaveLength(2)
          for (const item of page.items) {
            expect(item).toMatchObject({
              lastDiscordRequester: null,
              lastRequester: null,
              lastStartedUpstream: true,
            })
          }
        }
      })

      it('is absent when the latest completed job had a requester', async () => {
        setLibrary([libraryMovie(7, day(1))])
        seedJob({
          id: 'm',
          mediaId: 'tmdb:7',
          origin: 'web',
          requesterEmail: 'alice@example.com',
          requesterUserId: 'u1',
          type: 'movie',
        })

        const page = await service.listGallery({ isAdmin: false, limit: 10 })

        expect(page.items[0]).not.toHaveProperty('lastStartedUpstream')
      })

      it('is absent when an older upstream job sits under a newer requested one', async () => {
        setLibrary([libraryMovie(7, day(1))])
        seedJob({
          createdAt: day(1),
          id: 'adopted',
          mediaId: 'tmdb:7',
          origin: 'upstream',
          type: 'movie',
        })
        seedJob({
          createdAt: day(2),
          id: 'requested',
          mediaId: 'tmdb:7',
          origin: 'web',
          requesterEmail: 'bob@example.com',
          requesterUserId: 'u2',
          type: 'movie',
        })

        const page = await service.listGallery({ isAdmin: false, limit: 10 })

        expect(page.items[0]).not.toHaveProperty('lastStartedUpstream')
        expect(page.items[0]?.lastRequester).toEqual({
          email: 'bob@example.com',
          userId: 'u2',
        })
      })

      it('is absent on a title nobody downloaded through this app', async () => {
        setLibrary([libraryMovie(7, day(1))])

        const page = await service.listGallery({ isAdmin: false, limit: 10 })

        expect(page.items[0]).not.toHaveProperty('lastStartedUpstream')
      })
    })

    it('narrows `?requester=` to the titles that requester has a completed job for, counting only theirs', async () => {
      setLibrary([
        libraryMovie(1, day(1)),
        libraryMovie(2, day(2)),
        libraryMovie(3, day(3)),
      ])
      seedJob({
        id: 'alice-1',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })
      seedJob({
        id: 'bob-1',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        type: 'movie',
      })
      seedJob({
        id: 'alice-2-failed',
        mediaId: 'tmdb:2',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'failed',
        type: 'movie',
      })

      const page = await service.listGallery({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
      })

      expect(page.items.map(i => [i.media.id, i.downloadCount])).toEqual([
        ['tmdb:1', 1],
      ])
      expect(page.items[0]?.lastRequester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
      expect(page.total).toBe(1)
    })

    it('applies excludeHiddenVideos for a non-admin requester-scoped lookup, hiding both the row and reducing total', async () => {
      setLibrary([libraryMovie(1, day(1))])
      seedVideo('alice-hidden-video', day(2))
      seedJob({
        hiddenAttribution: true,
        id: 'alice-hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })
      seedJob({
        id: 'alice-visible-movie',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
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

      expect(adminPage.items.map(i => i.media.id)).toEqual([
        'video:alice-hidden-video',
        'tmdb:1',
      ])
      expect(adminPage.total).toBe(2)
    })

    // The guard is for the requester-keyed lookup only: the unscoped
    // gallery still lists the hidden video, masked.
    it('keeps a hidden video in the unscoped gallery for a non-admin', async () => {
      seedVideo('hidden-video', day(1))
      seedJob({
        hiddenAttribution: true,
        id: 'hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => i.media.id)).toEqual(['video:hidden-video'])
    })

    it('narrows by type', async () => {
      setLibrary([libraryMovie(1, day(1)), libraryShow(2, day(2))])
      seedVideo('clip', day(3))

      const page = await service.listGallery({
        isAdmin: false,
        limit: 10,
        types: [DownloadType.Movie, DownloadType.Video],
      })

      expect(page.items.map(i => i.media.id)).toEqual(['video:clip', 'tmdb:1'])
      expect(page.total).toBe(2)
    })

    it('does not read Radarr/Sonarr for a video-only gallery', async () => {
      seedVideo('clip', day(1))

      const page = await service.listGallery({
        isAdmin: false,
        limit: 10,
        types: [DownloadType.Video],
      })

      expect(page.items.map(i => i.media.id)).toEqual(['video:clip'])
      expect(mediaResolver.listLibrary).not.toHaveBeenCalled()
    })

    it('filters `from`/`to` on addedAt, inclusively', async () => {
      setLibrary([
        libraryMovie(1, day(1)),
        libraryMovie(2, day(2)),
        libraryMovie(3, day(3)),
      ])
      // A job inside the range is irrelevant - the range is on the title.
      seedJob({
        createdAt: day(2),
        id: 'grab',
        mediaId: 'tmdb:1',
        type: 'movie',
      })

      const page = await service.listGallery({
        createdFrom: day(2),
        createdTo: day(3),
        isAdmin: false,
        limit: 10,
      })

      expect(page.items.map(i => i.media.id)).toEqual(['tmdb:3', 'tmdb:2'])
      expect(page.total).toBe(2)
    })

    it('answers a range with nothing in it with an empty page', async () => {
      setLibrary([libraryMovie(1, day(1))])

      const page = await service.listGallery({
        createdFrom: day(5),
        createdTo: day(6),
        isAdmin: false,
        limit: 10,
      })

      expect(page).toEqual({ items: [], nextCursor: null, total: 0 })
    })

    it('resolves only the page it renders, in one resolver call', async () => {
      setLibrary([
        libraryMovie(1, day(1)),
        libraryMovie(2, day(2)),
        libraryMovie(3, day(3)),
      ])

      await service.listGallery({ isAdmin: false, limit: 2 })

      expect(mediaResolver.resolve).toHaveBeenCalledTimes(1)
      expect(mediaResolver.resolve).toHaveBeenCalledWith([
        { mediaId: 'tmdb:3', type: DownloadType.Movie },
        { mediaId: 'tmdb:2', type: DownloadType.Movie },
      ])
    })

    // A library source that can't be read degrades the page to the others
    // rather than failing it - the same call `resolve()`'s placeholders make.
    it('lists the readable sources when one is degraded, without throwing', async () => {
      setLibrary([libraryShow(2, day(2))], [DownloadType.Movie])
      seedVideo('clip', day(1))

      const page = await service.listGallery({ isAdmin: false, limit: 10 })

      expect(page.items.map(i => i.media.id)).toEqual(['tvdb:2', 'video:clip'])
      expect(page.total).toBe(2)
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

    it('narrows by type when provided', async () => {
      seedJob({
        id: 'alice-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'video',
      })
      seedJob({
        id: 'alice-movie',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })

      const page = await service.listHistory({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
        types: [DownloadType.Movie],
      })

      expect(page.items.map(i => i.id)).toEqual(['alice-movie'])
    })

    it('narrows by status when provided', async () => {
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

      const page = await service.listHistory({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
        statuses: [DownloadJobStatus.Failed],
      })

      expect(page.items.map(i => i.id)).toEqual(['alice-failed'])
    })

    it('composes type and status filters with AND', async () => {
      seedJob({
        id: 'alice-failed-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'failed',
        type: 'video',
      })
      seedJob({
        id: 'alice-failed-movie',
        mediaId: 'tmdb:2',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'failed',
        type: 'movie',
      })
      seedJob({
        id: 'alice-completed-video',
        mediaId: 'video:alice-completed-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        status: 'completed',
        type: 'video',
      })

      const page = await service.listHistory({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
        statuses: [DownloadJobStatus.Failed],
        types: [DownloadType.Video],
      })

      expect(page.items.map(i => i.id)).toEqual(['alice-failed-video'])
    })

    it('never returns another requester even when type/status filters match their jobs', async () => {
      seedJob({
        id: 'bob-failed-video',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        status: 'failed',
        type: 'video',
      })

      const page = await service.listHistory({
        isAdmin: false,
        limit: 10,
        requesterEmail: 'alice@example.com',
        statuses: [DownloadJobStatus.Failed],
        types: [DownloadType.Video],
      })

      expect(page.items).toEqual([])
      expect(page.total).toBe(0)
    })

    // Plan 017 §E2: the Discord arm rides through to the filter alongside the
    // email, rather than replacing it or being dropped.
    it("unions a linked requester's discord jobs with their web jobs", async () => {
      const snowflake = '111111111111111111'
      seedJob({
        id: 'alice-web',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })
      seedJob({
        discordUserId: snowflake,
        discordUsername: 'alice',
        id: 'alice-discord',
        origin: 'discord',
      })
      seedJob({
        discordUserId: '222222222222222222',
        discordUsername: 'bob',
        id: 'bob-discord',
        origin: 'discord',
      })

      const page = await service.listHistory({
        isAdmin: false,
        limit: 10,
        requesterDiscordUserId: snowflake,
        requesterEmail: 'alice@example.com',
      })

      expect(page.items.map(i => i.id).sort()).toEqual([
        'alice-discord',
        'alice-web',
      ])
      expect(page.total).toBe(2)
    })

    // ⚠️ listHistory deliberately never sets `excludeHiddenVideos` - the
    // controller's self-or-admin 403 is the guard, and a non-admin may always
    // see their *own* hidden videos. Widening to two identity columns must
    // not quietly change that on the Discord side either.
    it("keeps a linked requester's own hidden discord video visible to them", async () => {
      const snowflake = '111111111111111111'
      seedJob({
        discordUserId: snowflake,
        discordUsername: 'alice',
        hiddenAttribution: true,
        id: 'alice-discord-hidden',
        origin: 'discord',
        type: 'video',
      })

      const page = await service.listHistory({
        isAdmin: false,
        limit: 10,
        requesterDiscordUserId: snowflake,
        requesterEmail: 'alice@example.com',
      })

      expect(page.items.map(i => i.id)).toEqual(['alice-discord-hidden'])
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
      setLibrary([
        libraryMovie(1, day(1)),
        libraryMovie(2, day(2)),
        libraryMovie(3, day(3)),
      ])

      const page1 = await service.listGallery({ isAdmin: false, limit: 2 })
      expect(page1.items.map(i => i.media.id)).toEqual(['tmdb:3', 'tmdb:2'])
      expect(page1.total).toBe(3)
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await service.listGallery({
        cursor: page1.nextCursor ?? undefined,
        isAdmin: false,
        limit: 2,
      })
      expect(page2.items.map(i => i.media.id)).toEqual(['tmdb:1'])
      expect(page2.total).toBe(3)
      expect(page2.nextCursor).toBeNull()
    })

    // The boundary falls inside a run of titles sharing one `addedAt`, which
    // only the media-id tiebreak can split without a skip or a repeat.
    it('pages across a boundary inside an addedAt tie without skipping or repeating', async () => {
      setLibrary([
        libraryMovie(1, day(1)),
        libraryMovie(2, day(1)),
        libraryMovie(3, day(1)),
        libraryMovie(4, day(2)),
      ])

      const seen: string[] = []
      let cursor: string | undefined
      for (let i = 0; i < 4; i++) {
        const page = await service.listGallery({
          cursor,
          isAdmin: false,
          limit: 2,
        })
        seen.push(...page.items.map(item => item.media.id))
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }

      expect(seen).toEqual(['tmdb:4', 'tmdb:1', 'tmdb:2', 'tmdb:3'])
    })

    // A title removed between two page loads must not strand the cursor.
    it('resumes after the cursor even if the title it points at has left the library', async () => {
      setLibrary([
        libraryMovie(1, day(1)),
        libraryMovie(2, day(2)),
        libraryMovie(3, day(3)),
      ])
      const page1 = await service.listGallery({ isAdmin: false, limit: 2 })

      setLibrary([libraryMovie(1, day(1)), libraryMovie(3, day(3))])
      const page2 = await service.listGallery({
        cursor: page1.nextCursor ?? undefined,
        isAdmin: false,
        limit: 2,
      })

      expect(page2.items.map(i => i.media.id)).toEqual(['tmdb:1'])
      expect(page2.nextCursor).toBeNull()
    })

    it('rejects a gallery cursor replayed under a different filter', async () => {
      setLibrary([libraryMovie(1, day(1)), libraryMovie(2, day(2))])
      const page1 = await service.listGallery({ isAdmin: false, limit: 1 })

      await expect(
        service.listGallery({
          cursor: page1.nextCursor ?? undefined,
          isAdmin: false,
          limit: 1,
          types: [DownloadType.Movie],
        }),
      ).rejects.toThrow(BadRequestException)
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
    // Plan 021: the two halves count different things - `types` the library,
    // `uploaders` the people in `jobs`.
    it('counts the library for types and completed jobs for uploaders', async () => {
      setLibrary([
        libraryMovie(1, day(1)),
        libraryMovie(2, day(1)),
        libraryShow(3, day(1)),
      ])
      seedVideo('bob-video', day(1))
      seedJob({
        id: 'alice-movie',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })
      seedJob({
        id: 'alice-movie-again',
        mediaId: 'tmdb:1',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'movie',
      })
      seedJob({
        id: 'bob-video',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
      })
      // A download of a title since removed from the library still happened,
      // and still says something about its uploader - but not about types.
      seedJob({
        id: 'carol-removed',
        mediaId: 'tmdb:99',
        origin: 'web',
        requesterEmail: 'carol@example.com',
        requesterUserId: 'u3',
        type: 'movie',
      })
      seedJob({
        id: 'bob-failed',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
        status: 'failed',
      })

      const facets = await service.getGalleryFacets({ isAdmin: false })

      expect(facets.types).toEqual([
        { count: 2, type: 'movie' },
        { count: 1, type: 'show' },
        { count: 1, type: 'video' },
      ])
      expect(
        facets.uploaders.sort((a, b) => a.email.localeCompare(b.email)),
      ).toEqual([
        { count: 2, email: 'alice@example.com' },
        { count: 1, email: 'bob@example.com' },
        { count: 1, email: 'carol@example.com' },
      ])
    })

    it('leaves out a type the library has no title of', async () => {
      setLibrary([libraryMovie(1, day(1))])

      const facets = await service.getGalleryFacets({ isAdmin: true })

      expect(facets.types).toEqual([{ count: 1, type: 'movie' }])
    })

    it('omits an uploader whose only completed row is a hidden video, for a non-admin', async () => {
      seedVideo('alice-hidden-video', day(1))
      seedJob({
        hiddenAttribution: true,
        id: 'alice-hidden-video',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
        type: 'video',
      })

      const nonAdminFacets = await service.getGalleryFacets({ isAdmin: false })
      const adminFacets = await service.getGalleryFacets({ isAdmin: true })

      expect(nonAdminFacets.uploaders).toEqual([])
      expect(adminFacets.uploaders).toEqual([
        { count: 1, email: 'alice@example.com' },
      ])
      // The type aggregate is never guarded - it leaks no identity.
      expect(nonAdminFacets.types).toEqual([{ count: 1, type: 'video' }])
    })

    it('excludes service-origin rows from the uploader facet', async () => {
      seedVideo('service-job', day(1))
      seedJob({ id: 'service-job', origin: 'service' })

      const facets = await service.getGalleryFacets({ isAdmin: true })

      expect(facets.uploaders).toEqual([])
      expect(facets.types).toEqual([{ count: 1, type: 'video' }])
    })

    it('narrows types by addedAt and uploaders by job date', async () => {
      setLibrary([libraryMovie(1, day(1)), libraryMovie(2, day(10))])
      seedJob({
        createdAt: day(1),
        id: 'before',
        origin: 'web',
        requesterEmail: 'alice@example.com',
        requesterUserId: 'u1',
      })
      seedJob({
        createdAt: day(10),
        id: 'within',
        origin: 'web',
        requesterEmail: 'bob@example.com',
        requesterUserId: 'u2',
      })

      const facets = await service.getGalleryFacets({
        createdFrom: day(5),
        isAdmin: true,
      })

      expect(facets.types).toEqual([{ count: 1, type: 'movie' }])
      expect(facets.uploaders).toEqual([{ count: 1, email: 'bob@example.com' }])
    })

    it('counts the readable sources when one is degraded, without throwing', async () => {
      setLibrary([libraryShow(2, day(1))], [DownloadType.Movie])

      const facets = await service.getGalleryFacets({ isAdmin: true })

      expect(facets.types).toEqual([{ count: 1, type: 'show' }])
    })
  })
})
