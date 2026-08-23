// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// MediaDownloadService) must mock it first - see
// media-download.service.test.ts for the same pattern.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  type DownloadJob,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { ConflictException, Logger, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { RadarrService } from 'src/media/radarr.service'
import { ReleaseService } from 'src/media/release.service'
import { SonarrService } from 'src/media/sonarr.service'

const MOVIE_ID = 'tmdb:27205'
const SHOW_ID = 'tvdb:81189'

const ALICE = { email: 'alice@example.com', userId: 'user_1' }

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

/** The arguments the last `MediaDownloadService.request()` call received. */
interface CapturedRequest {
  action: string
  mediaId: string
  requester?: { email: string; userId: string } | null
  type: DownloadType
  upstreamId: number
}

describe('ReleaseService', () => {
  let service: ReleaseService
  let dbService: DbService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let mediaResolverService: jest.Mocked<MediaResolverService>
  let mediaDownloadService: jest.Mocked<MediaDownloadService>
  let captured: CapturedRequest | undefined

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
      getEpisodes: jest.fn(),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      setEpisodesMonitored: jest.fn(),
      setSeriesMonitored: jest.fn(),
    } as unknown as jest.Mocked<SonarrService>

    mediaResolverService = {
      invalidate: jest.fn(),
    } as unknown as jest.Mocked<MediaResolverService>

    captured = undefined
    // Mirrors the real `request()` contract rather than stubbing it out: it
    // runs `submit()`, and a submit failure becomes a Failed job rather than
    // a throw - which is exactly how requestMovie already behaves, and what
    // "the grab reuses the same choke point" has to mean to be worth
    // asserting.
    mediaDownloadService = {
      request: jest.fn(async ({ submit, ...rest }) => {
        captured = rest as CapturedRequest
        const base = {
          completedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          hiddenAttribution: false,
          id: 'job-1',
          media: { id: rest.mediaId, title: 't', tmdbId: 1, type: rest.type },
          requester: rest.requester ?? null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        }

        try {
          await submit()
          return { ...base, status: DownloadJobStatus.Searching } as DownloadJob
        } catch (err) {
          return {
            ...base,
            error: getErrorMessage(err),
            status: DownloadJobStatus.Failed,
          } as DownloadJob
        }
      }),
    } as unknown as jest.Mocked<MediaDownloadService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReleaseService,
        { provide: DbService, useValue: dbService },
        { provide: MediaDownloadService, useValue: mediaDownloadService },
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

  describe('grabRelease', () => {
    const input = { guid: 'indexer://abc', indexerId: 3 }

    it('creates the job through MediaDownloadService with the right attribution', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(mediaDownloadService.request).toHaveBeenCalledTimes(1)
      expect(captured).toEqual({
        action: 'grabRelease',
        mediaId: MOVIE_ID,
        requester: ALICE,
        type: DownloadType.Movie,
        upstreamId: 27205,
      })
      expect(radarrService.grabRelease).toHaveBeenCalledWith('indexer://abc', 3)
      expect(job.status).toBe(DownloadJobStatus.Searching)
    })

    it('creates an unattributed job for a service caller with no identity', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })

      const job = await service.grabRelease(MOVIE_ID, input)

      expect(captured?.requester).toBeUndefined()
      expect(job.requester).toBeNull()
    })

    // The one place the restore is skipped: the user picked this release, so
    // the title stays monitored and Radarr manages the import and upgrades.
    it('leaves a freshly-added movie monitored after a successful grab', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: false,
      })

      await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.setMonitored).not.toHaveBeenCalled()
    })

    it('leaves the target episodes monitored after a successful show grab', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        turnedOnEpisodeIds: [101],
        wasMonitored: false,
      })

      await service.grabRelease(
        SHOW_ID,
        { ...input, episodeId: 4412, seasonNumber: 2 },
        ALICE,
      )

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(81189, {
        monitorEpisodes: { episodeId: 4412, seasonNumber: 2 },
      })
      expect(sonarrService.grabRelease).toHaveBeenCalledWith('indexer://abc', 3)
      expect(sonarrService.setEpisodesMonitored).not.toHaveBeenCalled()
      expect(sonarrService.setSeriesMonitored).not.toHaveBeenCalled()
    })

    it('refuses a flagged guid with a 409, before any job exists', async () => {
      insertBadFile(dbService.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId: MOVIE_ID,
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Some.Movie.2020.1080p',
      })

      await expect(service.grabRelease(MOVIE_ID, input, ALICE)).rejects.toThrow(
        ConflictException,
      )
      expect(mediaDownloadService.request).not.toHaveBeenCalled()
      expect(radarrService.grabRelease).not.toHaveBeenCalled()
    })

    it('allows a guid flagged only under a different title', async () => {
      insertBadFile(dbService.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId: 'tmdb:438631',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })

      await expect(
        service.grabRelease(MOVIE_ID, input, ALICE),
      ).resolves.toMatchObject({ status: DownloadJobStatus.Searching })
    })

    it('404s for a video media id without touching either service', async () => {
      await expect(
        service.grabRelease('video:V1StGXR8_Z5', input, ALICE),
      ).rejects.toThrow(NotFoundException)
      expect(mediaDownloadService.request).not.toHaveBeenCalled()
    })

    // Same shape requestMovie already has: the failure lands on the job, so
    // the caller sees *which* request failed and why rather than a bare 500.
    it('records an upstream grab failure on the job rather than throwing', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })
      radarrService.grabRelease.mockRejectedValue(
        new Error('Indexer unavailable'),
      )

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toContain('Indexer unavailable')
    })

    it('records an ensureMovie failure on the job too', async () => {
      radarrService.ensureMovie.mockRejectedValue(new Error('radarr down'))

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(radarrService.grabRelease).not.toHaveBeenCalled()
    })
  })

  describe('replaceRelease', () => {
    const input = { guid: 'indexer://new', indexerId: 3 }

    beforeEach(() => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        turnedOnEpisodeIds: [],
        wasMonitored: true,
      })
    })

    it('deletes every existing movie file, invalidates, then grabs - in that order', async () => {
      const order: string[] = []
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }, { id: 12 }])
      radarrService.deleteMovieFile.mockImplementation(async id => {
        order.push(`delete:${id}`)
      })
      mediaResolverService.invalidate.mockImplementation(() => {
        order.push('invalidate')
      })
      radarrService.grabRelease.mockImplementation(async () => {
        order.push('grab')
      })

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(order).toEqual(['delete:11', 'delete:12', 'invalidate', 'grab'])
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(MOVIE_ID)
      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(captured?.action).toBe('replaceRelease')
    })

    // Per-file deletes only. unmonitorAndDelete would take the whole movie
    // with it, leaving the replacement nowhere to import to.
    it('never reaches for the whole-title delete', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }])

      await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.deleteMovieFile).toHaveBeenCalledWith(11)
      expect(
        (radarrService as unknown as { unmonitorAndDelete?: jest.Mock })
          .unmonitorAndDelete,
      ).toBeUndefined()
    })

    it('treats zero existing files as a plain grab, not an error', async () => {
      radarrService.getMovieFiles.mockResolvedValue([])

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.deleteMovieFile).not.toHaveBeenCalled()
      expect(radarrService.grabRelease).toHaveBeenCalledWith('indexer://new', 3)
      expect(job.status).toBe(DownloadJobStatus.Searching)
    })

    it('skips a file Radarr returned with no id', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{}, { id: 12 }])

      await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.deleteMovieFile).toHaveBeenCalledTimes(1)
      expect(radarrService.deleteMovieFile).toHaveBeenCalledWith(12)
    })

    // The grab is what the user asked for; if it fails after the delete
    // landed, the job says so rather than the API pretending it worked.
    it('surfaces a grab failure on the job even though the delete succeeded', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }])
      radarrService.grabRelease.mockRejectedValue(new Error('Indexer refused'))

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.deleteMovieFile).toHaveBeenCalledWith(11)
      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toContain('Indexer refused')
    })

    it('does not grab when the delete itself fails', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }])
      radarrService.deleteMovieFile.mockRejectedValue(new Error('locked'))

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.grabRelease).not.toHaveBeenCalled()
      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toContain('locked')
    })

    it('refuses a flagged replacement guid with a 409, deleting nothing', async () => {
      insertBadFile(dbService.db, {
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        mediaId: MOVIE_ID,
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://new',
      })

      await expect(
        service.replaceRelease(MOVIE_ID, input, ALICE),
      ).rejects.toThrow(ConflictException)
      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
      expect(radarrService.deleteMovieFile).not.toHaveBeenCalled()
    })

    // A downloaded-then-manually-unmonitored title would otherwise fail the
    // grab, which is why replace still goes through withMonitoring.
    it('re-monitors an unmonitored movie and does not restore it afterwards', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: false,
      })
      radarrService.getMovieFiles.mockResolvedValue([])

      await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.setMonitored).not.toHaveBeenCalled()
    })

    describe('shows', () => {
      it('deletes only the requested season when one is given', async () => {
        sonarrService.getEpisodeFiles.mockResolvedValue([
          { id: 21, seasonNumber: 1 },
          { id: 22, seasonNumber: 2 },
          { id: 23, seasonNumber: 2 },
        ])

        await service.replaceRelease(
          SHOW_ID,
          { ...input, seasonNumber: 2 },
          ALICE,
        )

        expect(sonarrService.deleteEpisodeFile.mock.calls.flat()).toEqual([
          22, 23,
        ])
      })

      it('deletes every season when no season is given', async () => {
        sonarrService.getEpisodeFiles.mockResolvedValue([
          { id: 21, seasonNumber: 1 },
          { id: 22, seasonNumber: 2 },
        ])

        await service.replaceRelease(SHOW_ID, input, ALICE)

        expect(sonarrService.deleteEpisodeFile.mock.calls.flat()).toEqual([
          21, 22,
        ])
      })

      // Sonarr's episode-file list carries seasonNumber but no episode id, so
      // a single-episode scope has to resolve the file the other way round.
      it('resolves a single episode to its file before deleting', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { episodeFileId: 31, id: 4411 },
          { episodeFileId: 32, id: 4412 },
        ])

        await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 4412, seasonNumber: 2 },
          ALICE,
        )

        expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9, {
          seasonNumber: 2,
        })
        expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledTimes(1)
        expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledWith(32)
        expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
      })

      // Sonarr reports `episodeFileId: 0` for an episode with no file - a
      // null guard would have tried to delete file 0.
      it('deletes nothing when the target episode has no file yet', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { episodeFileId: 0, id: 4412 },
        ])

        const job = await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 4412 },
          ALICE,
        )

        expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
        expect(sonarrService.grabRelease).toHaveBeenCalled()
        expect(job.status).toBe(DownloadJobStatus.Searching)
      })

      it('deletes nothing when the scoped episode is not in the season at all', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { episodeFileId: 31, id: 4411 },
        ])

        await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 9999 },
          ALICE,
        )

        expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
      })
    })
  })

  describe('flagBadFile / listBadFiles', () => {
    it('records the flag with the flagger identity and the display fields', () => {
      const flag = service.flagBadFile(
        MOVIE_ID,
        {
          guid: 'indexer://bad',
          indexerId: 3,
          reason: 'Audio desyncs at 40m',
          title: 'Some.Movie.2020.1080p',
        },
        ALICE,
      )

      expect(flag).toMatchObject({
        flaggedBy: ALICE,
        indexerId: 3,
        mediaId: MOVIE_ID,
        reason: 'Audio desyncs at 40m',
        releaseGuid: 'indexer://bad',
        releaseTitle: 'Some.Movie.2020.1080p',
      })
      // Serialized, not a Date - this is the wire shape.
      expect(typeof flag.createdAt).toBe('string')
    })

    it('nulls the optional fields rather than dropping them', () => {
      const flag = service.flagBadFile(MOVIE_ID, { guid: 'g' }, ALICE)

      expect(flag).toMatchObject({
        indexerId: null,
        reason: null,
        releaseTitle: null,
      })
    })

    it('is idempotent - re-flagging returns the original row and its flagger', () => {
      const first = service.flagBadFile(MOVIE_ID, { guid: 'g' }, ALICE)
      const second = service.flagBadFile(
        MOVIE_ID,
        { guid: 'g' },
        {
          email: 'bob@example.com',
          userId: 'user_2',
        },
      )

      expect(second.id).toBe(first.id)
      expect(second.flaggedBy).toEqual(ALICE)
      expect(service.listBadFiles(MOVIE_ID)).toHaveLength(1)
    })

    it('derives mediaType from the media id', () => {
      service.flagBadFile(SHOW_ID, { guid: 'g' }, ALICE)

      // A `tvdb:` id under mediaType 'movie' would trip the table's CHECK,
      // so surviving the insert is the assertion.
      expect(service.listBadFiles(SHOW_ID)).toHaveLength(1)
    })

    it('404s for a media id that can have no releases', () => {
      expect(() =>
        service.flagBadFile('video:V1StGXR8_Z5', { guid: 'g' }, ALICE),
      ).toThrow(NotFoundException)
      expect(() => service.listBadFiles('video:V1StGXR8_Z5')).toThrow(
        NotFoundException,
      )
    })

    it('lists only the requested title, newest first', () => {
      service.flagBadFile(MOVIE_ID, { guid: 'first' }, ALICE)
      service.flagBadFile(MOVIE_ID, { guid: 'second' }, ALICE)
      service.flagBadFile('tmdb:438631', { guid: 'other-title' }, ALICE)

      expect(service.listBadFiles(MOVIE_ID).map(f => f.releaseGuid)).toEqual([
        'second',
        'first',
      ])
    })

    it('returns an empty list for a title with no flags', () => {
      expect(service.listBadFiles(MOVIE_ID)).toEqual([])
    })

    // The end-to-end loop Phase 3 exists for: flag a release, and the next
    // listing marks it so the UI can hide it and the grab path refuses it.
    it('makes a freshly-flagged release show up as flaggedBad on the next listing', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasMonitored: true,
      })
      radarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://bad' }),
      ])

      expect((await service.listReleases(MOVIE_ID))[0]?.flaggedBad).toBe(false)

      service.flagBadFile(MOVIE_ID, { guid: 'indexer://bad' }, ALICE)

      expect((await service.listReleases(MOVIE_ID))[0]?.flaggedBad).toBe(true)
      await expect(
        service.grabRelease(MOVIE_ID, { guid: 'indexer://bad', indexerId: 3 }),
      ).rejects.toThrow(ConflictException)
    })
  })
})
