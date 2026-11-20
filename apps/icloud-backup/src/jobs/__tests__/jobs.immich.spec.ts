import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ForbiddenException } from '@nestjs/common'

import { createTestDb } from 'src/db/__tests__/helpers/test-db'
import { accounts } from 'src/db/schema'
import { ImmichError } from 'src/immich/immich.errors'

import {
  alice,
  APPLE,
  bob,
  captureLogs,
  createHarness,
  type FakeProc,
  type Harness,
  LOG,
  rejection,
  TEMP_PASSWORD,
} from './helpers/harness'

describe('JobsService: Immich after a download', () => {
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

  async function runSync(user: typeof alice, nth: number, files = 0) {
    await h.service.sync(user)
    await h.untilProcs(nth + 1, 'download')
    const proc: FakeProc = h.procs.downloads[nth]!
    const lines: string[] = [LOG.total(files)]
    for (let i = 0; i < files; i++) {
      lines.push(
        LOG.downloaded(
          await h.file(user.email.split('@')[0]!, `n${nth}/${i}.jpg`, 10),
        ),
      )
    }
    proc.emit(...lines, LOG.allDone)
    proc.exit(0)
  }

  it('creates the Immich user and library after the first success, and only scans after that', async () => {
    await h.seedAccount(alice, APPLE.alice)
    await runSync(alice, 0, 3)
    const first = await h.untilState(alice, 'done')

    expect(h.provisioner.ensured).toEqual([
      { email: 'alice@example.com', slug: 'alice' },
    ])
    expect(h.immichClient.scans).toEqual([])
    expect(first.account?.immich).toEqual({
      email: 'alice@example.com',
      createdByUs: true,
      url: 'https://immich.lilnas.io',
    })
    const stored = await h.accounts.findByLilnasUserId(alice.userId)
    expect(stored).toMatchObject({
      immichUserId: 'immich-user-1',
      immichLibraryId: 'immich-library-1',
      immichEmail: 'alice@example.com',
      immichCreatedByUs: true,
      totalItems: 3,
      totalBytes: 30,
    })

    await runSync(alice, 1, 2)
    const second = await h.untilState(alice, 'done')
    expect(h.provisioner.ensured).toHaveLength(1)
    expect(h.immichClient.scans).toEqual(['immich-library-1'])
    expect(second.account).toMatchObject({ totalItems: 5, totalBytes: 50 })
  })

  it('uses the plus tag and the folder prefix when they are set', async () => {
    await h.close()
    await setup({
      IMMICH_EMAIL_PLUS_TAG: 'icloud-backup-dev',
      ACCOUNT_SLUG_PREFIX: 'dev-',
    })
    await h.service.start(alice, APPLE.alice)
    await h.untilProcs(1, 'auth')
    h.procs.auth[0]!.exit(0)
    await h.untilProcs(1, 'download')
    h.procs.downloads[0]!.emit(LOG.allDone)
    h.procs.downloads[0]!.exit(0)
    await h.untilState(alice, 'done')
    expect(h.provisioner.ensured).toEqual([
      { email: 'alice+icloud-backup-dev@example.com', slug: 'dev-alice' },
    ])
    expect(await readdir(h.photosRoot)).toEqual(['dev-alice'])
  })

  describe('when Immich fails', () => {
    it('keeps the downloaded totals and tries Immich again on the next sync', async () => {
      await h.seedAccount(alice, APPLE.alice)
      h.provisioner.failWith = new ImmichError(
        'http_error',
        'Immich POST /admin/users failed with 500',
        500,
      )
      await runSync(alice, 0, 4)
      const failed = await h.untilState(alice, 'failed')
      expect(failed.job).toMatchObject({
        errorCode: 'immich_error',
        downloadedItems: 4,
      })
      expect(failed.account).toMatchObject({ totalItems: 4, totalBytes: 40 })
      expect(failed.account?.lastBackupAt).not.toBeNull()
      expect(failed.account?.immich).toBeNull()

      const account = await h.accounts.findByLilnasUserId(alice.userId)
      const job = await h.jobsRepo.findLatestForAccount(account!.id)
      expect(job?.errorDetail).toContain('http_error')
      expect(job?.errorDetail).toContain('500')

      h.provisioner.failWith = null
      await runSync(alice, 1, 0)
      const done = await h.untilState(alice, 'done')
      expect(h.provisioner.ensured).toHaveLength(2)
      expect(done.account?.immich?.email).toBe('alice@example.com')
      // Nothing is counted twice.
      expect(done.account).toMatchObject({ totalItems: 4, totalBytes: 40 })
    })

    it("reports a library on another user's folder as an Immich error with that code", async () => {
      await h.seedAccount(alice, APPLE.alice)
      h.provisioner.failWith = new ImmichError(
        'import_path_taken',
        'An Immich library owned by another user already uses /icloud-users/alice',
      )
      await runSync(alice, 0)
      const view = await h.untilState(alice, 'failed')
      expect(view.job?.errorCode).toBe('immich_error')
      const account = await h.accounts.findByLilnasUserId(alice.userId)
      const job = await h.jobsRepo.findLatestForAccount(account!.id)
      expect(job?.errorDetail?.startsWith('import_path_taken')).toBe(true)
    })

    it("does not store the text of an error that is not Immich's own", async () => {
      await h.seedAccount(alice, APPLE.alice)
      h.provisioner.failWith = new Error('connect ECONNREFUSED 10.0.0.1:2283')
      await runSync(alice, 0)
      await h.untilState(alice, 'failed')
      const account = await h.accounts.findByLilnasUserId(alice.userId)
      const job = await h.jobsRepo.findLatestForAccount(account!.id)
      expect(job?.errorCode).toBe('immich_error')
      expect(job?.errorDetail).not.toContain('ECONNREFUSED')
    })

    it('reports a failed scan the same way, and retries it on the next sync', async () => {
      await h.seedAccount(alice, APPLE.alice)
      await runSync(alice, 0)
      await h.untilState(alice, 'done')

      h.immichClient.failWith = new ImmichError('timeout', 'Immich timed out')
      await runSync(alice, 1)
      const failed = await h.untilState(alice, 'failed')
      expect(failed.job?.errorCode).toBe('immich_error')

      h.immichClient.failWith = null
      await runSync(alice, 2)
      await h.untilState(alice, 'done')
      expect(h.immichClient.scans).toHaveLength(2)
    })
  })

  describe('a new Immich password', () => {
    it('is returned once for a user this service created, and stored nowhere', async () => {
      await h.seedAccount(alice, APPLE.alice)
      await runSync(alice, 0)
      await h.untilState(alice, 'done')

      await expect(h.service.newImmichPassword(alice)).resolves.toEqual({
        password: TEMP_PASSWORD,
      })
      expect(h.provisioner.resets).toEqual(['immich-user-1'])
      expect(await h.dump()).not.toContain(TEMP_PASSWORD)
    })

    it('is refused with a 403 for a user that already existed', async () => {
      await h.seedAccount(alice, APPLE.alice)
      h.provisioner.link = { ...h.provisioner.link, createdByUs: false }
      await runSync(alice, 0)
      await h.untilState(alice, 'done')

      await expect(h.service.newImmichPassword(alice)).rejects.toBeInstanceOf(
        ForbiddenException,
      )
      expect(h.provisioner.resets).toEqual([])
    })

    it('is refused with a 409 before there is an Immich account', async () => {
      await h.seedAccount(alice, APPLE.alice)
      expect((await rejection(h.service.newImmichPassword(alice))).status).toBe(
        409,
      )
      expect((await rejection(h.service.newImmichPassword(bob))).status).toBe(
        409,
      )
    })

    it('is a 502 when Immich cannot do it', async () => {
      await h.seedAccount(alice, APPLE.alice)
      await runSync(alice, 0)
      await h.untilState(alice, 'done')
      h.provisioner.newTemporaryPassword = async () => {
        throw new ImmichError('network', 'down')
      }
      expect((await rejection(h.service.newImmichPassword(alice))).status).toBe(
        502,
      )
    })
  })

  describe('a first backup into a folder that already holds files', () => {
    it('uses the folder as it is and adopts the Immich library that is already there', async () => {
      // Two family libraries are moved in by hand before anyone signs in.
      const old = await h.file('alice', '2019/07/04/old.jpg', 77)
      const before = await readFile(old)
      // The provisioner finds the user and the library on this very folder.
      h.provisioner.link = {
        userId: 'existing-user',
        libraryId: 'existing-library',
        email: 'alice@example.com',
        createdByUs: false,
      }

      await h.signIn(alice, APPLE.alice)
      await h.untilProcs(1, 'download')
      const download = h.procs.downloads[0]!
      expect(download.args).toEqual(
        expect.arrayContaining(['--directory', join(h.photosRoot, 'alice')]),
      )
      const added = await h.file('alice', '2024/01/01/new.jpg', 12)
      download.emit(
        LOG.total(2),
        LOG.skipped(old),
        LOG.downloaded(added),
        LOG.allDone,
      )
      download.exit(0)
      const view = await h.untilState(alice, 'done')

      // Same slug: never renamed, suffixed or emptied.
      expect(await readdir(h.photosRoot)).toEqual(['alice'])
      expect(await readFile(old)).toEqual(before)
      const account = await h.accounts.findByLilnasUserId(alice.userId)
      expect(account?.slug).toBe('alice')
      expect(h.provisioner.ensured).toEqual([
        { email: 'alice@example.com', slug: 'alice' },
      ])

      // The existing library is stored, and is not ours.
      expect(account).toMatchObject({
        immichUserId: 'existing-user',
        immichLibraryId: 'existing-library',
        immichCreatedByUs: false,
      })
      expect(view.account?.immich).toMatchObject({ createdByUs: false })
      expect(view.job).toMatchObject({ skippedItems: 1, downloadedItems: 1 })

      // So the password button is not allowed.
      await expect(h.service.newImmichPassword(alice)).rejects.toBeInstanceOf(
        ForbiddenException,
      )
      expect(h.provisioner.resets).toEqual([])
    })
  })
})
