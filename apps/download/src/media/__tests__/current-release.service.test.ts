import type { HistoryResource as RadarrHistoryResource } from '@lilnas/media/radarr'
import type { HistoryResource as SonarrHistoryResource } from '@lilnas/media/sonarr'
import { DownloadType } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { upsertMediaFileRelease } from 'src/db/media-file-releases.repo'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { RadarrService } from 'src/media/radarr.service'
import type { HistoryRecordLike } from 'src/media/release-history.util'
import { SonarrService } from 'src/media/sonarr.service'

const MOVIE_ID = 'tmdb:27205'
const SHOW_ID = 'tvdb:81189'

/**
 * Fixtures are built as the structural `HistoryRecordLike` both services'
 * records satisfy, then widened to whichever generated type the mocked method
 * returns - the two SDKs' `HistoryResource`s differ only in fields this join
 * never reads (`movieId` vs `seriesId`), so one set of builders serves both.
 */
function asRadarrHistory(
  records: readonly HistoryRecordLike[],
): RadarrHistoryResource[] {
  return records as RadarrHistoryResource[]
}

function asSonarrHistory(
  records: readonly HistoryRecordLike[],
): SonarrHistoryResource[] {
  return records as SonarrHistoryResource[]
}

/**
 * A `grabbed` record, with `data` in the shape both *arrs actually serialize:
 * every value a string, however numeric it looks.
 */
function grabbed({
  date = '2024-01-01T00:00:00Z',
  downloadId,
  episodeId,
  guid,
  indexer,
  indexerId,
  protocol = '1',
  publishedDate,
  size = '4419036486',
  title = 'Some.Release.1080p-GROUP',
}: {
  date?: string
  downloadId: string
  episodeId?: number
  guid: string
  indexer?: string
  indexerId?: number
  protocol?: string
  publishedDate?: string
  size?: string
  title?: string
}): HistoryRecordLike {
  const data: Record<string, string> = { guid, protocol, size }
  if (indexer !== undefined) data['indexer'] = indexer
  if (indexerId !== undefined) data['indexerId'] = String(indexerId)
  if (publishedDate !== undefined) data['publishedDate'] = publishedDate

  return {
    data,
    date,
    downloadId,
    episodeId,
    eventType: 'grabbed',
    sourceTitle: title,
  }
}

function imported({
  date = '2024-01-01T01:00:00Z',
  downloadId,
  fileId,
}: {
  date?: string
  downloadId: string
  fileId: number
}): HistoryRecordLike {
  return {
    data: { fileId: String(fileId) },
    date,
    downloadId,
    eventType: 'downloadFolderImported',
  }
}

/** One grab plus its import - the minimal round trip the join needs. */
function roundTrip(options: {
  downloadId: string
  episodeId?: number
  fileId: number
  guid: string
  indexer?: string
  indexerId?: number
  publishedDate?: string
  title?: string
}): HistoryRecordLike[] {
  return [grabbed(options), imported(options)]
}

describe('CurrentReleaseService', () => {
  let service: CurrentReleaseService
  let dbService: DbService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>

  beforeEach(async () => {
    dbService = createTestDbService()
    const mockRadarrService = {
      getMovieFiles: jest.fn(),
      getMovieHistory: jest.fn(),
    }
    const mockSonarrService = {
      getIndexers: jest.fn(),
      getSeriesHistory: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CurrentReleaseService,
        { provide: DbService, useValue: dbService },
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
      ],
    }).compile()

    service = module.get(CurrentReleaseService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
    jest.restoreAllMocks()
  })

  describe('forMovie', () => {
    it('resolves a movie release from history and caches it', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 42 }])
      radarrService.getMovieHistory.mockResolvedValue(
        asRadarrHistory(
          roundTrip({
            downloadId: 'sab:abc',
            fileId: 42,
            guid: 'indexer://abc',
            indexer: 'NzbGeek',
            indexerId: 3,
            publishedDate: '2010-07-16T00:00:00Z',
            title: 'Inception.2010.1080p-GROUP',
          }),
        ),
      )

      const row = await service.forMovie(MOVIE_ID, 7)

      expect(row).toMatchObject({
        downloadId: 'sab:abc',
        // Radarr's history has no episode scope, and the
        // episode-only-for-shows CHECK would reject one anyway.
        episodeId: null,
        indexer: 'NzbGeek',
        indexerId: 3,
        mediaId: MOVIE_ID,
        mediaType: 'movie',
        protocol: 'usenet',
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Inception.2010.1080p-GROUP',
        size: 4419036486,
        upstreamFileId: 42,
      })
      // The history string became a real Date on the way into the
      // timestamp_ms column.
      expect(row?.publishDate).toEqual(new Date('2010-07-16T00:00:00Z'))

      expect(service.forFile(DownloadType.Movie, 42)).toEqual(row)
    })

    it('drops an unparseable publish date rather than storing an invalid one', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 42 }])
      radarrService.getMovieHistory.mockResolvedValue(
        asRadarrHistory(
          roundTrip({
            downloadId: 'sab:abc',
            fileId: 42,
            guid: 'indexer://abc',
            publishedDate: 'not a date',
          }),
        ),
      )

      const row = await service.forMovie(MOVIE_ID, 7)

      expect(row?.publishDate).toBeNull()
    })

    it('answers a cached movie without calling history', async () => {
      upsertMediaFileRelease(dbService.db, {
        mediaId: MOVIE_ID,
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://cached',
        upstreamFileId: 42,
      })
      radarrService.getMovieFiles.mockResolvedValue([{ id: 42 }])

      const row = await service.forMovie(MOVIE_ID, 7)

      expect(row?.releaseGuid).toBe('indexer://cached')
      expect(radarrService.getMovieHistory).not.toHaveBeenCalled()
    })

    it('never calls history for a movie with no file', async () => {
      radarrService.getMovieFiles.mockResolvedValue([])

      expect(await service.forMovie(MOVIE_ID, 7)).toBeUndefined()
      expect(radarrService.getMovieHistory).not.toHaveBeenCalled()
    })

    it('skips movie file entries carrying no id', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ path: '/movies/a.mkv' }])

      expect(await service.forMovie(MOVIE_ID, 7)).toBeUndefined()
      expect(radarrService.getMovieHistory).not.toHaveBeenCalled()
    })

    it('does not cache a file history cannot resolve, so the next view retries', async () => {
      radarrService.getMovieFiles.mockResolvedValue([{ id: 42 }])
      // An import with no surviving grab - a manual import, or history
      // pruned past the grab.
      radarrService.getMovieHistory.mockResolvedValue(
        asRadarrHistory([imported({ downloadId: 'sab:abc', fileId: 42 })]),
      )

      expect(await service.forMovie(MOVIE_ID, 7)).toBeUndefined()
      expect(service.forFile(DownloadType.Movie, 42)).toBeUndefined()

      await service.forMovie(MOVIE_ID, 7)
      expect(radarrService.getMovieHistory).toHaveBeenCalledTimes(2)
    })

    it('logs and returns undefined when Radarr history throws', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      radarrService.getMovieFiles.mockResolvedValue([{ id: 42 }])
      radarrService.getMovieHistory.mockRejectedValue(new Error('boom'))

      expect(await service.forMovie(MOVIE_ID, 7)).toBeUndefined()
      expect(warn).toHaveBeenCalled()
    })

    it('logs and returns undefined when the movie file lookup throws', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      radarrService.getMovieFiles.mockRejectedValue(new Error('boom'))

      expect(await service.forMovie(MOVIE_ID, 7)).toBeUndefined()
      expect(warn).toHaveBeenCalled()
      expect(radarrService.getMovieHistory).not.toHaveBeenCalled()
    })
  })

  describe('forEpisodeFiles', () => {
    it('makes no upstream call when every file is cached', async () => {
      for (const fileId of [1, 2]) {
        upsertMediaFileRelease(dbService.db, {
          mediaId: SHOW_ID,
          mediaType: DownloadType.Show,
          releaseGuid: `indexer://${fileId}`,
          upstreamFileId: fileId,
        })
      }

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [1, 2])

      expect([...rows.keys()].sort()).toEqual([1, 2])
      expect(sonarrService.getSeriesHistory).not.toHaveBeenCalled()
      expect(sonarrService.getIndexers).not.toHaveBeenCalled()
    })

    it('makes exactly one history call for a whole series with one uncached file', async () => {
      const fileIds = Array.from({ length: 40 }, (_, index) => index + 1)
      for (const fileId of fileIds.slice(0, 39)) {
        upsertMediaFileRelease(dbService.db, {
          mediaId: SHOW_ID,
          mediaType: DownloadType.Show,
          releaseGuid: `indexer://${fileId}`,
          upstreamFileId: fileId,
        })
      }
      sonarrService.getSeriesHistory.mockResolvedValue(
        asSonarrHistory(
          fileIds.flatMap(fileId =>
            roundTrip({
              downloadId: `sab:${fileId}`,
              episodeId: 100 + fileId,
              fileId,
              guid: `indexer://resolved-${fileId}`,
            }),
          ),
        ),
      )

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, fileIds)

      expect(sonarrService.getSeriesHistory).toHaveBeenCalledTimes(1)
      expect(rows.size).toBe(40)
      // Every file that one call resolved is written back, not just the
      // uncached one - the call is already paid for.
      expect(rows.get(1)?.releaseGuid).toBe('indexer://resolved-1')
      expect(rows.get(40)?.episodeId).toBe(140)
    })

    it('omits ids history cannot resolve and does not negative-cache them', async () => {
      sonarrService.getSeriesHistory.mockResolvedValue(
        asSonarrHistory(
          roundTrip({ downloadId: 'sab:1', fileId: 1, guid: 'indexer://1' }),
        ),
      )

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [1, 2])

      expect([...rows.keys()]).toEqual([1])
      expect(service.forFile(DownloadType.Show, 2)).toBeUndefined()

      await service.forEpisodeFiles(SHOW_ID, 9, [1, 2])
      expect(sonarrService.getSeriesHistory).toHaveBeenCalledTimes(2)
    })

    it('returns only the requested ids even when history resolved more', async () => {
      sonarrService.getSeriesHistory.mockResolvedValue(
        asSonarrHistory([
          ...roundTrip({ downloadId: 'sab:1', fileId: 1, guid: 'indexer://1' }),
          ...roundTrip({ downloadId: 'sab:2', fileId: 2, guid: 'indexer://2' }),
        ]),
      )

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [1])

      expect([...rows.keys()]).toEqual([1])
      // ...but the unasked-for file was still cached on the way past.
      expect(service.forFile(DownloadType.Show, 2)?.releaseGuid).toBe(
        'indexer://2',
      )
    })

    it('returns an empty map for no file ids, without going upstream', async () => {
      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [])

      expect(rows.size).toBe(0)
      expect(sonarrService.getSeriesHistory).not.toHaveBeenCalled()
    })

    it('logs and returns the cached rows when Sonarr history throws', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      upsertMediaFileRelease(dbService.db, {
        mediaId: SHOW_ID,
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://cached',
        upstreamFileId: 1,
      })
      sonarrService.getSeriesHistory.mockRejectedValue(new Error('boom'))

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [1, 2])

      expect(rows.get(1)?.releaseGuid).toBe('indexer://cached')
      expect(rows.has(2)).toBe(false)
      expect(warn).toHaveBeenCalled()
    })
  })

  describe('Sonarr indexer ids', () => {
    it('resolves an indexer name to its id', async () => {
      sonarrService.getIndexers.mockResolvedValue([{ id: 5, name: 'AltHub' }])
      sonarrService.getSeriesHistory.mockResolvedValue(
        asSonarrHistory(
          roundTrip({
            downloadId: 'sab:1',
            fileId: 1,
            guid: 'indexer://1',
            // Cased differently from the configured indexer: the *arrs
            // disagree about casing in the data bag across versions.
            indexer: 'althub',
          }),
        ),
      )

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [1])

      expect(rows.get(1)).toMatchObject({ indexer: 'althub', indexerId: 5 })
    })

    it('stores no indexer id for a name that matches nothing', async () => {
      // `id` and `name` are both optional on IndexerResource, so a
      // half-formed entry has to be skipped rather than keyed on `undefined`.
      sonarrService.getIndexers.mockResolvedValue([
        { id: 5 },
        { name: 'NzbGeek' },
        { id: 6, name: null },
      ])
      sonarrService.getSeriesHistory.mockResolvedValue(
        asSonarrHistory(
          roundTrip({
            downloadId: 'sab:1',
            fileId: 1,
            guid: 'indexer://1',
            indexer: 'AltHub',
          }),
        ),
      )

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [1])

      expect(rows.get(1)).toMatchObject({ indexer: 'AltHub', indexerId: null })
    })

    it('stores the release without an id when the indexer lookup throws', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      sonarrService.getIndexers.mockRejectedValue(new Error('boom'))
      sonarrService.getSeriesHistory.mockResolvedValue(
        asSonarrHistory(
          roundTrip({
            downloadId: 'sab:1',
            fileId: 1,
            guid: 'indexer://1',
            indexer: 'AltHub',
          }),
        ),
      )

      const rows = await service.forEpisodeFiles(SHOW_ID, 9, [1])

      expect(rows.get(1)).toMatchObject({
        indexerId: null,
        releaseGuid: 'indexer://1',
      })
      expect(warn).toHaveBeenCalled()
    })

    it('never fetches the indexer list when no release names one', async () => {
      sonarrService.getSeriesHistory.mockResolvedValue(
        asSonarrHistory(
          roundTrip({ downloadId: 'sab:1', fileId: 1, guid: 'indexer://1' }),
        ),
      )

      await service.forEpisodeFiles(SHOW_ID, 9, [1])

      expect(sonarrService.getIndexers).not.toHaveBeenCalled()
    })

    it('fetches the indexer list once across two resolves inside the TTL', async () => {
      sonarrService.getIndexers.mockResolvedValue([{ id: 5, name: 'AltHub' }])
      sonarrService.getSeriesHistory.mockImplementation(async () =>
        asSonarrHistory(
          roundTrip({
            downloadId: 'sab:1',
            fileId: 1,
            guid: 'indexer://1',
            indexer: 'AltHub',
          }),
        ),
      )

      // Two distinct, both-uncached file ids, so both calls really do reach
      // history rather than the second short-circuiting on the cache.
      await service.forEpisodeFiles(SHOW_ID, 9, [1])
      await service.forEpisodeFiles(SHOW_ID, 9, [2])

      expect(sonarrService.getSeriesHistory).toHaveBeenCalledTimes(2)
      expect(sonarrService.getIndexers).toHaveBeenCalledTimes(1)
    })

    it('refetches the indexer list once the TTL has expired', async () => {
      const now = jest.spyOn(Date, 'now').mockReturnValue(0)
      sonarrService.getIndexers.mockResolvedValue([{ id: 5, name: 'AltHub' }])
      sonarrService.getSeriesHistory.mockImplementation(async () =>
        asSonarrHistory(
          roundTrip({
            downloadId: 'sab:1',
            fileId: 1,
            guid: 'indexer://1',
            indexer: 'AltHub',
          }),
        ),
      )

      await service.forEpisodeFiles(SHOW_ID, 9, [1])
      now.mockReturnValue(60_001)
      await service.forEpisodeFiles(SHOW_ID, 9, [2])

      expect(sonarrService.getIndexers).toHaveBeenCalledTimes(2)
    })
  })

  describe('forFile', () => {
    it('reads the cache without any upstream call', () => {
      upsertMediaFileRelease(dbService.db, {
        mediaId: SHOW_ID,
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://cached',
        upstreamFileId: 1,
      })

      expect(service.forFile(DownloadType.Show, 1)?.releaseGuid).toBe(
        'indexer://cached',
      )
      // The same file id under the other service is a different file.
      expect(service.forFile(DownloadType.Movie, 1)).toBeUndefined()
      expect(sonarrService.getSeriesHistory).not.toHaveBeenCalled()
      expect(radarrService.getMovieFiles).not.toHaveBeenCalled()
    })
  })
})
