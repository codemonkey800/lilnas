import {
  computeDownloadState,
  computeProgress,
  downloadMovieSchema,
  isImportStatus,
} from 'src/downloads/downloads.types'

describe('computeProgress', () => {
  it('returns null when size is undefined', () => {
    expect(computeProgress(undefined, 500)).toBeNull()
  })

  it('returns null when sizeleft is undefined', () => {
    expect(computeProgress(1000, undefined)).toBeNull()
  })

  it('returns null when both are undefined', () => {
    expect(computeProgress(undefined, undefined)).toBeNull()
  })

  it('returns null when size is zero (avoids division by zero)', () => {
    expect(computeProgress(0, 0)).toBeNull()
  })

  it('returns null when size is negative', () => {
    expect(computeProgress(-1, 0)).toBeNull()
  })

  it('returns 0 when no bytes downloaded yet', () => {
    expect(computeProgress(1000, 1000)).toBe(0)
  })

  it('returns 100 when fully downloaded', () => {
    expect(computeProgress(1000, 0)).toBe(100)
  })

  it('returns 50 at exactly halfway', () => {
    expect(computeProgress(1000, 500)).toBe(50)
  })

  it('rounds to nearest integer', () => {
    // 333/1000 = 33.3% -> rounds to 33
    expect(computeProgress(1000, 667)).toBe(33)
    // 666/1000 = 66.6% -> rounds to 67
    expect(computeProgress(1000, 334)).toBe(67)
  })

  it('handles large file sizes without precision loss', () => {
    const gb = 50 * 1024 * 1024 * 1024
    expect(computeProgress(gb, 0)).toBe(100)
    expect(computeProgress(gb, gb)).toBe(0)
    expect(computeProgress(gb, gb / 2)).toBe(50)
  })
})

describe('isImportStatus', () => {
  it('returns true when progress is exactly 100', () => {
    expect(isImportStatus(100, 'queued')).toBe(true)
  })

  it('returns true when progress exceeds 100', () => {
    expect(isImportStatus(105, null)).toBe(true)
  })

  it('returns false when progress is 99 and status is not an import status', () => {
    expect(isImportStatus(99, 'downloading')).toBe(false)
  })

  it.each(['importPending', 'importing', 'importBlocked', 'imported'])(
    'returns true for import status "%s" regardless of progress',
    status => {
      expect(isImportStatus(50, status)).toBe(true)
      expect(isImportStatus(0, status)).toBe(true)
    },
  )

  it('returns false for non-import status strings at progress < 100', () => {
    expect(isImportStatus(99, 'downloading')).toBe(false)
    expect(isImportStatus(0, 'queued')).toBe(false)
    expect(isImportStatus(99, 'failed')).toBe(false)
  })

  it('returns false for null status at progress < 100', () => {
    expect(isImportStatus(0, null)).toBe(false)
    expect(isImportStatus(99, null)).toBe(false)
  })

  it('returns false for undefined status at progress < 100', () => {
    expect(isImportStatus(50, undefined)).toBe(false)
  })

  it('returns false for empty string status at progress < 100', () => {
    expect(isImportStatus(50, '')).toBe(false)
  })
})

describe('computeDownloadState', () => {
  it('returns "searching" when queueId is null', () => {
    expect(
      computeDownloadState({
        queueId: null,
        lastProgress: null,
        lastStatus: null,
      }),
    ).toBe('searching')
  })

  it('returns "searching" when queueId is null even with progress data', () => {
    expect(
      computeDownloadState({
        queueId: null,
        lastProgress: 50,
        lastStatus: 'downloading',
      }),
    ).toBe('searching')
  })

  it('returns "downloading" when queueId is set and progress < 100', () => {
    expect(
      computeDownloadState({
        queueId: 42,
        lastProgress: 50,
        lastStatus: 'downloading',
      }),
    ).toBe('downloading')
  })

  it('returns "downloading" when queueId is set and progress is null', () => {
    expect(
      computeDownloadState({
        queueId: 42,
        lastProgress: null,
        lastStatus: null,
      }),
    ).toBe('downloading')
  })

  it('returns "importing" when progress reaches 100', () => {
    expect(
      computeDownloadState({
        queueId: 42,
        lastProgress: 100,
        lastStatus: 'downloading',
      }),
    ).toBe('importing')
  })

  it.each(['importPending', 'importing', 'importBlocked', 'imported'])(
    'returns "importing" for import status "%s" even at low progress',
    status => {
      expect(
        computeDownloadState({
          queueId: 42,
          lastProgress: 50,
          lastStatus: status,
        }),
      ).toBe('importing')
    },
  )
})

describe('downloadMovieSchema refine constraint', () => {
  it('accepts a movie request without releaseGuid', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 123,
    })
    expect(result.success).toBe(true)
  })

  it('accepts a movie request with releaseGuid and indexerId together', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 123,
      releaseGuid: 'abc-guid',
      indexerId: 5,
    })
    expect(result.success).toBe(true)
  })

  it('rejects releaseGuid provided without indexerId', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 123,
      releaseGuid: 'abc-guid',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/indexerId is required/)
    }
  })

  it('accepts indexerId without releaseGuid (optional pairing)', () => {
    const result = downloadMovieSchema.safeParse({
      mediaType: 'movie',
      tmdbId: 123,
      indexerId: 5,
    })
    expect(result.success).toBe(true)
  })
})
