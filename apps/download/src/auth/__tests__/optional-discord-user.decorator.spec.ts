import { type ExecutionContext } from '@nestjs/common'

import { extractOptionalDiscordUser } from 'src/auth/optional-discord-user.decorator'

function buildContext(headers: Record<string, string | string[] | undefined>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

describe('extractOptionalDiscordUser', () => {
  it('returns { discordUserId, discordUsername } when both headers are present', () => {
    expect(
      extractOptionalDiscordUser(
        buildContext({
          'x-discord-user-id': '123456789012345678',
          'x-discord-username': 'alice',
        }),
      ),
    ).toEqual({ discordUserId: '123456789012345678', discordUsername: 'alice' })
  })

  it('returns undefined (not a throw) for a browser caller with no Discord headers at all', () => {
    expect(extractOptionalDiscordUser(buildContext({}))).toBeUndefined()
  })

  it('returns undefined when only one of the two headers is present', () => {
    expect(
      extractOptionalDiscordUser(
        buildContext({ 'x-discord-user-id': '123456789012345678' }),
      ),
    ).toBeUndefined()
  })

  it('takes the first value when a header arrives as an array', () => {
    expect(
      extractOptionalDiscordUser(
        buildContext({
          'x-discord-user-id': ['123456789012345678', '987654321098765432'],
          'x-discord-username': ['alice', 'bob'],
        }),
      ),
    ).toEqual({ discordUserId: '123456789012345678', discordUsername: 'alice' })
  })

  it('never applies a dev fallback — unlike @OptionalCurrentUser() there is no dev Discord identity', () => {
    const originalEnv = { ...process.env }
    process.env = {
      ...process.env,
      DEV_USER_EMAIL: 'dev@example.com',
      DEV_USER_ID: 'dev-1',
      NODE_ENV: 'development',
    } as typeof process.env

    try {
      expect(extractOptionalDiscordUser(buildContext({}))).toBeUndefined()
    } finally {
      process.env = { ...originalEnv }
    }
  })
})
