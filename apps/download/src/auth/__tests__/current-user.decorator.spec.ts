import { type ExecutionContext, UnauthorizedException } from '@nestjs/common'

import { extractCurrentUser } from 'src/auth/current-user.decorator'

function buildContext(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

describe('extractCurrentUser', () => {
  it('returns { email, userId } when both headers are present', () => {
    expect(
      extractCurrentUser(
        buildContext({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      ),
    ).toEqual({ email: 'alice@example.com', userId: 'user_1' })
  })

  it('throws UnauthorizedException when x-forwarded-user is missing', () => {
    expect(() =>
      extractCurrentUser(buildContext({ 'x-forwarded-user-id': 'user_1' })),
    ).toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException when x-forwarded-user-id is missing', () => {
    expect(() =>
      extractCurrentUser(
        buildContext({ 'x-forwarded-user': 'alice@example.com' }),
      ),
    ).toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException when both headers are missing', () => {
    expect(() => extractCurrentUser(buildContext({}))).toThrow(
      UnauthorizedException,
    )
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

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('falls back to DEV_USER_EMAIL/DEV_USER_ID when headers are absent, matching @OptionalCurrentUser()', () => {
      setEnv({
        NODE_ENV: 'development',
        DEV_USER_EMAIL: 'dev@example.com',
        DEV_USER_ID: 'dev-1',
      })

      expect(extractCurrentUser(buildContext({}))).toEqual({
        email: 'dev@example.com',
        userId: 'dev-1',
      })
    })
  })
})
