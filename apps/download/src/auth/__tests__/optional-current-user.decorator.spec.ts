import { type ExecutionContext } from '@nestjs/common'

import { extractOptionalCurrentUser } from 'src/auth/optional-current-user.decorator'

function buildContext(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

describe('extractOptionalCurrentUser', () => {
  it('returns { email, userId } when both headers are present', () => {
    expect(
      extractOptionalCurrentUser(
        buildContext({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      ),
    ).toEqual({ email: 'alice@example.com', userId: 'user_1' })
  })

  it('returns undefined (not a throw) for a service caller with no headers at all', () => {
    expect(extractOptionalCurrentUser(buildContext({}))).toBeUndefined()
  })

  it('returns undefined when only one of the two headers is present', () => {
    expect(
      extractOptionalCurrentUser(
        buildContext({ 'x-forwarded-user': 'alice@example.com' }),
      ),
    ).toBeUndefined()
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

    it('falls back to DEV_USER_EMAIL/DEV_USER_ID when headers are absent and NODE_ENV is not production', () => {
      setEnv({
        NODE_ENV: 'development',
        DEV_USER_EMAIL: 'dev@example.com',
        DEV_USER_ID: 'dev-1',
      })

      expect(extractOptionalCurrentUser(buildContext({}))).toEqual({
        email: 'dev@example.com',
        userId: 'dev-1',
      })
    })

    it('stays undefined (not a throw) when NODE_ENV is production, even with dev vars set', () => {
      setEnv({
        NODE_ENV: 'production',
        DEV_USER_EMAIL: 'dev@example.com',
        DEV_USER_ID: 'dev-1',
      })

      expect(extractOptionalCurrentUser(buildContext({}))).toBeUndefined()
    })
  })
})
