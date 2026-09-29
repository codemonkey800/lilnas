import type { Db } from 'src/db/db.service'
import { getCursor, setCursor } from 'src/db/history-cursors.repo'

import { createTestDbService } from './test-utils'

const T1 = '2026-09-28T10:00:00Z'
const T2 = '2026-09-28T10:00:01Z'
const T0 = '2026-09-28T09:59:59Z'

describe('history-cursors repo', () => {
  let db: Db
  let close: () => void

  beforeEach(() => {
    const dbService = createTestDbService()
    db = dbService.db
    close = () => dbService.onModuleDestroy()
  })

  afterEach(() => close())

  it('has no cursor for an app whose history was never read', () => {
    expect(getCursor(db, 'radarr')).toBeUndefined()
  })

  it('stores a first cursor and reads it back, ids sorted and de-duplicated', () => {
    expect(setCursor(db, 'radarr', T1, [7, 3, 7])).toEqual({
      date: T1,
      ids: [3, 7],
    })
    expect(getCursor(db, 'radarr')).toEqual({ date: T1, ids: [3, 7] })
  })

  it('keeps one cursor per app', () => {
    setCursor(db, 'radarr', T1, [1])
    setCursor(db, 'sonarr', T2, [2])

    expect(getCursor(db, 'radarr')).toEqual({ date: T1, ids: [1] })
    expect(getCursor(db, 'sonarr')).toEqual({ date: T2, ids: [2] })
  })

  // Ids inside one second are not monotonic, so a tie that spans two reads
  // must remember both reads' ids.
  it('unions the ids on an equal date', () => {
    setCursor(db, 'sonarr', T1, [52, 9])
    expect(setCursor(db, 'sonarr', T1, [9, 4])).toEqual({
      date: T1,
      ids: [4, 9, 52],
    })
    expect(getCursor(db, 'sonarr')).toEqual({ date: T1, ids: [4, 9, 52] })
  })

  it('treats two spellings of the same instant as equal, keeping the stored one', () => {
    setCursor(db, 'sonarr', T1, [1])
    setCursor(db, 'sonarr', '2026-09-28T10:00:00.000Z', [2])

    expect(getCursor(db, 'sonarr')).toEqual({ date: T1, ids: [1, 2] })
  })

  it('replaces the ids on a later date', () => {
    setCursor(db, 'sonarr', T1, [52, 9])
    expect(setCursor(db, 'sonarr', T2, [11])).toEqual({ date: T2, ids: [11] })
    expect(getCursor(db, 'sonarr')).toEqual({ date: T2, ids: [11] })
  })

  it('never moves backwards', () => {
    setCursor(db, 'sonarr', T1, [5])

    expect(setCursor(db, 'sonarr', T0, [1, 2])).toEqual({ date: T1, ids: [5] })
    expect(getCursor(db, 'sonarr')).toEqual({ date: T1, ids: [5] })
  })

  it('accepts an empty id list', () => {
    expect(setCursor(db, 'radarr', T1, [])).toEqual({ date: T1, ids: [] })
  })

  it('rejects a date it cannot compare', () => {
    expect(() => setCursor(db, 'radarr', 'not a date', [1])).toThrow(
      /not a date/,
    )
    expect(getCursor(db, 'radarr')).toBeUndefined()
  })
})
