import { DownloadType } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'

import { createTestDb, type TestDb } from 'src/db/__tests__/test-utils'
import { insertBadFile } from 'src/db/bad-files.repo'
import { upsertMediaFileRelease } from 'src/db/media-file-releases.repo'
import { syncFlaggedReleases } from 'src/media/flagged-release-sync.util'

const flagger = {
  flaggedByEmail: 'alice@example.com',
  flaggedByUserId: 'user_1',
}

describe('syncFlaggedReleases', () => {
  let testDb: TestDb
  let logger: Logger
  let warn: jest.SpyInstance
  let owner: { syncFlaggedReleaseProfile: jest.Mock }

  beforeEach(() => {
    testDb = createTestDb()
    logger = new Logger('test')
    warn = jest.spyOn(logger, 'warn').mockImplementation()
    owner = {
      syncFlaggedReleaseProfile: jest.fn().mockResolvedValue(undefined),
    }
  })

  afterEach(() => {
    testDb.close()
  })

  function flag(
    mediaId: string,
    releaseGuid: string,
    releaseTitle?: string,
  ): void {
    insertBadFile(testDb.db, {
      ...flagger,
      mediaId,
      mediaType: mediaId.startsWith('tmdb:')
        ? DownloadType.Movie
        : DownloadType.Show,
      releaseGuid,
      releaseTitle,
    })
  }

  it('hands the full title list of that media type to the app', async () => {
    flag('tmdb:1', 'g1', 'Movie.One')
    flag('tmdb:2', 'g2', 'Movie.Two')
    flag('tvdb:3', 'g3', 'Show.Three')

    await syncFlaggedReleases(testDb.db, DownloadType.Movie, owner, logger)

    expect(owner.syncFlaggedReleaseProfile).toHaveBeenCalledTimes(1)
    expect(owner.syncFlaggedReleaseProfile.mock.calls[0][0].sort()).toEqual([
      'Movie.One',
      'Movie.Two',
    ])
  })

  it('backfills a missing title from media_file_releases', async () => {
    flag('tvdb:3', 'g3')
    upsertMediaFileRelease(testDb.db, {
      mediaId: 'tvdb:3',
      mediaType: DownloadType.Show,
      releaseGuid: 'g3',
      releaseTitle: 'Show.S01.1080p',
      upstreamFileId: 9,
    })

    await syncFlaggedReleases(testDb.db, DownloadType.Show, owner, logger)

    expect(owner.syncFlaggedReleaseProfile).toHaveBeenCalledWith([
      'Show.S01.1080p',
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it('skips a flag with no title anywhere, warning once per process', async () => {
    flag('tmdb:1', 'untitled-once-guid')

    await syncFlaggedReleases(testDb.db, DownloadType.Movie, owner, logger)
    await syncFlaggedReleases(testDb.db, DownloadType.Movie, owner, logger)

    expect(owner.syncFlaggedReleaseProfile).toHaveBeenNthCalledWith(1, [])
    expect(owner.syncFlaggedReleaseProfile).toHaveBeenNthCalledWith(2, [])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/tmdb:1 untitled-once-guid/)
  })

  it('rejects when the app does', async () => {
    owner.syncFlaggedReleaseProfile.mockRejectedValue(new Error('radarr down'))

    await expect(
      syncFlaggedReleases(testDb.db, DownloadType.Movie, owner, logger),
    ).rejects.toThrow('radarr down')
  })

  // - The race the lock exists for: the second flag's sync must not read
  //   the table (and PUT its list) until the first sync has finished
  it('runs one sync per app at a time, each reading the table once it holds the lock', async () => {
    let finishFirst: () => void = () => undefined
    owner.syncFlaggedReleaseProfile.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishFirst = resolve
        }),
    )

    flag('tmdb:1', 'g1', 'Movie.One')
    const first = syncFlaggedReleases(
      testDb.db,
      DownloadType.Movie,
      owner,
      logger,
    )
    await new Promise(resolve => setImmediate(resolve))

    flag('tmdb:2', 'g2', 'Movie.Two')
    const second = syncFlaggedReleases(
      testDb.db,
      DownloadType.Movie,
      owner,
      logger,
    )
    await new Promise(resolve => setImmediate(resolve))

    expect(owner.syncFlaggedReleaseProfile).toHaveBeenCalledTimes(1)

    finishFirst()
    await Promise.all([first, second])

    expect(owner.syncFlaggedReleaseProfile).toHaveBeenCalledTimes(2)
    expect(owner.syncFlaggedReleaseProfile.mock.calls[1][0].sort()).toEqual([
      'Movie.One',
      'Movie.Two',
    ])
  })
})
