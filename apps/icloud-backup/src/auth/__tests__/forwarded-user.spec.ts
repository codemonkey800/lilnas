import { Logger } from '@nestjs/common'

import { getForwardedUser, resolveForwardedUser } from 'src/auth/forwarded-user'

import { setEnv, USER_HEADERS } from './helpers/identity'

describe('getForwardedUser', () => {
  it('returns { email, userId } when both headers are present', () => {
    expect(getForwardedUser({ headers: USER_HEADERS })).toEqual({
      email: 'alice@example.com',
      userId: 'user_1',
    })
  })

  it.each([
    ['x-forwarded-user', { 'x-forwarded-user-id': 'user_1' }],
    ['x-forwarded-user-id', { 'x-forwarded-user': 'alice@example.com' }],
    ['both headers', {}],
  ])('returns undefined when %s is missing', (_name, headers) => {
    expect(getForwardedUser({ headers })).toBeUndefined()
  })

  it('takes the first value of an array header', () => {
    expect(
      getForwardedUser({
        headers: {
          'x-forwarded-user': ['alice@example.com', 'bob@example.com'],
          'x-forwarded-user-id': ['user_1', 'user_2'],
        },
      }),
    ).toEqual({ email: 'alice@example.com', userId: 'user_1' })
  })
})

describe('resolveForwardedUser', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  const devIdentity = {
    DEV_USER_EMAIL: 'dev@example.com',
    DEV_USER_ID: 'dev-1',
  }

  it('prefers the real headers over the dev fallback', () => {
    setEnv({ NODE_ENV: 'development', ...devIdentity })

    expect(resolveForwardedUser({ headers: USER_HEADERS })).toEqual({
      email: 'alice@example.com',
      userId: 'user_1',
    })
  })

  it('uses the dev fallback outside production when both DEV_USER_* are set', () => {
    setEnv({ NODE_ENV: 'development', ...devIdentity })

    expect(resolveForwardedUser({ headers: {} })).toEqual({
      email: 'dev@example.com',
      userId: 'dev-1',
    })
  })

  it('uses the dev fallback when NODE_ENV is unset', () => {
    setEnv({ NODE_ENV: undefined, ...devIdentity })

    expect(resolveForwardedUser({ headers: {} })).toEqual({
      email: 'dev@example.com',
      userId: 'dev-1',
    })
  })

  it('ignores the dev fallback in production', () => {
    setEnv({ NODE_ENV: 'production', ...devIdentity })

    expect(resolveForwardedUser({ headers: {} })).toBeUndefined()
  })

  it.each([
    ['DEV_USER_ID', { DEV_USER_EMAIL: 'dev@example.com' }],
    ['DEV_USER_EMAIL', { DEV_USER_ID: 'dev-1' }],
    ['both DEV_USER_*', {}],
  ])('has no fallback when %s is unset', (_name, partial) => {
    setEnv({
      NODE_ENV: 'development',
      DEV_USER_EMAIL: undefined,
      DEV_USER_ID: undefined,
      ...partial,
    })

    expect(resolveForwardedUser({ headers: {} })).toBeUndefined()
  })

  it('does not take a half-present header pair as an identity', () => {
    setEnv({ NODE_ENV: 'production' })

    expect(
      resolveForwardedUser({
        headers: { 'x-forwarded-user': 'alice@example.com' },
      }),
    ).toBeUndefined()
  })
})
