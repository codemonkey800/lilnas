import {
  DownloadType,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { videos } from 'src/db/schema'
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

describe('MediaResolverService', () => {
  let service: MediaResolverService
  let dbService: DbService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaResolverService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
      ],
    }).compile()

    service = module.get(MediaResolverService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)
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

    it('omits a video key with no matching row, rather than throwing', async () => {
      const { media } = await service.resolve([
        { mediaId: 'video:missing', type: DownloadType.Video },
      ])

      expect(media.has('video:missing')).toBe(false)
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
})
