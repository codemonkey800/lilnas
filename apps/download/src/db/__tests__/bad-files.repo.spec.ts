import { DownloadType } from '@lilnas/utils/download/types'

import {
  deleteBadFile,
  getBadFileByGuid,
  insertBadFile,
  listBadFilesByMediaId,
} from 'src/db/bad-files.repo'

import { createTestDb } from './test-utils'

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
