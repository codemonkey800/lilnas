import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { eq } from 'drizzle-orm'

import {
  reconcileInterruptedJobs,
  RESTART_SURVIVING_STATUSES,
} from 'src/db/reconcile-interrupted-jobs'
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
        mediaId: `video:${id}`,
        origin: 'service',
        status,
        type: 'video',
      })
      .run()
  }

  it('marks every non-terminal row except needs_attention as failed with an interruption error', () => {
    const { db, close } = createTestDb()
    try {
      seed(db, 'downloading-1', 'downloading')
      seed(db, 'converting-1', 'converting')
      seed(db, 'pending-1', 'pending')
      seed(db, 'attention-1', 'needs_attention')

      const changed = reconcileInterruptedJobs(db)

      expect(changed).toBe(3)
      for (const id of ['downloading-1', 'converting-1', 'pending-1']) {
        const row = db.select().from(jobs).where(eq(jobs.id, id)).all()[0]
        expect(row?.status).toBe('failed')
        expect(row?.error).toBe('Interrupted by a service restart')
      }

      const spared = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'attention-1'))
        .all()[0]

      expect(spared?.status).toBe('needs_attention')
      expect(spared?.error).toBeNull()
    } finally {
      close()
    }
  })

  // Plan 020. `needs_attention` is the one non-terminal status the sweep
  // spares: it describes Radarr/Sonarr's "Downloaded - Waiting to Import"
  // queue row, which is still there after this process restarts. Failing it
  // would both lie about upstream and offer a Retry that re-grabs a file
  // already sitting on disk. `bootstrap.ts` re-adopts these rows instead.
  it('leaves a needs_attention row completely untouched - status, error and updatedAt', () => {
    const { db, close } = createTestDb()
    try {
      seed(db, 'attention-1', 'needs_attention')

      const before = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'attention-1'))
        .all()[0]

      const changed = reconcileInterruptedJobs(db)

      expect(changed).toBe(0)

      const after = db
        .select()
        .from(jobs)
        .where(eq(jobs.id, 'attention-1'))
        .all()[0]

      expect(after?.status).toBe('needs_attention')
      expect(after?.error).toBeNull()
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
    } finally {
      close()
    }
  })

  it('lists needs_attention in RESTART_SURVIVING_STATUSES', () => {
    expect([...RESTART_SURVIVING_STATUSES]).toEqual([
      DownloadJobStatus.NeedsAttention,
    ])
  })

  // Phase 5. `paused`/`pausing` are non-terminal, so this sweep catches them
  // like any other in-flight status. That is deliberate, not an oversight: a
  // paused video's partial file lives under `/download/videos`, which has no
  // volume behind it, so a restart destroys the bytes and leaves nothing to
  // resume from. Failing the row loudly is more honest than leaving it parked
  // at `paused` pointing at a file that no longer exists.
  it.each(['paused', 'pausing'] as const)(
    'deliberately fails a `%s` row too - a pause is not designed to survive a restart',
    status => {
      const { db, close } = createTestDb()
      try {
        seed(db, 'paused-1', status)

        const changed = reconcileInterruptedJobs(db)

        expect(changed).toBe(1)

        const row = db
          .select()
          .from(jobs)
          .where(eq(jobs.id, 'paused-1'))
          .all()[0]

        expect(row?.status).toBe('failed')
        expect(row?.error).toBe('Interrupted by a service restart')
      } finally {
        close()
      }
    },
  )

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
