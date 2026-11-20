import { type INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'

import { AdminController } from 'src/admin/admin.controller'
import { AdminService } from 'src/admin/admin.service'
import { AdminGuard } from 'src/auth/admin.guard'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { ForwardedUserGuard } from 'src/auth/forwarded-user.guard'
import { AccountsRepo } from 'src/db/repos/accounts.repo'
import { JobsRepo } from 'src/db/repos/jobs.repo'
import type { Account, Job } from 'src/db/schema'
import { AdminAccountRowSchema } from 'src/shared/contract'

const ADMIN = {
  'x-forwarded-user': 'admin@example.com',
  'x-forwarded-user-id': 'user_admin',
}
const MEMBER = {
  'x-forwarded-user': 'mom@example.com',
  'x-forwarded-user-id': 'user_mom',
}

function account(over: Partial<Account>): Account {
  return {
    id: 'acc-1',
    lilnasUserId: 'user_mom',
    lilnasEmail: 'mom@example.com',
    slug: 'mom',
    appleId: 'mom@example.invalid',
    immichUserId: 'immich-1',
    immichLibraryId: 'lib-1',
    immichEmail: 'mom@example.com',
    immichCreatedByUs: true,
    totalItems: 42,
    totalBytes: 123456789,
    lastBackupAt: new Date('2026-02-03T04:05:06.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  }
}

describe('AdminController', () => {
  let app: INestApplication
  let base: string
  let accounts: { list: jest.Mock }
  let jobs: { findLatestForAccount: jest.Mock }

  beforeEach(async () => {
    accounts = {
      list: jest.fn().mockResolvedValue([
        account({}),
        account({
          id: 'acc-2',
          lilnasUserId: 'user_new',
          lilnasEmail: 'new@example.com',
          slug: 'new',
          appleId: null,
          immichUserId: null,
          immichLibraryId: null,
          totalItems: 0,
          totalBytes: 0,
          lastBackupAt: null,
        }),
        // An Immich user was created but its library was not: not linked.
        account({
          id: 'acc-3',
          lilnasUserId: 'user_half',
          lilnasEmail: 'half@example.com',
          slug: 'half',
          appleId: null,
          immichLibraryId: null,
          totalItems: 0,
          totalBytes: 0,
          lastBackupAt: null,
        }),
      ]),
    }
    jobs = {
      findLatestForAccount: jest.fn(async (id: string) =>
        id === 'acc-1' ? ({ id: 'job-1', state: 'done' } as Job) : null,
      ),
    }
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        AdminService,
        AdminGuard,
        { provide: AccountsRepo, useValue: accounts },
        { provide: JobsRepo, useValue: jobs },
        {
          provide: AdminCheckService,
          useValue: {
            checkIsAdmin: jest.fn(
              async (email: string) => email === 'admin@example.com',
            ),
          },
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

  it('lists one row per account for an admin, using the stored totals', async () => {
    const res = await fetch(`${base}/admin/accounts`, { headers: ADMIN })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')

    const rows: unknown = await res.json()
    expect(rows).toEqual([
      {
        email: 'mom@example.com',
        appleId: 'mom@example.invalid',
        folder: 'mom',
        state: 'done',
        lastBackupAt: '2026-02-03T04:05:06.000Z',
        totalItems: 42,
        totalBytes: 123456789,
        hasImmich: true,
      },
      {
        email: 'new@example.com',
        appleId: '',
        folder: 'new',
        state: null,
        lastBackupAt: null,
        totalItems: 0,
        totalBytes: 0,
        hasImmich: false,
      },
      {
        email: 'half@example.com',
        appleId: '',
        folder: 'half',
        state: null,
        lastBackupAt: null,
        totalItems: 0,
        totalBytes: 0,
        hasImmich: false,
      },
    ])
    expect(AdminAccountRowSchema.array().safeParse(rows).success).toBe(true)
  })

  it('is 403 for a non-admin', async () => {
    const res = await fetch(`${base}/admin/accounts`, { headers: MEMBER })
    expect(res.status).toBe(403)
    expect(accounts.list).not.toHaveBeenCalled()
  })

  it('is 401 without the forwarded identity', async () => {
    const res = await fetch(`${base}/admin/accounts`)
    expect(res.status).toBe(401)
    expect(accounts.list).not.toHaveBeenCalled()
  })
})
