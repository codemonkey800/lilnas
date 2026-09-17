// `ShowService` imports `parseReleaseTarget` from release.service, which
// transitively reaches MediaDownloadService and its ESM-only nanoid - see
// release.service.test.ts for the same mock.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadType,
  type Episode,
  type Media,
  type Season,
} from '@lilnas/utils/download/types'
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import type { MediaFileReleaseRow } from 'src/db/schema'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { RadarrService } from 'src/media/radarr.service'
import { ShowService } from 'src/media/show.service'
import { SonarrService } from 'src/media/sonarr.service'

const MOVIE_ID = 'tmdb:27205'
const SHOW_ID = 'tvdb:81189'
const VIDEO_ID = 'video:V1StGXR8_Z5'

const SEASON: Season = {
  episodeCount: 1,
  episodeFileCount: 1,
  episodes: [
    {
      episodeNumber: 1,
      hasFile: true,
      id: 4400,
      monitored: true,
      seasonNumber: 1,
    },
  ],
  monitored: true,
  seasonNumber: 1,
  sizeOnDisk: 100,
}

/** `episodeFileId` absent is Sonarr's "no file" once `toEpisode()` has
 * dropped the zero it reports for that case. */
function episode(
  id: number,
  seasonNumber: number,
  episodeFileId?: number,
): Episode {
  return {
    episodeFileId,
    episodeNumber: id % 100,
    hasFile: episodeFileId != null,
    id,
    monitored: true,
    seasonNumber,
  }
}

function season(seasonNumber: number, episodes: Episode[]): Season {
  return {
    episodeCount: episodes.length,
    episodeFileCount: episodes.filter(e => e.episodeFileId != null).length,
    episodes,
    monitored: true,
    seasonNumber,
    sizeOnDisk: 100,
  }
}

function releaseRow(
  upstreamFileId: number,
  releaseGuid: string,
): MediaFileReleaseRow {
  return {
    downloadId: 'abc',
    episodeId: null,
    id: upstreamFileId,
    indexer: 'Some Indexer',
    indexerId: 3,
    mediaId: SHOW_ID,
    mediaType: DownloadType.Show,
    protocol: 'torrent',
    publishDate: null,
    releaseGroup: 'NTb',
    releaseGuid,
    releaseTitle: 'A Release',
    resolvedAt: new Date(0),
    size: 1_000,
    upstreamFileId,
  }
}

describe('ShowService', () => {
  let service: ShowService
  let currentReleaseService: jest.Mocked<CurrentReleaseService>
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let mediaResolverService: jest.Mocked<MediaResolverService>

  /** Makes `resolve()` answer with one resolved media, or with nothing. */
  function resolvesTo(media: Media | undefined) {
    mediaResolverService.resolve.mockResolvedValue({
      degradedSources: [],
      media: new Map(media ? [[media.id, media]] : []),
    })
  }

  // `sonarrId`/`radarrId` absent is how a resolved-but-not-in-the-library
  // title looks: `MediaResolverService` still answers for the key (from the
  // discover lookup, or with a placeholder) but has no upstream id for it.
  const show = (sonarrId?: number): Media => ({
    id: SHOW_ID,
    sonarrId,
    title: 'The Wire',
    tvdbId: 81189,
    type: DownloadType.Show,
  })

  const movie = (radarrId?: number): Media => ({
    id: MOVIE_ID,
    radarrId,
    title: 'Inception',
    tmdbId: 27205,
    type: DownloadType.Movie,
  })

  const showInLibrary = () => show(9)
  const movieInLibrary = () => movie(5)

  beforeEach(async () => {
    currentReleaseService = {
      forEpisodeFiles: jest.fn().mockResolvedValue(new Map()),
    } as unknown as jest.Mocked<CurrentReleaseService>

    radarrService = {
      deleteMovieFile: jest.fn(),
      getMovieFiles: jest.fn().mockResolvedValue([]),
      setMonitored: jest.fn(),
    } as unknown as jest.Mocked<RadarrService>

    sonarrService = {
      deleteEpisodeFile: jest.fn(),
      getEpisodeFiles: jest.fn().mockResolvedValue([]),
      getEpisodes: jest.fn().mockResolvedValue([]),
      listSeasons: jest.fn().mockResolvedValue([SEASON]),
      unmonitorScope: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<SonarrService>

    mediaResolverService = {
      invalidate: jest.fn(),
      resolve: jest.fn(),
    } as unknown as jest.Mocked<MediaResolverService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShowService,
        { provide: CurrentReleaseService, useValue: currentReleaseService },
        { provide: MediaResolverService, useValue: mediaResolverService },
        { provide: RadarrService, useValue: radarrService },
        { provide: SonarrService, useValue: sonarrService },
      ],
    }).compile()

    service = module.get<ShowService>(ShowService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
  })

  describe('listSeasons', () => {
    it('returns the seasons Sonarr reports for a library show', async () => {
      resolvesTo(showInLibrary())

      await expect(service.listSeasons(SHOW_ID)).resolves.toEqual([SEASON])
      expect(sonarrService.listSeasons).toHaveBeenCalledWith(9)
    })

    it('404s a movie key - a movie has no seasons', async () => {
      await expect(service.listSeasons(MOVIE_ID)).rejects.toThrow(
        NotFoundException,
      )
      expect(sonarrService.listSeasons).not.toHaveBeenCalled()
    })

    it.each([VIDEO_ID, 'garbage', 'tvdb:not-a-number'])(
      '404s the unusable key %s',
      async key => {
        await expect(service.listSeasons(key)).rejects.toThrow(
          NotFoundException,
        )
      },
    )

    // Deliberately not `ensureSeries`: adding a series to the library as a
    // side effect of a GET would be a genuine surprise.
    it('404s a show that is not in the library rather than adding it', async () => {
      resolvesTo(show())

      await expect(service.listSeasons(SHOW_ID)).rejects.toThrow(
        /not in the library/,
      )
      expect(sonarrService.listSeasons).not.toHaveBeenCalled()
    })
  })

  describe('listSeasons - current release', () => {
    beforeEach(() => resolvesTo(showInLibrary()))

    it('stamps the guid onto episodes with a file and leaves the rest alone', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [episode(101, 1, 991), episode(102, 1)]),
      ])
      currentReleaseService.forEpisodeFiles.mockResolvedValue(
        new Map([[991, releaseRow(991, 'guid-991')]]),
      )

      const [first] = await service.listSeasons(SHOW_ID)

      expect(first?.episodes).toEqual([
        { ...episode(101, 1, 991), currentReleaseGuid: 'guid-991' },
        episode(102, 1),
      ])
    })

    // Sonarr's history is per-series, so the whole listing is one call no
    // matter how many seasons it spans.
    it('resolves every season of a series in a single call', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [episode(101, 1, 1)]),
        season(2, [episode(201, 2, 2)]),
        season(3, [episode(301, 3, 3)]),
      ])
      currentReleaseService.forEpisodeFiles.mockResolvedValue(
        new Map([
          [1, releaseRow(1, 'guid-1')],
          [2, releaseRow(2, 'guid-2')],
          [3, releaseRow(3, 'guid-3')],
        ]),
      )

      const seasons = await service.listSeasons(SHOW_ID)

      expect(currentReleaseService.forEpisodeFiles).toHaveBeenCalledTimes(1)
      expect(currentReleaseService.forEpisodeFiles).toHaveBeenCalledWith(
        SHOW_ID,
        9,
        [1, 2, 3],
      )
      expect(
        seasons.flatMap(s => s.episodes.map(e => e.currentReleaseGuid)),
      ).toEqual(['guid-1', 'guid-2', 'guid-3'])
    })

    // `episodeFileId: 0` is Sonarr's "no file"; `toEpisode()` drops the zero,
    // so a file-less episode must never reach the resolver.
    it('does not pass a file-less episode to the resolver', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(0, [episode(1, 0)]),
        season(1, [episode(101, 1), episode(102, 1, 42)]),
      ])

      await service.listSeasons(SHOW_ID)

      expect(currentReleaseService.forEpisodeFiles).toHaveBeenCalledWith(
        SHOW_ID,
        9,
        [42],
      )
    })

    it('skips the resolver entirely when no episode has a file', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [episode(101, 1), episode(102, 1)]),
      ])

      await service.listSeasons(SHOW_ID)

      expect(currentReleaseService.forEpisodeFiles).not.toHaveBeenCalled()
    })

    // The documented degradation: `CurrentReleaseService` answers an upstream
    // failure with an empty map rather than throwing.
    it('leaves every episode unannotated when nothing resolves', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [episode(101, 1, 991)]),
      ])
      currentReleaseService.forEpisodeFiles.mockResolvedValue(new Map())

      const seasons = await service.listSeasons(SHOW_ID)

      expect(seasons[0]?.episodes[0]?.currentReleaseGuid).toBeUndefined()
    })

    // The guid is an enrichment - it is never worth failing the page over.
    it('still lists the seasons when the resolver throws', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [episode(101, 1, 991)]),
      ])
      currentReleaseService.forEpisodeFiles.mockRejectedValue(
        new Error('sonarr down'),
      )

      const seasons = await service.listSeasons(SHOW_ID)

      expect(seasons).toEqual([season(1, [episode(101, 1, 991)])])
    })
  })

  describe('deleteFiles - shows', () => {
    it('deletes the resolved files, unmonitors the scope, and invalidates the cache', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
      ])

      const scope = { episodeId: 4412, seasonNumber: 3 }
      await expect(service.deleteFiles(SHOW_ID, scope)).resolves.toBe(1)

      expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledWith(991)
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, scope)
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(SHOW_ID)
    })

    it('deletes every file of a season, sequentially', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { id: 1, seasonNumber: 3 },
        { id: 2, seasonNumber: 3 },
        { id: 3, seasonNumber: 4 },
      ])

      await expect(
        service.deleteFiles(SHOW_ID, { seasonNumber: 3 }),
      ).resolves.toBe(2)

      expect(sonarrService.deleteEpisodeFile.mock.calls).toEqual([[1], [2]])
    })

    it('deletes every file of the title when the scope is empty', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { id: 1, seasonNumber: 1 },
        { id: 2, seasonNumber: 3 },
      ])

      await expect(service.deleteFiles(SHOW_ID, {})).resolves.toBe(2)
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, {})
    })

    // The caller asked for a state, and that state already holds.
    it('treats deleting zero files as a success', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodeFiles.mockResolvedValue([])

      await expect(service.deleteFiles(SHOW_ID, {})).resolves.toBe(0)
      expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
    })

    // A monitored, file-less episode is exactly what the next RSS sync
    // re-grabs, so the unmonitor is the load-bearing half here.
    it('unmonitors even when it deleted nothing', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodeFiles.mockResolvedValue([])

      await service.deleteFiles(SHOW_ID, { seasonNumber: 3 })

      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, {
        seasonNumber: 3,
      })
    })

    // The files are already gone - failing the caller now helps nobody.
    it('swallows an unmonitor failure, logs it, and still reports the count', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodeFiles.mockResolvedValue([
        { id: 1, seasonNumber: 1 },
      ])
      sonarrService.unmonitorScope.mockRejectedValue(new Error('sonarr down'))
      const warn = jest.spyOn(Logger.prototype, 'warn')

      await expect(service.deleteFiles(SHOW_ID, {})).resolves.toBe(1)

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'sonarr down', source: 'sonarr' }),
        expect.stringContaining('failed to unmonitor'),
      )
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(SHOW_ID)
    })

    it('404s a show that is not in the library', async () => {
      resolvesTo(show())

      await expect(service.deleteFiles(SHOW_ID, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
    })
  })

  describe('deleteFiles - movies', () => {
    it('deletes the movie file and unmonitors the movie', async () => {
      resolvesTo(movieInLibrary())
      radarrService.getMovieFiles.mockResolvedValue([{ id: 77 }])

      await expect(service.deleteFiles(MOVIE_ID, {})).resolves.toBe(1)

      expect(radarrService.deleteMovieFile).toHaveBeenCalledWith(77)
      expect(radarrService.setMonitored).toHaveBeenCalledWith(5, false)
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(MOVIE_ID)
    })

    // Silently ignoring the scope would let a caller believe they had
    // deleted one episode of something that has none.
    it.each([
      ['an episodeId', { episodeId: 4412 }],
      ['a seasonNumber', { seasonNumber: 3 }],
      ['season 0', { seasonNumber: 0 }],
    ])('400s a movie delete carrying %s', async (_label, scope) => {
      await expect(service.deleteFiles(MOVIE_ID, scope)).rejects.toThrow(
        BadRequestException,
      )
      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
    })

    it('treats a movie with no file as a successful zero-delete', async () => {
      resolvesTo(movieInLibrary())
      radarrService.getMovieFiles.mockResolvedValue([])

      await expect(service.deleteFiles(MOVIE_ID, {})).resolves.toBe(0)
      expect(radarrService.setMonitored).toHaveBeenCalledWith(5, false)
    })

    it('swallows a failed movie unmonitor', async () => {
      resolvesTo(movieInLibrary())
      radarrService.getMovieFiles.mockResolvedValue([{ id: 77 }])
      radarrService.setMonitored.mockRejectedValue(new Error('radarr down'))

      await expect(service.deleteFiles(MOVIE_ID, {})).resolves.toBe(1)
    })

    it('404s a movie that is not in the library', async () => {
      resolvesTo(movie())

      await expect(service.deleteFiles(MOVIE_ID, {})).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  it.each([VIDEO_ID, 'garbage'])(
    'deleteFiles 404s the unusable key %s before touching upstream',
    async key => {
      await expect(service.deleteFiles(key, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
    },
  )
})
