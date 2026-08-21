import {
  getVideoById,
  getVideosByIds,
  upsertVideoByNaturalKey,
} from 'src/db/videos.repo'

import { createTestDb } from './test-utils'

describe('videos repo', () => {
  it('upsert inserts a new row when the natural key is unseen', () => {
    const { db, close } = createTestDb()
    try {
      const row = upsertVideoByNaturalKey(db, {
        id: 'video-1',
        naturalKey: 'https://example.com/a#-',
        sourceUrl: 'https://example.com/a',
        title: 'https://example.com/a',
      })

      expect(row.id).toBe('video-1')
      expect(row.naturalKey).toBe('https://example.com/a#-')
      expect(row.title).toBe('https://example.com/a')
    } finally {
      close()
    }
  })

  it('upsert is idempotent on the natural key and returns the same row id twice', () => {
    const { db, close } = createTestDb()
    try {
      const first = upsertVideoByNaturalKey(db, {
        id: 'video-1',
        naturalKey: 'https://example.com/a#-',
        sourceUrl: 'https://example.com/a',
        title: 'https://example.com/a',
      })

      // A second call minting a *different* id, same natural key - the
      // conflicting row must keep the first call's id.
      const second = upsertVideoByNaturalKey(db, {
        id: 'video-2',
        naturalKey: 'https://example.com/a#-',
        overview: 'Now with an overview',
        sourceUrl: 'https://example.com/a',
        title: 'A Real Title',
      })

      expect(second.id).toBe(first.id)
      expect(second.title).toBe('A Real Title')
      expect(second.overview).toBe('Now with an overview')

      const all = getVideosByIds(db, [first.id, 'video-2'])
      expect(all).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('getVideoById returns undefined for an unknown id', () => {
    const { db, close } = createTestDb()
    try {
      expect(getVideoById(db, 'nonexistent')).toBeUndefined()
    } finally {
      close()
    }
  })

  it('getVideosByIds returns an empty array for an empty id list without querying', () => {
    const { db, close } = createTestDb()
    try {
      expect(getVideosByIds(db, [])).toEqual([])
    } finally {
      close()
    }
  })

  it('getVideosByIds batches a lookup across multiple rows', () => {
    const { db, close } = createTestDb()
    try {
      upsertVideoByNaturalKey(db, {
        id: 'video-1',
        naturalKey: 'https://example.com/a#-',
        sourceUrl: 'https://example.com/a',
        title: 'A',
      })
      upsertVideoByNaturalKey(db, {
        id: 'video-2',
        naturalKey: 'https://example.com/b#-',
        sourceUrl: 'https://example.com/b',
        title: 'B',
      })

      const rows = getVideosByIds(db, ['video-1', 'video-2', 'missing'])
      expect(rows.map(r => r.id).sort()).toEqual(['video-1', 'video-2'])
    } finally {
      close()
    }
  })
})
