import { getForwardedUser } from 'src/auth/forwarded-user'

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
