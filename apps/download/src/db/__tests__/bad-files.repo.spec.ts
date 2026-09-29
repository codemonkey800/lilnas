import { DownloadType } from '@lilnas/utils/download/types'

import {
  deleteBadFile,
  getBadFileByGuid,
  insertBadFile,
  listBadFilesByMediaId,
  listFlaggedReleaseTitles,
  usableReleaseTitle,
} from 'src/db/bad-files.repo'
import { upsertMediaFileRelease } from 'src/db/media-file-releases.repo'

import { createTestDb, type TestDb } from './test-utils'

const flagger = {
  flaggedByEmail: 'alice@example.com',
  flaggedByUserId: 'user_1',
}

describe('bad files repo', () => {
  it('inserts a flag with every optional field populated', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertBadFile(db, {
        ...flagger,
        indexerId: 3,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        reason: 'Audio desyncs at 40m',
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Inception.2010.1080p',
      })

      expect(row).toMatchObject({
        flaggedByEmail: 'alice@example.com',
        flaggedByUserId: 'user_1',
        indexerId: 3,
        mediaId: 'tmdb:27205',
        mediaType: 'movie',
        reason: 'Audio desyncs at 40m',
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Inception.2010.1080p',
      })
      expect(row.createdAt).toBeInstanceOf(Date)
    } finally {
      close()
    }
  })

  it('inserts a flag carrying only a guid, leaving the display fields null', () => {
    const { db, close } = createTestDb()
    try {
      const row = insertBadFile(db, {
        ...flagger,
        mediaId: 'tvdb:81189',
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://abc',
      })

      expect(row).toMatchObject({
        indexerId: null,
        reason: null,
        releaseTitle: null,
      })
    } finally {
      close()
    }
  })

  // The point of the unique index: a double-click, or two users flagging the
  // same release at once, must not 500 on a UNIQUE constraint.
  it('is idempotent on (mediaId, releaseGuid) and keeps the first flagger', () => {
    const { db, close } = createTestDb()
    try {
      const first = insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        reason: 'Audio desyncs at 40m',
        releaseGuid: 'indexer://abc',
      })

      const second = insertBadFile(db, {
        flaggedByEmail: 'bob@example.com',
        flaggedByUserId: 'user_2',
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        reason: 'Different reason entirely',
        releaseGuid: 'indexer://abc',
      })

      expect(second.id).toBe(first.id)
      expect(second.flaggedByEmail).toBe('alice@example.com')
      expect(second.reason).toBe('Audio desyncs at 40m')
      expect(listBadFilesByMediaId(db, 'tmdb:27205')).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('treats the same guid under a different media id as a separate flag', () => {
    const { db, close } = createTestDb()
    try {
      insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })
      insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:438631',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })

      expect(listBadFilesByMediaId(db, 'tmdb:27205')).toHaveLength(1)
      expect(listBadFilesByMediaId(db, 'tmdb:438631')).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('lists only the requested media id, newest first', () => {
    const { db, close } = createTestDb()
    try {
      insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://first',
      })
      insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://second',
      })
      insertBadFile(db, {
        ...flagger,
        mediaId: 'tvdb:81189',
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://other-title',
      })

      const rows = listBadFilesByMediaId(db, 'tmdb:27205')

      // Both rows land inside the same millisecond, so `createdAt DESC`
      // alone can't order them - the `id DESC` tiebreak is what makes this
      // deterministic rather than insertion-order-by-luck.
      expect(rows.map(row => row.releaseGuid)).toEqual([
        'indexer://second',
        'indexer://first',
      ])
    } finally {
      close()
    }
  })

  it('returns an empty list for a media id with no flags', () => {
    const { db, close } = createTestDb()
    try {
      expect(listBadFilesByMediaId(db, 'tmdb:99999')).toEqual([])
    } finally {
      close()
    }
  })

  it('gets a single flag by its natural key', () => {
    const { db, close } = createTestDb()
    try {
      insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })

      expect(
        getBadFileByGuid(db, 'tmdb:27205', 'indexer://abc')?.releaseGuid,
      ).toBe('indexer://abc')
    } finally {
      close()
    }
  })

  it('returns undefined for an unflagged guid, and for the right guid under the wrong media id', () => {
    const { db, close } = createTestDb()
    try {
      insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })

      expect(
        getBadFileByGuid(db, 'tmdb:27205', 'indexer://never-flagged'),
      ).toBeUndefined()
      expect(
        getBadFileByGuid(db, 'tmdb:438631', 'indexer://abc'),
      ).toBeUndefined()
    } finally {
      close()
    }
  })

  it('deletes a flag by id and returns the removed row', () => {
    const { db, close } = createTestDb()
    try {
      const inserted = insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })

      const deleted = deleteBadFile(db, 'tmdb:27205', inserted.id)

      expect(deleted?.id).toBe(inserted.id)
      expect(listBadFilesByMediaId(db, 'tmdb:27205')).toEqual([])
    } finally {
      close()
    }
  })

  it('returns undefined when deleting a flag that does not exist', () => {
    const { db, close } = createTestDb()
    try {
      expect(deleteBadFile(db, 'tmdb:27205', 12345)).toBeUndefined()
    } finally {
      close()
    }
  })

  // The scope is load-bearing, not defensive dressing - see the doc comment
  // on `deleteBadFile`. A flag id is a global PK, so without the mediaId
  // match this would delete someone else's title's flag.
  it('leaves a flag alone when the id is real but under a different media id', () => {
    const { db, close } = createTestDb()
    try {
      const inserted = insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })

      expect(deleteBadFile(db, 'tmdb:438631', inserted.id)).toBeUndefined()
      expect(listBadFilesByMediaId(db, 'tmdb:27205')).toHaveLength(1)
    } finally {
      close()
    }
  })

  // Deleting then re-flagging the same release has to work - otherwise an
  // unflag would be permanent, which is not what "unflag" means.
  it('allows re-flagging a release after its flag was deleted', () => {
    const { db, close } = createTestDb()
    try {
      const first = insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })
      deleteBadFile(db, 'tmdb:27205', first.id)

      const second = insertBadFile(db, {
        ...flagger,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://abc',
      })

      expect(second.id).not.toBe(first.id)
      expect(listBadFilesByMediaId(db, 'tmdb:27205')).toHaveLength(1)
    } finally {
      close()
    }
  })
})

describe('usableReleaseTitle', () => {
  it('trims a real title', () => {
    expect(usableReleaseTitle('  Inception.2010.1080p ', 'g')).toBe(
      'Inception.2010.1080p',
    )
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['blank', '   '],
    ['just the guid', 'indexer://abc'],
  ])('rejects a title that is %s', (_, title) => {
    expect(usableReleaseTitle(title, 'indexer://abc')).toBeUndefined()
  })
})

describe('listFlaggedReleaseTitles', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = createTestDb()
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

  function fileRelease(
    mediaId: string,
    releaseGuid: string,
    releaseTitle: string | undefined,
    upstreamFileId: number,
  ): void {
    upsertMediaFileRelease(testDb.db, {
      mediaId,
      mediaType: mediaId.startsWith('tmdb:')
        ? DownloadType.Movie
        : DownloadType.Show,
      releaseGuid,
      releaseTitle,
      upstreamFileId,
    })
  }

  it('lists every titled flag of one media type, across titles', () => {
    flag('tmdb:1', 'g1', 'Movie.One.1080p')
    flag('tmdb:2', 'g2', 'Movie.Two.720p')
    flag('tvdb:3', 'g3', 'Show.S01.1080p')

    expect(
      listFlaggedReleaseTitles(testDb.db, DownloadType.Movie).titles.sort(),
    ).toEqual(['Movie.One.1080p', 'Movie.Two.720p'])
    expect(listFlaggedReleaseTitles(testDb.db, DownloadType.Show)).toEqual({
      titles: ['Show.S01.1080p'],
      untitled: [],
    })
  })

  it('falls back to the title media_file_releases has for the same guid', () => {
    flag('tmdb:1', 'g1')
    fileRelease('tmdb:1', 'g1', 'Movie.One.2160p', 501)

    expect(listFlaggedReleaseTitles(testDb.db, DownloadType.Movie)).toEqual({
      titles: ['Movie.One.2160p'],
      untitled: [],
    })
  })

  it('treats a flag titled with its own guid as untitled', () => {
    flag('tmdb:1', 'indexer://g1', 'indexer://g1')
    fileRelease('tmdb:1', 'indexer://g1', 'Movie.One.2160p', 501)

    expect(
      listFlaggedReleaseTitles(testDb.db, DownloadType.Movie).titles,
    ).toEqual(['Movie.One.2160p'])
  })

  it('only falls back to a file of the same title', () => {
    flag('tmdb:1', 'g1')
    fileRelease('tmdb:2', 'g1', 'Some.Other.Movie', 501)

    const result = listFlaggedReleaseTitles(testDb.db, DownloadType.Movie)

    expect(result.titles).toEqual([])
    expect(result.untitled.map(row => row.releaseGuid)).toEqual(['g1'])
  })

  it('reports a flag with no title anywhere as untitled', () => {
    flag('tmdb:1', 'g1', 'Movie.One.1080p')
    flag('tmdb:1', 'g2')
    fileRelease('tmdb:1', 'g2', undefined, 501)

    const result = listFlaggedReleaseTitles(testDb.db, DownloadType.Movie)

    expect(result.titles).toEqual(['Movie.One.1080p'])
    expect(result.untitled).toEqual([
      expect.objectContaining({ mediaId: 'tmdb:1', releaseGuid: 'g2' }),
    ])
  })

  it('is empty with no flags', () => {
    expect(listFlaggedReleaseTitles(testDb.db, DownloadType.Movie)).toEqual({
      titles: [],
      untitled: [],
    })
  })
})
