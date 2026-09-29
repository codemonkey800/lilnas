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
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { upsertMediaFileRelease } from 'src/db/media-file-releases.repo'
import type { MediaFileReleaseRow } from 'src/db/schema'
import type { CommandSnapshot } from 'src/media/arr-command.types'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { RadarrService } from 'src/media/radarr.service'
import {
  BROWSE_REFRESH_WAIT_MS,
  PICK_A_SCOPE_MESSAGE,
  ReleaseService,
} from 'src/media/release.service'
import { SdkHttpError } from 'src/media/sdk-result.util'
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

/** A `media_file_releases` row as `CurrentReleaseService` hands one back. */
function currentRow(
  overrides: Partial<MediaFileReleaseRow> = {},
): MediaFileReleaseRow {
  return {
    downloadId: 'dl-1',
    episodeId: null,
    id: 1,
    indexer: 'NZBGeek',
    indexerId: 11,
    mediaId: MOVIE_ID,
    mediaType: DownloadType.Movie,
    protocol: 'usenet',
    publishDate: new Date('2020-05-01T00:00:00.000Z'),
    releaseGroup: 'GRP',
    releaseGuid: 'indexer://current',
    releaseTitle: 'Some.Movie.2020.2160p',
    resolvedAt: new Date('2026-01-01T00:00:00.000Z'),
    size: 4419036486,
    upstreamFileId: 501,
    ...overrides,
  }
}

/** A command snapshot in the given state, as `getCommand` returns one. */
function refreshCommand(status: CommandSnapshot['status']): CommandSnapshot {
  return { body: {}, id: 55, name: 'RefreshMovie', status }
}

/** A promise plus the handle to settle it from the test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** Lets every already-settled promise chain run to its next real wait. */
function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

/** The arguments the last `MediaDownloadService.request()` call received. */
interface CapturedRequest {
  action: string
  mediaId: string
  requester?: { email: string; userId: string } | null
  scope?: ShowScope
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
  let currentReleaseService: jest.Mocked<CurrentReleaseService>
  let captured: CapturedRequest | undefined

  beforeEach(async () => {
    // A real in-memory DbService rather than a mocked drizzle chain: the
    // repo functions take `db` directly, so a mock would be re-implementing
    // the query builder rather than testing anything.
    dbService = createTestDbService()

    radarrService = {
      deleteMovieFile: jest.fn(),
      editMovies: jest.fn(),
      ensureMovie: jest.fn(),
      // The add's own refresh, already finished by the first read.
      getCommand: jest.fn(async () => refreshCommand('completed')),
      getMovieFiles: jest.fn(),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      refreshMovie: jest.fn(async () => ({
        id: 55,
        name: 'RefreshMovie',
        queuedAt: '2026-01-01T00:00:00.000Z',
      })),
      setMonitored: jest.fn(),
      unmonitorAndDelete: jest.fn(),
    } as unknown as jest.Mocked<RadarrService>

    sonarrService = {
      deleteEpisodeFile: jest.fn(),
      editSeries: jest.fn(),
      ensureSeries: jest.fn(),
      getCommand: jest.fn(async () => refreshCommand('completed')),
      getEpisodeFiles: jest.fn(),
      // A season/series scope's file resolution joins the files back to
      // their episodes, so the replace path reads these too.
      getEpisodes: jest.fn().mockResolvedValue([]),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      // Mirrors the real one: a no-op for a season-only scope, and the
      // display fields filled in for an episode scope.
      resolveScope: jest.fn(async (scope: ShowScope) =>
        scope.episodeId != null
          ? { episodeId: scope.episodeId, episodeNumber: 5, seasonNumber: 3 }
          : scope,
      ),
      refreshSeries: jest.fn(async () => ({
        id: 56,
        name: 'RefreshSeries',
        queuedAt: '2026-01-01T00:00:00.000Z',
      })),
      setEpisodesMonitored: jest.fn(),
      setSeriesMonitored: jest.fn(),
      unmonitorAndDelete: jest.fn(),
    } as unknown as jest.Mocked<SonarrService>

    mediaResolverService = {
      invalidate: jest.fn(),
      invalidateAfterEnsure: jest.fn(),
    } as unknown as jest.Mocked<MediaResolverService>

    // Defaults to "nothing resolved", which is what every pre-existing
    // listing assertion in this file assumes: no row, no synthesized release.
    currentReleaseService = {
      forEpisodeFiles: jest.fn(async () => new Map()),
      forMovie: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<CurrentReleaseService>

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
          // Mirrors `request()`'s own contract: a scope handed back by
          // submit replaces the one the job was minted with.
          const result = await submit()
          return {
            ...base,
            scope: result?.scope ?? rest.scope,
            status: DownloadJobStatus.Searching,
          } as DownloadJob
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
        { provide: CurrentReleaseService, useValue: currentReleaseService },
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
    /** Asserts the listing wrote nothing about monitoring, anywhere. */
    function expectNoMonitoringWrites() {
      expect(radarrService.editMovies).not.toHaveBeenCalled()
      expect(radarrService.setMonitored).not.toHaveBeenCalled()
      expect(radarrService.unmonitorAndDelete).not.toHaveBeenCalled()
    }

    it('ensures the movie unmonitored and lists its releases', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: true,
      })
      radarrService.getReleases.mockResolvedValue([release()])

      const result = await service.listReleases(MOVIE_ID)

      expect(radarrService.ensureMovie).toHaveBeenCalledWith(27205, {
        monitored: false,
      })
      expect(radarrService.getReleases).toHaveBeenCalledWith(7)
      expect(result).toEqual([release()])
      expectNoMonitoringWrites()
    })

    // Radarr's interactive search never checks `monitored`, so there is
    // nothing to flip on the way in and nothing to put back on the way out.
    it('writes nothing for an unmonitored title already in the library', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: false,
      })
      radarrService.getReleases.mockResolvedValue([release()])

      await service.listReleases(MOVIE_ID)

      expectNoMonitoringWrites()
      // Only a fresh add has a refresh to wait for.
      expect(radarrService.refreshMovie).not.toHaveBeenCalled()
      expect(mediaResolverService.invalidate).not.toHaveBeenCalled()
    })

    // The old borrow deleted a title it had added - and a grab picked from
    // that listing then landed on a movie id that no longer existed.
    it('adds an absent title unmonitored and leaves it in the library', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: true,
        wasMonitored: false,
      })
      radarrService.getReleases.mockResolvedValue([release()])

      await expect(service.listReleases(MOVIE_ID)).resolves.toEqual([release()])

      expectNoMonitoringWrites()
      // Added, so the cached library (which lacks it) has to go.
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(MOVIE_ID)
    })

    it('never deletes or unmonitors when the release fetch throws', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: true,
        wasMonitored: false,
      })
      radarrService.getReleases.mockRejectedValue(new Error('indexer down'))

      await expect(service.listReleases(MOVIE_ID)).rejects.toThrow(
        'indexer down',
      )
      expectNoMonitoringWrites()
    })

    it('surfaces an ensureMovie failure without listing', async () => {
      radarrService.ensureMovie.mockRejectedValue(new Error('radarr down'))

      await expect(service.listReleases(MOVIE_ID)).rejects.toThrow(
        'radarr down',
      )
      expect(radarrService.getReleases).not.toHaveBeenCalled()
      expectNoMonitoringWrites()
    })
  })

  describe('listReleases - refresh wait after an add', () => {
    beforeEach(() => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: true,
        wasMonitored: false,
      })
      radarrService.getReleases.mockResolvedValue([release()])
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    // `isNew: true` re-sends the body of the refresh Radarr queued on the
    // add, which the de-dupe turns into that same command's id.
    it("waits on the add's own refresh before searching", async () => {
      jest.useFakeTimers()
      radarrService.getCommand
        .mockResolvedValueOnce(refreshCommand('queued'))
        .mockResolvedValueOnce(refreshCommand('started'))
        .mockResolvedValueOnce(refreshCommand('completed'))

      const pending = service.listReleases(MOVIE_ID)

      await jest.advanceTimersByTimeAsync(0)
      expect(radarrService.refreshMovie).toHaveBeenCalledWith(7, {
        isNew: true,
      })
      expect(radarrService.getCommand).toHaveBeenCalledWith(55)
      expect(radarrService.getReleases).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1000)
      expect(radarrService.getReleases).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toEqual([release()])
      expect(radarrService.getCommand).toHaveBeenCalledTimes(3)
    })

    it(`lists anyway once the refresh is still running after ${BROWSE_REFRESH_WAIT_MS}ms`, async () => {
      jest.useFakeTimers()
      radarrService.getCommand.mockResolvedValue(refreshCommand('started'))

      const pending = service.listReleases(MOVIE_ID)

      await jest.advanceTimersByTimeAsync(BROWSE_REFRESH_WAIT_MS - 1000)
      expect(radarrService.getReleases).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toEqual([release()])
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ commandId: 55, mediaId: MOVIE_ID }),
        expect.stringContaining('still running'),
      )
    })

    it('lists anyway when the refresh ended badly', async () => {
      radarrService.getCommand.mockResolvedValue(refreshCommand('failed'))

      await expect(service.listReleases(MOVIE_ID)).resolves.toEqual([release()])
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
        expect.stringContaining('did not complete'),
      )
    })

    it('lists anyway when the refresh cannot be queued or read', async () => {
      radarrService.refreshMovie.mockRejectedValue(new Error('radarr down'))

      await expect(service.listReleases(MOVIE_ID)).resolves.toEqual([release()])
      expect(radarrService.getCommand).not.toHaveBeenCalled()
    })

    it('waits on the series refresh for a show it added', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: true,
        wasMonitored: false,
      })
      sonarrService.getReleases.mockResolvedValue([])

      await service.listReleases(SHOW_ID, { seasonNumber: 1 })

      expect(sonarrService.refreshSeries).toHaveBeenCalledWith(9, {
        isNew: true,
      })
      expect(sonarrService.getCommand).toHaveBeenCalledWith(56)
      expect(
        sonarrService.getCommand.mock.invocationCallOrder[0] ?? Infinity,
      ).toBeLessThan(sonarrService.getReleases.mock.invocationCallOrder[0] ?? 0)
    })
  })

  describe('listReleases - concurrency', () => {
    // Two browses of one title: the second queues behind the first's add
    // *and* its refresh wait, then finds the title already there.
    it('adds a title once when two browses race', async () => {
      let inLibrary = false
      radarrService.ensureMovie.mockImplementation(async () => {
        const wasAdded = !inLibrary
        inLibrary = true
        return { movie: {}, radarrId: 7, wasAdded, wasMonitored: false }
      })
      const refresh = deferred<CommandSnapshot>()
      radarrService.getCommand.mockReturnValue(refresh.promise)
      radarrService.getReleases.mockResolvedValue([release()])

      const first = service.listReleases(MOVIE_ID)
      const second = service.listReleases(MOVIE_ID)
      await flushPromises()

      // The first is parked in its refresh wait, still holding the lock.
      expect(radarrService.ensureMovie).toHaveBeenCalledTimes(1)

      refresh.resolve(refreshCommand('completed'))
      await Promise.all([first, second])

      expect(radarrService.ensureMovie).toHaveBeenCalledTimes(2)
      const results = await Promise.all(
        radarrService.ensureMovie.mock.results.map(r => r.value),
      )
      expect(results.filter(r => r.wasAdded)).toHaveLength(1)
      expect(radarrService.refreshMovie).toHaveBeenCalledTimes(1)
    })

    it('does not make a different title wait', async () => {
      radarrService.ensureMovie.mockImplementation(async tmdbId => ({
        movie: {},
        radarrId: tmdbId,
        wasAdded: tmdbId === 27205,
        wasMonitored: false,
      }))
      const refresh = deferred<CommandSnapshot>()
      radarrService.getCommand.mockReturnValue(refresh.promise)
      radarrService.getReleases.mockResolvedValue([])

      const held = service.listReleases(MOVIE_ID)
      await expect(service.listReleases('tmdb:438631')).resolves.toEqual([])

      refresh.resolve(refreshCommand('completed'))
      await held
    })
  })

  describe('listReleases - shows', () => {
    it('ensures the series unmonitored and passes the scope only to getReleases', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: true,
      })
      sonarrService.getReleases.mockResolvedValue([])

      await service.listReleases(SHOW_ID, { episodeId: 4412, seasonNumber: 2 })

      expect(sonarrService.ensureSeries).toHaveBeenCalledWith(81189, {
        monitored: false,
      })
      expect(sonarrService.getReleases).toHaveBeenCalledWith(9, {
        episodeId: 4412,
        seasonNumber: 2,
      })
    })

    it('writes nothing for an unmonitored series already in the library', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: false,
      })
      sonarrService.getReleases.mockResolvedValue([])

      await service.listReleases(SHOW_ID, { seasonNumber: 2 })

      expect(sonarrService.setEpisodesMonitored).not.toHaveBeenCalled()
      expect(sonarrService.setSeriesMonitored).not.toHaveBeenCalled()
      expect(sonarrService.editSeries).not.toHaveBeenCalled()
      expect(sonarrService.refreshSeries).not.toHaveBeenCalled()
    })

    it('adds an absent series unmonitored and never deletes it', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: true,
        wasMonitored: false,
      })
      sonarrService.getReleases.mockRejectedValue(new Error('indexer down'))

      await expect(
        service.listReleases(SHOW_ID, { episodeId: 4412 }),
      ).rejects.toThrow('indexer down')

      expect(sonarrService.unmonitorAndDelete).not.toHaveBeenCalled()
      expect(sonarrService.setEpisodesMonitored).not.toHaveBeenCalled()
      expect(sonarrService.editSeries).not.toHaveBeenCalled()
    })

    // Sonarr's unscoped `GET /release` is its RSS feed, not a search - so it
    // is refused before the series is even added.
    it.each([
      ['no scope', undefined],
      ['an empty scope', {}],
      [
        'an all-undefined scope',
        { episodeId: undefined, seasonNumber: undefined },
      ],
    ])('rejects a show listing with %s as a 400', async (_label, scope) => {
      const listing = service.listReleases(SHOW_ID, scope)

      await expect(listing).rejects.toThrow(BadRequestException)
      await expect(listing).rejects.toThrow(PICK_A_SCOPE_MESSAGE)
      expect(sonarrService.ensureSeries).not.toHaveBeenCalled()
      expect(sonarrService.getReleases).not.toHaveBeenCalled()
    })

    // Season 0 is the specials - a real scope, not a missing one.
    it('lists season 0', async () => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: false,
      })
      sonarrService.getReleases.mockResolvedValue([])

      await expect(
        service.listReleases(SHOW_ID, { seasonNumber: 0 }),
      ).resolves.toEqual([])

      expect(sonarrService.getReleases).toHaveBeenCalledWith(9, {
        seasonNumber: 0,
      })
    })
  })

  describe('listReleases - flaggedBad annotation', () => {
    beforeEach(() => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
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

  // The reason this exists: a release grabbed months ago will not come back
  // in today's indexer search, so without synthesis the row the report
  // control hangs off never renders.
  describe('listReleases - current release synthesis', () => {
    beforeEach(() => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: true,
      })
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: true,
      })
    })

    it('prepends the current release when the indexer did not return it', async () => {
      currentReleaseService.forMovie.mockResolvedValue(currentRow())
      radarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://other' }),
      ])

      const result = await service.listReleases(MOVIE_ID)

      expect(currentReleaseService.forMovie).toHaveBeenCalledWith(MOVIE_ID, 7)
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        // Deliberately *not* blocked: this row offers the report control,
        // not a grab, and `ReleaseRow` derives its blocked styling from
        // these two.
        downloadAllowed: true,
        flaggedBad: false,
        guid: 'indexer://current',
        indexer: 'NZBGeek',
        indexerId: 11,
        protocol: 'usenet',
        publishDate: '2020-05-01T00:00:00.000Z',
        rejected: false,
        releaseGroup: 'GRP',
        size: 4419036486,
        title: 'Some.Movie.2020.2160p',
      })
      expect(result[1]?.guid).toBe('indexer://other')
    })

    it('leaves the list untouched when the indexer already returned the current release', async () => {
      currentReleaseService.forMovie.mockResolvedValue(currentRow())
      const found = release({ guid: 'indexer://current', indexerId: 3 })
      radarrService.getReleases.mockResolvedValue([found])

      const result = await service.listReleases(MOVIE_ID)

      // Exactly once, and it is the indexer's row - not a synthesized copy
      // stacked on top of it.
      expect(result).toEqual([found])
    })

    it('marks a synthesized release that is flagged', async () => {
      insertBadFile(dbService.db, {
        flaggedByEmail: ALICE.email,
        flaggedByUserId: ALICE.userId,
        mediaId: MOVIE_ID,
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://current',
      })
      currentReleaseService.forMovie.mockResolvedValue(currentRow())
      radarrService.getReleases.mockResolvedValue([])

      const result = await service.listReleases(MOVIE_ID)

      expect(result).toHaveLength(1)
      expect(result[0]?.flaggedBad).toBe(true)
    })

    it('falls back to the guid when the cached row has no title', async () => {
      currentReleaseService.forMovie.mockResolvedValue(
        currentRow({
          indexer: null,
          indexerId: null,
          protocol: null,
          publishDate: null,
          releaseGroup: null,
          releaseTitle: null,
          size: null,
        }),
      )
      radarrService.getReleases.mockResolvedValue([])

      const [result] = await service.listReleases(MOVIE_ID)

      expect(result).toEqual({
        downloadAllowed: true,
        flaggedBad: false,
        guid: 'indexer://current',
        indexer: undefined,
        // `GrabReleaseInputSchema.nonnegative()` treats 0 as legal, and
        // `ReleaseSchema.indexerId` is required - so an unresolvable indexer
        // still has to supply one.
        indexerId: 0,
        protocol: undefined,
        publishDate: undefined,
        rejected: false,
        releaseGroup: undefined,
        size: undefined,
        title: 'indexer://current',
      })
    })

    it('synthesizes nothing for a movie with no file', async () => {
      currentReleaseService.forMovie.mockResolvedValue(undefined)
      radarrService.getReleases.mockResolvedValue([release()])

      const result = await service.listReleases(MOVIE_ID)

      expect(result).toEqual([release()])
    })

    it('still returns the indexer releases when resolution fails', async () => {
      currentReleaseService.forMovie.mockRejectedValue(new Error('db gone'))
      radarrService.getReleases.mockResolvedValue([release()])

      const result = await service.listReleases(MOVIE_ID)

      expect(result).toEqual([release()])
    })

    it('resolves an episode-scoped show listing through its episode file', async () => {
      sonarrService.getReleases.mockResolvedValue([])
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 0, id: 4411 },
        { episodeFileId: 77, id: 4412 },
      ])
      currentReleaseService.forEpisodeFiles.mockResolvedValue(
        new Map([
          [
            77,
            currentRow({
              episodeId: 4412,
              mediaId: SHOW_ID,
              mediaType: DownloadType.Show,
              releaseGuid: 'indexer://ep',
              releaseTitle: 'The.Wire.S03E05.1080p',
              upstreamFileId: 77,
            }),
          ],
        ]),
      )

      const result = await service.listReleases(SHOW_ID, {
        episodeId: 4412,
        seasonNumber: 3,
      })

      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9, {
        seasonNumber: 3,
      })
      expect(currentReleaseService.forEpisodeFiles).toHaveBeenCalledWith(
        SHOW_ID,
        9,
        [77],
      )
      expect(result.map(r => r.guid)).toEqual(['indexer://ep'])
      expect(result[0]?.title).toBe('The.Wire.S03E05.1080p')
    })

    // `episodeFileId: 0` is Sonarr's "no file".
    it('synthesizes nothing for an episode with no file', async () => {
      sonarrService.getReleases.mockResolvedValue([release()])
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 0, id: 4412 },
      ])

      const result = await service.listReleases(SHOW_ID, { episodeId: 4412 })

      expect(currentReleaseService.forEpisodeFiles).not.toHaveBeenCalled()
      expect(result).toEqual([release()])
    })

    // A season or series scope names many files, so there is no single
    // current release to pin to the top.
    it('synthesizes nothing for a season-scoped listing', async () => {
      sonarrService.getReleases.mockResolvedValue([release()])

      const result = await service.listReleases(SHOW_ID, { seasonNumber: 3 })

      expect(sonarrService.getEpisodes).not.toHaveBeenCalled()
      expect(currentReleaseService.forEpisodeFiles).not.toHaveBeenCalled()
      expect(currentReleaseService.forMovie).not.toHaveBeenCalled()
      expect(result).toEqual([release()])
    })
  })

  describe('grabRelease', () => {
    const input = { guid: 'indexer://abc', indexerId: 3 }

    it('creates the job through MediaDownloadService with the right attribution', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
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
        wasAdded: false,
        wasMonitored: true,
      })

      const job = await service.grabRelease(MOVIE_ID, input)

      expect(captured?.requester).toBeUndefined()
      expect(job.requester).toBeNull()
    })

    it('ensures unmonitored, grabs, then turns monitoring on - in that order', async () => {
      const order: string[] = []
      radarrService.ensureMovie.mockImplementation(async () => {
        order.push('ensure')
        return { movie: {}, radarrId: 7, wasAdded: false, wasMonitored: false }
      })
      radarrService.grabRelease.mockImplementation(async () => {
        order.push('grab')
      })
      radarrService.editMovies.mockImplementation(async () => {
        order.push('monitor')
      })

      await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.ensureMovie).toHaveBeenCalledWith(27205, {
        monitored: false,
      })
      expect(order).toEqual(['ensure', 'grab', 'monitor'])
      expect(radarrService.editMovies).toHaveBeenCalledWith([7], {
        monitored: true,
      })
      // No refresh wait on the grab path.
      expect(radarrService.refreshMovie).not.toHaveBeenCalled()
    })

    it('leaves monitoring as it was when the grab fails', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: false,
      })
      radarrService.grabRelease.mockRejectedValue(new Error('Not in cache'))

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(radarrService.editMovies).not.toHaveBeenCalled()
      expect(radarrService.setMonitored).not.toHaveBeenCalled()
    })

    // The release is already with the download client; failing the job
    // would report an error for a download that is going ahead.
    it('keeps a successful grab when turning monitoring on fails', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: false,
      })
      radarrService.editMovies.mockRejectedValue(new Error('radarr down'))

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'radarr down', mediaId: MOVIE_ID }),
        expect.stringContaining('could not turn monitoring on'),
      )
    })

    // Monitoring changed, and an add changed the library - either way the
    // resolver's cached copy is stale.
    it('invalidates the resolver after adding and after monitoring', async () => {
      const order: string[] = []
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: true,
        wasMonitored: false,
      })
      mediaResolverService.invalidate.mockImplementation(() => {
        order.push('invalidate')
      })
      radarrService.grabRelease.mockImplementation(async () => {
        order.push('grab')
      })

      await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(order).toEqual(['invalidate', 'grab', 'invalidate'])
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(MOVIE_ID)
    })

    describe('shows', () => {
      beforeEach(() => {
        sonarrService.ensureSeries.mockResolvedValue({
          series: {},
          sonarrId: 9,
          wasAdded: false,
          wasMonitored: false,
        })
      })

      it('monitors the grabbed episode and then the series, after the grab', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { id: 4411, monitored: false, seasonNumber: 2 },
          { id: 4412, monitored: false, seasonNumber: 2 },
        ])

        await service.grabRelease(
          SHOW_ID,
          { ...input, episodeId: 4412, seasonNumber: 2 },
          ALICE,
        )

        expect(sonarrService.ensureSeries).toHaveBeenCalledWith(81189, {
          monitored: false,
        })
        expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9, {
          seasonNumber: 2,
        })
        expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
          [4412],
          true,
        )
        expect(sonarrService.editSeries).toHaveBeenCalledWith([9], {
          monitored: true,
        })

        const grab = sonarrService.grabRelease.mock.invocationCallOrder[0] ?? 0
        const episodes =
          sonarrService.setEpisodesMonitored.mock.invocationCallOrder[0] ?? 0
        const series = sonarrService.editSeries.mock.invocationCallOrder[0] ?? 0
        expect(grab).toBeLessThan(episodes)
        expect(episodes).toBeLessThan(series)
      })

      // Season 0 is specials - a truthiness check would widen this to an
      // unscoped grab and skip exactly the season that was picked.
      it("monitors a season-0 grab's episodes, skipping ones already on", async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { id: 1, monitored: false, seasonNumber: 0 },
          { id: 2, monitored: true, seasonNumber: 0 },
        ])

        await service.grabRelease(SHOW_ID, { ...input, seasonNumber: 0 }, ALICE)

        expect(sonarrService.getEpisodes).toHaveBeenCalledWith(9, {
          seasonNumber: 0,
        })
        expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
          [1],
          true,
        )
      })

      it('monitors every season but the specials for an unscoped grab', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { id: 1, monitored: false, seasonNumber: 0 },
          { id: 2, monitored: false, seasonNumber: 1 },
          { id: 3, monitored: true, seasonNumber: 1 },
          { id: 4, monitored: false, seasonNumber: 2 },
        ])

        await service.grabRelease(SHOW_ID, input, ALICE)

        expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
          [2, 4],
          true,
        )
        expect(sonarrService.editSeries).toHaveBeenCalledWith([9], {
          monitored: true,
        })
      })

      it('monitors nothing when the show grab fails', async () => {
        sonarrService.grabRelease.mockRejectedValue(new Error('Not in cache'))

        const job = await service.grabRelease(
          SHOW_ID,
          { ...input, seasonNumber: 2 },
          ALICE,
        )

        expect(job.status).toBe(DownloadJobStatus.Failed)
        expect(sonarrService.setEpisodesMonitored).not.toHaveBeenCalled()
        expect(sonarrService.editSeries).not.toHaveBeenCalled()
        expect(sonarrService.setSeriesMonitored).not.toHaveBeenCalled()
      })
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
        wasAdded: false,
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
        wasAdded: false,
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

  // Radarr/Sonarr cache interactive-search decisions for 30 minutes; a pick
  // made after that (or after an *arr restart) 404s on `POST /release`.
  describe('grabRelease - release cache miss', () => {
    const input = { guid: 'indexer://abc', indexerId: 3 }
    const GONE = 'That release is no longer available — search again'

    function cacheMiss() {
      return new SdkHttpError(
        'grabRelease failed: {"message":"Couldn\'t find requested release in cache"}',
        404,
        { message: "Couldn't find requested release in cache" },
      )
    }

    beforeEach(() => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: false,
      })
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: false,
      })
    })

    it('searches again and grabs the release when it is still listed', async () => {
      radarrService.grabRelease
        .mockRejectedValueOnce(cacheMiss())
        .mockResolvedValueOnce(undefined)
      radarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://other' }),
        release(),
      ])

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(radarrService.getReleases).toHaveBeenCalledTimes(1)
      expect(radarrService.getReleases).toHaveBeenCalledWith(7)
      expect(radarrService.grabRelease).toHaveBeenCalledTimes(2)
      expect(radarrService.grabRelease).toHaveBeenLastCalledWith(
        'indexer://abc',
        3,
      )
      expect(radarrService.editMovies).toHaveBeenCalledWith([7], {
        monitored: true,
      })

      const relist = radarrService.getReleases.mock.invocationCallOrder[0] ?? 0
      const retry = radarrService.grabRelease.mock.invocationCallOrder[1] ?? 0
      expect(relist).toBeLessThan(retry)
    })

    it('relists a show with the same scope the pick came from', async () => {
      sonarrService.grabRelease
        .mockRejectedValueOnce(cacheMiss())
        .mockResolvedValueOnce(undefined)
      sonarrService.getReleases.mockResolvedValue([release()])

      const job = await service.grabRelease(
        SHOW_ID,
        { ...input, episodeId: 4412, seasonNumber: 3 },
        ALICE,
      )

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(sonarrService.getReleases).toHaveBeenCalledWith(9, {
        episodeId: 4412,
        seasonNumber: 3,
      })
      expect(sonarrService.grabRelease).toHaveBeenCalledTimes(2)
    })

    // There is no scoped listing to repeat, and the unscoped one is the RSS
    // feed - so it reads as gone rather than relisting unscoped.
    it('does not relist an unscoped show grab', async () => {
      sonarrService.grabRelease.mockRejectedValue(cacheMiss())

      const job = await service.grabRelease(SHOW_ID, input, ALICE)

      expect(job.error).toBe(GONE)
      expect(sonarrService.getReleases).not.toHaveBeenCalled()
      expect(sonarrService.grabRelease).toHaveBeenCalledTimes(1)
    })

    it('fails with a clear message when the release is gone', async () => {
      radarrService.grabRelease.mockRejectedValue(cacheMiss())
      // Same guid from a different indexer is a different release.
      radarrService.getReleases.mockResolvedValue([
        release({ guid: 'indexer://other' }),
        release({ indexerId: 4 }),
      ])

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe(GONE)
      expect(radarrService.grabRelease).toHaveBeenCalledTimes(1)
      expect(radarrService.editMovies).not.toHaveBeenCalled()
    })

    // The on-disk row `listReleases` synthesizes isn't in the *arr's cache,
    // so it must not count as the release still being listed.
    it('does not count the synthesized current release as still listed', async () => {
      radarrService.grabRelease.mockRejectedValue(cacheMiss())
      radarrService.getReleases.mockResolvedValue([])
      currentReleaseService.forMovie.mockResolvedValue(
        currentRow({ indexerId: 3, releaseGuid: 'indexer://abc' }),
      )

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.error).toBe(GONE)
      expect(radarrService.grabRelease).toHaveBeenCalledTimes(1)
    })

    it('fails with the same message when the search again fails', async () => {
      radarrService.grabRelease.mockRejectedValue(cacheMiss())
      radarrService.getReleases.mockRejectedValue(new Error('radarr down'))

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.error).toBe(GONE)
      expect(radarrService.grabRelease).toHaveBeenCalledTimes(1)
    })

    it('does not loop when the retried grab 404s too', async () => {
      radarrService.grabRelease.mockRejectedValue(cacheMiss())
      radarrService.getReleases.mockResolvedValue([release()])

      const job = await service.grabRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toContain('Couldn')
      expect(radarrService.getReleases).toHaveBeenCalledTimes(1)
      expect(radarrService.grabRelease).toHaveBeenCalledTimes(2)
      expect(radarrService.editMovies).not.toHaveBeenCalled()
    })

    it.each([
      [
        'a 409 indexer failure',
        new SdkHttpError('grabRelease failed: indexer down', 409, {}),
      ],
      ['a 500', new SdkHttpError('grabRelease failed: boom', 500, {})],
      [
        'a network error',
        new SdkHttpError(
          'grabRelease failed: fetch failed',
          undefined,
          undefined,
        ),
      ],
      ['a plain error', new Error('grabRelease failed: 404 in the text only')],
    ])(
      "keeps today's failure for %s, without searching again",
      async (_label, error) => {
        radarrService.grabRelease.mockRejectedValue(error)

        const job = await service.grabRelease(MOVIE_ID, input, ALICE)

        expect(job.status).toBe(DownloadJobStatus.Failed)
        expect(job.error).toBe(error.message)
        expect(radarrService.getReleases).not.toHaveBeenCalled()
        expect(radarrService.grabRelease).toHaveBeenCalledTimes(1)
      },
    )

    it('applies to replaceRelease, deleting only after the retried grab', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }])
      radarrService.grabRelease
        .mockRejectedValueOnce(cacheMiss())
        .mockResolvedValueOnce(undefined)
      radarrService.getReleases.mockResolvedValue([release()])

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(radarrService.deleteMovieFile).toHaveBeenCalledTimes(1)
      expect(radarrService.grabRelease).toHaveBeenCalledTimes(2)

      const relist = radarrService.getReleases.mock.invocationCallOrder[0] ?? 0
      const retry = radarrService.grabRelease.mock.invocationCallOrder[1] ?? 0
      const del = radarrService.deleteMovieFile.mock.invocationCallOrder[0] ?? 0
      const monitor = radarrService.editMovies.mock.invocationCallOrder[0] ?? 0
      expect(relist).toBeLessThan(retry)
      expect(retry).toBeLessThan(del)
      expect(del).toBeLessThan(monitor)
    })

    it('keeps the existing files when a replace finds the release gone', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }])
      radarrService.grabRelease.mockRejectedValue(cacheMiss())
      radarrService.getReleases.mockResolvedValue([])

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe(GONE)
      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
      expect(radarrService.deleteMovieFile).not.toHaveBeenCalled()
    })
  })

  // `GrabReleaseInput` has carried episodeId/seasonNumber since Phase 3 -
  // they scope the post-grab monitoring, and since Phase 4 the job too.
  describe('grabRelease - scope on the job', () => {
    beforeEach(() => {
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: true,
      })
    })

    it('mints a show job with the requested scope and stores the resolved one', async () => {
      const job = await service.grabRelease(
        SHOW_ID,
        { episodeId: 4412, guid: 'g', indexerId: 1, seasonNumber: 3 },
        ALICE,
      )

      expect(captured?.scope).toEqual({ episodeId: 4412, seasonNumber: 3 })
      expect(job.scope).toEqual({
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      })
    })

    it('carries a season-only scope through without a resolution round trip', async () => {
      const job = await service.grabRelease(
        SHOW_ID,
        { guid: 'g', indexerId: 1, seasonNumber: 3 },
        ALICE,
      )

      expect(job.scope).toEqual({ seasonNumber: 3 })
    })

    // Season 0 is specials - a truthiness check would drop it.
    it('keeps a season-0 scope', async () => {
      const job = await service.grabRelease(
        SHOW_ID,
        { guid: 'g', indexerId: 1, seasonNumber: 0 },
        ALICE,
      )

      expect(job.scope).toEqual({ seasonNumber: 0 })
    })

    it('mints an unscoped job for a show grab naming neither', async () => {
      const job = await service.grabRelease(
        SHOW_ID,
        { guid: 'g', indexerId: 1 },
        ALICE,
      )

      expect(captured?.scope).toBeUndefined()
      expect(job.scope).toBeUndefined()
      expect(sonarrService.resolveScope).not.toHaveBeenCalled()
    })

    // The show-only fields on a movie key stay ignored exactly as they were
    // before Phase 4 - starting to reject them would be an unrelated
    // behavior change.
    it('never puts a scope on a movie job, even when the body carries one', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: true,
      })

      const job = await service.grabRelease(
        MOVIE_ID,
        { episodeId: 4412, guid: 'g', indexerId: 1, seasonNumber: 3 },
        ALICE,
      )

      expect(captured?.scope).toBeUndefined()
      expect(job.scope).toBeUndefined()
      expect(sonarrService.resolveScope).not.toHaveBeenCalled()
    })

    // The release is already grabbed by then; failing the caller over a
    // display-numbering lookup would be the wrong trade.
    it('falls back to the unresolved scope when resolveScope fails', async () => {
      sonarrService.resolveScope.mockRejectedValue(new Error('sonarr down'))

      const job = await service.grabRelease(
        SHOW_ID,
        { episodeId: 4412, guid: 'g', indexerId: 1 },
        ALICE,
      )

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.scope).toEqual({ episodeId: 4412 })
      expect(sonarrService.grabRelease).toHaveBeenCalled()
    })

    // replaceRelease shares runGrab(), so it gets this for free - asserted
    // rather than assumed.
    it('applies to replaceRelease through the shared runGrab', async () => {
      sonarrService.getEpisodes.mockResolvedValue([
        { episodeFileId: 991, id: 4412, seasonNumber: 3 },
      ])

      const job = await service.replaceRelease(
        SHOW_ID,
        { episodeId: 4412, guid: 'g', indexerId: 1, seasonNumber: 3 },
        ALICE,
      )

      expect(job.scope).toEqual({
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      })
      expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledWith(991)
    })
  })

  describe('replaceRelease', () => {
    const input = { guid: 'indexer://new', indexerId: 3 }

    beforeEach(() => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: true,
      })
      sonarrService.ensureSeries.mockResolvedValue({
        series: {},
        sonarrId: 9,
        wasAdded: false,
        wasMonitored: true,
      })
    })

    it('grabs, then deletes every existing movie file, then re-monitors - in that order', async () => {
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
      radarrService.editMovies.mockImplementation(async () => {
        order.push('monitor')
      })

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(order).toEqual([
        'grab',
        'delete:11',
        'delete:12',
        'invalidate',
        'monitor',
        'invalidate',
      ])
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
      // Asserted as never *called*, not merely absent from the mock.
      expect(radarrService.unmonitorAndDelete).not.toHaveBeenCalled()
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

    // A failed grab must leave the user with what they had, not nothing.
    it('keeps the existing files when the grab fails', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }])
      radarrService.grabRelease.mockRejectedValue(new Error('Indexer refused'))

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
      expect(radarrService.deleteMovieFile).not.toHaveBeenCalled()
      expect(radarrService.editMovies).not.toHaveBeenCalled()
      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toContain('Indexer refused')
    })

    // The replacement is already downloading; failing the job would report
    // an error for a download that is going ahead anyway.
    it('keeps the job running with a warning when the delete fails', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 11 }, { id: 12 }])
      radarrService.deleteMovieFile.mockRejectedValue(new Error('locked'))

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.grabRelease).toHaveBeenCalledWith('indexer://new', 3)
      // Sequential - the first failure stops the batch.
      expect(radarrService.deleteMovieFile).toHaveBeenCalledTimes(1)
      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.error).toBeUndefined()
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'replaceRelease',
          error: 'locked',
          mediaId: MOVIE_ID,
        }),
        expect.stringContaining('could not delete the existing files'),
      )
      // Still re-monitored, and the cache still dropped.
      expect(radarrService.editMovies).toHaveBeenCalledWith([7], {
        monitored: true,
      })
      expect(mediaResolverService.invalidate).toHaveBeenCalledWith(MOVIE_ID)
    })

    it('keeps the job running when listing the files to delete fails', async () => {
      radarrService.getMovieFiles.mockRejectedValue(new Error('radarr down'))

      const job = await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.grabRelease).toHaveBeenCalled()
      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(radarrService.editMovies).toHaveBeenCalled()
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

    // A downloaded-then-manually-unmonitored title comes out of a replace
    // monitored - once the replacement is grabbed, not before.
    it('monitors an unmonitored movie once the replacement is grabbed', async () => {
      radarrService.ensureMovie.mockResolvedValue({
        movie: {},
        radarrId: 7,
        wasAdded: false,
        wasMonitored: false,
      })
      radarrService.getMovieFiles.mockResolvedValue([])

      await service.replaceRelease(MOVIE_ID, input, ALICE)

      expect(radarrService.ensureMovie).toHaveBeenCalledWith(27205, {
        monitored: false,
      })
      expect(radarrService.editMovies).toHaveBeenCalledWith([7], {
        monitored: true,
      })
      expect(
        radarrService.grabRelease.mock.invocationCallOrder[0] ?? Infinity,
      ).toBeLessThan(radarrService.editMovies.mock.invocationCallOrder[0] ?? 0)
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

      it('grabs, then deletes, then re-monitors the episodes and the series', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { episodeFileId: 32, id: 4412, monitored: true, seasonNumber: 2 },
        ])

        const job = await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 4412, seasonNumber: 2 },
          ALICE,
        )

        expect(job.status).toBe(DownloadJobStatus.Searching)
        const grab = sonarrService.grabRelease.mock.invocationCallOrder[0] ?? 0
        const del = sonarrService.deleteEpisodeFile.mock.invocationCallOrder[0]
        const episodes =
          sonarrService.setEpisodesMonitored.mock.invocationCallOrder[0]
        const series = sonarrService.editSeries.mock.invocationCallOrder[0]
        expect(grab).toBeGreaterThan(0)
        expect(del).toBeGreaterThan(grab)
        expect(episodes).toBeGreaterThan(del ?? Infinity)
        expect(series).toBeGreaterThan(episodes ?? Infinity)
        expect(sonarrService.editSeries).toHaveBeenCalledWith([9], {
          monitored: true,
        })
      })

      // Sonarr's "unmonitor deleted episodes" setting can flip an episode off
      // as its file goes - the monitor step reads after the delete and turns
      // it back on.
      it('re-monitors an episode the delete unmonitored', async () => {
        sonarrService.getEpisodes
          // The delete's file resolution - still monitored.
          .mockResolvedValueOnce([
            { episodeFileId: 32, id: 4412, monitored: true, seasonNumber: 2 },
          ])
          // The monitor step, after Sonarr unmonitored it on delete.
          .mockResolvedValueOnce([
            { episodeFileId: 0, id: 4412, monitored: false, seasonNumber: 2 },
          ])

        await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 4412, seasonNumber: 2 },
          ALICE,
        )

        expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledWith(32)
        expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
          [4412],
          true,
        )
      })

      it('keeps the episode files when the show grab fails', async () => {
        sonarrService.getEpisodeFiles.mockResolvedValue([
          { id: 21, seasonNumber: 1 },
        ])
        sonarrService.grabRelease.mockRejectedValue(new Error('indexer down'))

        const job = await service.replaceRelease(
          SHOW_ID,
          { ...input, seasonNumber: 1 },
          ALICE,
        )

        expect(job.status).toBe(DownloadJobStatus.Failed)
        expect(sonarrService.getEpisodeFiles).not.toHaveBeenCalled()
        expect(sonarrService.deleteEpisodeFile).not.toHaveBeenCalled()
        expect(sonarrService.setEpisodesMonitored).not.toHaveBeenCalled()
      })

      // E01E02 in one file: replacing E01 deletes that file once, not once
      // per episode it backs.
      it('deletes a multi-episode file once for an episode scope', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { episodeFileId: 31, id: 4411, seasonNumber: 1 },
          { episodeFileId: 31, id: 4412, seasonNumber: 1 },
        ])

        await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 4411, seasonNumber: 1 },
          ALICE,
        )

        expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledTimes(1)
        expect(sonarrService.deleteEpisodeFile).toHaveBeenCalledWith(31)
      })

      it('deletes a multi-episode file once for a season scope', async () => {
        sonarrService.getEpisodeFiles.mockResolvedValue([
          { id: 31, seasonNumber: 1 },
        ])
        sonarrService.getEpisodes.mockResolvedValue([
          { episodeFileId: 31, id: 4411, seasonNumber: 1 },
          { episodeFileId: 31, id: 4412, seasonNumber: 1 },
        ])

        await service.replaceRelease(
          SHOW_ID,
          { ...input, seasonNumber: 1 },
          ALICE,
        )

        expect(sonarrService.deleteEpisodeFile.mock.calls.flat()).toEqual([31])
      })

      // Replacing E01 of E01E02 took E02's footage too - if Sonarr unmonitored
      // both on delete, E02 must come back on or it is stranded with neither
      // a file nor monitoring.
      it('re-monitors every episode a deleted multi-episode file backed', async () => {
        sonarrService.getEpisodes
          .mockResolvedValueOnce([
            { episodeFileId: 31, id: 4411, monitored: true, seasonNumber: 1 },
            { episodeFileId: 31, id: 4412, monitored: true, seasonNumber: 1 },
            { episodeFileId: 33, id: 4413, monitored: false, seasonNumber: 1 },
          ])
          .mockResolvedValueOnce([
            { episodeFileId: 0, id: 4411, monitored: false, seasonNumber: 1 },
            { episodeFileId: 0, id: 4412, monitored: false, seasonNumber: 1 },
            { episodeFileId: 33, id: 4413, monitored: false, seasonNumber: 1 },
          ])

        await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 4411, seasonNumber: 1 },
          ALICE,
        )

        // E03 has its own file and was never touched - it stays off.
        expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
          [4411, 4412],
          true,
        )
      })

      it('keeps the job running and still re-monitors when an episode delete fails', async () => {
        sonarrService.getEpisodes
          .mockResolvedValueOnce([
            { episodeFileId: 31, id: 4411, monitored: true, seasonNumber: 1 },
            { episodeFileId: 31, id: 4412, monitored: true, seasonNumber: 1 },
          ])
          .mockResolvedValueOnce([
            { episodeFileId: 31, id: 4411, monitored: true, seasonNumber: 1 },
            { episodeFileId: 31, id: 4412, monitored: false, seasonNumber: 1 },
          ])
        sonarrService.deleteEpisodeFile.mockRejectedValue(new Error('locked'))

        const job = await service.replaceRelease(
          SHOW_ID,
          { ...input, episodeId: 4411, seasonNumber: 1 },
          ALICE,
        )

        expect(job.status).toBe(DownloadJobStatus.Searching)
        expect(job.error).toBeUndefined()
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'replaceRelease',
            error: 'locked',
          }),
          expect.stringContaining('could not delete the existing files'),
        )
        expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
          [4412],
          true,
        )
        expect(sonarrService.editSeries).toHaveBeenCalledWith([9], {
          monitored: true,
        })
      })

      // A plain grab deletes nothing, so it has no siblings to bring along.
      it('monitors only the grabbed episode on a plain grab', async () => {
        sonarrService.getEpisodes.mockResolvedValue([
          { episodeFileId: 31, id: 4411, monitored: false, seasonNumber: 1 },
          { episodeFileId: 31, id: 4412, monitored: false, seasonNumber: 1 },
        ])

        await service.grabRelease(
          SHOW_ID,
          { ...input, episodeId: 4411, seasonNumber: 1 },
          ALICE,
        )

        expect(sonarrService.setEpisodesMonitored).toHaveBeenCalledWith(
          [4411],
          true,
        )
      })
    })
  })

  /** Gives both apps a working flagged-profile sync for the flag tests. */
  function stubFlaggedProfileSync(): void {
    radarrService.syncFlaggedReleaseProfile = jest
      .fn()
      .mockResolvedValue(undefined)
    sonarrService.syncFlaggedReleaseProfile = jest
      .fn()
      .mockResolvedValue(undefined)
  }

  describe('flagBadFile / listBadFiles', () => {
    beforeEach(stubFlaggedProfileSync)

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
        wasAdded: false,
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

  describe('unflagBadFile', () => {
    beforeEach(stubFlaggedProfileSync)

    it('removes the flag and returns the removed row', () => {
      const flagged = service.flagBadFile(MOVIE_ID, { guid: 'g' }, ALICE)

      const unflagged = service.unflagBadFile(MOVIE_ID, flagged.id)

      expect(unflagged).toEqual(flagged)
      expect(service.listBadFiles(MOVIE_ID)).toEqual([])
    })

    it('lets the release be flagged again afterwards', () => {
      const flagged = service.flagBadFile(MOVIE_ID, { guid: 'g' }, ALICE)
      service.unflagBadFile(MOVIE_ID, flagged.id)

      service.flagBadFile(MOVIE_ID, { guid: 'g' }, ALICE)

      expect(service.listBadFiles(MOVIE_ID)).toHaveLength(1)
    })

    it('404s for a flag id that does not exist', () => {
      expect(() => service.unflagBadFile(MOVIE_ID, 99999)).toThrow(
        NotFoundException,
      )
    })

    // Same protection `deleteBadFile` gives every caller: a real flag id
    // under the wrong media id in the route must not be deletable by
    // guessing, since the id alone is a global PK.
    it('404s for a real flag id requested under the wrong media id', () => {
      const flagged = service.flagBadFile(MOVIE_ID, { guid: 'g' }, ALICE)

      expect(() => service.unflagBadFile('tmdb:438631', flagged.id)).toThrow(
        NotFoundException,
      )
      expect(service.listBadFiles(MOVIE_ID)).toHaveLength(1)
    })

    it('404s for a media id that can have no releases', () => {
      expect(() => service.unflagBadFile('video:V1StGXR8_Z5', 1)).toThrow(
        NotFoundException,
      )
    })
  })

  describe('flagBadFile / unflagBadFile - mirroring into Radarr/Sonarr', () => {
    beforeEach(stubFlaggedProfileSync)

    it('syncs Radarr with every flagged movie title after a flag', async () => {
      service.flagBadFile(
        'tmdb:438631',
        { guid: 'other', title: 'Other.Movie.2021' },
        ALICE,
      )
      service.flagBadFile(MOVIE_ID, { guid: 'g', title: 'Some.Movie' }, ALICE)
      await flushPromises()

      expect(radarrService.syncFlaggedReleaseProfile).toHaveBeenCalledTimes(2)
      const [titles] = radarrService.syncFlaggedReleaseProfile.mock.calls[1]!
      expect([...titles].sort()).toEqual(['Other.Movie.2021', 'Some.Movie'])
      expect(sonarrService.syncFlaggedReleaseProfile).not.toHaveBeenCalled()
    })

    it('syncs Sonarr, not Radarr, for a show flag', async () => {
      service.flagBadFile(SHOW_ID, { guid: 'g', title: 'Show.S01' }, ALICE)
      await flushPromises()

      expect(sonarrService.syncFlaggedReleaseProfile).toHaveBeenCalledWith([
        'Show.S01',
      ])
      expect(radarrService.syncFlaggedReleaseProfile).not.toHaveBeenCalled()
    })

    it('syncs the remaining titles after an unflag', async () => {
      const keep = service.flagBadFile(
        MOVIE_ID,
        { guid: 'keep', title: 'Keep.Me' },
        ALICE,
      )
      const drop = service.flagBadFile(
        MOVIE_ID,
        { guid: 'drop', title: 'Drop.Me' },
        ALICE,
      )
      await flushPromises()
      radarrService.syncFlaggedReleaseProfile.mockClear()

      service.unflagBadFile(MOVIE_ID, drop.id)
      await flushPromises()

      expect(radarrService.syncFlaggedReleaseProfile).toHaveBeenCalledTimes(1)
      expect(radarrService.syncFlaggedReleaseProfile).toHaveBeenCalledWith([
        'Keep.Me',
      ])
      expect(service.listBadFiles(MOVIE_ID)).toEqual([keep])
    })

    it('syncs an empty list once the last flag is gone', async () => {
      const flagged = service.flagBadFile(
        SHOW_ID,
        { guid: 'g', title: 'Show.S01' },
        ALICE,
      )
      service.unflagBadFile(SHOW_ID, flagged.id)
      await flushPromises()

      expect(sonarrService.syncFlaggedReleaseProfile).toHaveBeenLastCalledWith(
        [],
      )
    })

    it('does not sync for an unflag that 404s', async () => {
      expect(() => service.unflagBadFile(MOVIE_ID, 99999)).toThrow(
        NotFoundException,
      )
      await flushPromises()

      expect(radarrService.syncFlaggedReleaseProfile).not.toHaveBeenCalled()
    })

    it('still records the flag and only warns when the sync fails', async () => {
      radarrService.syncFlaggedReleaseProfile.mockRejectedValue(
        new Error('radarr down'),
      )

      const flag = service.flagBadFile(
        MOVIE_ID,
        { guid: 'g', title: 'Some.Movie' },
        ALICE,
      )
      await flushPromises()

      expect(flag.releaseGuid).toBe('g')
      expect(service.listBadFiles(MOVIE_ID)).toHaveLength(1)
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringMatching(/Radarr.*radarr down/),
      )
    })

    it('still removes the flag when the sync fails', async () => {
      const flagged = service.flagBadFile(
        MOVIE_ID,
        { guid: 'g', title: 'Some.Movie' },
        ALICE,
      )
      await flushPromises()
      radarrService.syncFlaggedReleaseProfile.mockRejectedValue(
        new Error('radarr down'),
      )

      expect(service.unflagBadFile(MOVIE_ID, flagged.id)).toEqual(flagged)
      await flushPromises()

      expect(service.listBadFiles(MOVIE_ID)).toEqual([])
    })

    describe('title backfill', () => {
      beforeEach(() => {
        upsertMediaFileRelease(dbService.db, {
          mediaId: MOVIE_ID,
          mediaType: DownloadType.Movie,
          releaseGuid: 'indexer://current',
          releaseTitle: 'Some.Movie.2020.2160p',
          upstreamFileId: 501,
        })
      })

      it('takes the title of the file on disk when the flag sent none', async () => {
        const flag = service.flagBadFile(
          MOVIE_ID,
          { guid: 'indexer://current' },
          ALICE,
        )
        await flushPromises()

        expect(flag.releaseTitle).toBe('Some.Movie.2020.2160p')
        expect(radarrService.syncFlaggedReleaseProfile).toHaveBeenCalledWith([
          'Some.Movie.2020.2160p',
        ])
      })

      // The picker renders the guid in place of a missing title, so a flag
      // raised from that row sends the guid back as `title`.
      it('takes it too when the flag sent the guid as its title', () => {
        const flag = service.flagBadFile(
          MOVIE_ID,
          { guid: 'indexer://current', title: 'indexer://current' },
          ALICE,
        )

        expect(flag.releaseTitle).toBe('Some.Movie.2020.2160p')
      })

      it('keeps a real title the flag sent', () => {
        const flag = service.flagBadFile(
          MOVIE_ID,
          { guid: 'indexer://current', title: 'As.Shown.In.Picker' },
          ALICE,
        )

        expect(flag.releaseTitle).toBe('As.Shown.In.Picker')
      })

      it('leaves the title empty when no file came from that release', () => {
        const flag = service.flagBadFile(
          MOVIE_ID,
          { guid: 'indexer://elsewhere' },
          ALICE,
        )

        expect(flag.releaseTitle).toBeNull()
      })
    })
  })
})
