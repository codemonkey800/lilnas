import {
  type ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'

import { AdminGuard } from 'src/auth/admin.guard'
import type { AdminCheckService } from 'src/auth/admin-check.service'

function buildContext(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

const ADMIN_HEADERS = {
  'x-forwarded-user': 'alice@example.com',
  'x-forwarded-user-id': 'user_1',
}

describe('AdminGuard', () => {
  let checkIsAdmin: jest.Mock
  let guard: AdminGuard

  beforeEach(() => {
    checkIsAdmin = jest.fn()
    guard = new AdminGuard({
      checkIsAdmin,
    } as unknown as AdminCheckService)
  })

  it('returns true when the forwarded user is an admin', async () => {
    checkIsAdmin.mockResolvedValue(true)

    await expect(guard.canActivate(buildContext(ADMIN_HEADERS))).resolves.toBe(
      true,
    )
    expect(checkIsAdmin).toHaveBeenCalledWith('alice@example.com')
  })

  it('throws ForbiddenException when the forwarded user is not an admin', async () => {
    checkIsAdmin.mockResolvedValue(false)

    await expect(
      guard.canActivate(buildContext(ADMIN_HEADERS)),
    ).rejects.toThrow(ForbiddenException)
    await expect(
      guard.canActivate(buildContext(ADMIN_HEADERS)),
    ).rejects.toThrow('Admin access required')
  })

  it('throws UnauthorizedException when both headers are missing', async () => {
    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
      UnauthorizedException,
    )
  })

  it('throws UnauthorizedException when x-forwarded-user is missing', async () => {
    await expect(
      guard.canActivate(buildContext({ 'x-forwarded-user-id': 'user_1' })),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException when x-forwarded-user-id is missing', async () => {
    await expect(
      guard.canActivate(
        buildContext({ 'x-forwarded-user': 'alice@example.com' }),
      ),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('does not consult the admin check when identity is missing', async () => {
    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
      UnauthorizedException,
    )
    expect(checkIsAdmin).not.toHaveBeenCalled()
  })

  describe('dev fallback', () => {
    const originalEnv = { ...process.env }

    // See forwarded-user.spec.ts's identical helper for why whole-object
    // reassignment is required rather than mutating process.env in place.
    function setEnv(overrides: Record<string, string | undefined>): void {
      const next: Record<string, string | undefined> = { ...process.env }
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) {
          delete next[key]
        } else {
          next[key] = value
        }
      }
      process.env = next as typeof process.env
    }

    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation()
      setEnv({
        NODE_ENV: 'development',
        DEV_USER_EMAIL: 'dev@example.com',
        DEV_USER_ID: 'dev-1',
      })
    })

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('still consults the admin check for the dev fallback identity', async () => {
      checkIsAdmin.mockResolvedValue(true)

      await expect(guard.canActivate(buildContext({}))).resolves.toBe(true)
      expect(checkIsAdmin).toHaveBeenCalledWith('dev@example.com')
    })

    it('is not auto-admin — a non-admin dev identity is still forbidden', async () => {
      checkIsAdmin.mockResolvedValue(false)

      await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
        ForbiddenException,
      )
      expect(checkIsAdmin).toHaveBeenCalledWith('dev@example.com')
    })
  })
})
