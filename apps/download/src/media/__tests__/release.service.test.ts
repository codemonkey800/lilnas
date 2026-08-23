import { DownloadType } from '@lilnas/utils/download/types'
import { Logger, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { RadarrService } from 'src/media/radarr.service'
import { ReleaseService } from 'src/media/release.service'
import { SonarrService } from 'src/media/sonarr.service'

const MOVIE_ID = 'tmdb:27205'
const SHOW_ID = 'tvdb:81189'

function release(overrides: Record<string, unknown> = {}) {
  return {
    downloadAllowed: true,
    flaggedBad: false,
    guid: 'indexer://abc',
    indexerId: 3,
    rejected: false,
    title: 'Some.Movie.2020.1080p',
    ...overrides,
  }
}

describe('ReleaseService', () => {
  let service: ReleaseService
  let dbService: DbService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let mediaResolverService: jest.Mocked<MediaResolverService>

  beforeEach(async () => {
    // A real in-memory DbService rather than a mocked drizzle chain: the
    // repo functions take `db` directly, so a mock would be re-implementing
    // the query builder rather than testing anything.
    dbService = createTestDbService()

    radarrService = {
      deleteMovieFile: jest.fn(),
      ensureMovie: jest.fn(),
      getMovieFiles: jest.fn(),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      setMonitored: jest.fn(),
    } as unknown as jest.Mocked<RadarrService>

    sonarrService = {
      deleteEpisodeFile: jest.fn(),
      ensureSeries: jest.fn(),
      getEpisodeFiles: jest.fn(),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      setEpisodesMonitored: jest.fn(),
      setSeriesMonitored: jest.fn(),
    } as unknown as jest.Mocked<SonarrService>

    mediaResolverService = {
      invalidate: jest.fn(),
    } as unknown as jest.Mocked<MediaResolverService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReleaseService,
        { provide: DbService, useValue: dbService },
        { provide: MediaResolverService, useValue: mediaResolverService },
        { provide: RadarrService, useValue: radarrService },
        { provide: SonarrService, useValue: sonarrService },
      ],
    }).compile()

    service = module.get(ReleaseService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  describe('listReleases - target parsing', () => {
    it.each([
      ['a video key', 'video:V1StGXR8_Z5'],
      ['an unrecognized prefix', 'imdb:tt1375666'],
      ['a bare id with no prefix', '27205'],
      ['a tmdb key with a non-numeric suffix', 'tmdb:not-a-number'],
    ])('404s for %s', async (_label, mediaId) => {
      await expect(service.listReleases(mediaId)).rejects.toThrow(
        NotFoundException,
      )
      expect(radarrService.ensureMovie).not.toHaveBeenCalled()
      expect(sonarrService.ensureSeries).not.toHaveBeenCalled()
    })
  })

  describe('listReleases - movies', () => {
    it('ensures the movie, lists its releases, and restores monitoring', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: false,
      })
      radarrService.getReleases.mockResolvedValue([release()])

      const result = await service.listReleases(MOVIE_ID)

      expect(radarrService.ensureMovie).toHaveBeenCalledWith(27205)
      expect(radarrService.getReleases).toHaveBeenCalledWith(7)
      // Borrowed, so it must be put back.
      expect(radarrService.setMonitored).toHaveBeenCalledWith(7, false)
      expect(result).toEqual([release()])
    })

    // The load-bearing rule: a title with a pending requestMovie is monitored
    // on purpose, and unmonitoring it after a release listing would silently
    // kill that request.
    it('leaves an already-monitored movie strictly alone', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })
      radarrService.getReleases.mockResolvedValue([])

      await service.listReleases(MOVIE_ID)

      expect(radarrService.setMonitored).not.toHaveBeenCalled()
    })

    it('still restores monitoring when the release fetch throws', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: false,
      })
      radarrService.getReleases.mockRejectedValue(new Error('indexer down'))

      await expect(service.listReleases(MOVIE_ID)).rejects.toThrow(
        'indexer down',
      )
      expect(radarrService.setMonitored).toHaveBeenCalledWith(7, false)
    })

    // The caller asked for releases; failing their request because the
    // cleanup didn't take would be the wrong trade.
    it('swallows a failed restore and still returns the releases', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: false,
      })
      radarrService.getReleases.mockResolvedValue([release()])
      radarrService.setMonitored.mockRejectedValue(new Error('radarr down'))

      await expect(service.listReleases(MOVIE_ID)).resolves.toHaveLength(1)
    })

    it('surfaces an ensureMovie failure without attempting a restore', async () => {
      radarrService.ensureMovie.mockRejectedValue(new Error('radarr down'))

      await expect(service.listReleases(MOVIE_ID)).rejects.toThrow(
        'radarr down',
      )
      expect(radarrService.getReleases).not.toHaveBeenCalled()
      expect(radarrService.setMonitored).not.toHaveBeenCalled()
    })
  })

  describe('listReleases - shows', () => {
    it('passes the season/episode scope to both ensureSeries and getReleases', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        turnedOnEpisodeIds: [],
        wasMonitored: true,
      })
      sonarrService.getReleases.mockResolvedValue([])

      await service.listReleases(SHOW_ID, { episodeId: 4412, seasonNumber: 2 })

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(81189, {
        monitorEpisodes: { episodeId: 4412, seasonNumber: 2 },
      })
      expect(sonarrService.getReleases).toHaveBeenCalledWith(9, {
        episodeId: 4412,
        seasonNumber: 2,
      })
    })

    it('unmonitors only the episodes it turned on, then the series', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        turnedOnEpisodeIds: [101, 102],
        wasMonitored: false,
      })
      sonarrService.getReleases.mockResolvedValue([])

      await service.listReleases(SHOW_ID, { seasonNumber: 2 })

      expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
        [101, 102],
        false,
      )
      expect(sonarrService.setSeriesMonitored).toHaveBeenCalledWith(9, false)
    })

    // Series-level and episode-level monitoring are restored independently:
    // a series that was already monitored keeps its flag even though this
    // call had to switch some of its episodes on.
    it('restores episodes but not the series when the series was already monitored', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        turnedOnEpisodeIds: [101],
        wasMonitored: true,
      })
      sonarrService.getReleases.mockResolvedValue([])

      await service.listReleases(SHOW_ID, { seasonNumber: 2 })

      expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
        [101],
        false,
      )
      expect(sonarrService.setSeriesMonitored).not.toHaveBeenCalled()
    })

    it('still restores when the show release fetch throws', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        turnedOnEpisodeIds: [101],
        wasMonitored: false,
      })
      sonarrService.getReleases.mockRejectedValue(new Error('indexer down'))

      await expect(service.listReleases(SHOW_ID)).rejects.toThrow(
        'indexer down',
      )
      expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
        [101],
        false,
      )
      expect(sonarrService.setSeriesMonitored).toHaveBeenCalledWith(9, false)
    })
  })

  describe('listReleases - flaggedBad annotation', () => {
    beforeEach(() => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })
    })

    it('marks a flagged guid and leaves the others alone', async () => {
      insertBadFile(dbService.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId: MOVIE_ID,
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://bad',
      })
      radarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://good' }),
        release({ guid: 'indexer://bad' }),
      ])

      const result = await service.listReleases(MOVIE_ID)

      expect(result.map(r => [r.guid, r.flaggedBad])).toEqual([
        ['indexer://good', false],
        ['indexer://bad', true],
      ])
    })

    it('leaves every release unflagged when the title has no flags', async () => {
      radarrService.getReleases.mockResolvedValue([release()])

      const [result] = await service.listReleases(MOVIE_ID)

      expect(result?.flaggedBad).toBe(false)
    })

    // Flags are scoped to (mediaId, guid) - the same release guid flagged
    // under a different title must not bleed across.
    it('ignores a flag recorded against a different media id', async () => {
      insertBadFile(dbService.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId: 'tmdb:438631',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })
      radarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://abc' }),
      ])

      const [result] = await service.listReleases(MOVIE_ID)

      expect(result?.flaggedBad).toBe(false)
    })
  })
})
