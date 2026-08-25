import {
  DownloadType,
  type Media,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import {
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { MINIO_CONNECTION } from 'nestjs-minio'
import { Readable } from 'stream'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { videos } from 'src/db/schema'
import { MediaFileService } from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { SonarrService } from 'src/media/sonarr.service'

import { createFakeMediaResolver } from './helpers/fake-media-resolver'

const MOVIE_ID = 'tmdb:27205'
const SHOW_ID = 'tvdb:81189'
const VIDEO_ID = 'video:vid-1'

const PUBLIC_BASE = 'https://storage.lilnas.io'

/** A stored download URL the way `DownloadVideoService.upload()` writes it. */
function downloadUrl(key: string): string {
  return `${PUBLIC_BASE}/videos/${key}`
}

function movie(overrides: Partial<Movie> = {}): Movie {
  return {
    id: MOVIE_ID,
    title: 'Inception',
    tmdbId: 27205,
    type: DownloadType.Movie,
    ...overrides,
  }
}

function show(overrides: Partial<Show> = {}): Show {
  return {
    id: SHOW_ID,
    sonarrId: 9,
    title: 'The Wire',
    tvdbId: 81189,
    type: DownloadType.Show,
    ...overrides,
  }
}

describe('MediaFileService', () => {
  let service: MediaFileService
  let dbService: DbService
  let resolver: ReturnType<typeof createFakeMediaResolver>
  let sonarrService: jest.Mocked<SonarrService>
  let minioClient: { getObject: jest.Mock; statObject: jest.Mock }
  let warn: jest.SpyInstance

  /** Makes the resolver answer with exactly this media, undegraded. */
  function resolvesTo(media: Media) {
    resolver.fixtures.set(media.id, media)
  }

  /**
   * Makes the resolver answer the way it does mid-outage: the source flagged
   * in `degradedSources`, and a placeholder that carries no `filePath` and no
   * `radarrId`/`sonarrId` (see `MediaResolverService.resolveMovies`).
   */
  function degrades(
    mediaId: string,
    type: DownloadType.Movie | DownloadType.Show,
  ): void {
    const placeholder: Media =
      type === DownloadType.Movie
        ? { id: mediaId, title: mediaId, tmdbId: 0, type }
        : { id: mediaId, title: mediaId, tvdbId: 0, type: DownloadType.Show }

    resolver.resolve.mockResolvedValue({
      degradedSources: [type],
      media: new Map([[mediaId, placeholder]]),
    })
  }

  function seedVideo(input: {
    downloadUrls?: string[]
    id?: string
    title?: string
  }) {
    const id = input.id ?? 'vid-1'

    dbService.db
      .insert(videos)
      .values({
        downloadUrls: input.downloadUrls,
        id,
        naturalKey: `https://example.com/${id}#-`,
        sourceUrl: `https://example.com/${id}`,
        title: input.title ?? 'A Clip',
      })
      .run()
  }

  function stats(overrides: Record<string, unknown> = {}) {
    minioClient.statObject.mockResolvedValue({
      etag: 'etag',
      lastModified: new Date(0),
      metaData: { 'content-type': 'video/mp4' },
      size: 1234,
      ...overrides,
    })
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    resolver = createFakeMediaResolver()
    minioClient = { getObject: jest.fn(), statObject: jest.fn() }

    sonarrService = {
      getEpisodeFiles: jest.fn().mockResolvedValue([]),
      getEpisodes: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<SonarrService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaFileService,
        { provide: DbService, useValue: dbService },
        { provide: MediaResolverService, useValue: resolver },
        { provide: MINIO_CONNECTION, useValue: minioClient },
        { provide: SonarrService, useValue: sonarrService },
      ],
    }).compile()

    service = module.get(MediaFileService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  describe('key parsing and scope validation', () => {
    it.each(['bogus:1', 'nonsense', '', 'tmdb', 'imdb:tt1375666'])(
      'rejects the unrecognized key %p with a 404',
      async key => {
        await expect(service.resolveFileSource(key, {})).rejects.toThrow(
          NotFoundException,
        )
      },
    )

    it('rejects a show key with no episodeId - a series is not one file', async () => {
      await expect(service.resolveFileSource(SHOW_ID, {})).rejects.toThrow(
        BadRequestException,
      )
    })

    it.each([MOVIE_ID, VIDEO_ID])(
      'rejects episodeId on the non-show key %p',
      async key => {
        await expect(
          service.resolveFileSource(key, { episodeId: 4400 }),
        ).rejects.toThrow(BadRequestException)
      },
    )

    it.each([MOVIE_ID, SHOW_ID])(
      'rejects part on the non-video key %p',
      async key => {
        await expect(
          service.resolveFileSource(key, { episodeId: 4400, part: 1 }),
        ).rejects.toThrow(BadRequestException)
      },
    )

    it('rejects a malformed scope before it costs an upstream round trip', async () => {
      await expect(
        service.resolveFileSource(MOVIE_ID, { episodeId: 4400 }),
      ).rejects.toThrow(BadRequestException)

      expect(resolver.resolve).not.toHaveBeenCalled()
    })
  })

  describe('video sources', () => {
    it('resolves the object key out of the stored download URL', async () => {
      seedVideo({ downloadUrls: [downloadUrl('job-1/part0.mp4')] })
      stats()

      await expect(service.resolveFileSource(VIDEO_ID, {})).resolves.toEqual({
        bucket: 'videos',
        contentType: 'video/mp4',
        fileName: 'A Clip.mp4',
        key: 'job-1/part0.mp4',
        kind: 'object',
        size: 1234,
      })
      expect(minioClient.statObject).toHaveBeenCalledWith(
        'videos',
        'job-1/part0.mp4',
      )
    })

    it('percent-decodes a key the stored URL had to encode', async () => {
      seedVideo({ downloadUrls: [downloadUrl('job-1/My%20Clip%232.mp4')] })
      stats()

      const source = await service.resolveFileSource(VIDEO_ID, {})

      expect(source).toMatchObject({ key: 'job-1/My Clip#2.mp4' })
    })

    it('names a single-part video after its title, with no part suffix', async () => {
      seedVideo({
        downloadUrls: [downloadUrl('job-1/part0.mp4')],
        title: 'Cat compilation',
      })
      stats()

      await expect(
        service.resolveFileSource(VIDEO_ID, { part: 0 }),
      ).resolves.toMatchObject({ fileName: 'Cat compilation.mp4' })
    })

    it('suffixes the part only when the post produced more than one', async () => {
      seedVideo({
        downloadUrls: [
          downloadUrl('job-1/part0.mp4'),
          downloadUrl('job-1/part1.mp4'),
        ],
        title: 'Cat compilation',
      })
      stats()

      await expect(
        service.resolveFileSource(VIDEO_ID, { part: 1 }),
      ).resolves.toMatchObject({
        fileName: 'Cat compilation (part 1).mp4',
        key: 'job-1/part1.mp4',
      })
    })

    it('strips separators and control characters out of the title', async () => {
      seedVideo({
        downloadUrls: [downloadUrl('job-1/part0.mp4')],
        title: 'a/b\\c\r\nd',
      })
      stats()

      await expect(
        service.resolveFileSource(VIDEO_ID, {}),
      ).resolves.toMatchObject({ fileName: 'abcd.mp4' })
    })

    it('falls back to the video id when a title sanitizes down to nothing', async () => {
      seedVideo({
        downloadUrls: [downloadUrl('job-1/part0.mp4')],
        title: '///',
      })
      stats()

      await expect(
        service.resolveFileSource(VIDEO_ID, {}),
      ).resolves.toMatchObject({ fileName: 'vid-1.mp4' })
    })

    it('falls back to the extension when the stat carries no content type', async () => {
      seedVideo({ downloadUrls: [downloadUrl('job-1/part0.webm')] })
      stats({ metaData: {} })

      await expect(
        service.resolveFileSource(VIDEO_ID, {}),
      ).resolves.toMatchObject({ contentType: 'video/webm' })
    })

    it('falls back to octet-stream when neither the stat nor the key says', async () => {
      seedVideo({ downloadUrls: [downloadUrl('job-1/part0')] })
      stats({ metaData: undefined })

      await expect(
        service.resolveFileSource(VIDEO_ID, {}),
      ).resolves.toMatchObject({
        contentType: 'application/octet-stream',
        fileName: 'A Clip',
      })
    })

    it('404s when there is no videos row behind the key', async () => {
      await expect(service.resolveFileSource(VIDEO_ID, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('404s when downloadUrls was never written - nothing was uploaded', async () => {
      seedVideo({ downloadUrls: undefined })

      await expect(service.resolveFileSource(VIDEO_ID, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(minioClient.statObject).not.toHaveBeenCalled()
    })

    it('404s when downloadUrls is an empty list', async () => {
      seedVideo({ downloadUrls: [] })

      await expect(service.resolveFileSource(VIDEO_ID, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(minioClient.statObject).not.toHaveBeenCalled()
    })

    it('404s for a part index past the end of downloadUrls', async () => {
      seedVideo({ downloadUrls: [downloadUrl('job-1/part0.mp4')] })

      await expect(
        service.resolveFileSource(VIDEO_ID, { part: 3 }),
      ).rejects.toThrow(NotFoundException)
    })

    it.each([
      ['not a URL at all', 'not-a-url'],
      ['a URL outside the videos bucket', `${PUBLIC_BASE}/other/job-1/x.mp4`],
      ['a bucket-root URL with no key', `${PUBLIC_BASE}/videos/`],
      ['a URL with a broken escape', `${PUBLIC_BASE}/videos/job-1/%zz.mp4`],
    ])('404s (never 500s) on %s', async (_label, url) => {
      seedVideo({ downloadUrls: [url] })

      await expect(service.resolveFileSource(VIDEO_ID, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(warn).toHaveBeenCalled()
    })

    it('404s when the object is gone from MinIO but the row still points at it', async () => {
      seedVideo({ downloadUrls: [downloadUrl('job-1/part0.mp4')] })
      minioClient.statObject.mockRejectedValue(
        Object.assign(new Error('Not found'), { code: 'NoSuchKey' }),
      )

      await expect(service.resolveFileSource(VIDEO_ID, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('re-throws a MinIO outage rather than calling it a missing file', async () => {
      seedVideo({ downloadUrls: [downloadUrl('job-1/part0.mp4')] })
      minioClient.statObject.mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      )

      await expect(service.resolveFileSource(VIDEO_ID, {})).rejects.toThrow(
        'connect ECONNREFUSED',
      )
    })
  })

  describe('movie sources', () => {
    it('resolves the Radarr movie file path', async () => {
      resolvesTo(movie({ filePath: '/movies/Inception (2010)/Inception.mkv' }))

      await expect(service.resolveFileSource(MOVIE_ID, {})).resolves.toEqual({
        fileName: 'Inception.mkv',
        kind: 'disk',
        path: '/movies/Inception (2010)/Inception.mkv',
      })
    })

    it('404s a movie with no file yet', async () => {
      resolvesTo(movie())

      await expect(service.resolveFileSource(MOVIE_ID, {})).rejects.toThrow(
        NotFoundException,
      )
    })

    it('503s when Radarr is degraded rather than claiming there is no file', async () => {
      degrades(MOVIE_ID, DownloadType.Movie)

      await expect(service.resolveFileSource(MOVIE_ID, {})).rejects.toThrow(
        ServiceUnavailableException,
      )
    })
  })

  describe('episode sources', () => {
    const episodes = [
      { episodeFileId: 77, id: 4400, seasonNumber: 1 },
      { episodeFileId: 0, id: 4401, seasonNumber: 1 },
    ]

    it('resolves the Sonarr episode file path, never the series folder', async () => {
      resolvesTo(show({ filePath: '/tv/The Wire' }))
      sonarrService.getEpisodes.mockResolvedValue(episodes)
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { id: 77, path: '/tv/The Wire/Season 01/S01E01.mkv' },
      ])

      await expect(
        service.resolveFileSource(SHOW_ID, { episodeId: 4400 }),
      ).resolves.toEqual({
        fileName: 'S01E01.mkv',
        kind: 'disk',
        path: '/tv/The Wire/Season 01/S01E01.mkv',
      })
      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9)
      expect(sonarrService.getEpisodeFiles).toHaveBeenCalledWith(9)
    })

    it('404s an episode id the series does not have', async () => {
      resolvesTo(show())
      sonarrService.getEpisodes.mockResolvedValue(episodes)

      await expect(
        service.resolveFileSource(SHOW_ID, { episodeId: 9999 }),
      ).rejects.toThrow(NotFoundException)
      expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
    })

    it('404s an episode Sonarr reports no file for (episodeFileId 0)', async () => {
      resolvesTo(show())
      sonarrService.getEpisodes.mockResolvedValue(episodes)

      await expect(
        service.resolveFileSource(SHOW_ID, { episodeId: 4401 }),
      ).rejects.toThrow(NotFoundException)
      expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
    })

    it('404s when the episode file has no path on it', async () => {
      resolvesTo(show())
      sonarrService.getEpisodes.mockResolvedValue(episodes)
      sonarrService.getEpisodeFiles.mockResolvedValue([{ id: 77 }])

      await expect(
        service.resolveFileSource(SHOW_ID, { episodeId: 4400 }),
      ).rejects.toThrow(NotFoundException)
    })

    it('503s when Sonarr is degraded', async () => {
      degrades(SHOW_ID, DownloadType.Show)

      await expect(
        service.resolveFileSource(SHOW_ID, { episodeId: 4400 }),
      ).rejects.toThrow(ServiceUnavailableException)
      expect(sonarrService.getEpisodes).not.toHaveBeenCalled()
    })

    it('503s a placeholder show with no sonarrId - the same outage', async () => {
      resolvesTo(show({ sonarrId: undefined }))

      await expect(
        service.resolveFileSource(SHOW_ID, { episodeId: 4400 }),
      ).rejects.toThrow(ServiceUnavailableException)
    })
  })

  describe('disk path allowlist', () => {
    it.each([
      ['/config/../secrets', '/secrets'],
      ['/etc/passwd', '/etc/passwd'],
      ['/movies', '/movies'],
      ['/tv/../etc/shadow', '/etc/shadow'],
      ['/moviesdecoy/x.mkv', '/moviesdecoy/x.mkv'],
    ])('404s and warns for the movie path %p', async (filePath, logged) => {
      resolvesTo(movie({ filePath }))

      await expect(service.resolveFileSource(MOVIE_ID, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ mediaId: MOVIE_ID, path: logged }),
        expect.stringContaining('outside the allowed library roots'),
      )
    })

    it('404s and warns for an episode path outside /tv', async () => {
      resolvesTo(show())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 77, id: 4400 },
      ])
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { id: 77, path: '/tv/../root/.ssh/id_ed25519' },
      ])

      await expect(
        service.resolveFileSource(SHOW_ID, { episodeId: 4400 }),
      ).rejects.toThrow(NotFoundException)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/root/.ssh/id_ed25519' }),
        expect.stringContaining('outside the allowed library roots'),
      )
    })
  })

  describe('getObjectStream', () => {
    it('opens the object through the injected MinIO client', async () => {
      const stream = Readable.from(['bytes'])
      minioClient.getObject.mockResolvedValue(stream)

      await expect(
        service.getObjectStream({
          bucket: 'videos',
          contentType: 'video/mp4',
          fileName: 'A Clip.mp4',
          key: 'job-1/part0.mp4',
          kind: 'object',
          size: 1234,
        }),
      ).resolves.toBe(stream)
      expect(minioClient.getObject).toHaveBeenCalledWith(
        'videos',
        'job-1/part0.mp4',
      )
    })
  })
})
