import {
  DownloadType,
  type Media,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { videos } from 'src/db/schema'
import { EmbyStatusService } from 'src/emby/emby-status.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import type { PollableQueueItem } from 'src/media/queue-status.util'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

function buildMovie(tmdbId: number, overrides: Partial<Movie> = {}): Movie {
  return {
    id: `tmdb:${tmdbId}`,
    title: `Movie ${tmdbId}`,
    tmdbId,
    type: DownloadType.Movie,
    ...overrides,
  }
}

function buildShow(tvdbId: number, overrides: Partial<Show> = {}): Show {
  return {
    id: `tvdb:${tvdbId}`,
    title: `Show ${tvdbId}`,
    tvdbId,
    type: DownloadType.Show,
    ...overrides,
  }
}

/**
 * Collects what `annotate()` was handed. The real service is documented to
 * iterate its argument exactly once, and `resolve()` passes a one-shot
 * `Map.values()` iterator - so a test that reads the argument twice (once to
 * assert on it, once via `toHaveBeenCalledWith`) would drain it and see an
 * empty set the second time. Snapshotting into an array at call time is the
 * only way to assert on the contents without breaking that contract.
 */
function captureAnnotateArgs(): {
  annotate: jest.Mock<Promise<void>, [Iterable<Media>]>
  calls: Media[][]
} {
  const calls: Media[][] = []
  const annotate = jest.fn(async (media: Iterable<Media>) => {
    calls.push([...media])
  })

  return { annotate, calls }
}

describe('MediaResolverService', () => {
  let service: MediaResolverService
  let dbService: DbService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let embyStatusService: jest.Mocked<EmbyStatusService>
  let mediaStateService: MediaStateService
  let annotateCalls: Media[][]

  beforeEach(async () => {
    dbService = createTestDbService()
    const mockRadarrService = {
      getLibrary: jest.fn(),
      getLibraryMovie: jest.fn(),
      lookupByTmdbId: jest.fn(),
    }
    const mockSonarrService = {
      getLibrary: jest.fn(),
      getLibraryShow: jest.fn(),
      lookupByTvdbId: jest.fn(),
    }
    const { annotate, calls } = captureAnnotateArgs()
    annotateCalls = calls
    const mockEmbyStatusService = { annotate }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaResolverService,
        // The real one, not a mock: it has no dependencies and only reads
        // memory, and its output is part of what resolve() promises.
        MediaStateService,
        { provide: DbService, useValue: dbService },
        { provide: EmbyStatusService, useValue: mockEmbyStatusService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
      ],
    }).compile()

    service = module.get(MediaResolverService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)
    embyStatusService = module.get(EmbyStatusService)
    mediaStateService = module.get(MediaStateService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
    jest.restoreAllMocks()
  })

  describe('video keys', () => {
    it('resolves a video key from the videos table', async () => {
      dbService.db
        .insert(videos)
        .values({
          id: 'vid-1',
          naturalKey: 'https://example.com/a#-',
          sourceUrl: 'https://example.com/a',
          title: 'A Video',
        })
        .run()

      const { media } = await service.resolve([
        { mediaId: 'video:vid-1', type: DownloadType.Video },
      ])

      expect(media.get('video:vid-1')).toMatchObject({
        id: 'video:vid-1',
        sourceUrl: 'https://example.com/a',
        title: 'A Video',
        type: DownloadType.Video,
      })
    })

    // Plan 021: `addedAt` is when the file landed - `updated_at` once
    // `download_urls` is set, and nothing (never "now") before then.
    it('carries updatedAt as addedAt once the video has download URLs', async () => {
      dbService.db
        .insert(videos)
        .values({
          downloadUrls: ['https://files.example.com/a.mp4'],
          id: 'vid-1',
          naturalKey: 'https://example.com/a#-',
          sourceUrl: 'https://example.com/a',
          title: 'A Video',
          updatedAt: new Date('2026-09-01T12:34:56.789Z'),
        })
        .run()

      const { media } = await service.resolve([
        { mediaId: 'video:vid-1', type: DownloadType.Video },
      ])

      expect(media.get('video:vid-1')).toMatchObject({
        addedAt: '2026-09-01T12:34:56.789Z',
        downloadUrls: ['https://files.example.com/a.mp4'],
      })
    })

    it.each([
      ['no download URLs yet', undefined],
      ['an empty download URL list', []],
    ])(
      'leaves addedAt undefined for a video with %s',
      async (_label, downloadUrls) => {
        dbService.db
          .insert(videos)
          .values({
            downloadUrls,
            id: 'vid-1',
            naturalKey: 'https://example.com/a#-',
            sourceUrl: 'https://example.com/a',
            title: 'A Video',
            updatedAt: new Date('2026-09-01T12:34:56.789Z'),
          })
          .run()

        const { media } = await service.resolve([
          { mediaId: 'video:vid-1', type: DownloadType.Video },
        ])

        expect(media.get('video:vid-1')?.addedAt).toBeUndefined()
      },
    )

    // `jobs.media_id` has no foreign key (it points at `videos` for some
    // rows and at TMDB/TVDB for others), so a dangling video key is
    // structurally possible. Answering with a placeholder rather than a gap
    // means a list endpoint degrades one card instead of dropping a job it
    // knows about - `/media/:id` still 404s such a key, by checking the row
    // directly rather than going through here.
    it('answers a video key with no matching row with a placeholder, rather than throwing or omitting it', async () => {
      const { media } = await service.resolve([
        { mediaId: 'video:missing', type: DownloadType.Video },
      ])

      expect(media.get('video:missing')).toEqual({
        id: 'video:missing',
        sourceUrl: '',
        state: 'absent',
        title: 'video:missing',
        type: DownloadType.Video,
      })
    })
  })

  describe('movie keys', () => {
    it('resolves from the whole-library cache on a hit', async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1), buildMovie(2)])

      const { degradedSources, media } = await service.resolve([
        { mediaId: 'tmdb:2', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:2')).toMatchObject({ tmdbId: 2 })
      expect(degradedSources).toEqual([])
      expect(radarrService.lookupByTmdbId).not.toHaveBeenCalled()
    })

    it('reuses the library cache across calls within the TTL window', async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1)])

      await service.resolve([{ mediaId: 'tmdb:1', type: DownloadType.Movie }])
      await service.resolve([{ mediaId: 'tmdb:1', type: DownloadType.Movie }])

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(1)
    })

    it('falls back to a per-id lookup on a cache miss', async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1)])
      radarrService.lookupByTmdbId.mockResolvedValue(buildMovie(2))

      const { media } = await service.resolve([
        { mediaId: 'tmdb:2', type: DownloadType.Movie },
      ])

      expect(radarrService.lookupByTmdbId).toHaveBeenCalledWith(2)
      expect(media.get('tmdb:2')).toMatchObject({ tmdbId: 2 })
    })

    it('returns a placeholder and flags the source as degraded when the library lookup throws', async () => {
      radarrService.getLibrary.mockRejectedValue(new Error('radarr down'))
      radarrService.lookupByTmdbId.mockRejectedValue(new Error('radarr down'))

      const { degradedSources, media } = await service.resolve([
        { mediaId: 'tmdb:5', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:5')).toEqual({
        id: 'tmdb:5',
        state: 'absent',
        title: 'tmdb:5',
        tmdbId: 5,
        type: DownloadType.Movie,
      })
      expect(degradedSources).toEqual([DownloadType.Movie])
    })

    it('returns a placeholder for a single failed per-id lookup without failing the whole batch', async () => {
      radarrService.getLibrary.mockResolvedValue([])
      radarrService.lookupByTmdbId.mockImplementation(tmdbId =>
        tmdbId === 1
          ? Promise.resolve(buildMovie(1))
          : Promise.reject(new Error('not found')),
      )

      const { degradedSources, media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
        { mediaId: 'tmdb:2', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')).toMatchObject({ tmdbId: 1 })
      expect(media.get('tmdb:2')).toMatchObject({
        id: 'tmdb:2',
        title: 'tmdb:2',
      })
      expect(degradedSources).toEqual([DownloadType.Movie])
    })
  })

  describe('show keys', () => {
    it('resolves from the whole-library cache and falls back on a miss', async () => {
      sonarrService.getLibrary.mockResolvedValue([buildShow(10)])
      sonarrService.lookupByTvdbId.mockResolvedValue(buildShow(20))

      const { media } = await service.resolve([
        { mediaId: 'tvdb:10', type: DownloadType.Show },
        { mediaId: 'tvdb:20', type: DownloadType.Show },
      ])

      expect(media.get('tvdb:10')).toMatchObject({ tvdbId: 10 })
      expect(media.get('tvdb:20')).toMatchObject({ tvdbId: 20 })
      expect(sonarrService.lookupByTvdbId).toHaveBeenCalledWith(20)
    })
  })

  // invalidate() must mean "read it fresh", never "read it from the discover
  // lookup" - that copy has no radarrId, no monitored and no file, so a title
  // that just finished downloading would resolve as `absent`.
  describe('invalidate', () => {
    const movieKey = { mediaId: 'tmdb:1', type: DownloadType.Movie } as const

    it('re-reads the library for an invalidated movie rather than looking it up', async () => {
      radarrService.getLibrary.mockResolvedValueOnce([
        buildMovie(1, { monitored: true, radarrId: 7 }),
      ])
      await service.resolve([movieKey])

      radarrService.getLibrary.mockResolvedValueOnce([
        buildMovie(1, {
          filePath: '/movies/one.mkv',
          monitored: true,
          radarrId: 7,
        }),
      ])
      service.invalidate('tmdb:1')
      const { media } = await service.resolve([movieKey])

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(2)
      expect(radarrService.lookupByTmdbId).not.toHaveBeenCalled()
      expect(media.get('tmdb:1')).toMatchObject({
        filePath: '/movies/one.mkv',
        monitored: true,
        radarrId: 7,
        state: 'available',
      })
    })

    it('caches the fresh read like any other', async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1)])
      await service.resolve([movieKey])

      service.invalidate('tmdb:1')
      await service.resolve([movieKey])
      await service.resolve([movieKey])

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(2)
    })

    it('re-reads the show library for an invalidated show', async () => {
      sonarrService.getLibrary.mockResolvedValue([buildShow(10)])
      const showKey = { mediaId: 'tvdb:10', type: DownloadType.Show } as const
      await service.resolve([showKey])

      service.invalidate('tvdb:10')
      await service.resolve([showKey])

      expect(sonarrService.getLibrary).toHaveBeenCalledTimes(2)
      expect(sonarrService.lookupByTvdbId).not.toHaveBeenCalled()
    })

    it("leaves the other source's cache alone", async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(10)])
      sonarrService.getLibrary.mockResolvedValue([buildShow(10)])
      const showKey = { mediaId: 'tvdb:10', type: DownloadType.Show } as const
      await service.resolve([
        { mediaId: 'tmdb:10', type: DownloadType.Movie },
        showKey,
      ])

      service.invalidate('tmdb:10')
      await service.resolve([showKey])

      expect(sonarrService.getLibrary).toHaveBeenCalledTimes(1)
    })

    it('ignores a video key', async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1)])
      await service.resolve([movieKey])

      service.invalidate('video:1')
      await service.resolve([movieKey])

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(1)
    })

    // A read that started before the change answers its own caller, but
    // caching it would put the pre-change copy back for a whole TTL.
    it('does not cache a library read that was in flight when it landed', async () => {
      let finishStaleRead!: (movies: Movie[]) => void
      radarrService.getLibrary.mockImplementationOnce(
        () =>
          new Promise<Movie[]>(resolve => {
            finishStaleRead = resolve
          }),
      )
      const staleResolve = service.resolve([movieKey])

      service.invalidate('tmdb:1')
      finishStaleRead([buildMovie(1, { radarrId: 7 })])
      await staleResolve

      radarrService.getLibrary.mockResolvedValueOnce([
        buildMovie(1, { filePath: '/movies/one.mkv', radarrId: 7 }),
      ])
      const { media } = await service.resolve([movieKey])

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(2)
      expect(media.get('tmdb:1')).toMatchObject({ filePath: '/movies/one.mkv' })
    })
  })

  // The poller's call: it holds a queue item's Radarr/Sonarr id, not a media
  // id, when the cached library doesn't have the title yet.
  describe('invalidateLibrary', () => {
    it('makes the next read of that library go back upstream', async () => {
      radarrService.getLibrary.mockResolvedValueOnce([])
      await service.getMovieLibrary()

      radarrService.getLibrary.mockResolvedValueOnce([
        buildMovie(1, { radarrId: 7 }),
      ])
      service.invalidateLibrary(DownloadType.Movie)
      const library = await service.getMovieLibrary()

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(2)
      expect(library.get(1)).toMatchObject({ radarrId: 7 })
    })

    it("leaves the other source's cache alone", async () => {
      radarrService.getLibrary.mockResolvedValue([])
      sonarrService.getLibrary.mockResolvedValue([])
      await Promise.all([service.getMovieLibrary(), service.getShowLibrary()])

      service.invalidateLibrary(DownloadType.Show)
      await Promise.all([service.getMovieLibrary(), service.getShowLibrary()])

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(1)
      expect(sonarrService.getLibrary).toHaveBeenCalledTimes(2)
    })
  })

  describe('invalidateAfterEnsure', () => {
    const movieKey = { mediaId: 'tmdb:1', type: DownloadType.Movie } as const

    async function libraryReadsAfter(ensured: {
      wasAdded: boolean
      wasMonitored: boolean
    }): Promise<number> {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1)])
      await service.resolve([movieKey])

      service.invalidateAfterEnsure('tmdb:1', ensured)
      await service.resolve([movieKey])

      return radarrService.getLibrary.mock.calls.length
    }

    it('re-reads the library after an ensure that added the title', async () => {
      expect(
        await libraryReadsAfter({ wasAdded: true, wasMonitored: false }),
      ).toBe(2)
    })

    it('re-reads the library after an ensure that turned monitoring on', async () => {
      expect(
        await libraryReadsAfter({ wasAdded: false, wasMonitored: false }),
      ).toBe(2)
    })

    it('keeps the cache after an ensure that changed nothing', async () => {
      expect(
        await libraryReadsAfter({ wasAdded: false, wasMonitored: true }),
      ).toBe(1)
    })
  })

  describe('listLibrary', () => {
    const movieAddedAt = '2026-03-01T10:00:00.000Z'
    const showAddedAt = '2026-04-02T12:00:00.000Z'

    function ids(entries: { media: Media }[]): string[] {
      return entries.map(entry => entry.media.id).sort()
    }

    it('lists movies with a file and shows with episode files', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { addedAt: movieAddedAt, filePath: '/movies/one.mkv' }),
        buildMovie(2, { monitored: true, radarrId: 2 }),
      ])
      sonarrService.getLibrary.mockResolvedValue([
        buildShow(10, {
          addedAt: showAddedAt,
          episodeFileCount: 3,
          filePath: '/tv/ten',
        }),
        // In the library with a series folder but nothing on disk - its
        // `filePath` must not count as a file.
        buildShow(20, {
          addedAt: showAddedAt,
          episodeFileCount: 0,
          filePath: '/tv/twenty',
        }),
        buildShow(30, { addedAt: showAddedAt, filePath: '/tv/thirty' }),
      ])

      const { degradedSources, entries } = await service.listLibrary()

      expect(ids(entries)).toEqual(['tmdb:1', 'tvdb:10'])
      expect(degradedSources).toEqual([])
    })

    it("sources addedAt from each title's own addedAt", async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { addedAt: movieAddedAt, filePath: '/movies/one.mkv' }),
      ])
      sonarrService.getLibrary.mockResolvedValue([
        buildShow(10, { addedAt: showAddedAt, episodeFileCount: 1 }),
      ])

      const { entries } = await service.listLibrary()
      const byId = new Map(entries.map(entry => [entry.media.id, entry]))

      expect(byId.get('tmdb:1')?.addedAt).toEqual(new Date(movieAddedAt))
      expect(byId.get('tvdb:10')?.addedAt).toEqual(new Date(showAddedAt))
    })

    it('leaves out a title with a file but no addedAt, rather than dating it now', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { filePath: '/movies/one.mkv' }),
      ])
      sonarrService.getLibrary.mockResolvedValue([
        buildShow(10, { addedAt: showAddedAt, episodeFileCount: 1 }),
      ])

      const { entries } = await service.listLibrary()

      expect(ids(entries)).toEqual(['tvdb:10'])
    })

    it('returns the cached media unannotated', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { addedAt: movieAddedAt, filePath: '/movies/one.mkv' }),
      ])
      sonarrService.getLibrary.mockResolvedValue([])
      const annotateState = jest.spyOn(mediaStateService, 'annotate')

      const { entries } = await service.listLibrary()

      expect(entries[0]?.media).not.toHaveProperty('state')
      expect(embyStatusService.annotate).not.toHaveBeenCalled()
      expect(annotateState).not.toHaveBeenCalled()
    })

    it('reads through the same cache resolve() uses', async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1)])
      sonarrService.getLibrary.mockResolvedValue([])

      await service.resolve([{ mediaId: 'tmdb:1', type: DownloadType.Movie }])
      await service.listLibrary()

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(1)
    })

    it('omits a source that is down and reports it degraded, without throwing', async () => {
      radarrService.getLibrary.mockRejectedValue(new Error('radarr down'))
      sonarrService.getLibrary.mockResolvedValue([
        buildShow(10, { addedAt: showAddedAt, episodeFileCount: 1 }),
      ])

      const { degradedSources, entries } = await service.listLibrary()

      expect(ids(entries)).toEqual(['tvdb:10'])
      expect(degradedSources).toEqual([DownloadType.Movie])
    })

    // Inside FAILURE_TTL_MS the read answers with an empty map instead of
    // throwing - that is still an unreachable source, not an empty library.
    it('keeps reporting a source degraded while its failure is cached', async () => {
      radarrService.getLibrary.mockResolvedValue([])
      sonarrService.getLibrary.mockRejectedValue(new Error('sonarr down'))

      await service.listLibrary()
      const { degradedSources } = await service.listLibrary()

      expect(sonarrService.getLibrary).toHaveBeenCalledTimes(1)
      expect(degradedSources).toEqual([DownloadType.Show])
    })

    it('does not report an empty library as degraded', async () => {
      radarrService.getLibrary.mockResolvedValue([])
      sonarrService.getLibrary.mockResolvedValue([])

      await service.listLibrary()
      const { degradedSources, entries } = await service.listLibrary()

      expect(entries).toEqual([])
      expect(degradedSources).toEqual([])
    })
  })

  it('resolves a mixed-type key list in one call', async () => {
    dbService.db
      .insert(videos)
      .values({
        id: 'vid-1',
        naturalKey: 'https://example.com/a#-',
        sourceUrl: 'https://example.com/a',
        title: 'A Video',
      })
      .run()
    radarrService.getLibrary.mockResolvedValue([buildMovie(1)])
    sonarrService.getLibrary.mockResolvedValue([buildShow(10)])

    const { media } = await service.resolve([
      { mediaId: 'video:vid-1', type: DownloadType.Video },
      { mediaId: 'tmdb:1', type: DownloadType.Movie },
      { mediaId: 'tvdb:10', type: DownloadType.Show },
    ])

    expect(media.size).toBe(3)
    expect(media.get('video:vid-1')?.type).toBe(DownloadType.Video)
    expect(media.get('tmdb:1')?.type).toBe(DownloadType.Movie)
    expect(media.get('tvdb:10')?.type).toBe(DownloadType.Show)
  })

  // EmbyStatusService is the one collaborator that runs *after* resolution
  // rather than producing any of it. What these pin down is the seam, not
  // Emby behaviour (emby-status.service.test.ts owns that): that it is
  // handed the finished media exactly once per resolve, that its in-place
  // mutations reach the caller, and that it can never take resolve() down.
  describe('Emby annotation', () => {
    it('hands every resolved movie and show to EmbyStatusService, in one batched call', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { filePath: '/media/movies/Movie 1' }),
      ])
      sonarrService.getLibrary.mockResolvedValue([
        buildShow(10, { filePath: '/media/tv/Show 10' }),
      ])

      await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
        { mediaId: 'tvdb:10', type: DownloadType.Show },
      ])

      // One call, not one per key - resolve() runs on a 10s cron, so a
      // per-key call would multiply Emby traffic by the page size.
      expect(embyStatusService.annotate).toHaveBeenCalledTimes(1)
      expect(annotateCalls[0]).toHaveLength(2)
      expect(annotateCalls[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'tmdb:1', tmdbId: 1 }),
          expect.objectContaining({ id: 'tvdb:10', tvdbId: 10 }),
        ]),
      )
    })

    // annotate() mutates in place and returns void, so the only way its work
    // reaches a caller is by resolve() returning the same objects it passed
    // in - a defensive copy anywhere in between would silently drop every
    // badge.
    it('returns the media objects EmbyStatusService annotated in place', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { filePath: '/media/movies/Movie 1' }),
      ])
      embyStatusService.annotate.mockImplementation(async items => {
        for (const item of items) {
          if (item.type !== DownloadType.Movie) continue
          item.embyStatus = {
            itemId: 'emby-1',
            state: 'indexed',
            watchUrl:
              'https://emby.example.com/web/index.html#!/item?id=emby-1',
          }
        }
      })

      const { media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')).toMatchObject({
        embyStatus: {
          itemId: 'emby-1',
          state: 'indexed',
          watchUrl: 'https://emby.example.com/web/index.html#!/item?id=emby-1',
        },
      })
    })

    // Called unconditionally rather than gated on "are there any managed
    // media": annotate() already returns before any HTTP call when nothing
    // has a filePath, and a second copy of that test here would be a second
    // thing to keep in sync. A video has no embyStatus field at all, so
    // nothing is written either way.
    it('still calls EmbyStatusService for a video-only resolve, which costs nothing', async () => {
      dbService.db
        .insert(videos)
        .values({
          id: 'vid-1',
          naturalKey: 'https://example.com/a#-',
          sourceUrl: 'https://example.com/a',
          title: 'A Video',
        })
        .run()

      const { media } = await service.resolve([
        { mediaId: 'video:vid-1', type: DownloadType.Video },
      ])

      expect(embyStatusService.annotate).toHaveBeenCalledTimes(1)
      expect(annotateCalls[0]).toEqual([
        expect.objectContaining({ id: 'video:vid-1' }),
      ])
      expect(media.get('video:vid-1')).not.toHaveProperty('embyStatus')
    })

    // A failed Radarr/Sonarr lookup yields a placeholder with no filePath,
    // which annotate() skips on its own. resolve() deliberately does no
    // filtering of its own, so the placeholder goes through like anything
    // else - one code path, not two.
    it('passes placeholder media through without special-casing it', async () => {
      radarrService.getLibrary.mockRejectedValue(new Error('radarr down'))
      radarrService.lookupByTmdbId.mockRejectedValue(new Error('radarr down'))

      const { degradedSources } = await service.resolve([
        { mediaId: 'tmdb:5', type: DownloadType.Movie },
      ])

      expect(annotateCalls[0]).toEqual([
        expect.objectContaining({ id: 'tmdb:5', title: 'tmdb:5' }),
      ])
      // Emby is not a DownloadType and never joins degradedSources - a
      // per-title `unknown` carries that signal instead.
      expect(degradedSources).toEqual([DownloadType.Movie])
    })

    // EmbyStatusService is contractually incapable of rejecting, so this
    // asserts the guard rather than a live path: resolve() backs every list
    // endpoint and the poller, and a future regression in Emby annotation
    // must cost a badge, not the whole page.
    it('returns its normal payload even if annotation rejects', async () => {
      radarrService.getLibrary.mockResolvedValue([buildMovie(1)])
      embyStatusService.annotate.mockRejectedValue(new Error('emby exploded'))

      const { degradedSources, media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')).toMatchObject({ id: 'tmdb:1', tmdbId: 1 })
      expect(media.get('tmdb:1')).not.toHaveProperty('embyStatus')
      expect(degradedSources).toEqual([])
    })
  })

  // Plan 021: every media resolve() returns carries a `state`. The derivation
  // rules belong to media-state.service.test.ts; these pin the seam - that
  // each type and a placeholder come back annotated, and that the queue the
  // poller feeds MediaStateService reaches the resolved media.
  describe('state annotation', () => {
    it('marks a movie with a file available', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, {
          filePath: '/media/movies/Movie 1',
          monitored: true,
          radarrId: 11,
        }),
      ])

      const { media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')?.state).toBe('available')
    })

    it('marks a monitored movie with no file wanted', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { monitored: true, radarrId: 11 }),
      ])

      const { media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')?.state).toBe('wanted')
    })

    it('marks a show with episode files available', async () => {
      sonarrService.getLibrary.mockResolvedValue([
        buildShow(10, {
          episodeCount: 10,
          episodeFileCount: 3,
          filePath: '/media/tv/Show 10',
          monitored: true,
          sonarrId: 21,
        }),
      ])

      const { media } = await service.resolve([
        { mediaId: 'tvdb:10', type: DownloadType.Show },
      ])

      expect(media.get('tvdb:10')?.state).toBe('available')
    })

    it('marks a video with download URLs available', async () => {
      dbService.db
        .insert(videos)
        .values({
          downloadUrls: ['https://files.example.com/a.mp4'],
          id: 'vid-1',
          naturalKey: 'https://example.com/a#-',
          sourceUrl: 'https://example.com/a',
          title: 'A Video',
        })
        .run()

      const { media } = await service.resolve([
        { mediaId: 'video:vid-1', type: DownloadType.Video },
      ])

      expect(media.get('video:vid-1')?.state).toBe('available')
    })

    it('marks a placeholder for an unreachable source absent', async () => {
      radarrService.getLibrary.mockRejectedValue(new Error('radarr down'))
      radarrService.lookupByTmdbId.mockRejectedValue(new Error('radarr down'))

      const { media } = await service.resolve([
        { mediaId: 'tmdb:5', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:5')?.state).toBe('absent')
      expect(media.get('tmdb:5')).not.toHaveProperty('queueSnapshot')
    })

    it('marks a movie with a queue item downloading, with its snapshot', async () => {
      const item: PollableQueueItem = {
        movieId: 11,
        size: 1000,
        sizeleft: 250,
        status: 'downloading',
        timeleft: '00:05:00',
      }
      mediaStateService.setQueue('radarr', [item])
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { monitored: true, radarrId: 11 }),
      ])

      const { media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')).toMatchObject({
        queueSnapshot: {
          progress: 75,
          status: 'downloading',
          timeLeft: '00:05:00',
        },
        state: 'downloading',
      })
    })

    // The two annotators write disjoint fields, so neither can clobber the
    // other's work on the same object.
    it('keeps the Emby status alongside the state', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { filePath: '/media/movies/Movie 1', radarrId: 11 }),
      ])
      embyStatusService.annotate.mockImplementation(async items => {
        for (const item of items) {
          if (item.type !== DownloadType.Movie) continue
          item.embyStatus = { state: 'indexing' }
        }
      })

      const { media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')).toMatchObject({
        embyStatus: { state: 'indexing' },
        state: 'available',
      })
    })

    // The Emby guard sits before the state annotation, so a throwing Emby
    // must not cost the state too.
    it('still annotates state when Emby annotation rejects', async () => {
      radarrService.getLibrary.mockResolvedValue([
        buildMovie(1, { monitored: true, radarrId: 11 }),
      ])
      embyStatusService.annotate.mockRejectedValue(new Error('emby exploded'))

      const { media } = await service.resolve([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])

      expect(media.get('tmdb:1')?.state).toBe('wanted')
    })
  })

  describe('library changes', () => {
    const WITH_FILE = { filePath: '/movies/1.mkv', radarrId: 11 }

    function listen(): string[][] {
      const changes: string[][] = []
      service.onLibraryChange(ids => changes.push([...ids]))
      return changes
    }

    it('takes the first read as the baseline and reports nothing', async () => {
      const changes = listen()
      radarrService.getLibrary.mockResolvedValue([buildMovie(1, WITH_FILE)])

      await service.getMovieLibrary()

      expect(changes).toEqual([])
    })

    it('reports titles removed, added and changed between reads', async () => {
      const changes = listen()
      radarrService.getLibrary.mockResolvedValueOnce([
        buildMovie(1, WITH_FILE),
        buildMovie(2, { radarrId: 12 }),
        buildMovie(3, { radarrId: 13 }),
      ])
      await service.getMovieLibrary()

      radarrService.getLibrary.mockResolvedValueOnce([
        // 1: file deleted; 2: gone from Radarr; 3: untouched; 4: added.
        buildMovie(1, { radarrId: 11 }),
        buildMovie(3, { radarrId: 13 }),
        buildMovie(4, { radarrId: 14 }),
      ])
      await service.refreshLibrary(DownloadType.Movie)

      expect(changes).toHaveLength(1)
      expect([...(changes[0] ?? [])].sort()).toEqual([
        'tmdb:1',
        'tmdb:2',
        'tmdb:4',
      ])
    })

    it('ignores metadata that moved without the library state', async () => {
      const changes = listen()
      radarrService.getLibrary.mockResolvedValueOnce([buildMovie(1, WITH_FILE)])
      await service.getMovieLibrary()

      radarrService.getLibrary.mockResolvedValueOnce([
        buildMovie(1, { ...WITH_FILE, title: 'Renamed' }),
      ])
      await service.refreshLibrary(DownloadType.Movie)

      expect(changes).toEqual([])
    })

    it('reports a show whose episode files changed', async () => {
      const changes = listen()
      sonarrService.getLibrary.mockResolvedValueOnce([
        buildShow(7, { episodeFileCount: 3, sonarrId: 70 }),
      ])
      await service.getShowLibrary()

      sonarrService.getLibrary.mockResolvedValueOnce([
        buildShow(7, { episodeFileCount: 2, sonarrId: 70 }),
      ])
      await service.refreshLibrary(DownloadType.Show)

      expect(changes).toEqual([['tvdb:7']])
    })

    it('refreshLibrary re-reads upstream inside the TTL', async () => {
      radarrService.getLibrary.mockResolvedValue([])

      await service.getMovieLibrary()
      await service.getMovieLibrary()
      await service.refreshLibrary(DownloadType.Movie)

      expect(radarrService.getLibrary).toHaveBeenCalledTimes(2)
    })

    it('keeps the last good baseline across a failed read', async () => {
      const changes = listen()
      radarrService.getLibrary.mockResolvedValueOnce([buildMovie(1, WITH_FILE)])
      await service.getMovieLibrary()

      radarrService.getLibrary.mockRejectedValueOnce(new Error('down'))
      await expect(service.refreshLibrary(DownloadType.Movie)).rejects.toThrow()

      radarrService.getLibrary.mockResolvedValueOnce([buildMovie(1, WITH_FILE)])
      await service.refreshLibrary(DownloadType.Movie)

      expect(changes).toEqual([])
    })

    describe('refreshTitles', () => {
      it('does nothing before the library has been read once', async () => {
        await service.refreshTitles(['tmdb:1'])

        expect(radarrService.getLibraryMovie).not.toHaveBeenCalled()
      })

      it('patches a removed title out, so it resolves as not in the library', async () => {
        const changes = listen()
        radarrService.getLibrary.mockResolvedValue([buildMovie(1, WITH_FILE)])
        await service.getMovieLibrary()
        radarrService.getLibraryMovie.mockResolvedValue(undefined)
        radarrService.lookupByTmdbId.mockResolvedValue(buildMovie(1))

        await service.refreshTitles(['tmdb:1'])

        expect(radarrService.getLibraryMovie).toHaveBeenCalledWith(1)
        expect(changes).toEqual([['tmdb:1']])
        const { media } = await service.resolve([
          { mediaId: 'tmdb:1', type: DownloadType.Movie },
        ])
        expect(media.get('tmdb:1')).toMatchObject({ state: 'absent' })
        // Served from the patched cache, not a fresh whole-library read.
        expect(radarrService.getLibrary).toHaveBeenCalledTimes(1)
      })

      it('patches a changed title in', async () => {
        const changes = listen()
        radarrService.getLibrary.mockResolvedValue([buildMovie(1, WITH_FILE)])
        await service.getMovieLibrary()
        radarrService.getLibraryMovie.mockResolvedValue(
          buildMovie(1, { radarrId: 11 }),
        )

        await service.refreshTitles(['tmdb:1'])

        expect(changes).toEqual([['tmdb:1']])
        const library = await service.getMovieLibrary()
        expect(library.get(1)?.filePath).toBeUndefined()
      })

      it('reports nothing when the title is unchanged', async () => {
        const changes = listen()
        radarrService.getLibrary.mockResolvedValue([buildMovie(1, WITH_FILE)])
        await service.getMovieLibrary()
        radarrService.getLibraryMovie.mockResolvedValue(
          buildMovie(1, WITH_FILE),
        )

        await service.refreshTitles(['tmdb:1'])

        expect(changes).toEqual([])
      })

      it('does not report the same change again on the next full read', async () => {
        const changes = listen()
        radarrService.getLibrary.mockResolvedValueOnce([
          buildMovie(1, WITH_FILE),
        ])
        await service.getMovieLibrary()
        radarrService.getLibraryMovie.mockResolvedValue(undefined)
        await service.refreshTitles(['tmdb:1'])

        radarrService.getLibrary.mockResolvedValueOnce([])
        await service.refreshLibrary(DownloadType.Movie)

        expect(changes).toEqual([['tmdb:1']])
      })

      it('leaves a title whose read failed alone', async () => {
        const changes = listen()
        radarrService.getLibrary.mockResolvedValue([buildMovie(1, WITH_FILE)])
        await service.getMovieLibrary()
        radarrService.getLibraryMovie.mockRejectedValue(new Error('down'))

        await expect(service.refreshTitles(['tmdb:1'])).resolves.toBeUndefined()

        expect(changes).toEqual([])
      })

      it('drops a batch that an invalidate overtook', async () => {
        const changes = listen()
        radarrService.getLibrary.mockResolvedValue([buildMovie(1, WITH_FILE)])
        await service.getMovieLibrary()
        radarrService.getLibraryMovie.mockImplementation(async () => {
          service.invalidateLibrary(DownloadType.Movie)
          return undefined
        })

        await service.refreshTitles(['tmdb:1'])

        expect(changes).toEqual([])
      })

      it('reads shows through Sonarr', async () => {
        const changes = listen()
        sonarrService.getLibrary.mockResolvedValue([
          buildShow(7, { episodeFileCount: 1, sonarrId: 70 }),
        ])
        await service.getShowLibrary()
        sonarrService.getLibraryShow.mockResolvedValue(
          buildShow(7, { episodeFileCount: 0, sonarrId: 70 }),
        )

        await service.refreshTitles(['tvdb:7', 'video:abc'])

        expect(sonarrService.getLibraryShow).toHaveBeenCalledWith(7)
        expect(changes).toEqual([['tvdb:7']])
      })
    })
  })
})
