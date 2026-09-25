import {
  getDiscordDisplayName,
  getDiscordRequester,
} from 'src/auth/discord-user'

function buildRequest(headers: Record<string, string | string[] | undefined>) {
  return { headers } as unknown as Parameters<typeof getDiscordRequester>[0]
}

describe('getDiscordRequester', () => {
  it('returns { discordUserId, discordUsername } when both headers are present', () => {
    expect(
      getDiscordRequester(
        buildRequest({
          'x-discord-user-id': '123456789012345678',
          'x-discord-username': 'alice',
        }),
      ),
    ).toEqual({ discordUserId: '123456789012345678', discordUsername: 'alice' })
  })

  it('returns undefined when x-discord-user-id is missing', () => {
    expect(
      getDiscordRequester(buildRequest({ 'x-discord-username': 'alice' })),
    ).toBeUndefined()
  })

  it('returns undefined when x-discord-username is missing', () => {
    expect(
      getDiscordRequester(
        buildRequest({ 'x-discord-user-id': '123456789012345678' }),
      ),
    ).toBeUndefined()
  })

  it('returns undefined when both headers are missing', () => {
    expect(getDiscordRequester(buildRequest({}))).toBeUndefined()
  })

  it('takes the first value when a header arrives as an array', () => {
    expect(
      getDiscordRequester(
        buildRequest({
          'x-discord-user-id': ['123456789012345678', '987654321098765432'],
          'x-discord-username': ['alice', 'bob'],
        }),
      ),
    ).toEqual({ discordUserId: '123456789012345678', discordUsername: 'alice' })
  })

  it('ignores x-discord-display-name entirely — it is never part of the requester', () => {
    expect(
      getDiscordRequester(
        buildRequest({
          'x-discord-display-name': 'Alice A.',
          'x-discord-user-id': '123456789012345678',
          'x-discord-username': 'alice',
        }),
      ),
    ).toEqual({ discordUserId: '123456789012345678', discordUsername: 'alice' })
  })
})

describe('getDiscordDisplayName', () => {
  it('returns the header value when present', () => {
    expect(
      getDiscordDisplayName(
        buildRequest({ 'x-discord-display-name': 'Alice A.' }),
      ),
    ).toBe('Alice A.')
  })

  it('returns undefined when the header is absent — globalName is nullable on Discord', () => {
    expect(
      getDiscordDisplayName(
        buildRequest({
          'x-discord-user-id': '123456789012345678',
          'x-discord-username': 'alice',
        }),
      ),
    ).toBeUndefined()
  })

  it('takes the first value when the header arrives as an array', () => {
    expect(
      getDiscordDisplayName(
        buildRequest({ 'x-discord-display-name': ['Alice A.', 'Bob B.'] }),
      ),
    ).toBe('Alice A.')
  })

  it('passes untrusted free text through verbatim', () => {
    expect(
      getDiscordDisplayName(
        buildRequest({ 'x-discord-display-name': '  <b>Al ice</b> 🎉 ' }),
      ),
    ).toBe('  <b>Al ice</b> 🎉 ')
  })
})
