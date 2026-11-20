import { createTestDb } from 'src/db/__tests__/helpers/test-db'
import { accounts } from 'src/db/schema'
import type { BackupState } from 'src/shared/contract'

import {
  alice,
  APPLE,
  captureLogs,
  createHarness,
  type Harness,
  LOG,
  settle,
} from './helpers/harness'

describe('JobsService: restarts and shutdown', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>
  let h: Harness

  beforeAll(async () => {
    testDb = await createTestDb()
  })
  afterAll(() => testDb.close())
  beforeEach(async () => {
    captureLogs()
    await testDb.db.delete(accounts)
    h = await createHarness(testDb.db)
  })
  afterEach(() => h.close())

  /** A job as a previous process left it. */
  async function leftBehind(state: BackupState) {
    const account = await h.seedAccount(alice, APPLE.alice)
    const job = await h.jobsRepo.create({
      accountId: account.id,
      kind: 'first_backup',
      state,
    })
    return { account, job }
  }

  describe('a job that was signing in', () => {
    it.each([
      'queued_login',
      'need_password',
      'checking_password',
      'need_code',
      'checking_code',
    ] as const)('fails with interrupted_login from %s', async state => {
      const { job } = await leftBehind(state)
      await h.service.onApplicationBootstrap()

      const view = await h.view(alice)
      expect(view.job).toMatchObject({
        id: job.id,
        state: 'failed',
        errorCode: 'interrupted_login',
      })
      expect(view.job?.finishedAt).not.toBeNull()
      expect(await h.eventMessages(alice)).toContain(
        'state: The sign-in was interrupted by a restart',
      )
      await settle(10)
      expect(h.procs.procs).toHaveLength(0)
    })
  })

  describe('a job that was downloading or finishing', () => {
    it.each([
      'queued_download',
      'indexing_wait',
      'downloading',
      'provisioning',
    ] as const)(
      'goes back to the queue from %s and runs again',
      async state => {
        const { job } = await leftBehind(state)
        await h.service.onApplicationBootstrap()

        await h.untilProcs(1, 'download')
        const view = await h.view(alice)
        expect(view.job).toMatchObject({ id: job.id, state: 'downloading' })
        expect(await h.eventMessages(alice)).toContain(
          'state: Resumed after a restart: waiting to download',
        )

        const proc = h.procs.downloads[0]!
        proc.emit(LOG.total(1), LOG.allDone)
        proc.exit(0)
        const done = await h.untilState(alice, 'done')
        expect(done.job?.id).toBe(job.id)
        expect(done.account?.immich).not.toBeNull()
      },
    )

    it('keeps the retries already used on the indexing ladder', async () => {
      const { job } = await leftBehind('indexing_wait')
      await h.jobsRepo.update(job.id, {
        attempt: 3,
        retryAt: new Date(h.clock.now() + 60_000),
      })
      await h.service.onApplicationBootstrap()
      await h.untilProcs(1, 'download')
      const view = await h.view(alice)
      expect(view.job).toMatchObject({ attempt: 3, retryAt: null })
    })

    it('does not add the totals of a job that had reached Immich twice', async () => {
      const { account, job } = await leftBehind('provisioning')
      await h.jobsRepo.update(job.id, {
        downloadedItems: 5,
        downloadedBytes: 50,
      })
      await h.accounts.addTotals(account.id, 5, 50)

      await h.service.onApplicationBootstrap()
      await h.untilProcs(1, 'download')
      h.procs.downloads[0]!.emit(LOG.allDone)
      h.procs.downloads[0]!.exit(0)
      const view = await h.untilState(alice, 'done')
      expect(view.account).toMatchObject({ totalItems: 5, totalBytes: 50 })
    })

    it('adds to what a half-finished download had already counted', async () => {
      const { job } = await leftBehind('downloading')
      await h.jobsRepo.update(job.id, {
        downloadedItems: 5,
        downloadedBytes: 50,
      })
      await h.service.onApplicationBootstrap()
      await h.untilProcs(1, 'download')
      const proc = h.procs.downloads[0]!
      proc.emit(LOG.downloaded(await h.file('alice', 'x.jpg', 8)), LOG.allDone)
      proc.exit(0)
      const view = await h.untilState(alice, 'done')
      expect(view.account).toMatchObject({ totalItems: 6, totalBytes: 58 })
    })

    it('runs jobs of several people through the same download slots', async () => {
      const others = ['b', 'c', 'd'].map(n => ({
        email: `${n}@example.com`,
        userId: `user-${n}`,
        isAdmin: false,
      }))
      await leftBehind('downloading')
      for (const user of others) {
        const account = await h.seedAccount(user, `${user.userId}@apple.test`)
        await h.jobsRepo.create({
          accountId: account.id,
          kind: 'sync',
          state: 'queued_download',
        })
      }
      await h.service.onApplicationBootstrap()
      await h.untilProcs(2, 'download')
      await settle(10)
      expect(h.procs.downloads).toHaveLength(2)
    })
  })

  it('leaves finished jobs alone', async () => {
    const { job } = await leftBehind('done')
    await h.service.onApplicationBootstrap()
    expect((await h.view(alice)).job).toMatchObject({
      id: job.id,
      state: 'done',
    })
    expect(h.procs.procs).toHaveLength(0)
  })

  describe('shutdown', () => {
    it('stops every child and leaves the rows as they are', async () => {
      // A download in progress and a person typing their password.
      await h.seedAccount(alice, APPLE.alice)
      await h.service.sync(alice)
      await h.untilProcs(1, 'download')
      await h.untilState(alice, 'downloading')

      const bob = {
        email: 'bob@example.com',
        userId: 'user-bob',
        isAdmin: false,
      }
      await h.service.start(bob, APPLE.bob)
      await h.untilProcs(1, 'auth')
      h.webui.step = { step: 'need_password', error: null }
      await h.clock.advance(1000)
      await h.untilState(bob, 'need_password')

      await h.service.onApplicationShutdown()

      expect(h.procs.downloads[0]!.stopCalls).toBe(1)
      expect(h.procs.auth[0]!.stopCalls).toBe(1)
      expect((await h.view(alice)).job).toMatchObject({
        state: 'downloading',
        finishedAt: null,
        errorCode: null,
      })
      expect((await h.view(bob)).job).toMatchObject({
        state: 'need_password',
        finishedAt: null,
      })
      expect(h.clock.pending).toBe(0)
    })

    it('leaves a job that was waiting for a retry or a turn as it was', async () => {
      await h.seedAccount(alice, APPLE.alice)
      await h.service.sync(alice)
      await h.untilProcs(1, 'download')
      h.procs.downloads[0]!.emit(LOG.indexing)
      h.procs.downloads[0]!.exit(1)
      await h.untilState(alice, 'indexing_wait')

      await h.service.onApplicationShutdown()
      expect((await h.view(alice)).job).toMatchObject({
        state: 'indexing_wait',
        finishedAt: null,
      })
      // A restart picks it up again.
      await h.service.onApplicationBootstrap()
      await h.untilProcs(2, 'download')
    })

    it('stops announcing changes', async () => {
      await h.seedAccount(alice, APPLE.alice)
      await h.service.sync(alice)
      await h.untilProcs(1, 'download')
      await h.service.onApplicationShutdown()
      h.changes.length = 0
      await settle(10)
      expect(h.changes).toEqual([])
    })
  })
})
