import { eq } from 'drizzle-orm'

import type { Db } from 'src/db/db.service'
import {
  claimedDownloadIds,
  findJobsByDownloadId,
  keptDownloadIds,
  linkDownload,
  listForJob,
  markFailed,
  markImported,
} from 'src/db/job-downloads.repo'
import { type ArrApp, jobs } from 'src/db/schema'

import { createTestDbService } from './test-utils'

type RowInsert = typeof jobs.$inferInsert

function seedJob(db: Db, id: string, overrides: Partial<RowInsert> = {}): void {
  db.insert(jobs)
    .values({
      id,
      mediaId: 'tvdb:121361',
      origin: 'service',
      status: 'downloading',
      type: 'show',
      ...overrides,
    })
    .run()
}

const GRABBED = '2026-09-28T10:00:00Z'
const LATER = '2026-09-28T11:00:00Z'

describe('job-downloads repo', () => {
  let db: Db
  let close: () => void

  beforeEach(() => {
    const dbService = createTestDbService()
    db = dbService.db
    close = () => dbService.onModuleDestroy()
    seedJob(db, 'job-a')
    seedJob(db, 'job-b')
  })

  afterEach(() => close())

  describe('linkDownload', () => {
    it('links a download and returns the stored row', () => {
      const row = linkDownload(db, {
        app: 'sonarr',
        downloadId: 'nzo_1',
        grabbedAt: GRABBED,
        interactive: true,
        jobId: 'job-a',
      })

      expect(row).toEqual({
        app: 'sonarr',
        downloadId: 'nzo_1',
        failReason: null,
        failedAt: null,
        grabbedAt: GRABBED,
        importedAt: null,
        interactive: true,
        jobId: 'job-a',
      })
    })

    it('is idempotent - linking twice keeps one row and the first timestamps', () => {
      linkDownload(db, {
        app: 'sonarr',
        downloadId: 'nzo_1',
        grabbedAt: GRABBED,
        interactive: false,
        jobId: 'job-a',
      })
      const again = linkDownload(db, {
        app: 'sonarr',
        downloadId: 'nzo_1',
        grabbedAt: LATER,
        interactive: true,
        jobId: 'job-a',
      })

      expect(listForJob(db, 'job-a')).toHaveLength(1)
      expect(again.grabbedAt).toBe(GRABBED)
      expect(again.interactive).toBe(false)
    })

    it('does not clear an imported/failed mark when linked again', () => {
      linkDownload(db, {
        app: 'sonarr',
        downloadId: 'nzo_1',
        grabbedAt: GRABBED,
        jobId: 'job-a',
      })
      markImported(db, 'sonarr', 'nzo_1', LATER)

      const again = linkDownload(db, {
        app: 'sonarr',
        downloadId: 'nzo_1',
        grabbedAt: GRABBED,
        jobId: 'job-a',
      })

      expect(again.importedAt).toBe(LATER)
    })

    it('fills a grab date and interactive flag the first link did not have', () => {
      linkDownload(db, {
        app: 'sonarr',
        downloadId: 'nzo_1',
        grabbedAt: null,
        jobId: 'job-a',
      })
      const filled = linkDownload(db, {
        app: 'sonarr',
        downloadId: 'nzo_1',
        grabbedAt: GRABBED,
        interactive: true,
        jobId: 'job-a',
      })

      expect(filled.grabbedAt).toBe(GRABBED)
      expect(filled.interactive).toBe(true)
    })

    it('rejects a link to a job that does not exist', () => {
      expect(() =>
        linkDownload(db, {
          app: 'radarr',
          downloadId: 'nzo_1',
          grabbedAt: GRABBED,
          jobId: 'no-such-job',
        }),
      ).toThrow(/FOREIGN KEY/)
    })
  })

  describe('markImported / markFailed across two jobs sharing a download', () => {
    beforeEach(() => {
      for (const jobId of ['job-a', 'job-b']) {
        linkDownload(db, {
          app: 'sonarr',
          downloadId: 'pack',
          grabbedAt: GRABBED,
          jobId,
        })
      }
      linkDownload(db, {
        app: 'sonarr',
        downloadId: 'other',
        grabbedAt: GRABBED,
        jobId: 'job-a',
      })
    })

    it('marks every job linked to the download imported, and only that download', () => {
      const changed = markImported(db, 'sonarr', 'pack', LATER)

      expect(changed.map(row => row.jobId).sort()).toEqual(['job-a', 'job-b'])
      expect(
        findJobsByDownloadId(db, 'sonarr', 'pack').map(row => row.importedAt),
      ).toEqual([LATER, LATER])
      expect(
        findJobsByDownloadId(db, 'sonarr', 'other')[0]?.importedAt,
      ).toBeNull()
    })

    it('is idempotent - a replayed import changes nothing and keeps the first time', () => {
      markImported(db, 'sonarr', 'pack', GRABBED)

      expect(markImported(db, 'sonarr', 'pack', LATER)).toEqual([])
      expect(
        findJobsByDownloadId(db, 'sonarr', 'pack').map(row => row.importedAt),
      ).toEqual([GRABBED, GRABBED])
    })

    it('marks every linked job failed with the reason, idempotently', () => {
      const changed = markFailed(
        db,
        'sonarr',
        'pack',
        LATER,
        'Unpacking failed',
      )

      expect(changed).toHaveLength(2)
      expect(markFailed(db, 'sonarr', 'pack', LATER, 'something else')).toEqual(
        [],
      )
      expect(findJobsByDownloadId(db, 'sonarr', 'pack')).toEqual([
        expect.objectContaining({
          failReason: 'Unpacking failed',
          failedAt: LATER,
          jobId: 'job-a',
        }),
        expect.objectContaining({
          failReason: 'Unpacking failed',
          failedAt: LATER,
          jobId: 'job-b',
        }),
      ])
    })

    it('matches on the app as well as the download id', () => {
      expect(markImported(db, 'radarr', 'pack', LATER)).toEqual([])
      expect(markFailed(db, 'radarr', 'pack', LATER, null)).toEqual([])
      expect(findJobsByDownloadId(db, 'radarr', 'pack')).toEqual([])
    })
  })

  describe('listForJob', () => {
    it('lists a job’s downloads in link order, and nothing for an unlinked job', () => {
      for (const downloadId of ['d3', 'd1', 'd2']) {
        linkDownload(db, {
          app: 'sonarr',
          downloadId,
          grabbedAt: GRABBED,
          jobId: 'job-a',
        })
      }

      expect(listForJob(db, 'job-a').map(row => row.downloadId)).toEqual([
        'd3',
        'd1',
        'd2',
      ])
      expect(listForJob(db, 'job-b')).toEqual([])
    })
  })

  it('cascades a job delete to its links', () => {
    linkDownload(db, {
      app: 'sonarr',
      downloadId: 'pack',
      grabbedAt: GRABBED,
      jobId: 'job-a',
    })
    linkDownload(db, {
      app: 'sonarr',
      downloadId: 'pack',
      grabbedAt: GRABBED,
      jobId: 'job-b',
    })

    db.delete(jobs).where(eq(jobs.id, 'job-a')).run()

    expect(listForJob(db, 'job-a')).toEqual([])
    expect(
      findJobsByDownloadId(db, 'sonarr', 'pack').map(row => row.jobId),
    ).toEqual(['job-b'])
  })

  describe('claimedDownloadIds', () => {
    it('holds the downloads of in-flight jobs of that app only', () => {
      seedJob(db, 'job-done', { status: 'completed' })
      seedJob(db, 'job-failed', { status: 'failed' })
      seedJob(db, 'job-not-found', { status: 'not_found' })
      seedJob(db, 'job-attention', { status: 'needs_attention' })
      seedJob(db, 'job-movie', { mediaId: 'tmdb:1', type: 'movie' })

      const link = (
        jobId: string,
        downloadId: string,
        app: ArrApp = 'sonarr',
      ) =>
        linkDownload(db, {
          app,
          downloadId,
          grabbedAt: GRABBED,
          jobId,
        })

      link('job-a', 'live-1')
      link('job-b', 'live-2')
      link('job-attention', 'attention')
      link('job-done', 'done')
      link('job-failed', 'failed')
      link('job-not-found', 'not-found')
      link('job-movie', 'movie-1', 'radarr')
      // A download shared by a finished job and a live one is still claimed.
      link('job-done', 'shared')
      link('job-a', 'shared')

      expect(claimedDownloadIds(db, 'sonarr')).toEqual(
        new Set(['attention', 'live-1', 'live-2', 'shared']),
      )
      expect(claimedDownloadIds(db, 'radarr')).toEqual(new Set(['movie-1']))
    })

    it('releases a download once its job settles', () => {
      linkDownload(db, {
        app: 'sonarr',
        downloadId: 'd1',
        grabbedAt: GRABBED,
        jobId: 'job-a',
      })
      expect(claimedDownloadIds(db, 'sonarr').has('d1')).toBe(true)

      db.update(jobs)
        .set({ status: 'cancelled' })
        .where(eq(jobs.id, 'job-a'))
        .run()

      expect(claimedDownloadIds(db, 'sonarr').has('d1')).toBe(false)
    })
  })

  describe('keptDownloadIds', () => {
    const NOTE = 'Part of a season download that is still running'

    it('holds the live downloads of jobs cancelled with the note only', () => {
      seedJob(db, 'kept', { status: 'cancelled', statusNote: NOTE })
      seedJob(db, 'kept-failed', { status: 'cancelled', statusNote: NOTE })
      seedJob(db, 'plain-cancel', { status: 'cancelled' })
      seedJob(db, 'other-note', {
        status: 'cancelled',
        statusNote: 'Removed from the download client',
      })

      const link = (jobId: string, downloadId: string) =>
        linkDownload(db, { app: 'sonarr', downloadId, grabbedAt: null, jobId })

      link('kept', 'pack')
      link('kept-failed', 'dead-pack')
      link('plain-cancel', 'removed')
      link('other-note', 'gone')
      link('job-a', 'live')
      markFailed(db, 'sonarr', 'dead-pack', LATER, 'client error')
      // The first episode's import, recorded while the rest is queued.
      markImported(db, 'sonarr', 'pack', LATER)

      expect(keptDownloadIds(db, 'sonarr', NOTE)).toEqual(new Set(['pack']))
      expect(keptDownloadIds(db, 'radarr', NOTE)).toEqual(new Set())
    })
  })
})
