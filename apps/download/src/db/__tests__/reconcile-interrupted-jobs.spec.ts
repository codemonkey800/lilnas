import { eq } from 'drizzle-orm'

import { reconcileInterruptedJobs } from 'src/db/reconcile-interrupted-jobs'
import { DOWNLOAD_JOB_STATUSES, DOWNLOAD_TYPES, jobs } from 'src/db/schema'

import { createTestDb } from './test-utils'

type Status = (typeof DOWNLOAD_JOB_STATUSES)[number]
type Type = (typeof DOWNLOAD_TYPES)[number]

const MEDIA_PREFIX: Record<Type, string> = {
  movie: 'tmdb',
  show: 'tvdb',
  video: 'video',
}

describe('reconcileInterruptedJobs', () => {
  function seed(
    db: ReturnType<typeof createTestDb>['db'],
    id: string,
    status: Status,
    type: Type = 'video',
  ) {
    db.insert(jobs)
      .values({
        id,
        mediaId: `${MEDIA_PREFIX[type]}:${id}`,
        origin: 'service',
        status,
        type,
      })
      .run()
  }

  function read(db: ReturnType<typeof createTestDb>['db'], id: string) {
    return db.select().from(jobs).where(eq(jobs.id, id)).all()[0]
  }

  it('marks every non-terminal video row except needs_attention as failed with an interruption error', () => {
    const { db, close } = createTestDb()
    try {
      seed(db, 'downloading-1', 'downloading')
      seed(db, 'converting-1', 'converting')
      seed(db, 'pending-1', 'pending')
      seed(db, 'attention-1', 'needs_attention')

      const changed = reconcileInterruptedJobs(db)

      expect(changed).toBe(3)
      for (const id of ['downloading-1', 'converting-1', 'pending-1']) {
        const row = read(db, id)
        expect(row?.status).toBe('failed')
        expect(row?.error).toBe('Interrupted by a service restart')
      }

      const spared = read(db, 'attention-1')

      expect(spared?.status).toBe('needs_attention')
      expect(spared?.error).toBeNull()
    } finally {
      close()
    }
  })

  // Plan 021. A movie/show download runs in Radarr/Sonarr, which outlived
  // this process, so a restart says nothing about it - the _Cars_ bug was a
  // restart failing a movie job whose file then landed. These rows are
  // re-adopted at boot instead, and the poller settles them.
  it.each([
    ['movie', 'downloading'],
    ['movie', 'paused'],
    ['show', 'searching'],
    ['show', 'requested'],
    ['show', 'importing'],
    ['show', 'paused'],
  ] as const)(
    'leaves a %s row at `%s` completely untouched - status, error and updatedAt',
    (type, status) => {
      const { db, close } = createTestDb()
      try {
        seed(db, 'open-1', status, type)
        const before = read(db, 'open-1')

        expect(reconcileInterruptedJobs(db)).toBe(0)

        const after = read(db, 'open-1')

        expect(after?.status).toBe(status)
        expect(after?.error).toBeNull()
        expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
      } finally {
        close()
      }
    },
  )

  // Plan 020. `needs_attention` describes Radarr/Sonarr's "Downloaded -
  // Waiting to Import" queue row, which is still there after this process
  // restarts. Failing it would both lie about upstream and offer a Retry that
  // re-grabs a file already sitting on disk. `bootstrap.ts` re-adopts these
  // rows instead. Spared for every type, videos included.
  it.each(DOWNLOAD_TYPES)(
    'leaves a needs_attention %s row completely untouched - status, error and updatedAt',
    type => {
      const { db, close } = createTestDb()
      try {
        seed(db, 'attention-1', 'needs_attention', type)

        const before = read(db, 'attention-1')

        const changed = reconcileInterruptedJobs(db)

        expect(changed).toBe(0)

        const after = read(db, 'attention-1')

        expect(after?.status).toBe('needs_attention')
        expect(after?.error).toBeNull()
        expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
      } finally {
        close()
      }
    },
  )

  // Phase 5. `paused`/`pausing` are non-terminal, so this sweep catches a
  // paused video like any other in-flight one. That is deliberate, not an
  // oversight: a paused video's partial file lives under `/download/videos`,
  // which has no volume behind it, so a restart destroys the bytes and leaves
  // nothing to resume from. Failing the row loudly is more honest than
  // leaving it parked at `paused` pointing at a file that no longer exists.
  it.each(['paused', 'pausing'] as const)(
    'deliberately fails a `%s` video row too - a video pause is not designed to survive a restart',
    status => {
      const { db, close } = createTestDb()
      try {
        seed(db, 'paused-1', status)

        const changed = reconcileInterruptedJobs(db)

        expect(changed).toBe(1)

        const row = read(db, 'paused-1')

        expect(row?.status).toBe('failed')
        expect(row?.error).toBe('Interrupted by a service restart')
      } finally {
        close()
      }
    },
  )

  it('fails only the video rows in a mixed table', () => {
    const { db, close } = createTestDb()
    try {
      seed(db, 'video-1', 'downloading', 'video')
      seed(db, 'movie-1', 'downloading', 'movie')
      seed(db, 'show-1', 'downloading', 'show')

      expect(reconcileInterruptedJobs(db)).toBe(1)
      expect(read(db, 'video-1')?.status).toBe('failed')
      expect(read(db, 'movie-1')?.status).toBe('downloading')
      expect(read(db, 'show-1')?.status).toBe('downloading')
    } finally {
      close()
    }
  })

  it.each(DOWNLOAD_TYPES)(
    'leaves terminal %s rows (cancelled, completed, failed) untouched',
    type => {
      const { db, close } = createTestDb()
      try {
        seed(db, 'cancelled-1', 'cancelled', type)
        seed(db, 'completed-1', 'completed', type)
        seed(db, 'failed-1', 'failed', type)

        const changed = reconcileInterruptedJobs(db)

        expect(changed).toBe(0)

        for (const status of ['cancelled', 'completed', 'failed'] as const) {
          const row = read(db, `${status}-1`)
          expect(row?.status).toBe(status)
          expect(row?.error).toBeNull()
        }
      } finally {
        close()
      }
    },
  )

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
