import {
  ConflictException,
  ConsoleLogger,
  type INestApplication,
  Logger,
} from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'

import { BackupController } from 'src/api/backup.controller'
import { JobUserService } from 'src/api/job-user.service'
import { RequestedWithGuard } from 'src/api/requested-with.guard'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { ForwardedUserGuard } from 'src/auth/forwarded-user.guard'
import { JobsService } from 'src/jobs/jobs.service'
import type { BackupView } from 'src/shared/contract'

const ID = {
  'x-forwarded-user': 'alice@example.com',
  'x-forwarded-user-id': 'user_1',
}
const POST = { ...ID, 'x-requested-with': 'icloud-backup' }
const PASSWORD = 'hunter2-not-a-real-password'

const VIEW: BackupView = {
  email: 'alice@example.com',
  isAdmin: false,
  lowDiskSpace: false,
  account: null,
  job: null,
}

describe('BackupController', () => {
  let app: INestApplication
  let base: string
  let jobs: Record<
    | 'getView'
    | 'start'
    | 'sync'
    | 'submitPassword'
    | 'submitCode'
    | 'cancel'
    | 'newImmichPassword',
    jest.Mock
  >
  const logged: unknown[][] = []

  async function call(
    method: 'GET' | 'POST',
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  beforeEach(async () => {
    for (const method of [
      'log',
      'warn',
      'error',
      'debug',
      'verbose',
    ] as const) {
      const record = (...args: unknown[]) => void logged.push(args)
      jest.spyOn(Logger.prototype, method).mockImplementation(record)
      jest.spyOn(ConsoleLogger.prototype, method).mockImplementation(record)
    }
    logged.length = 0
    jobs = {
      getView: jest.fn().mockResolvedValue(VIEW),
      start: jest.fn().mockResolvedValue(VIEW),
      sync: jest.fn().mockResolvedValue(VIEW),
      submitPassword: jest.fn().mockResolvedValue(VIEW),
      submitCode: jest.fn().mockResolvedValue(VIEW),
      cancel: jest.fn().mockResolvedValue(VIEW),
      newImmichPassword: jest
        .fn()
        .mockResolvedValue({ password: 'a made-up phrase' }),
    }
    const module = await Test.createTestingModule({
      controllers: [BackupController],
      providers: [
        JobUserService,
        RequestedWithGuard,
        { provide: JobsService, useValue: jobs },
        {
          provide: AdminCheckService,
          useValue: { checkIsAdmin: jest.fn().mockResolvedValue(true) },
        },
        { provide: APP_GUARD, useClass: ForwardedUserGuard },
      ],
    }).compile()
    app = module.createNestApplication({ logger: false })
    await app.listen(0, '127.0.0.1')
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
  })

  afterEach(async () => {
    await app.close()
  })

  const alice = { email: 'alice@example.com', userId: 'user_1', isAdmin: true }

  describe('happy paths', () => {
    it('GET /backup returns the view', async () => {
      const res = await call('GET', '/backup', ID)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(VIEW)
      expect(jobs.getView).toHaveBeenCalledWith(alice)
    })

    it('POST /backup/start passes the normalised Apple ID', async () => {
      const res = await call('POST', '/backup/start', POST, {
        appleId: '  Mom@Example.com ',
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(VIEW)
      expect(jobs.start).toHaveBeenCalledWith(alice, 'mom@example.com')
    })

    it('POST /backup/sync', async () => {
      const res = await call('POST', '/backup/sync', POST)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(VIEW)
      expect(jobs.sync).toHaveBeenCalledWith(alice)
    })

    it('POST /backup/password passes the password untouched', async () => {
      const res = await call('POST', '/backup/password', POST, {
        password: ` ${PASSWORD} `,
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(VIEW)
      expect(jobs.submitPassword).toHaveBeenCalledWith(alice, ` ${PASSWORD} `)
    })

    it('POST /backup/code', async () => {
      const res = await call('POST', '/backup/code', POST, { code: '123456' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(VIEW)
      expect(jobs.submitCode).toHaveBeenCalledWith(alice, '123456')
    })

    it('POST /backup/cancel', async () => {
      const res = await call('POST', '/backup/cancel', POST)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(VIEW)
      expect(jobs.cancel).toHaveBeenCalledWith(alice)
    })

    it('POST /backup/immich-password returns the password', async () => {
      const res = await call('POST', '/backup/immich-password', POST)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ password: 'a made-up phrase' })
      expect(jobs.newImmichPassword).toHaveBeenCalledWith(alice)
    })
  })

  describe('identity', () => {
    it.each([
      ['GET', '/backup'],
      ['POST', '/backup/start'],
      ['POST', '/backup/sync'],
      ['POST', '/backup/password'],
      ['POST', '/backup/code'],
      ['POST', '/backup/cancel'],
      ['POST', '/backup/immich-password'],
    ] as const)(
      '%s %s is 401 without the forwarded identity',
      async (method, path) => {
        const res = await call(method, path, {
          'x-requested-with': 'icloud-backup',
        })
        expect(res.status).toBe(401)
        for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled()
      },
    )
  })

  describe('validation', () => {
    it('400 for a bad Apple ID', async () => {
      const res = await call('POST', '/backup/start', POST, {
        appleId: 'not an email',
      })
      expect(res.status).toBe(400)
      expect(jobs.start).not.toHaveBeenCalled()
    })

    it('400 for an empty password, without echoing it', async () => {
      const res = await call('POST', '/backup/password', POST, { password: '' })
      expect(res.status).toBe(400)
      expect(jobs.submitPassword).not.toHaveBeenCalled()
    })

    it('400 for a 5-digit code', async () => {
      const res = await call('POST', '/backup/code', POST, { code: '12345' })
      expect(res.status).toBe(400)
      expect(jobs.submitCode).not.toHaveBeenCalled()
    })

    it('400 for a missing body, and the message names the field only', async () => {
      const res = await call('POST', '/backup/password', POST, { password: 5 })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { message: string }
      expect(body.message).toContain('password')
    })
  })

  describe('X-Requested-With', () => {
    it.each([
      ['/backup/start', { appleId: 'mom@example.com' }],
      ['/backup/sync', undefined],
      ['/backup/password', { password: PASSWORD }],
      ['/backup/code', { code: '123456' }],
      ['/backup/cancel', undefined],
      ['/backup/immich-password', undefined],
    ] as const)('POST %s is 403 without the header', async (path, body) => {
      const res = await call('POST', path, ID, body)
      expect(res.status).toBe(403)
      for (const fn of Object.values(jobs)) expect(fn).not.toHaveBeenCalled()
    })

    it('403 for a wrong header value', async () => {
      const res = await call('POST', '/backup/sync', {
        ...ID,
        'x-requested-with': 'XMLHttpRequest',
      })
      expect(res.status).toBe(403)
    })

    it('does not apply to GET', async () => {
      expect((await call('GET', '/backup', ID)).status).toBe(200)
    })
  })

  describe('conflicts', () => {
    it('passes a 409 and its short message through', async () => {
      jobs.sync.mockRejectedValue(
        new ConflictException({
          statusCode: 409,
          message: 'A backup is already running.',
          error: 'Conflict',
        }),
      )
      const res = await call('POST', '/backup/sync', POST)
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({
        statusCode: 409,
        message: 'A backup is already running.',
      })
    })
  })

  describe('Cache-Control', () => {
    it.each([
      ['/backup/password', { password: PASSWORD }],
      ['/backup/code', { code: '123456' }],
      ['/backup/immich-password', undefined],
    ] as const)('POST %s sends no-store', async (path, body) => {
      const res = await call('POST', path, POST, body)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })
  })

  describe('logging', () => {
    it('no request body reaches a logger', async () => {
      await call('POST', '/backup/password', POST, { password: PASSWORD })
      await call('POST', '/backup/password', POST, { password: '' })
      jobs.submitCode.mockRejectedValue(new ConflictException('nope'))
      await call('POST', '/backup/code', POST, { code: '654321' })
      await call('POST', '/backup/code', POST, { code: '12345' })

      const dump = JSON.stringify(logged)
      expect(dump).not.toContain(PASSWORD)
      expect(dump).not.toContain('654321')
      expect(dump).not.toContain('12345')
    })
  })
})
