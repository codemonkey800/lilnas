import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { createTestDb } from 'src/db/__tests__/helpers/test-db'
import { accounts } from 'src/db/schema'

import {
  alice,
  APPLE,
  bob,
  captureLogs,
  CODE,
  createHarness,
  type Harness,
  LOG,
  PASSWORD,
  rejection,
  settle,
} from './helpers/harness'

describe('JobsService: the sign-in turn', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>
  let h: Harness
  let logs: () => string

  beforeAll(async () => {
    testDb = await createTestDb()
  })
  afterAll(() => testDb.close())
  beforeEach(async () => {
    await testDb.db.delete(accounts)
    logs = captureLogs()
    h = await createHarness(testDb.db)
  })
  afterEach(() => h.close())

  /** Starts alice and answers every form up to the given state. */
  async function reach(
    user: typeof alice,
    state:
      'need_password' | 'checking_password' | 'need_code' | 'checking_code',
  ) {
    const before = h.procs.auth.length
    await h.service.start(user, APPLE.alice)
    await h.untilProcs(before + 1, 'auth')
    const proc = h.procs.auth[before]!
    h.webui.step = { step: 'need_password', error: null }
    await h.clock.advance(1000)
    await h.untilState(user, 'need_password')
    if (state === 'need_password') return proc
    await h.service.submitPassword(user, PASSWORD)
    h.webui.step = { step: 'checking_password' }
    await h.clock.advance(1000)
    if (state === 'checking_password') return proc
    h.webui.step = { step: 'need_code', error: null }
    await h.clock.advance(1000)
    await h.untilState(user, 'need_code')
    if (state === 'need_code') return proc
    await h.service.submitCode(user, CODE)
    h.webui.step = { step: 'checking_code' }
    await h.clock.advance(1000)
    return proc
  }

  it('takes a first backup from the first sign-in to done, state by state', async () => {
    let view = await h.service.start(alice, APPLE.alice)
    expect(view.email).toBe('alice@example.com')
    expect(view.account).toMatchObject({
      appleId: APPLE.alice,
      appleIdLocked: false,
      lastBackupAt: null,
      immich: null,
    })
    expect(view.job).toMatchObject({
      kind: 'first_backup',
      state: 'queued_login',
      queuePosition: null,
      authError: null,
      errorCode: null,
    })

    // The folders exist, with the modes the plan asks for.
    expect((await stat(join(h.photosRoot, 'alice'))).mode & 0o777).toBe(0o755)
    expect(
      (await stat(join(h.stateRoot, 'cookies', 'alice'))).mode & 0o777,
    ).toBe(0o700)

    await h.untilProcs(1, 'auth')
    const auth = h.procs.auth[0]!
    expect(auth.args).toEqual(
      expect.arrayContaining([
        '--auth-only',
        '--username',
        APPLE.alice,
        '--cookie-directory',
        join(h.stateRoot, 'cookies', 'alice'),
      ]),
    )

    h.webui.step = { step: 'need_password', error: null }
    await h.clock.advance(1000)
    view = await h.untilState(alice, 'need_password')
    expect(view.job?.authError).toBeNull()

    view = await h.service.submitPassword(alice, PASSWORD)
    expect(view.job?.state).toBe('checking_password')
    h.webui.step = { step: 'checking_password' }
    await h.clock.advance(1000)
    expect((await h.view(alice)).job?.state).toBe('checking_password')

    h.webui.step = { step: 'need_code', error: null }
    await h.clock.advance(1000)
    await h.untilState(alice, 'need_code')

    view = await h.service.submitCode(alice, CODE)
    expect(view.job?.state).toBe('checking_code')
    expect(h.webui.received).toEqual([
      { kind: 'password', value: PASSWORD },
      { kind: 'code', value: CODE },
    ])

    auth.emit("INFO     Great, you're all set up.")
    auth.exit(0)

    // Downloading, with progress.
    await h.untilProcs(1, 'download')
    view = await h.untilState(alice, 'downloading')
    expect(view.account?.appleIdLocked).toBe(true)
    const download = h.procs.downloads[0]!
    expect(download.args).toEqual(
      expect.arrayContaining(['--directory', join(h.photosRoot, 'alice')]),
    )
    expect(download.args).not.toContain('--auth-only')
    const first = await h.file('alice', '2024/05/01/a.jpg', 100)
    const second = await h.file('alice', '2024/05/01/b.mov', 250)
    download.emit(LOG.total(2), LOG.downloaded(first), LOG.downloaded(second))

    // Finishing up: hold the provisioner so the state can be read.
    let release: () => void = () => undefined
    h.provisioner.hold = new Promise<void>(resolve => {
      release = resolve
    })
    download.emit(LOG.allDone)
    download.exit(0)
    view = await h.untilState(alice, 'provisioning')
    expect(view.job).toMatchObject({
      totalItems: 2,
      downloadedItems: 2,
      downloadedBytes: 350,
    })
    release()

    view = await h.untilState(alice, 'done')
    expect(view.job).toMatchObject({
      state: 'done',
      downloadedItems: 2,
      downloadedBytes: 350,
      errorCode: null,
    })
    expect(view.job?.finishedAt).not.toBeNull()
    expect(view.account).toMatchObject({
      appleIdLocked: true,
      totalItems: 2,
      totalBytes: 350,
      immich: { email: 'alice@example.com', createdByUs: true },
    })
    expect(view.account?.lastBackupAt).not.toBeNull()

    expect(await h.eventMessages(alice)).toEqual(
      expect.arrayContaining([
        'state: Waiting for a sign-in turn',
        'state: Waiting for the Apple password',
        'state: Checking the Apple password',
        'state: Waiting for the verification code',
        'state: Checking the verification code',
        'state: Waiting to download',
        'download_started: Downloading',
        'state: Finishing up in Immich',
        'state: Backup finished',
      ]),
    )
    expect(h.changes.length).toBeGreaterThan(5)
    expect(new Set(h.changes)).toEqual(new Set([alice.userId]))
  })

  it('goes straight to the download when the saved session is still good', async () => {
    await h.service.start(alice, APPLE.alice)
    await h.untilProcs(1, 'auth')
    // icloudpd never asked for a password and exited cleanly.
    h.procs.auth[0]!.exit(0)
    await h.untilProcs(1, 'download')
    expect(await h.eventMessages(alice)).not.toContain(
      'state: Waiting for the Apple password',
    )
  })

  it('fails with icloudpd_error when icloudpd dies before asking for anything', async () => {
    await h.service.start(alice, APPLE.alice)
    await h.untilProcs(1, 'auth')
    h.procs.auth[0]!.exit(1)
    const view = await h.untilState(alice, 'failed')
    expect(view.job?.errorCode).toBe('icloudpd_error')
    expect(h.procs.downloads).toHaveLength(0)
  })

  it('fails with icloudpd_error when icloudpd cannot be started', async () => {
    h.procs.failNext = true
    await h.service.start(alice, APPLE.alice)
    const view = await h.untilState(alice, 'failed')
    expect(view.job?.errorCode).toBe('icloudpd_error')
  })

  it('stays on the code step after a wrong code and takes a second one', async () => {
    const auth = await reach(alice, 'checking_code')

    h.webui.step = { step: 'need_code', error: 'Failed to verify code' }
    await h.clock.advance(1000)
    let view = await h.untilState(alice, 'need_code')
    expect(view.job?.authError).toBe('wrong_code')
    expect(auth.finished).toBe(false)

    view = await h.service.submitCode(alice, '111111')
    expect(view.job).toMatchObject({ state: 'checking_code', authError: null })
    expect(h.webui.received.filter(r => r.kind === 'code')).toHaveLength(2)

    auth.emit("INFO     Great, you're all set up.")
    auth.exit(0)
    await h.untilProcs(1, 'download')
    expect(await h.eventMessages(alice)).toContain(
      'retry: The verification code was not accepted',
    )
  })

  it('reads a code form that comes back after the check as a wrong code, error text or not', async () => {
    await reach(alice, 'checking_code')
    h.webui.step = { step: 'need_code', error: null }
    await h.clock.advance(1000)
    const view = await h.untilState(alice, 'need_code')
    expect(view.job?.authError).toBe('wrong_code')
  })

  it('waits a few polls before reading an unchanged code form as a wrong code', async () => {
    await reach(alice, 'need_code')
    await h.service.submitCode(alice, CODE)
    // The form still shows the code step and was never seen checking.
    await h.clock.advance(2000)
    expect((await h.view(alice)).job?.state).toBe('checking_code')
    await h.clock.advance(1000)
    const view = await h.untilState(alice, 'need_code')
    expect(view.job?.authError).toBe('wrong_code')
  })

  it('restarts the sign-in after each wrong password and gives up after three', async () => {
    // Failure 1: the process exits after the check started.
    const first = await reach(alice, 'checking_password')
    first.exit(1)
    await h.untilProcs(2, 'auth')
    let view = await h.untilState(alice, 'need_password')
    expect(view.job?.authError).toBe('wrong_password')

    // Failure 2: the form drops to "no input" and the process stays up.
    const second = h.procs.auth[1]!
    h.webui.step = { step: 'need_password', error: null }
    await h.clock.advance(1000)
    await h.service.submitPassword(alice, PASSWORD)
    h.webui.step = { step: 'checking_password' }
    await h.clock.advance(1000)
    h.webui.step = { step: 'no_input' }
    await h.clock.advance(1000)
    await h.untilProcs(3, 'auth')
    expect(second.stopCalls).toBe(1)
    view = await h.untilState(alice, 'need_password')
    expect(view.job?.authError).toBe('wrong_password')

    // Failure 3: the process exits again, and the job fails.
    const third = h.procs.auth[2]!
    h.webui.step = { step: 'need_password', error: null }
    await h.clock.advance(1000)
    await h.service.submitPassword(alice, PASSWORD)
    h.webui.step = { step: 'checking_password' }
    await h.clock.advance(1000)
    third.exit(1)
    view = await h.untilState(alice, 'failed')
    expect(view.job?.errorCode).toBe('wrong_password')
    expect(h.procs.auth).toHaveLength(3)
    expect(h.webui.received.filter(r => r.kind === 'password')).toHaveLength(3)
    expect(h.procs.downloads).toHaveLength(0)
  })

  it('does not take a lone stale password form for a wrong password', async () => {
    const auth = await reach(alice, 'need_password')
    await h.service.submitPassword(alice, PASSWORD)
    // One poll still shows the password form: the form is catching up.
    await h.clock.advance(1000)
    h.webui.step = { step: 'checking_password' }
    await h.clock.advance(1000)
    expect(auth.finished).toBe(false)
    expect((await h.view(alice)).job?.state).toBe('checking_password')
  })

  it('does not take a lone stale no-input card for a wrong password either', async () => {
    const auth = await reach(alice, 'need_password')
    await h.service.submitPassword(alice, PASSWORD)
    h.webui.step = { step: 'no_input' }
    await h.clock.advance(1000)
    h.webui.step = { step: 'need_code', error: null }
    await h.clock.advance(1000)
    await h.untilState(alice, 'need_code')
    expect(auth.finished).toBe(false)
  })

  it('fails with login_timeout after ten minutes with a form waiting', async () => {
    const auth = await reach(alice, 'need_password')
    await h.clock.advance(10 * 60_000 - 1000)
    expect((await h.view(alice)).job?.state).toBe('need_password')
    await h.clock.advance(1000)
    const view = await h.untilState(alice, 'failed')
    expect(view.job?.errorCode).toBe('login_timeout')
    expect(auth.stopCalls).toBe(1)
  })

  it('restarts the ten minutes whenever the person answers', async () => {
    await reach(alice, 'need_code')
    await h.clock.advance(9 * 60_000)
    await h.service.submitCode(alice, CODE)
    h.webui.step = { step: 'checking_code' }
    await h.clock.advance(9 * 60_000)
    expect((await h.view(alice)).job?.state).toBe('checking_code')
  })

  it('fails with apple_access_denied when the log says ACCESS_DENIED', async () => {
    await h.service.start(alice, APPLE.alice)
    await h.untilProcs(1, 'auth')
    const auth = h.procs.auth[0]!
    auth.emit(LOG.denied)
    const view = await h.untilState(alice, 'failed')
    expect(view.job?.errorCode).toBe('apple_access_denied')
    expect(auth.stopCalls).toBe(1)
  })

  describe('cancel', () => {
    it.each([
      'need_password',
      'checking_password',
      'need_code',
      'checking_code',
    ] as const)('stops the sign-in in %s', async state => {
      const auth = await reach(alice, state)
      const view = await h.service.cancel(alice)
      expect(view.job).toMatchObject({ state: 'cancelled', errorCode: null })
      expect(auth.stopCalls).toBe(1)
      expect(h.procs.downloads).toHaveLength(0)
    })

    it('stops the sign-in that holds the turn before its form shows', async () => {
      await h.service.start(alice, APPLE.alice)
      await h.untilProcs(1, 'auth')
      const view = await h.service.cancel(alice)
      expect(view.job?.state).toBe('cancelled')
      expect(h.procs.auth[0]!.stopCalls).toBe(1)
    })

    it('takes a person out of the line', async () => {
      await h.service.start(alice, APPLE.alice)
      await h.untilProcs(1, 'auth')
      await h.service.start(bob, APPLE.bob)
      expect((await h.view(bob)).job).toMatchObject({
        state: 'queued_login',
        queuePosition: 1,
      })
      const view = await h.service.cancel(bob)
      expect(view.job?.state).toBe('cancelled')
      await settle(10)
      expect(h.procs.auth).toHaveLength(1)
      expect((await h.view(alice)).job?.state).toBe('queued_login')
    })

    it('leaves a view that does not claim a job when nothing is running', async () => {
      const view = await h.service.cancel(alice)
      expect(view.account).toBeNull()
      expect(view.job).toBeNull()
    })
  })

  describe('two people starting together', () => {
    beforeEach(async () => {
      await h.service.start(alice, APPLE.alice)
      await h.service.start(bob, APPLE.bob)
      await h.untilProcs(1, 'auth')
    })

    it('puts the second in line at position 1 and tells them when it moves', async () => {
      const view = await h.view(bob)
      expect(view.job).toMatchObject({
        state: 'queued_login',
        queuePosition: 1,
      })
      expect(h.procs.auth).toHaveLength(1)
      expect((await h.view(alice)).job?.queuePosition).toBeNull()
    })

    it('gives the form to the second when the first signs in', async () => {
      h.webui.step = { step: 'need_password', error: null }
      await h.clock.advance(1000)
      await h.service.submitPassword(alice, PASSWORD)
      const first = h.procs.auth[0]!
      first.emit("INFO     Great, you're all set up.")
      first.exit(0)

      await h.untilProcs(2, 'auth')
      await h.untilProcs(1, 'download')
      expect(h.procs.auth[1]!.args).toContain(APPLE.bob)
      h.webui.step = { step: 'need_password', error: null }
      await h.clock.advance(1000)
      const view = await h.untilState(bob, 'need_password')
      expect(view.job?.queuePosition).toBeNull()
    })

    it('gives the form to the second when the first fails', async () => {
      h.procs.auth[0]!.emit(LOG.denied)
      await h.untilState(alice, 'failed')
      await h.untilProcs(2, 'auth')
      expect(h.procs.auth[1]!.args).toContain(APPLE.bob)
    })

    it('gives the form to the second when the first cancels', async () => {
      await h.service.cancel(alice)
      await h.untilProcs(2, 'auth')
      expect(h.procs.auth[1]!.args).toContain(APPLE.bob)
      h.webui.step = { step: 'need_password', error: null }
      await h.clock.advance(1000)
      await h.untilState(bob, 'need_password')
    })

    it('announces the move to the person waiting', async () => {
      h.changes.length = 0
      await h.service.cancel(alice)
      await h.untilProcs(2, 'auth')
      expect(h.changes).toContain(bob.userId)
    })
  })

  describe('answers at the wrong time', () => {
    it('refuses a password and a code outside their forms', async () => {
      await h.service.start(alice, APPLE.alice)
      await h.untilProcs(1, 'auth')
      expect(
        (await rejection(h.service.submitPassword(alice, PASSWORD))).status,
      ).toBe(409)
      expect((await rejection(h.service.submitCode(alice, CODE))).status).toBe(
        409,
      )

      h.webui.step = { step: 'need_password', error: null }
      await h.clock.advance(1000)
      await h.untilState(alice, 'need_password')
      expect((await rejection(h.service.submitCode(alice, CODE))).status).toBe(
        409,
      )
      expect(h.webui.received).toEqual([])
    })

    it('refuses when nothing is running', async () => {
      expect(
        (await rejection(h.service.submitPassword(alice, PASSWORD))).status,
      ).toBe(409)
    })

    it('refuses with a 409 when the form says it is on another step', async () => {
      await reach(alice, 'need_password')
      h.webui.step = { step: 'checking_password' }
      const error = await rejection(h.service.submitPassword(alice, PASSWORD))
      expect(error.status).toBe(409)
      expect((await h.view(alice)).job?.state).toBe('need_password')
      expect(h.webui.received).toEqual([])
    })

    it('refuses with a 502 when icloudpd rejects the input, and stays put', async () => {
      await reach(alice, 'need_password')
      h.webui.nextResult = 'rejected'
      expect(
        (await rejection(h.service.submitPassword(alice, PASSWORD))).status,
      ).toBe(502)
      expect((await h.view(alice)).job?.state).toBe('need_password')
    })
  })

  describe('secrets', () => {
    it('never puts the password or the code in a log call or in the database', async () => {
      const auth = await reach(alice, 'need_password')
      await h.service.submitPassword(alice, PASSWORD)
      // icloudpd echoes what it was given when a field is missing.
      auth.emit(
        `ERROR    cannot find code in request ImmutableMultiDict([('password', '${PASSWORD}')])`,
      )
      h.webui.step = { step: 'checking_password' }
      await h.clock.advance(1000)
      h.webui.step = { step: 'need_code', error: null }
      await h.clock.advance(1000)
      await h.untilState(alice, 'need_code')
      await h.service.submitCode(alice, CODE)
      auth.emit(`ERROR    bad code ${CODE} for ${PASSWORD}`)
      h.webui.step = { step: 'need_code', error: 'Failed to verify code' }
      await h.clock.advance(1000)
      await h.untilState(alice, 'need_code')
      auth.exit(1)
      await h.untilState(alice, 'failed')

      const everything = `${logs()}${await h.dump()}`
      expect(everything).not.toContain(PASSWORD)
      expect(everything).not.toContain(CODE)
      expect(everything.length).toBeGreaterThan(100)
    })
  })
})
