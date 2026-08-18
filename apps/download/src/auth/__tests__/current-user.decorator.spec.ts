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
})
