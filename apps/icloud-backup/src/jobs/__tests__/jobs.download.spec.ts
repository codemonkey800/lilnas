import { createTestDb } from 'src/db/__tests__/helpers/test-db'
import { accounts } from 'src/db/schema'
import type { BackupState } from 'src/shared/contract'

import {
  alice,
  APPLE,
  bob,
  captureLogs,
  carol,
  createHarness,
  type FakeProc,
  type Harness,
  LOG,
  rejection,
  settle,
} from './helpers/harness'

describe('JobsService: downloads', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>
  let h: Harness

  beforeAll(async () => {
    testDb = await createTestDb()
  })
  afterAll(() => testDb.close())

  async function setup(env: Parameters<typeof createHarness>[1] = {}) {
    await testDb.db.delete(accounts)
    h = await createHarness(testDb.db, env)
  }
  beforeEach(() => {
    captureLogs()
    return setup()
  })
  afterEach(() => h.close())

  /** Starts a sync for a seeded account and returns its download process. */
  async function syncing(
    user: typeof alice,
    appleId: string,
    nth = 0,
  ): Promise<FakeProc> {
    await h.seedAccount(user, appleId)
    await h.service.sync(user)
    await h.untilProcs(nth + 1, 'download')
    return h.procs.downloads[nth]!
  }

  async function finishOk(proc: FakeProc) {
    proc.emit(LOG.allDone)
    proc.exit(0)
  }

  describe('a sync with the saved session', () => {
    it('never enters a password state and never starts a sign-in', async () => {
      const proc = await syncing(alice, APPLE.alice)
      const view = await h.untilState(alice, 'downloading')
      expect(view.job).toMatchObject({ kind: 'sync', queuePosition: null })
      await finishOk(proc)
      await h.untilState(alice, 'done')

      expect(h.procs.auth).toHaveLength(0)
      const events = (await h.eventMessages(alice)).join('\n')
      for (const word of ['password', 'code', 'sign-in turn']) {
        expect(events.toLowerCase()).not.toContain(word)
      }
    })

    it('adds --recent when ICLOUDPD_RECENT is set', async () => {
      await h.close()
      await setup({ ICLOUDPD_RECENT: '5' })
      const proc = await syncing(alice, APPLE.alice)
      expect(proc.args.slice(proc.args.indexOf('--recent'))).toEqual([
        '--recent',
        '5',
      ])
    })

    it('needs a Apple ID first', async () => {
      expect((await rejection(h.service.sync(alice))).status).toBe(409)
      await h.accounts.create({
        lilnasUserId: alice.userId,
        lilnasEmail: alice.email,
        slug: 'alice',
      })
      expect((await rejection(h.service.sync(alice))).status).toBe(409)
    })

    it('returns the running job instead of starting another', async () => {
      await syncing(alice, APPLE.alice)
      const first = (await h.view(alice)).job?.id
      const again = await h.service.sync(alice)
      const start = await h.service.start(alice, APPLE.alice)
      expect(again.job?.id).toBe(first)
      expect(start.job?.id).toBe(first)
      await settle(10)
      expect(h.procs.procs).toHaveLength(1)
    })
  })

  describe('progress', () => {
    it('counts files, bytes, skips and the current file relative to the folder', async () => {
      const proc = await syncing(alice, APPLE.alice)
      const a = await h.file('alice', '2024/01/02/a.jpg', 100)
      const b = await h.file('alice', '2024/01/02/b.jpg', 40)
      proc.emit(
        LOG.total(5),
        LOG.skipped(`${h.photosRoot}/alice/2023/old.jpg`),
        LOG.skipped(`${h.photosRoot}/alice/2023/older.jpg`),
        LOG.downloaded(a),
        LOG.downloaded(b),
      )
      // The first write is immediate, the rest follows within a second.
      await h.clock.advance(1000)
      await new Promise(resolve => setTimeout(resolve, 100))
      await h.clock.advance(1000)
      const view = await h.view(alice)
      expect(view.job).toMatchObject({
        state: 'downloading',
        totalItems: 5,
        downloadedItems: 2,
        skippedItems: 2,
        downloadedBytes: 140,
        currentFile: '2024/01/02/b.jpg',
      })
    })

    it('writes to the database and announces at most once a second', async () => {
      const update = jest.spyOn(h.jobsRepo, 'update')
      const proc = await syncing(alice, APPLE.alice)
      await h.untilState(alice, 'downloading')
      const progressWrites = () =>
        update.mock.calls.filter(([, patch]) => 'downloadedBytes' in patch)
          .length

      const files: string[] = []
      for (let i = 0; i < 50; i++) {
        files.push(await h.file('alice', `2024/${i}.jpg`, 10))
      }
      h.changes.length = 0
      proc.emit(LOG.total(50), ...files.map(f => LOG.downloaded(f)))
      await new Promise(resolve => setTimeout(resolve, 150))
      // One write, one announcement, however many lines came in.
      expect(progressWrites()).toBe(1)
      expect(h.changes).toHaveLength(1)

      await h.clock.advance(999)
      expect(progressWrites()).toBe(1)
      await h.clock.advance(1)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(progressWrites()).toBe(2)
      expect(h.changes).toHaveLength(2)
      expect((await h.view(alice)).job).toMatchObject({
        downloadedItems: 50,
        downloadedBytes: 500,
      })

      // Nothing new, nothing written.
      await h.clock.advance(10_000)
      expect(progressWrites()).toBe(2)
    })

    it('keeps files already counted when a retry starts', async () => {
      const first = await syncing(alice, APPLE.alice)
      const a = await h.file('alice', 'a.jpg', 30)
      first.emit(LOG.total(2), LOG.downloaded(a))
      first.exit(1)
      await h.untilState(alice, 'queued_download')
      await h.clock.advance(30_000)
      await h.untilProcs(2, 'download')
      const second = h.procs.downloads[1]!
      const b = await h.file('alice', 'b.jpg', 70)
      second.emit(LOG.total(2), LOG.skipped(a), LOG.downloaded(b))
      await finishOk(second)
      const view = await h.untilState(alice, 'done')
      expect(view.job).toMatchObject({
        downloadedItems: 2,
        downloadedBytes: 100,
        skippedItems: 1,
      })
      expect(view.account).toMatchObject({ totalItems: 2, totalBytes: 100 })
    })
  })

  describe('limits', () => {
    it('runs two downloads at a time and queues the third', async () => {
      const first = await syncing(alice, APPLE.alice, 0)
      await syncing(bob, APPLE.bob, 1)
      await h.seedAccount(carol, APPLE.carol)
      await h.service.sync(carol)
      await h.untilState(carol, 'queued_download')
      await settle(10)
      expect(h.procs.downloads).toHaveLength(2)
      expect((await h.view(alice)).job?.state).toBe('downloading')
      expect((await h.view(bob)).job?.state).toBe('downloading')

      await finishOk(first)
      await h.untilProcs(3, 'download')
      expect(h.procs.downloads[2]!.args).toContain(APPLE.carol)
      await h.untilState(carol, 'downloading')
    })

    it('honours MAX_DOWNLOADS=1', async () => {
      await h.close()
      await setup({ MAX_DOWNLOADS: '1' })
      await syncing(alice, APPLE.alice, 0)
      await h.seedAccount(bob, APPLE.bob)
      await h.service.sync(bob)
      await h.untilState(bob, 'queued_download')
      await settle(10)
      expect(h.procs.downloads).toHaveLength(1)
    })
  })

  describe('indexing', () => {
    const LADDER = [60, 120, 240, 480, 600, 600]

    async function indexingFailure(n: number, proc: FakeProc) {
      proc.emit(LOG.indexing)
      proc.exit(1)
      const view = await h.untilState(alice, 'indexing_wait')
      const wait = LADDER[n]!
      expect(view.job).toMatchObject({ attempt: n + 1, maxAttempts: 6 })
      expect(Date.parse(view.job!.retryAt!) - h.clock.now()).toBe(wait * 1000)
      // Not a second early.
      await h.clock.advance(wait * 1000 - 1)
      expect(h.procs.downloads).toHaveLength(n + 1)
      await h.clock.advance(1)
      await h.untilProcs(n + 2, 'download')
    }

    it('waits 60, 120 and 240 seconds, then succeeds', async () => {
      let proc = await syncing(alice, APPLE.alice)
      for (let n = 0; n < 3; n++) {
        await indexingFailure(n, proc)
        proc = h.procs.downloads[n + 1]!
      }
      await finishOk(proc)
      const view = await h.untilState(alice, 'done')
      expect(view.job).toMatchObject({ attempt: 3, retryAt: null })
    })

    it('waits the whole ladder and fails on the seventh failure with apple_indexing', async () => {
      let proc = await syncing(alice, APPLE.alice)
      for (let n = 0; n < 6; n++) {
        await indexingFailure(n, proc)
        proc = h.procs.downloads[n + 1]!
      }
      proc.emit(LOG.indexing)
      proc.exit(1)
      const view = await h.untilState(alice, 'failed')
      expect(view.job).toMatchObject({
        errorCode: 'apple_indexing',
        retryAt: null,
      })
      expect(h.procs.downloads).toHaveLength(7)
      const retries = (await h.eventMessages(alice)).filter(e =>
        e.startsWith('retry:'),
      )
      expect(retries).toHaveLength(6)
    })

    it('decides from the log, not the exit code', async () => {
      const proc = await syncing(alice, APPLE.alice)
      proc.emit(LOG.indexing)
      proc.exit(0)
      await h.untilState(alice, 'indexing_wait')
    })
  })

  describe('other failures', () => {
    it('retries an exit 0 without the "all done" line after 30 s, 2 min and 10 min, then fails with the last 20 lines', async () => {
      const waits = [30, 120, 600]
      let proc = await syncing(alice, APPLE.alice)
      for (let n = 0; n < 3; n++) {
        proc.emit(
          ...Array.from({ length: 25 }, (_, i) => `INFO line ${n}-${i}`),
        )
        proc.exit(0)
        await h.untilState(alice, 'queued_download')
        await settle(5)
        await h.clock.advance(waits[n]! * 1000 - 1)
        expect(h.procs.downloads).toHaveLength(n + 1)
        await h.clock.advance(1)
        await h.untilProcs(n + 2, 'download')
        proc = h.procs.downloads[n + 1]!
      }
      proc.emit(...Array.from({ length: 25 }, (_, i) => `INFO last ${i}`))
      proc.exit(0)
      const view = await h.untilState(alice, 'failed')
      expect(view.job?.errorCode).toBe('icloudpd_error')

      const account = await h.accounts.findByLilnasUserId(alice.userId)
      const job = await h.jobsRepo.findLatestForAccount(account!.id)
      const detail = job?.errorDetail?.split('\n') ?? []
      expect(detail).toHaveLength(20)
      expect(detail[0]).toContain('INFO last 5')
      expect(detail[19]).toContain('INFO last 24')
      expect(h.procs.downloads).toHaveLength(4)
    })

    it('succeeds when a retry finishes', async () => {
      const first = await syncing(alice, APPLE.alice)
      first.exit(2)
      await h.untilState(alice, 'queued_download')
      await h.clock.advance(30_000)
      await h.untilProcs(2, 'download')
      await finishOk(h.procs.downloads[1]!)
      await h.untilState(alice, 'done')
    })

    it('retries when icloudpd cannot be started', async () => {
      await h.seedAccount(alice, APPLE.alice)
      h.procs.failNext = true
      await h.service.sync(alice)
      await h.untilState(alice, 'queued_download')
      await h.clock.advance(30_000)
      await h.untilProcs(1, 'download')
    })

    it('turns an expired session into needs_login', async () => {
      const proc = await syncing(alice, APPLE.alice)
      proc.emit(LOG.expired, 'EOFError')
      proc.exit(1)
      const view = await h.untilState(alice, 'needs_login')
      expect(view.job?.finishedAt).not.toBeNull()
      expect(h.procs.downloads).toHaveLength(1)
      // The person can sign in again with the same Apple ID.
      await h.service.start(alice, APPLE.alice)
      await h.untilProcs(1, 'auth')
      expect((await h.view(alice)).job?.state).toBe('queued_login')
    })

    it('fails with apple_access_denied', async () => {
      const proc = await syncing(alice, APPLE.alice)
      proc.emit(LOG.denied)
      proc.exit(1)
      const view = await h.untilState(alice, 'failed')
      expect(view.job?.errorCode).toBe('apple_access_denied')
      expect(h.procs.downloads).toHaveLength(1)
    })
  })

  describe('cancel', () => {
    it.each<BackupState>(['downloading', 'queued_download', 'indexing_wait'])(
      'stops a job in %s',
      async state => {
        const proc = await syncing(alice, APPLE.alice)
        if (state === 'indexing_wait') {
          proc.emit(LOG.indexing)
          proc.exit(1)
          await h.untilState(alice, state)
        } else if (state === 'queued_download') {
          proc.exit(1)
          await h.untilState(alice, state)
        }
        const view = await h.service.cancel(alice)
        expect(view.job?.state).toBe('cancelled')
        if (state === 'downloading') expect(proc.stopCalls).toBe(1)
        // No retry follows.
        await h.clock.advance(60 * 60_000)
        expect(h.procs.downloads).toHaveLength(1)
      },
    )

    it('lets the next person in line take the freed download slot', async () => {
      await h.close()
      await setup({ MAX_DOWNLOADS: '1' })
      await syncing(alice, APPLE.alice, 0)
      await h.seedAccount(bob, APPLE.bob)
      await h.service.sync(bob)
      await h.untilState(bob, 'queued_download')
      await h.service.cancel(alice)
      await h.untilProcs(2, 'download')
      await h.untilState(bob, 'downloading')
    })
  })

  describe('disk guard', () => {
    it('refuses to start or sync below MIN_FREE_BYTES, and says why', async () => {
      h.disk.free = 500
      expect((await h.view(alice)).lowDiskSpace).toBe(true)

      const start = await rejection(h.service.start(alice, APPLE.alice))
      expect(start.status).toBe(409)
      expect(start.body.view).toMatchObject({ lowDiskSpace: true })
      // Refusing leaves nothing behind.
      expect(await h.accounts.findByLilnasUserId(alice.userId)).toBeNull()

      await h.seedAccount(bob, APPLE.bob)
      const sync = await rejection(h.service.sync(bob))
      expect(sync.status).toBe(409)
      expect(sync.body.view).toMatchObject({
        lowDiskSpace: true,
        job: null,
      })
      expect(h.procs.procs).toHaveLength(0)
    })

    it('accepts exactly MIN_FREE_BYTES', async () => {
      h.disk.free = 1000
      expect((await h.view(alice)).lowDiskSpace).toBe(false)
    })

    it('stops a download that starts after the disk filled up', async () => {
      await h.close()
      await setup({ MAX_DOWNLOADS: '1' })
      const first = await syncing(alice, APPLE.alice, 0)
      await h.seedAccount(bob, APPLE.bob)
      await h.service.sync(bob)
      await h.untilState(bob, 'queued_download')

      h.disk.free = 500
      await finishOk(first)
      const view = await h.untilState(bob, 'paused_low_disk')
      expect(view.job?.finishedAt).not.toBeNull()
      expect(h.procs.downloads).toHaveLength(1)
    })

    it('stops a download every 60 seconds it checks and finds the disk low', async () => {
      const proc = await syncing(alice, APPLE.alice)
      await h.untilState(alice, 'downloading')
      await h.clock.advance(60_000)
      expect(proc.stopCalls).toBe(0)

      h.disk.free = 500
      await h.clock.advance(59_999)
      expect(proc.stopCalls).toBe(0)
      await h.clock.advance(1)
      const view = await h.untilState(alice, 'paused_low_disk')
      expect(proc.stopCalls).toBe(1)
      expect(view.job?.errorCode).toBeNull()
      expect(h.procs.downloads).toHaveLength(1)
      // The timer is gone with the job.
      expect(h.clock.pending).toBe(0)
    })

    it('can be started again once there is room', async () => {
      const proc = await syncing(alice, APPLE.alice)
      await h.untilState(alice, 'downloading')
      h.disk.free = 500
      await h.clock.advance(60_000)
      await h.untilState(alice, 'paused_low_disk')
      expect(proc.stopCalls).toBe(1)

      h.disk.free = 1_000_000
      await h.service.sync(alice)
      await h.untilProcs(2, 'download')
    })
  })

  describe('the Apple ID', () => {
    it('can change before a download has started', async () => {
      await h.service.start(alice, APPLE.alice)
      await h.untilProcs(1, 'auth')
      let view = await h.service.cancel(alice)
      expect(view.account).toMatchObject({
        appleId: APPLE.alice,
        appleIdLocked: false,
      })

      view = await h.service.start(alice, 'other.icloud@example.com')
      expect(view.account).toMatchObject({
        appleId: 'other.icloud@example.com',
        appleIdLocked: false,
      })
    })

    it('is stored lower-cased and trimmed', async () => {
      const view = await h.service.start(alice, '  Alice.ICloud@Example.com ')
      expect(view.account?.appleId).toBe('alice.icloud@example.com')
    })

    it('is refused with a 409 once a download has started', async () => {
      await h.signIn(alice, APPLE.alice)
      await h.untilProcs(1, 'download')
      await h.service.cancel(alice)
      const locked = await h.view(alice)
      expect(locked.account?.appleIdLocked).toBe(true)

      const error = await rejection(
        h.service.start(alice, 'other.icloud@example.com'),
      )
      expect(error.status).toBe(409)
      expect((await h.view(alice)).account?.appleId).toBe(APPLE.alice)

      // The same Apple ID may sign in again.
      const again = await h.service.start(alice, APPLE.alice)
      expect(again.job?.state).toBe('queued_login')
    })

    it('stays locked after a failed download too', async () => {
      await h.signIn(alice, APPLE.alice)
      await h.untilProcs(1, 'download')
      h.procs.downloads[0]!.emit(LOG.denied)
      h.procs.downloads[0]!.exit(1)
      await h.untilState(alice, 'failed')
      expect((await h.view(alice)).account?.appleIdLocked).toBe(true)
    })

    it('is refused with a 409 when another account uses it', async () => {
      await h.seedAccount(alice, APPLE.alice)
      const error = await rejection(h.service.start(bob, APPLE.alice))
      expect(error.status).toBe(409)
      expect(await h.accounts.findByLilnasUserId(bob.userId)).toBeNull()
    })
  })
})
