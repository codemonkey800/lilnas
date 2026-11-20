import { Logger, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { ForwardedUserGuard } from 'src/auth/forwarded-user.guard'
import { Public } from 'src/auth/public.decorator'

import { fakeContext, setEnv, USER_HEADERS } from './helpers/identity'

describe('ForwardedUserGuard', () => {
  const originalEnv = { ...process.env }
  const guard = new ForwardedUserGuard(new Reflector())

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    setEnv({
      NODE_ENV: 'development',
      DEV_USER_EMAIL: undefined,
      DEV_USER_ID: undefined,
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('lets a request with both headers through', () => {
    expect(guard.canActivate(fakeContext(USER_HEADERS))).toBe(true)
  })

  it.each([
    ['x-forwarded-user-id', { 'x-forwarded-user': 'alice@example.com' }],
    ['x-forwarded-user', { 'x-forwarded-user-id': 'user_1' }],
    ['both headers', {}],
  ])('rejects with 401 when %s is missing', (_name, headers) => {
    expect(() => guard.canActivate(fakeContext(headers))).toThrow(
      UnauthorizedException,
    )
  })

  it('accepts a header-less request through the dev fallback when enabled', () => {
    setEnv({ DEV_USER_EMAIL: 'dev@example.com', DEV_USER_ID: 'dev-1' })

    expect(guard.canActivate(fakeContext({}))).toBe(true)
  })

  it('rejects a header-less request when only one DEV_USER_* is set', () => {
    setEnv({ DEV_USER_EMAIL: 'dev@example.com' })

    expect(() => guard.canActivate(fakeContext({}))).toThrow(
      UnauthorizedException,
    )
  })

  it('ignores the dev fallback in production', () => {
    setEnv({
      NODE_ENV: 'production',
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_ID: 'dev-1',
    })

    expect(() => guard.canActivate(fakeContext({}))).toThrow(
      UnauthorizedException,
    )
  })

  it('lets a @Public() controller through without an identity', () => {
    @Public()
    class PublicController {}
    const context = fakeContext({})
    jest.spyOn(context, 'getClass').mockReturnValue(PublicController)

    expect(guard.canActivate(context)).toBe(true)
  })
})
