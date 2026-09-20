// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// library-sync.ts, since backfillCompletedJobs()) must mock it first (see
// download/__tests__/download-state.service.test.ts for the same pattern).
// Counts up rather than returning a constant: two backfilled jobs need
// distinct ids, or the second insert would collide on `jobs.id`.
jest.mock('nanoid', () => {
  let counter = 0
  return { nanoid: jest.fn(() => `mock-id-${++counter}`) }
})

import { Logger } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { createTestDb } from 'src/db/__tests__/test-utils'
import { jobs } from 'src/db/schema'
import { syncDownloadedLibrary } from 'src/media/library-sync'
import type { RadarrService } from 'src/media/radarr.service'
import type { SonarrService } from 'src/media/sonarr.service'

function fakeRadarrService(
  movies: Array<{ addedAt: Date; movie: { id: string } }> = [],
): RadarrService {
  return {
    getDownloadedMovies: jest.fn().mockResolvedValue(movies),
  } as unknown as RadarrService
}

function fakeSonarrService(
  shows: Array<{ addedAt: Date; show: { id: string } }> = [],
): SonarrService {
  return {
    getDownloadedSeries: jest.fn().mockResolvedValue(shows),
  } as unknown as SonarrService
}

describe('syncDownloadedLibrary', () => {
  let logger: Logger

  beforeEach(() => {
    logger = new Logger('test')
    jest.spyOn(logger, 'warn').mockImplementation()
  })

  it('backfills a completed job for a downloaded movie and show with no job yet', async () => {
    const { db, close } = createTestDb()
    try {
      const addedAt = new Date('2024-01-15T00:00:00Z')
      const result = await syncDownloadedLibrary(
        db,
        fakeRadarrService([{ addedAt, movie: { id: 'tmdb:111' } }]),
        fakeSonarrService([{ addedAt, show: { id: 'tvdb:222' } }]),
        logger,
      )

      expect(result).toEqual({ moviesAdded: 1, showsAdded: 1 })

      const movieJob = db
        .select()
        .from(jobs)
        .where(eq(jobs.mediaId, 'tmdb:111'))
        .all()[0]
      expect(movieJob).toEqual(
        expect.objectContaining({
          mediaId: 'tmdb:111',
          origin: 'service',
          requesterEmail: null,
          requesterUserId: null,
          status: 'completed',
          type: 'movie',
        }),
      )
      expect(movieJob?.createdAt).toEqual(addedAt)
      expect(movieJob?.completedAt).toEqual(addedAt)

      const showJob = db
        .select()
        .from(jobs)
        .where(eq(jobs.mediaId, 'tvdb:222'))
        .all()[0]
      expect(showJob).toEqual(
        expect.objectContaining({ mediaId: 'tvdb:222', type: 'show' }),
      )
    } finally {
      close()
    }
  })

  it('does not duplicate a title that already has a completed job', async () => {
    const { db, close } = createTestDb()
    try {
      db.insert(jobs)
        .values({
          id: 'existing-1',
          mediaId: 'tmdb:111',
          origin: 'service',
          status: 'completed',
          type: 'movie',
        })
        .run()

      const result = await syncDownloadedLibrary(
        db,
        fakeRadarrService([{ addedAt: new Date(), movie: { id: 'tmdb:111' } }]),
        fakeSonarrService(),
        logger,
      )

      expect(result).toEqual({ moviesAdded: 0, showsAdded: 0 })
      expect(
        db.select().from(jobs).where(eq(jobs.mediaId, 'tmdb:111')).all(),
      ).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('still backfills a title whose only existing job is not completed', async () => {
    const { db, close } = createTestDb()
    try {
      db.insert(jobs)
        .values({
          id: 'existing-1',
          mediaId: 'tmdb:111',
          origin: 'service',
          status: 'failed',
          type: 'movie',
        })
        .run()

      const result = await syncDownloadedLibrary(
        db,
        fakeRadarrService([{ addedAt: new Date(), movie: { id: 'tmdb:111' } }]),
        fakeSonarrService(),
        logger,
      )

      expect(result).toEqual({ moviesAdded: 1, showsAdded: 0 })
      expect(
        db.select().from(jobs).where(eq(jobs.mediaId, 'tmdb:111')).all(),
      ).toHaveLength(2)
    } finally {
      close()
    }
  })

  it('does nothing when both upstreams have no downloaded titles', async () => {
    const { db, close } = createTestDb()
    try {
      const result = await syncDownloadedLibrary(
        db,
        fakeRadarrService(),
        fakeSonarrService(),
        logger,
      )

      expect(result).toEqual({ moviesAdded: 0, showsAdded: 0 })
      expect(db.select().from(jobs).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('logs and continues when Radarr fails, still syncing Sonarr', async () => {
    const { db, close } = createTestDb()
    try {
      const radarrService = {
        getDownloadedMovies: jest.fn().mockRejectedValue(new Error('down')),
      } as unknown as RadarrService

      const result = await syncDownloadedLibrary(
        db,
        radarrService,
        fakeSonarrService([{ addedAt: new Date(), show: { id: 'tvdb:222' } }]),
        logger,
      )

      expect(result).toEqual({ moviesAdded: 0, showsAdded: 1 })
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        expect.stringContaining('Radarr'),
      )
    } finally {
      close()
    }
  })
})
