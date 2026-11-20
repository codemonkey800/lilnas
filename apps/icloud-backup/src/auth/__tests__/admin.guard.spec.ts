import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import { AdminGuard } from 'src/auth/admin.guard'
import type { AdminCheckService } from 'src/auth/admin-check.service'

import { fakeContext, setEnv, USER_HEADERS } from './helpers/identity'

describe('AdminGuard', () => {
  const originalEnv = { ...process.env }
  const checkIsAdmin = jest.fn<Promise<boolean>, [string]>()
  const guard = new AdminGuard({ checkIsAdmin } as unknown as AdminCheckService)

  beforeEach(() => {
    setEnv({
      NODE_ENV: 'production',
      DEV_USER_EMAIL: undefined,
      DEV_USER_ID: undefined,
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('is a 401 without an identity, without asking auth', async () => {
    await expect(guard.canActivate(fakeContext({}))).rejects.toThrow(
      UnauthorizedException,
    )
    expect(checkIsAdmin).not.toHaveBeenCalled()
  })

  it('is a 403 for a non-admin', async () => {
    checkIsAdmin.mockResolvedValue(false)

    await expect(guard.canActivate(fakeContext(USER_HEADERS))).rejects.toThrow(
      ForbiddenException,
    )
    expect(checkIsAdmin).toHaveBeenCalledWith('alice@example.com')
  })

  it('lets an admin through', async () => {
    checkIsAdmin.mockResolvedValue(true)

    await expect(guard.canActivate(fakeContext(USER_HEADERS))).resolves.toBe(
      true,
    )
  })
})
