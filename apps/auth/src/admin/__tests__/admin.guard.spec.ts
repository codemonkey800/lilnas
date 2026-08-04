import type { ExecutionContext } from '@nestjs/common'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'

import { AdminGuard, isAdminEmail } from 'src/admin/admin.guard'
import type { AccessCacheService } from 'src/verify/access-cache.service'

process.env.ADMIN_EMAILS = 'admin@example.com, Second.Admin@Example.com'

function fakeAccessCache(
  session: { userId: string; email: string } | null,
): AccessCacheService & { hasGrant: jest.Mock; isBlocked: jest.Mock } {
  return {
    resolveSession: jest.fn().mockResolvedValue(session),
    hasGrant: jest.fn(),
    isBlocked: jest.fn(),
  } as unknown as AccessCacheService & {
    hasGrant: jest.Mock
    isBlocked: jest.Mock
  }
}

function fakeContext(cookie?: string): ExecutionContext {
  const req = { headers: { cookie } } as unknown as Request
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

describe('isAdminEmail (R17)', () => {
  it('matches an exact entry', () => {
    expect(isAdminEmail('admin@example.com', 'admin@example.com')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isAdminEmail('ADMIN@EXAMPLE.COM', 'admin@example.com')).toBe(true)
    expect(isAdminEmail('admin@example.com', 'ADMIN@EXAMPLE.COM')).toBe(true)
  })

  it('tolerates surrounding whitespace in the env list', () => {
    expect(isAdminEmail('admin@example.com', '  admin@example.com  ')).toBe(
      true,
    )
  })

  it('matches one of several comma-separated entries', () => {
    const list = 'a@example.com,b@example.com,c@example.com'
    expect(isAdminEmail('b@example.com', list)).toBe(true)
  })

  it('rejects a non-admin email', () => {
    expect(isAdminEmail('nobody@example.com', 'admin@example.com')).toBe(false)
  })

  it('rejects an empty email against a non-empty list', () => {
    expect(isAdminEmail('', 'admin@example.com')).toBe(false)
  })

  it('handles an empty ADMIN_EMAILS value without matching anything', () => {
    expect(isAdminEmail('admin@example.com', '')).toBe(false)
  })

  it('is not fooled by a substring match (admin@example.com.evil.com)', () => {
    expect(
      isAdminEmail('admin@example.com.evil.com', 'admin@example.com'),
    ).toBe(false)
  })
})

describe('AdminGuard (R17, AE5)', () => {
  it('covers AE5/R17: an ADMIN_EMAILS address is authorized without ever calling hasGrant or isBlocked', async () => {
    const accessCache = fakeAccessCache({
      userId: 'user_1',
      email: 'admin@example.com',
    })
    const guard = new AdminGuard(accessCache)

    const result = await guard.canActivate(fakeContext('cookie=x'))

    expect(result).toBe(true)
    expect(accessCache.hasGrant).not.toHaveBeenCalled()
    expect(accessCache.isBlocked).not.toHaveBeenCalled()
  })

  it('matches an admin email that differs only in case/whitespace from the env entry', async () => {
    const accessCache = fakeAccessCache({
      userId: 'user_2',
      email: '  SECOND.ADMIN@example.com  ',
    })
    const guard = new AdminGuard(accessCache)

    await expect(guard.canActivate(fakeContext('cookie=x'))).resolves.toBe(true)
  })

  it('a signed-in non-admin receives 403 (ForbiddenException), not 401', async () => {
    const accessCache = fakeAccessCache({
      userId: 'user_3',
      email: 'nobody@example.com',
    })
    const guard = new AdminGuard(accessCache)

    await expect(guard.canActivate(fakeContext('cookie=x'))).rejects.toThrow(
      ForbiddenException,
    )
  })

  it('an unauthenticated request receives 401 (UnauthorizedException), not 403', async () => {
    const accessCache = fakeAccessCache(null)
    const guard = new AdminGuard(accessCache)

    await expect(guard.canActivate(fakeContext(undefined))).rejects.toThrow(
      UnauthorizedException,
    )
  })
})
