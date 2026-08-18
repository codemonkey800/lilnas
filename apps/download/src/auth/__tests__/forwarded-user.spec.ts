import { Logger } from '@nestjs/common'

import { getForwardedUser, resolveForwardedUser } from 'src/auth/forwarded-user'

function buildRequest(headers: Record<string, string | string[] | undefined>) {
  return { headers } as unknown as Parameters<typeof getForwardedUser>[0]
}

describe('getForwardedUser', () => {
  it('returns { email, userId } when both headers are present', () => {
    expect(
      getForwardedUser(
        buildRequest({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      ),
    ).toEqual({ email: 'alice@example.com', userId: 'user_1' })
  })

  it('returns undefined when x-forwarded-user is missing', () => {
    expect(
      getForwardedUser(buildRequest({ 'x-forwarded-user-id': 'user_1' })),
    ).toBeUndefined()
  })

  it('returns undefined when x-forwarded-user-id is missing', () => {
    expect(
      getForwardedUser(
        buildRequest({ 'x-forwarded-user': 'alice@example.com' }),
      ),
    ).toBeUndefined()
  })

  it('returns undefined when both headers are missing', () => {
    expect(getForwardedUser(buildRequest({}))).toBeUndefined()
  })

  it('takes the first value when a header arrives as an array', () => {
    expect(
      getForwardedUser(
        buildRequest({
          'x-forwarded-user': ['alice@example.com', 'bob@example.com'],
          'x-forwarded-user-id': ['user_1', 'user_2'],
        }),
      ),
    ).toEqual({ email: 'alice@example.com', userId: 'user_1' })
  })
})

describe('resolveForwardedUser', () => {
  const originalEnv = { ...process.env }

  // `process.env.NODE_ENV` is typed readonly (Next.js's global env typing),
  // so tests can't assign/delete it in place - only whole-object
  // reassignment of `process.env` is allowed. Building a fresh plain object
  // and deleting keys from THAT (not from `process.env` itself) sidesteps
  // the readonly restriction.
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
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('prefers the real forwarded-user headers when present, even with the dev fallback configured', () => {
    setEnv({
      NODE_ENV: 'development',
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_ID: 'dev-1',
    })

    expect(
      resolveForwardedUser(
        buildRequest({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      ),
    ).toEqual({ email: 'alice@example.com', userId: 'user_1' })
  })

  it('falls back to DEV_USER_EMAIL/DEV_USER_ID when headers are absent and NODE_ENV is not production', () => {
    setEnv({
      NODE_ENV: 'development',
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_ID: 'dev-1',
    })

    expect(resolveForwardedUser(buildRequest({}))).toEqual({
      email: 'dev@example.com',
      userId: 'dev-1',
    })
  })

  it('stays inert (undefined) when NODE_ENV is production, even with both dev vars set', () => {
    setEnv({
      NODE_ENV: 'production',
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_ID: 'dev-1',
    })

    expect(resolveForwardedUser(buildRequest({}))).toBeUndefined()
  })

  it('stays inert when NODE_ENV is not production but DEV_USER_EMAIL is missing', () => {
    setEnv({
      NODE_ENV: 'development',
      DEV_USER_EMAIL: undefined,
      DEV_USER_ID: 'dev-1',
    })

    expect(resolveForwardedUser(buildRequest({}))).toBeUndefined()
  })

  it('stays inert when NODE_ENV is not production but DEV_USER_ID is missing', () => {
    setEnv({
      NODE_ENV: 'development',
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_ID: undefined,
    })

    expect(resolveForwardedUser(buildRequest({}))).toBeUndefined()
  })

  it('stays inert when neither dev var nor NODE_ENV is configured at all', () => {
    setEnv({
      NODE_ENV: undefined,
      DEV_USER_EMAIL: undefined,
      DEV_USER_ID: undefined,
    })

    expect(resolveForwardedUser(buildRequest({}))).toBeUndefined()
  })
})
