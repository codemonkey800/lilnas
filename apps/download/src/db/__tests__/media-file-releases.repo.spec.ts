import { DownloadType } from '@lilnas/utils/download/types'

import {
  getMediaFileRelease,
  listMediaFileReleasesByFileIds,
  upsertMediaFileRelease,
} from 'src/db/media-file-releases.repo'

import { createTestDb } from './test-utils'

describe('media file releases repo', () => {
  it('upserts a release with every optional field populated and reads it back', () => {
    const { db, close } = createTestDb()
    try {
      const written = upsertMediaFileRelease(db, {
        downloadId: 'sab:abc123',
        indexer: 'NZBgeek',
        indexerId: 3,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        protocol: 'usenet',
        publishDate: new Date('2010-07-16T00:00:00.000Z'),
        releaseGroup: 'GROUP',
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Inception.2010.1080p',
        size: 8_000_000_000,
        upstreamFileId: 42,
      })

      expect(written).toMatchObject({
        downloadId: 'sab:abc123',
        episodeId: null,
        indexer: 'NZBgeek',
        indexerId: 3,
        mediaId: 'tmdb:27205',
        mediaType: 'movie',
        protocol: 'usenet',
        releaseGroup: 'GROUP',
        releaseGuid: 'indexer://abc',
        releaseTitle: 'Inception.2010.1080p',
        size: 8_000_000_000,
        upstreamFileId: 42,
      })
      expect(written.publishDate).toEqual(new Date('2010-07-16T00:00:00.000Z'))
      expect(written.resolvedAt).toBeInstanceOf(Date)

      expect(getMediaFileRelease(db, DownloadType.Movie, 42)).toEqual(written)
    } finally {
      close()
    }
  })

  it('upserts a release carrying only a guid, leaving the denormalized fields null', () => {
    const { db, close } = createTestDb()
    try {
      const written = upsertMediaFileRelease(db, {
        mediaId: 'tvdb:81189',
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://abc',
        upstreamFileId: 7,
      })

      expect(written).toMatchObject({
        downloadId: null,
        episodeId: null,
        indexer: null,
        indexerId: null,
        protocol: null,
        publishDate: null,
        releaseGroup: null,
        releaseTitle: null,
        size: null,
      })
    } finally {
      close()
    }
  })

  it('records an episode id for a show file', () => {
    const { db, close } = createTestDb()
    try {
      const written = upsertMediaFileRelease(db, {
        episodeId: 991,
        mediaId: 'tvdb:81189',
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://abc',
        upstreamFileId: 7,
      })

      expect(written.episodeId).toBe(991)
    } finally {
      close()
    }
  })

  // The point of the unique index, and of `onConflictDoUpdate` over
  // `bad_files`' `onConflictDoNothing`: this row is a cache entry, so a
  // second resolve is a correction that must overwrite rather than either
  // duplicating or being silently discarded.
  it('replaces the existing row when the same file is resolved again', () => {
    const { db, close } = createTestDb()
    try {
      const first = upsertMediaFileRelease(db, {
        indexer: 'NZBgeek',
        indexerId: 3,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://stale',
        releaseTitle: 'Inception.2010.720p',
        upstreamFileId: 42,
      })

      const second = upsertMediaFileRelease(db, {
        indexer: 'DrunkenSlug',
        indexerId: 9,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://fresh',
        releaseTitle: 'Inception.2010.1080p',
        upstreamFileId: 42,
      })

      expect(second.id).toBe(first.id)
      expect(second).toMatchObject({
        indexer: 'DrunkenSlug',
        indexerId: 9,
        releaseGuid: 'indexer://fresh',
        releaseTitle: 'Inception.2010.1080p',
      })
      expect(
        listMediaFileReleasesByFileIds(db, DownloadType.Movie, [42]),
      ).toEqual([second])
    } finally {
      close()
    }
  })

  // Drizzle drops `undefined` keys from an update set, so without the
  // explicit `?? null` coalescing in the repo this row would keep the first
  // resolve's indexer alongside the second's guid.
  it('clears fields the newer resolve no longer carries', () => {
    const { db, close } = createTestDb()
    try {
      upsertMediaFileRelease(db, {
        downloadId: 'sab:abc123',
        indexer: 'NZBgeek',
        indexerId: 3,
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        protocol: 'usenet',
        publishDate: new Date('2010-07-16T00:00:00.000Z'),
        releaseGroup: 'GROUP',
        releaseGuid: 'indexer://stale',
        releaseTitle: 'Inception.2010.720p',
        size: 8_000_000_000,
        upstreamFileId: 42,
      })

      const second = upsertMediaFileRelease(db, {
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://fresh',
        upstreamFileId: 42,
      })

      expect(second).toMatchObject({
        downloadId: null,
        indexer: null,
        indexerId: null,
        protocol: null,
        publishDate: null,
        releaseGroup: null,
        releaseTitle: null,
        size: null,
      })
    } finally {
      close()
    }
  })

  it('restamps resolvedAt when a file is resolved again', () => {
    const { db, close } = createTestDb()
    jest.useFakeTimers()
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      const first = upsertMediaFileRelease(db, {
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://stale',
        upstreamFileId: 42,
      })

      jest.setSystemTime(new Date('2026-02-01T00:00:00.000Z'))
      const second = upsertMediaFileRelease(db, {
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://fresh',
        upstreamFileId: 42,
      })

      expect(first.resolvedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
      expect(second.resolvedAt).toEqual(new Date('2026-02-01T00:00:00.000Z'))
    } finally {
      jest.useRealTimers()
      close()
    }
  })

  // Radarr and Sonarr number their files independently, so the pair is the
  // key rather than the file id alone - a shared integer is two rows, not a
  // conflict.
  it('keeps the same file id under movie and show as two separate rows', () => {
    const { db, close } = createTestDb()
    try {
      const movie = upsertMediaFileRelease(db, {
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://movie',
        upstreamFileId: 42,
      })
      const show = upsertMediaFileRelease(db, {
        mediaId: 'tvdb:81189',
        mediaType: DownloadType.Show,
        releaseGuid: 'indexer://show',
        upstreamFileId: 42,
      })

      expect(show.id).not.toBe(movie.id)
      expect(getMediaFileRelease(db, DownloadType.Movie, 42)?.releaseGuid).toBe(
        'indexer://movie',
      )
      expect(getMediaFileRelease(db, DownloadType.Show, 42)?.releaseGuid).toBe(
        'indexer://show',
      )
    } finally {
      close()
    }
  })

  it('returns undefined for a file that has never been resolved', () => {
    const { db, close } = createTestDb()
    try {
      expect(getMediaFileRelease(db, DownloadType.Movie, 12345)).toBeUndefined()
    } finally {
      close()
    }
  })

  it('returns an empty list for an empty id batch without querying', () => {
    const { db, close } = createTestDb()
    try {
      // A `select` spy rather than an assertion on the result alone: the
      // point of the short circuit is that `inArray(col, [])` never reaches
      // the driver, and an empty result would look identical either way.
      const select = jest.spyOn(db, 'select')

      expect(listMediaFileReleasesByFileIds(db, DownloadType.Show, [])).toEqual(
        [],
      )
      expect(select).not.toHaveBeenCalled()
    } finally {
      close()
    }
  })

  it('batch reads only the requested ids, of the requested media type', () => {
    const { db, close } = createTestDb()
    try {
      for (const upstreamFileId of [1, 2, 3]) {
        upsertMediaFileRelease(db, {
          episodeId: upstreamFileId * 10,
          mediaId: 'tvdb:81189',
          mediaType: DownloadType.Show,
          releaseGuid: `indexer://show-${upstreamFileId}`,
          upstreamFileId,
        })
      }
      upsertMediaFileRelease(db, {
        mediaId: 'tmdb:27205',
        mediaType: DownloadType.Movie,
        releaseGuid: 'indexer://movie-1',
        upstreamFileId: 1,
      })

      const rows = listMediaFileReleasesByFileIds(
        db,
        DownloadType.Show,
        [1, 3, 99],
      )

      expect(rows.map(row => row.releaseGuid).sort()).toEqual([
        'indexer://show-1',
        'indexer://show-3',
      ])
    } finally {
      close()
    }
  })
})
