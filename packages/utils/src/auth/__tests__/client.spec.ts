import { AuthClient } from 'src/auth/client'
import { DiscordLinkLookupParams } from 'src/auth/types'

function mockFetchJson(body: unknown, ok = true): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: () => Promise.resolve(body),
  } as unknown as Response)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

describe('AuthClient', () => {
  describe('instance factories', () => {
    it('localInstance targets localhost:8081', async () => {
      const fetchSpy = mockFetchJson({ isAdmin: false })

      await AuthClient.localInstance.checkIsAdmin('alice@example.com')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/admin/check?email=alice%40example.com',
        { headers: JSON_HEADERS, signal: expect.any(AbortSignal) },
      )
    })

    it('dockerInstance targets the internal docker hostname', async () => {
      const fetchSpy = mockFetchJson({ isAdmin: false })

      await AuthClient.dockerInstance.checkIsAdmin('alice@example.com')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://auth:8081/admin/check?email=alice%40example.com',
        { headers: JSON_HEADERS, signal: expect.any(AbortSignal) },
      )
    })
  })

  describe('checkIsAdmin', () => {
    it('URL-encodes the email and returns the parsed body', async () => {
      mockFetchJson({ isAdmin: true })

      const result = await AuthClient.localInstance.checkIsAdmin('a b@x.com')

      expect(result).toEqual({ isAdmin: true })
    })

    it('throws when the response is not ok', async () => {
      mockFetchJson({ statusCode: 500, message: 'boom' }, false)

      await expect(
        AuthClient.localInstance.checkIsAdmin('alice@example.com'),
      ).rejects.toThrow('GET /admin/check failed with 500')
    })

    it('throws when the response body has an unexpected shape', async () => {
      mockFetchJson({ notIsAdmin: true })

      await expect(
        AuthClient.localInstance.checkIsAdmin('alice@example.com'),
      ).rejects.toThrow('GET /admin/check returned an unexpected body shape')
    })
  })

  describe('getDiscordLink', () => {
    it.each<[string, DiscordLinkLookupParams, string]>([
      [
        'discordUserId',
        { discordUserId: '123456789012345678' },
        'discordUserId=123456789012345678',
      ],
      ['userId', { userId: 'user/1' }, 'userId=user%2F1'],
      ['email', { email: 'a b@x.com' }, 'email=a%20b%40x.com'],
    ])(
      'encodes the %s lookup key into the query',
      async (_key, params, query) => {
        const fetchSpy = mockFetchJson({ identity: null, user: null })

        await AuthClient.localInstance.getDiscordLink(params)

        expect(fetchSpy).toHaveBeenCalledWith(
          `http://localhost:8081/internal/discord-link?${query}`,
          { headers: JSON_HEADERS, signal: expect.any(AbortSignal) },
        )
      },
    )

    it('passes a both-null body through for an unseen snowflake', async () => {
      mockFetchJson({ identity: null, user: null })

      const result = await AuthClient.localInstance.getDiscordLink({
        discordUserId: '123456789012345678',
      })

      expect(result).toEqual({ identity: null, user: null })
    })

    it('passes an observed-but-unlinked identity through', async () => {
      mockFetchJson({
        identity: {
          discordUserId: '123456789012345678',
          username: 'alice',
          displayName: null,
        },
        user: null,
      })

      const result = await AuthClient.localInstance.getDiscordLink({
        discordUserId: '123456789012345678',
      })

      expect(result).toEqual({
        identity: {
          discordUserId: '123456789012345678',
          username: 'alice',
          displayName: null,
        },
        user: null,
      })
    })

    it('passes a fully linked envelope through', async () => {
      const body = {
        identity: {
          discordUserId: '123456789012345678',
          username: 'alice',
          displayName: 'Alice',
        },
        user: { userId: 'user_1', email: 'alice@example.com', name: 'Alice' },
      }
      mockFetchJson(body)

      const result = await AuthClient.localInstance.getDiscordLink({
        email: 'alice@example.com',
      })

      expect(result).toEqual(body)
    })

    it('throws when the response is not ok', async () => {
      mockFetchJson({ statusCode: 500, message: 'boom' }, false)

      await expect(
        AuthClient.localInstance.getDiscordLink({ userId: 'user_1' }),
      ).rejects.toThrow('GET /internal/discord-link failed with 500')
    })

    it.each([
      ['a missing user key', { identity: null }],
      ['a missing identity key', { user: null }],
      ['a non-object identity', { identity: 'nope', user: null }],
      ['an array user', { identity: null, user: [] }],
      ['a non-object body', 'nope'],
    ])('throws on %s', async (_label, body) => {
      mockFetchJson(body)

      await expect(
        AuthClient.localInstance.getDiscordLink({ userId: 'user_1' }),
      ).rejects.toThrow(
        'GET /internal/discord-link returned an unexpected body shape',
      )
    })
  })

  describe('registerDiscordIdentity', () => {
    it('POSTs the identity as JSON', async () => {
      const fetchSpy = mockFetchJson({ ok: true })

      await AuthClient.dockerInstance.registerDiscordIdentity({
        discordUserId: '123456789012345678',
        username: 'alice',
        displayName: 'Alice',
      })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://auth:8081/internal/discord-identity',
        {
          method: 'POST',
          body: JSON.stringify({
            discordUserId: '123456789012345678',
            username: 'alice',
            displayName: 'Alice',
          }),
          headers: JSON_HEADERS,
          signal: expect.any(AbortSignal),
        },
      )
    })

    it('omits displayName when it is not supplied', async () => {
      const fetchSpy = mockFetchJson({ ok: true })

      await AuthClient.localInstance.registerDiscordIdentity({
        discordUserId: '123456789012345678',
        username: 'alice',
      })

      expect(fetchSpy.mock.calls[0][1]).toMatchObject({
        body: JSON.stringify({
          discordUserId: '123456789012345678',
          username: 'alice',
        }),
      })
    })

    it('throws when the response is not ok', async () => {
      mockFetchJson({ statusCode: 500, message: 'boom' }, false)

      await expect(
        AuthClient.localInstance.registerDiscordIdentity({
          discordUserId: '123456789012345678',
          username: 'alice',
        }),
      ).rejects.toThrow('POST /internal/discord-identity failed with 500')
    })
  })
})
