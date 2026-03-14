import {
  computeProgress,
  createTrackedEpisode,
  createTrackedMovie,
  downloadMovieSchema,
  downloadRequestSchema,
  downloadShowSchema,
  IMPORT_STATUSES,
  isImportStatus,
} from 'src/download/download.types'

describe('computeProgress', () => {
  it('computes percentage from size and sizeleft', () => {
    expect(computeProgress(1000, 500)).toBe(50)
  })

  it('returns 100 when sizeleft is 0 (complete)', () => {
    expect(computeProgress(1000, 0)).toBe(100)
  })

  it('returns 0 when sizeleft equals size', () => {
    expect(computeProgress(1000, 1000)).toBe(0)
  })

  it.each([
    { size: 0, sizeleft: 0, label: 'size is 0' },
    { size: -1, sizeleft: 0, label: 'size is negative' },
    { size: undefined, sizeleft: 500, label: 'size is undefined' },
    { size: 1000, sizeleft: undefined, label: 'sizeleft is undefined' },
    { size: undefined, sizeleft: undefined, label: 'both are undefined' },
  ])('returns null when $label', ({ size, sizeleft }) => {
    expect(computeProgress(size, sizeleft)).toBeNull()
  })

  it('rounds to nearest integer', () => {
    // 1/3 ≈ 33.33%
    expect(computeProgress(3, 2)).toBe(33)
  })

  it('returns negative value when sizeleft exceeds size (no clamping)', () => {
    const result = computeProgress(100, 200)
    expect(result).toBeLessThan(0)
  })
})

describe('isImportStatus', () => {
  it('returns true when progress >= 100', () => {
    expect(isImportStatus(100, 'queued')).toBe(true)
  })

  it('returns true when progress > 100', () => {
    expect(isImportStatus(101, 'queued')).toBe(true)
  })

  it('returns false when progress < 100 and status is not import', () => {
    expect(isImportStatus(50, 'downloading')).toBe(false)
  })

  it('returns true for any import status regardless of progress', () => {
    for (const status of IMPORT_STATUSES) {
      expect(isImportStatus(50, status)).toBe(true)
    }
  })

  it('returns false for non-import status at low progress', () => {
    expect(isImportStatus(0, 'downloading')).toBe(false)
  })

  it('returns false for null or undefined status at low progress', () => {
    expect(isImportStatus(50, null)).toBe(false)
    expect(isImportStatus(50, undefined)).toBe(false)
  })
})

describe('createTrackedMovie', () => {
  it('creates a tracked movie with identity fields set and all progress fields null', () => {
    const tracked = createTrackedMovie(456, 123)
    expect(tracked.kind).toBe('movie')
    expect(tracked.tmdbId).toBe(456)
    expect(tracked.radarrMovieId).toBe(123)
    expect(tracked.queueId).toBeNull()
    expect(tracked.lastProgress).toBeNull()
    expect(tracked.lastStatus).toBeNull()
    expect(tracked.lastSizeleft).toBeNull()
    expect(tracked.lastTitle).toBeNull()
    expect(tracked.lastSize).toBeNull()
    expect(tracked.lastEta).toBeNull()
  })
})

describe('createTrackedEpisode', () => {
  const identity = {
    tvdbId: 789,
    sonarrSeriesId: 20,
    sonarrEpisodeId: 1,
    seasonNumber: 1,
    episodeNumber: 3,
  }

  it('creates a tracked episode with identity fields set and all progress fields null', () => {
    const tracked = createTrackedEpisode(identity)
    expect(tracked.kind).toBe('episode')
    expect(tracked.tvdbId).toBe(789)
    expect(tracked.sonarrSeriesId).toBe(20)
    expect(tracked.sonarrEpisodeId).toBe(1)
    expect(tracked.seasonNumber).toBe(1)
    expect(tracked.episodeNumber).toBe(3)
    expect(tracked.queueId).toBeNull()
    expect(tracked.lastProgress).toBeNull()
    expect(tracked.lastStatus).toBeNull()
    expect(tracked.lastSizeleft).toBeNull()
    expect(tracked.lastTitle).toBeNull()
    expect(tracked.lastSize).toBeNull()
    expect(tracked.lastEta).toBeNull()
  })
})

describe('downloadMovieSchema', () => {
  it('accepts a valid movie request without a specific release', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 456,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid movie request with releaseGuid and indexerId', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 456,
      releaseGuid: 'abc-123',
      indexerId: 1,
    })
    expect(result.success).toBe(true)
  })

  it('rejects when releaseGuid is provided without indexerId', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 456,
      releaseGuid: 'abc-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects wrong mediaType', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'show',
      tmdbId: 456,
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing tmdbId', () => {
    const result = downloadMovieSchema.safeParse({ mediaType: 'movie' })
    expect(result.success).toBe(false)
  })
})

describe('downloadShowSchema', () => {
  it('accepts a series-scope request', () => {
    const result = downloadShowSchema.safeParse({
      mediaType: 'show',
      tvdbId: 789,
      scope: 'series',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a season-scope request with seasonNumber', () => {
    const result = downloadShowSchema.safeParse({
      mediaType: 'show',
      tvdbId: 789,
      scope: 'season',
      seasonNumber: 2,
    })
    expect(result.success).toBe(true)
  })

  it('accepts an episode-scope request with episodeId', () => {
    const result = downloadShowSchema.safeParse({
      mediaType: 'show',
      tvdbId: 789,
      scope: 'episode',
      episodeId: 100,
    })
    expect(result.success).toBe(true)
  })

  it('rejects season scope without seasonNumber', () => {
    const result = downloadShowSchema.safeParse({
      mediaType: 'show',
      tvdbId: 789,
      scope: 'season',
    })
    expect(result.success).toBe(false)
  })

  it('rejects episode scope without episodeId', () => {
    const result = downloadShowSchema.safeParse({
      mediaType: 'show',
      tvdbId: 789,
      scope: 'episode',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown scope', () => {
    const result = downloadShowSchema.safeParse({
      mediaType: 'show',
      tvdbId: 789,
      scope: 'special',
    })
    expect(result.success).toBe(false)
  })
})

describe('downloadRequestSchema', () => {
  it('accepts a valid movie request', () => {
    const result = downloadRequestSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 456,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid show request', () => {
    const result = downloadRequestSchema.safeParse({
      mediaType: 'show',
      tvdbId: 789,
      scope: 'series',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown mediaType', () => {
    const result = downloadRequestSchema.safeParse({
      mediaType: 'unknown',
      id: 1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty object', () => {
    const result = downloadRequestSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
