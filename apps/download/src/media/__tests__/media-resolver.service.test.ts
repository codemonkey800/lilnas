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
  let annotateCalls: Media[][]

  beforeEach(async () => {
    dbService = createTestDbService()
    const mockRadarrService = {
      getLibrary: jest.fn(),
      lookupByTmdbId: jest.fn(),
    }
    const mockSonarrService = {
      getLibrary: jest.fn(),
      lookupByTvdbId: jest.fn(),
    }
    const { annotate, calls } = captureAnnotateArgs()
    annotateCalls = calls
    const mockEmbyStatusService = { annotate }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaResolverService,
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
})
