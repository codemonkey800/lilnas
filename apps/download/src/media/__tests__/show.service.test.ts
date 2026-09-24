// `ShowService` imports `parseReleaseTarget` from release.service, which
// transitively reaches MediaDownloadService and its ESM-only nanoid - see
// release.service.test.ts for the same mock.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  type DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  type Episode,
  type Media,
  type Season,
} from '@lilnas/utils/download/types'
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import type { MediaFileReleaseRow } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import type { PollableQueueItem } from 'src/media/queue-status.util'
import { RadarrService } from 'src/media/radarr.service'
import { ShowService } from 'src/media/show.service'
import { SonarrService } from 'src/media/sonarr.service'

const MOVIE_ID = 'tmdb:27205'
const SHOW_ID = 'tvdb:81189'
const VIDEO_ID = 'video:V1StGXR8_Z5'

// A factory rather than a shared constant: `listSeasons` annotates the
// episodes it returns in place, so a shared object would carry one test's
// state into the next.
const SEASON = (): Season => ({
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
})

/** `episodeFileId` absent is Sonarr's "no file" once `toEpisode()` has
 * dropped the zero it reports for that case. */
function episode(
  id: number,
  seasonNumber: number,
  episodeFileId?: number,
  monitored = true,
): Episode {
  return {
    episodeFileId,
    episodeNumber: id % 100,
    hasFile: episodeFileId != null,
    id,
    monitored,
    seasonNumber,
  }
}

/** A Sonarr queue item for one episode of the in-library show (`sonarrId` 9). */
function queueItem(episodeId: number): PollableQueueItem {
  return {
    episodeId,
    seriesId: 9,
    size: 1000,
    sizeleft: 250,
    status: 'downloading',
    timeleft: '00:05:00',
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

const JOB_ISO = '2026-09-01T00:00:00.000Z'

function job(
  id: string,
  mediaId: string,
  status: DownloadJobStatus,
  type: DownloadType = DownloadType.Show,
): DownloadJobRecord {
  return {
    completedAt: null,
    createdAt: JOB_ISO,
    discordRequester: null,
    hiddenAttribution: false,
    id,
    linkedDiscord: null,
    mediaId,
    requester: null,
    status,
    type,
    updatedAt: JOB_ISO,
  }
}

describe('ShowService', () => {
  let service: ShowService
  let currentReleaseService: jest.Mocked<CurrentReleaseService>
  let downloadStateService: jest.Mocked<DownloadStateService>
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let mediaResolverService: jest.Mocked<MediaResolverService>
  // Real, not mocked: it is a fed in-memory cache with no dependencies, so
  // the tests seed its queue and assert on what it derives.
  let mediaStateService: MediaStateService

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

    // `deleteMovieFile`/`setMonitored` are kept only so the tests can assert
    // the pre-removal path is dead - `ShowService` no longer calls either.
    radarrService = {
      deleteMovieFile: jest.fn(),
      getMovieFiles: jest.fn().mockResolvedValue([]),
      setMonitored: jest.fn(),
      unmonitorAndDelete: jest.fn(),
    } as unknown as jest.Mocked<RadarrService>

    sonarrService = {
      deleteEpisodeFile: jest.fn(),
      getEpisodes: jest.fn().mockResolvedValue([]),
      getQueue: jest.fn().mockResolvedValue([]),
      listSeasons: jest.fn().mockImplementation(async () => [SEASON()]),
      setSeasonsMonitored: jest.fn().mockResolvedValue([]),
      unmonitorAndDelete: jest.fn(),
      unmonitorScope: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<SonarrService>

    mediaResolverService = {
      invalidate: jest.fn(),
      resolve: jest.fn(),
    } as unknown as jest.Mocked<MediaResolverService>

    // A real Map, not a mock: the cancellation pass iterates it, and the
    // set of records it holds is the whole point of these assertions.
    downloadStateService = {
      jobs: new Map<string, DownloadJobRecord>(),
      updateJob: jest.fn(),
    } as unknown as jest.Mocked<DownloadStateService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShowService,
        { provide: CurrentReleaseService, useValue: currentReleaseService },
        { provide: DownloadStateService, useValue: downloadStateService },
        { provide: MediaResolverService, useValue: mediaResolverService },
        MediaStateService,
        { provide: RadarrService, useValue: radarrService },
        { provide: SonarrService, useValue: sonarrService },
      ],
    }).compile()

    service = module.get<ShowService>(ShowService)
    mediaStateService = module.get(MediaStateService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
  })

  describe('listSeasons', () => {
    it('returns the seasons Sonarr reports for a library show', async () => {
      resolvesTo(showInLibrary())

      const expected = SEASON()

      await expect(service.listSeasons(SHOW_ID)).resolves.toEqual([
        {
          ...expected,
          episodes: expected.episodes.map(e => ({ ...e, state: 'available' })),
        },
      ])
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
        {
          ...episode(101, 1, 991),
          currentReleaseGuid: 'guid-991',
          state: 'available',
        },
        { ...episode(102, 1), state: 'wanted' },
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

      expect(seasons).toEqual([
        season(1, [{ ...episode(101, 1, 991), state: 'available' }]),
      ])
    })
  })

  describe('listSeasons - episode state', () => {
    beforeEach(() => resolvesTo(showInLibrary()))

    it('reports each episode’s state off the queue and the library', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [
          episode(101, 1),
          episode(102, 1, 991),
          episode(103, 1),
          episode(104, 1, undefined, false),
        ]),
      ])
      mediaStateService.setQueue('sonarr', [queueItem(101)])

      const [first] = await service.listSeasons(SHOW_ID)

      expect(
        first?.episodes.map(e => ({
          id: e.id,
          queueSnapshot: e.queueSnapshot,
          state: e.state,
        })),
      ).toEqual([
        {
          id: 101,
          queueSnapshot: {
            progress: 75,
            status: 'downloading',
            timeLeft: '00:05:00',
          },
          state: 'downloading',
        },
        { id: 102, queueSnapshot: undefined, state: 'available' },
        { id: 103, queueSnapshot: undefined, state: 'wanted' },
        { id: 104, queueSnapshot: undefined, state: 'absent' },
      ])
    })

    // The stored Sonarr queue is instance-wide: an item for the same episode
    // id under another series must not leak onto this one.
    it('ignores queue items for another series', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [episode(101, 1)]),
      ])
      mediaStateService.setQueue('sonarr', [
        { ...queueItem(101), seriesId: 10 },
      ])

      const [first] = await service.listSeasons(SHOW_ID)

      expect(first?.episodes[0]?.state).toBe('wanted')
      expect(first?.episodes[0]?.queueSnapshot).toBeUndefined()
    })

    // Both enrichments land on the same episode: the guid pass may copy the
    // episode, and the state must be set on the copy that is returned.
    it('keeps the current release guid alongside the state', async () => {
      sonarrService.listSeasons.mockResolvedValue([
        season(1, [episode(101, 1, 991)]),
      ])
      currentReleaseService.forEpisodeFiles.mockResolvedValue(
        new Map([[991, releaseRow(991, 'guid-991')]]),
      )

      const [first] = await service.listSeasons(SHOW_ID)

      expect(first?.episodes[0]).toMatchObject({
        currentReleaseGuid: 'guid-991',
        state: 'available',
      })
    })
  })

  describe('deleteFiles - shows', () => {
    it('deletes one episode’s file and unmonitors just that episode', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 992, id: 4413, seasonNumber: 3 },
      ])

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412, seasonNumber: 3 }),
      ).resolves.toEqual({
        cascade: 'none',
        deletedCount: 1,
        removedFromLibrary: false,
      })

      expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledWith(991)
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, {
        episodeId: 4412,
      })
      // A sibling still has a file, so the season flag is left alone and
      // the series stays in the library.
      expect(sonarrService.setSeasonsMonitored).toHaveBeenCalledWith(
        9,
        [],
        false,
      )
      expect(sonarrService.unmonitorAndDelete).not.toHaveBeenCalled()
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(SHOW_ID)
    })

    // The planner is only ever handed this series' queue - a whole-instance
    // queue would make every series look permanently "remaining".
    it('scopes the queue read to the series', async () => {
      resolvesTo(showInLibrary())

      await service.deleteFiles(SHOW_ID, { episodeId: 4412 })

      expect(sonarrService.getQueue).toHaveBeenCalledWith([9])
    })

    it('unmonitors the season when the last episode in it goes', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 900, id: 4401, seasonNumber: 1 },
      ])

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412 }),
      ).resolves.toEqual({
        cascade: 'season',
        deletedCount: 1,
        removedFromLibrary: false,
      })

      expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledWith(991)
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, {
        seasonNumber: 3,
      })
      expect(sonarrService.setSeasonsMonitored).toHaveBeenCalledWith(
        9,
        [3],
        false,
      )
      expect(sonarrService.unmonitorAndDelete).not.toHaveBeenCalled()
    })

    // Sonarr's `PUT /series` may cascade a changed season flag down to that
    // season's episodes, so the episode writes have to land first.
    it('unmonitors the episodes before it flips the season flag', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 900, id: 4401, seasonNumber: 1 },
      ])

      await service.deleteFiles(SHOW_ID, { episodeId: 4412 })

      const scopeCall = sonarrService.unmonitorScope.mock.invocationCallOrder[0]
      const flagCall =
        sonarrService.setSeasonsMonitored.mock.invocationCallOrder[0]
      expect(scopeCall).toBeLessThan(flagCall as number)
    })

    it('removes the series when the last episode of the last season goes', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
      ])

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412 }),
      ).resolves.toEqual({
        cascade: 'series',
        deletedCount: 1,
        removedFromLibrary: true,
      })

      expect(sonarrService.unmonitorAndDelete).toHaveBeenCalledWith(9, true)
      // Sonarr removes the folder itself - deleting the files first would be
      // a wasted round trip against something that is about to be gone.
      expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
      expect(sonarrService.unmonitorScope).not.toHaveBeenCalled()
      expect(sonarrService.setSeasonsMonitored).not.toHaveBeenCalled()
    })

    it('deletes every file of a season, sequentially, when another season remains', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 992, id: 4413, seasonNumber: 3 },
        { episodeFileId: 900, id: 4401, seasonNumber: 4 },
      ])

      await expect(
        service.deleteFiles(SHOW_ID, { seasonNumber: 3 }),
      ).resolves.toEqual({
        cascade: 'season',
        deletedCount: 2,
        removedFromLibrary: false,
      })

      expect(sonarrService.deleteEpisodeFile.mock.calls).toEqual([[991], [992]])
      expect(sonarrService.setSeasonsMonitored).toHaveBeenCalledWith(
        9,
        [3],
        false,
      )
    })

    it('removes the series when the deleted season was the only one left', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 992, id: 4413, seasonNumber: 3 },
      ])

      await expect(
        service.deleteFiles(SHOW_ID, { seasonNumber: 3 }),
      ).resolves.toEqual({
        cascade: 'series',
        deletedCount: 2,
        removedFromLibrary: true,
      })

      expect(sonarrService.unmonitorAndDelete).toHaveBeenCalledWith(9, true)
      expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
    })

    // A queue item is a file that is about to exist: removing the series
    // would cancel a download nobody asked to cancel.
    it('does not remove the series when another season is only in the queue', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
      ])
      sonarrService.getQueue.mockResolvedValue([{ id: 1, seasonNumber: 4 }])

      await expect(
        service.deleteFiles(SHOW_ID, { seasonNumber: 3 }),
      ).resolves.toEqual({
        cascade: 'season',
        deletedCount: 1,
        removedFromLibrary: false,
      })

      expect(sonarrService.unmonitorAndDelete).not.toHaveBeenCalled()
    })

    it('removes the series on an empty scope, counting each file once', async () => {
      resolvesTo(showInLibrary())
      // 5 backs two episodes - one multi-episode file on disk, not two.
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 5, id: 4401, seasonNumber: 1 },
        { episodeFileId: 5, id: 4402, seasonNumber: 1 },
        { episodeFileId: 6, id: 4412, seasonNumber: 3 },
      ])

      await expect(service.deleteFiles(SHOW_ID, {})).resolves.toEqual({
        cascade: 'series',
        deletedCount: 2,
        removedFromLibrary: true,
      })

      expect(sonarrService.unmonitorAndDelete).toHaveBeenCalledWith(9, true)
    })

    // The caller asked for a state, and that state already holds.
    it('treats deleting zero files as a success', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { id: 4412, seasonNumber: 3 },
        { episodeFileId: 900, id: 4413, seasonNumber: 3 },
      ])

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412 }),
      ).resolves.toEqual({
        cascade: 'none',
        deletedCount: 0,
        removedFromLibrary: false,
      })

      expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
      // A monitored, file-less episode is exactly what the next RSS sync
      // re-grabs, so the unmonitor is the load-bearing half here.
      expect(sonarrService.unmonitorScope).toHaveBeenCalledWith(9, {
        episodeId: 4412,
      })
    })

    // The files are already gone - failing the caller now helps nobody.
    it('swallows an unmonitor failure, logs it, and still reports the plan', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 992, id: 4413, seasonNumber: 3 },
      ])
      sonarrService.unmonitorScope.mockRejectedValue(new Error('sonarr down'))
      const warn = jest.spyOn(Logger.prototype, 'warn')

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412 }),
      ).resolves.toEqual({
        cascade: 'none',
        deletedCount: 1,
        removedFromLibrary: false,
      })

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'sonarr down', source: 'sonarr' }),
        expect.stringContaining('failed to unmonitor'),
      )
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(SHOW_ID)
    })

    // Same downgrade, the other call inside it.
    it('swallows a failed season-flag write too', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 900, id: 4401, seasonNumber: 1 },
      ])
      sonarrService.setSeasonsMonitored.mockRejectedValue(
        new Error('sonarr down'),
      )

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412 }),
      ).resolves.toMatchObject({ cascade: 'season', deletedCount: 1 })
    })

    // Nothing was deleted before the removal call, so there is no
    // half-finished state to report a success over.
    it('propagates a failed series removal', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
      ])
      sonarrService.unmonitorAndDelete.mockRejectedValue(
        new Error('sonarr down'),
      )

      await expect(service.deleteFiles(SHOW_ID, {})).rejects.toThrow(
        'sonarr down',
      )
    })

    it('404s a show that is not in the library', async () => {
      resolvesTo(show())

      await expect(service.deleteFiles(SHOW_ID, {})).rejects.toThrow(
        NotFoundException,
      )
      expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
      expect(sonarrService.unmonitorAndDelete).not.toHaveBeenCalled()
    })
  })

  describe('deleteFiles - movies', () => {
    it('removes the movie from Radarr and reports its file count', async () => {
      resolvesTo(movieInLibrary())
      radarrService.getMovieFiles.mockResolvedValue([{ id: 77 }])

      await expect(service.deleteFiles(MOVIE_ID, {})).resolves.toEqual({
        cascade: 'none',
        deletedCount: 1,
        removedFromLibrary: true,
      })

      expect(radarrService.unmonitorAndDelete).toHaveBeenCalledWith(5, true)
      // A movie has exactly one scope, so there is no per-file delete and
      // no monitoring state left to write.
      expect(radarrService.deleteMovieFile).not.toHaveBeenCalled()
      expect(radarrService.setMonitored).not.toHaveBeenCalled()
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
      expect(radarrService.unmonitorAndDelete).not.toHaveBeenCalled()
    })

    it('treats a movie with no file as a zero-count removal', async () => {
      resolvesTo(movieInLibrary())
      radarrService.getMovieFiles.mockResolvedValue([])

      await expect(service.deleteFiles(MOVIE_ID, {})).resolves.toEqual({
        cascade: 'none',
        deletedCount: 0,
        removedFromLibrary: true,
      })
      expect(radarrService.unmonitorAndDelete).toHaveBeenCalledWith(5, true)
    })

    it('propagates a failed removal', async () => {
      resolvesTo(movieInLibrary())
      radarrService.getMovieFiles.mockResolvedValue([{ id: 77 }])
      radarrService.unmonitorAndDelete.mockRejectedValue(
        new Error('radarr down'),
      )

      await expect(service.deleteFiles(MOVIE_ID, {})).rejects.toThrow(
        'radarr down',
      )
    })

    it('404s a movie that is not in the library', async () => {
      resolvesTo(movie())

      await expect(service.deleteFiles(MOVIE_ID, {})).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // A removal leaves the title with no upstream id, and
  // `MediaPollerService.trackedJobs` skips any job whose media resolves
  // without one - so an in-flight job the delete does not cancel here is
  // invisible to the poller until a restart fails it.
  describe('deleteFiles - cancelling the title’s in-flight jobs', () => {
    /** Makes a show delete cascade all the way to a series removal. */
    function removesTheSeries() {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
      ])
    }

    function seedJobs(...records: DownloadJobRecord[]) {
      for (const record of records) {
        downloadStateService.jobs.set(record.id, record)
      }
    }

    it('cancels a searching job when the series is removed', async () => {
      removesTheSeries()
      seedJobs(job('show-1', SHOW_ID, DownloadJobStatus.Searching))

      await service.deleteFiles(SHOW_ID, { episodeId: 4412 })

      expect(downloadStateService.updateJob).toHaveBeenCalledWith('show-1', {
        error: 'Removed from the library',
        status: DownloadJobStatus.Cancelled,
      })
    })

    it('cancels a searching job when the movie is removed', async () => {
      resolvesTo(movieInLibrary())
      seedJobs(
        job(
          'movie-1',
          MOVIE_ID,
          DownloadJobStatus.Searching,
          DownloadType.Movie,
        ),
      )

      await service.deleteFiles(MOVIE_ID, {})

      expect(downloadStateService.updateJob).toHaveBeenCalledWith('movie-1', {
        error: 'Removed from the library',
        status: DownloadJobStatus.Cancelled,
      })
    })

    it('leaves a terminal job alone', async () => {
      removesTheSeries()
      seedJobs(job('show-done', SHOW_ID, DownloadJobStatus.Completed))

      await service.deleteFiles(SHOW_ID, { episodeId: 4412 })

      expect(downloadStateService.updateJob).not.toHaveBeenCalled()
    })

    it('leaves another title’s job alone', async () => {
      removesTheSeries()
      seedJobs(job('other-1', 'tvdb:999', DownloadJobStatus.Searching))

      await service.deleteFiles(SHOW_ID, { episodeId: 4412 })

      expect(downloadStateService.updateJob).not.toHaveBeenCalled()
    })

    // The title is still in the library after a partial delete, so its jobs
    // are still pollable and keep running.
    it('cancels nothing when the delete only reaches a season', async () => {
      resolvesTo(showInLibrary())
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
        { episodeFileId: 900, id: 4401, seasonNumber: 1 },
      ])
      seedJobs(job('show-1', SHOW_ID, DownloadJobStatus.Searching))

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412 }),
      ).resolves.toMatchObject({ cascade: 'season', removedFromLibrary: false })

      expect(downloadStateService.updateJob).not.toHaveBeenCalled()
    })

    // The files are already gone upstream by the time this runs, so a
    // failed bookkeeping write is a warning, not a failed delete.
    it('swallows and logs an updateJob failure', async () => {
      removesTheSeries()
      seedJobs(
        job('show-1', SHOW_ID, DownloadJobStatus.Searching),
        job('show-2', SHOW_ID, DownloadJobStatus.Searching),
      )
      downloadStateService.updateJob.mockImplementationOnce(() => {
        throw new Error('job gone')
      })

      await expect(
        service.deleteFiles(SHOW_ID, { episodeId: 4412 }),
      ).resolves.toMatchObject({ removedFromLibrary: true })

      // The second job still gets cancelled - one bad record does not cost
      // the rest their cancellation.
      expect(downloadStateService.updateJob).toHaveBeenCalledTimes(2)
      expect(Logger.prototype.warn).toHaveBeenCalled()
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
