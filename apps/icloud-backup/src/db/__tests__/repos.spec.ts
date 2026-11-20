import { AccountsRepo } from 'src/db/repos/accounts.repo'
import { JobEventsRepo } from 'src/db/repos/job-events.repo'
import { JobsRepo, MAX_ERROR_DETAIL } from 'src/db/repos/jobs.repo'
import { slugFromEmail } from 'src/db/slug'

import { createTestDb } from './helpers/test-db'

type TestDb = Awaited<ReturnType<typeof createTestDb>>

describe('db repositories (PGlite, real migrations)', () => {
  let testDb: TestDb
  let accounts: AccountsRepo
  let jobs: JobsRepo
  let events: JobEventsRepo
  let n = 0

  beforeEach(async () => {
    testDb = await createTestDb()
    accounts = new AccountsRepo(testDb.db)
    jobs = new JobsRepo(testDb.db)
    events = new JobEventsRepo(testDb.db)
  })

  afterEach(async () => {
    await testDb.close()
  })

  function newAccount(email = `person${++n}@example.com`) {
    return accounts.create({
      lilnasUserId: `user-${email}`,
      lilnasEmail: email,
      slug: slugFromEmail(email),
    })
  }

  it('applies the migration to an empty database', async () => {
    const result = await testDb.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    )
    const names = result.rows.map(r => r.table_name)
    expect(names).toEqual(
      expect.arrayContaining(['accounts', 'jobs', 'job_events']),
    )
    expect(await accounts.list()).toEqual([])
  })

  describe('accounts', () => {
    it('creates with defaults and finds by id and lilnas user id', async () => {
      const a = await newAccount('Jane.Doe@example.com')
      expect(a).toMatchObject({
        slug: 'jane.doe',
        appleId: null,
        immichCreatedByUs: false,
        totalItems: 0,
        totalBytes: 0,
        lastBackupAt: null,
      })
      expect(await accounts.findById(a.id)).toMatchObject({ id: a.id })
      expect(await accounts.findByLilnasUserId(a.lilnasUserId)).toMatchObject({
        id: a.id,
      })
      expect(await accounts.findById(crypto.randomUUID())).toBeNull()
      expect(await accounts.findByLilnasUserId('nobody')).toBeNull()
    })

    it('gives two people with the same local part name and name-2', async () => {
      const first = await newAccount('sam@one.example')
      const second = await newAccount('sam@two.example')
      const third = await newAccount('sam@three.example')
      expect([first.slug, second.slug, third.slug]).toEqual([
        'sam',
        'sam-2',
        'sam-3',
      ])
      expect(await accounts.slugExists('sam-2')).toBe(true)
      expect(await accounts.slugExists('sam-4')).toBe(false)
    })

    it('refuses the same Apple ID on two accounts', async () => {
      const a = await newAccount()
      const b = await newAccount()
      await accounts.setAppleId(a.id, 'shared@example.com')
      await expect(
        accounts.setAppleId(b.id, 'shared@example.com'),
      ).rejects.toThrow()
      expect((await accounts.findById(a.id))?.appleId).toBe(
        'shared@example.com',
      )
      expect((await accounts.findById(b.id))?.appleId).toBeNull()
    })

    it('stores the Immich link and adds to the totals', async () => {
      const a = await newAccount()
      await accounts.setImmich(a.id, {
        userId: 'iu',
        libraryId: 'il',
        email: 'x@example.com',
        createdByUs: true,
      })
      await accounts.addTotals(a.id, 3, 5_000_000_000)
      await accounts.addTotals(a.id, 2, 10)
      expect(await accounts.findById(a.id)).toMatchObject({
        immichUserId: 'iu',
        immichLibraryId: 'il',
        immichEmail: 'x@example.com',
        immichCreatedByUs: true,
        totalItems: 5,
        totalBytes: 5_000_000_010,
      })
      expect((await accounts.findById(a.id))?.lastBackupAt).toBeInstanceOf(Date)
    })
  })

  describe('jobs', () => {
    it('refuses a second non-terminal job and allows one after finish', async () => {
      const a = await newAccount()
      const first = await jobs.create({
        accountId: a.id,
        kind: 'first_backup',
        state: 'queued_login',
      })
      await expect(
        jobs.create({ accountId: a.id, kind: 'sync', state: 'queued_login' }),
      ).rejects.toThrow()
      expect((await jobs.findActiveForAccount(a.id))?.id).toBe(first.id)

      await jobs.finish(first.id, 'done')
      expect(await jobs.findActiveForAccount(a.id)).toBeNull()

      const second = await jobs.create({
        accountId: a.id,
        kind: 'sync',
        state: 'queued_download',
      })
      expect((await jobs.findLatestForAccount(a.id))?.id).toBe(second.id)

      // Another account is unaffected by the first one's live job.
      const b = await newAccount()
      await expect(
        jobs.create({ accountId: b.id, kind: 'sync', state: 'need_password' }),
      ).resolves.toBeDefined()
    })

    it('findNonTerminal returns only non-terminal jobs', async () => {
      const [a, b, c] = [
        await newAccount(),
        await newAccount(),
        await newAccount(),
      ] as const
      const live = await jobs.create({
        accountId: a.id,
        kind: 'sync',
        state: 'downloading',
      })
      const waiting = await jobs.create({
        accountId: b.id,
        kind: 'first_backup',
        state: 'indexing_wait',
      })
      const finished = await jobs.create({
        accountId: c.id,
        kind: 'sync',
        state: 'downloading',
      })
      await jobs.finish(finished.id, 'failed', 'icloudpd_error', 'boom')

      const ids = (await jobs.findNonTerminal()).map(j => j.id).sort()
      expect(ids).toEqual([live.id, waiting.id].sort())
    })

    it('finish stamps finishedAt and records the error', async () => {
      const a = await newAccount()
      const job = await jobs.create({
        accountId: a.id,
        kind: 'sync',
        state: 'downloading',
      })
      const done = await jobs.finish(
        job.id,
        'failed',
        'icloudpd_error',
        'it broke',
      )
      expect(done).toMatchObject({
        state: 'failed',
        errorCode: 'icloudpd_error',
        errorDetail: 'it broke',
      })
      expect(done?.finishedAt).toBeInstanceOf(Date)
    })

    it('update patches fields and bumps updatedAt', async () => {
      const a = await newAccount()
      const job = await jobs.create({
        accountId: a.id,
        kind: 'sync',
        state: 'downloading',
      })
      const updated = await jobs.update(job.id, {
        downloadedItems: 7,
        downloadedBytes: 4_000_000_000,
        currentFile: 'IMG_1.HEIC',
      })
      expect(updated).toMatchObject({
        downloadedItems: 7,
        downloadedBytes: 4_000_000_000,
        currentFile: 'IMG_1.HEIC',
      })
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        job.updatedAt.getTime(),
      )
    })

    it('cuts errorDetail longer than 2000 characters', async () => {
      const a = await newAccount()
      const job = await jobs.create({
        accountId: a.id,
        kind: 'sync',
        state: 'downloading',
      })
      const viaUpdate = await jobs.update(job.id, {
        errorDetail: 'x'.repeat(5000),
      })
      expect(viaUpdate?.errorDetail).toHaveLength(MAX_ERROR_DETAIL)

      const viaFinish = await jobs.finish(
        job.id,
        'failed',
        'internal',
        'y'.repeat(2001),
      )
      expect(viaFinish?.errorDetail).toBe('y'.repeat(2000))
    })
  })

  describe('job events', () => {
    it('appends and returns the last N oldest-first', async () => {
      const a = await newAccount()
      const job = await jobs.create({
        accountId: a.id,
        kind: 'sync',
        state: 'downloading',
      })
      for (let i = 1; i <= 5; i++) {
        await events.append(job.id, 'progress', `step ${i}`)
      }
      const tail = await events.tail(job.id, 3)
      expect(tail.map(e => e.message)).toEqual(['step 3', 'step 4', 'step 5'])
      expect(tail[0]).toMatchObject({ jobId: job.id, type: 'progress' })
    })
  })
})
