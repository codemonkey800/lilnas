import { type ExecutionContext, UnauthorizedException } from '@nestjs/common'

import { ForwardedUserGuard } from 'src/auth/forwarded-user.guard'

function buildContext(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

describe('ForwardedUserGuard', () => {
  const guard = new ForwardedUserGuard()

  it('returns true when both headers are present', () => {
    expect(
      guard.canActivate(
        buildContext({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      ),
    ).toBe(true)
  })

  it('throws UnauthorizedException when x-forwarded-user is missing', () => {
    expect(() =>
      guard.canActivate(buildContext({ 'x-forwarded-user-id': 'user_1' })),
    ).toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException when x-forwarded-user-id is missing', () => {
    expect(() =>
      guard.canActivate(
        buildContext({ 'x-forwarded-user': 'alice@example.com' }),
      ),
    ).toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException when both headers are missing', () => {
    expect(() => guard.canActivate(buildContext({}))).toThrow(
      UnauthorizedException,
    )
  })
})
