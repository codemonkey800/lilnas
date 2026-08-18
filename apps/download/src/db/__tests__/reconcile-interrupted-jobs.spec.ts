import { eq } from 'drizzle-orm'

import { reconcileInterruptedJobs } from 'src/db/reconcile-interrupted-jobs'
import { DOWNLOAD_JOB_STATUSES, jobs } from 'src/db/schema'

import { createTestDb } from './test-utils'

describe('reconcileInterruptedJobs', () => {
  function seed(
    db: ReturnType<typeof createTestDb>['db'],
    id: string,
    status: (typeof DOWNLOAD_JOB_STATUSES)[number],
  ) {
    db.insert(jobs)
      .values({
        id,
        origin: 'service',
        status,
        type: 'video',
        url: `https://example.com/${id}`,
      })
      .run()
  }

  it('marks every non-terminal row as failed with an interruption error', () => {
    const { db, close } = createTestDb()
    try {
      seed(db, 'downloading-1', 'downloading')
      seed(db, 'converting-1', 'converting')
      seed(db, 'pending-1', 'pending')

      const changed = reconcileInterruptedJobs(db)

      expect(changed).toBe(3)
      for (const id of ['downloading-1', 'converting-1', 'pending-1']) {
        const row = db.select().from(jobs).where(eq(jobs.id, id)).all()[0]
        expect(row?.status).toBe('failed')
        expect(row?.error).toBe('Interrupted by a service restart')
      }
    } finally {
      close()
    }
  })

  it('leaves terminal rows (cancelled, completed, failed) untouched', () => {
    const { db, close } = createTestDb()
    try {
      seed(db, 'cancelled-1', 'cancelled')
      seed(db, 'completed-1', 'completed')
      seed(db, 'failed-1', 'failed')

      const changed = reconcileInterruptedJobs(db)

      expect(changed).toBe(0)

      const cancelled = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'cancelled-1'))
        .all()[0]
      const completed = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'completed-1'))
        .all()[0]
      const failed = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'failed-1'))
        .all()[0]

      expect(cancelled?.status).toBe('cancelled')
      expect(completed?.status).toBe('completed')
      expect(failed?.status).toBe('failed')
      expect(cancelled?.error).toBeNull()
      expect(completed?.error).toBeNull()
      expect(failed?.error).toBeNull()
    } finally {
      close()
    }
  })

  it('does nothing on an empty table', () => {
    const { db, close } = createTestDb()
    try {
      expect(() => reconcileInterruptedJobs(db)).not.toThrow()
      expect(reconcileInterruptedJobs(db)).toBe(0)
    } finally {
      close()
    }
  })
})
