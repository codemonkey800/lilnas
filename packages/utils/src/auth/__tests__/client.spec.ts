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

function mockFetchStatus(status: number, statusText: string): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({ statusCode: status, message: statusText }),
  } as unknown as Response)
}

/** Headers of the nth fetch call, as a plain record. */
function sentHeaders(
  fetchSpy: jest.SpyInstance,
  call = 0,
): Record<string, string> {
  const init = fetchSpy.mock.calls[call][1] as RequestInit
  return init.headers as Record<string, string>
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const TOKEN = 'test-token-ctor-0123456789'
const ENV_TOKEN = 'test-token-env-9876543210'

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response
}

/** Calls each of the three methods once against `client`. */
async function callAllMethods(client: AuthClient): Promise<jest.SpyInstance> {
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(okResponse({ isAdmin: true }))
    .mockResolvedValueOnce(okResponse({ identity: null, user: null }))
    .mockResolvedValueOnce(okResponse({ ok: true }))

  await client.checkIsAdmin('alice@example.com')
  await client.getDiscordLink({ userId: 'user_1' })
  await client.registerDiscordIdentity({
    discordUserId: '123456789012345678',
    username: 'alice',
  })

  expect(fetchSpy).toHaveBeenCalledTimes(3)
  return fetchSpy
}

const ORIGINAL_ENV_TOKEN = process.env.AUTH_INTERNAL_TOKEN

beforeEach(() => {
  delete process.env.AUTH_INTERNAL_TOKEN
})

afterAll(() => {
  if (ORIGINAL_ENV_TOKEN === undefined) {
    delete process.env.AUTH_INTERNAL_TOKEN
  } else {
    process.env.AUTH_INTERNAL_TOKEN = ORIGINAL_ENV_TOKEN
  }
})

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

  describe('bearer token', () => {
    function expectBearerOnAll(fetchSpy: jest.SpyInstance, token: string) {
      for (let call = 0; call < 3; call++) {
        expect(sentHeaders(fetchSpy, call)).toEqual({
          ...JSON_HEADERS,
          Authorization: `Bearer ${token}`,
        })
      }
    }

    function expectNoAuthorizationOnAll(fetchSpy: jest.SpyInstance) {
      for (let call = 0; call < 3; call++) {
        expect(sentHeaders(fetchSpy, call)).toEqual(JSON_HEADERS)
        const url = fetchSpy.mock.calls[call][0] as string
        expect(url).not.toContain('token')
      }
    }

    it('sends a constructor token on all three methods', async () => {
      const fetchSpy = await callAllMethods(
        new AuthClient('http://auth:8081', TOKEN),
      )

      expectBearerOnAll(fetchSpy, TOKEN)
    })

    it.each([
      ['localInstance', () => AuthClient.localInstance],
      ['dockerInstance', () => AuthClient.dockerInstance],
      ['new AuthClient()', () => new AuthClient()],
    ])(
      'sends AUTH_INTERNAL_TOKEN on all three methods via %s',
      async (_label, make) => {
        process.env.AUTH_INTERNAL_TOKEN = ENV_TOKEN

        const fetchSpy = await callAllMethods(make())

        expectBearerOnAll(fetchSpy, ENV_TOKEN)
      },
    )

    it('reads AUTH_INTERNAL_TOKEN when the factory is called, not at import', async () => {
      const before = AuthClient.dockerInstance
      process.env.AUTH_INTERNAL_TOKEN = ENV_TOKEN
      const after = AuthClient.dockerInstance

      expectNoAuthorizationOnAll(await callAllMethods(before))
      jest.restoreAllMocks()
      expectBearerOnAll(await callAllMethods(after), ENV_TOKEN)
    })

    it('trims surrounding whitespace from the token', async () => {
      process.env.AUTH_INTERNAL_TOKEN = `  ${ENV_TOKEN}\n`

      const fetchSpy = await callAllMethods(AuthClient.dockerInstance)

      expectBearerOnAll(fetchSpy, ENV_TOKEN)
    })

    it('sends no Authorization header with neither a constructor token nor the env', async () => {
      const fetchSpy = await callAllMethods(AuthClient.dockerInstance)

      expectNoAuthorizationOnAll(fetchSpy)
    })

    it.each([
      ['an empty string', ''],
      ['whitespace', ' \t\n '],
    ])('sends no Authorization header for %s', async (_label, blank) => {
      process.env.AUTH_INTERNAL_TOKEN = blank
      expectNoAuthorizationOnAll(
        await callAllMethods(AuthClient.dockerInstance),
      )
      jest.restoreAllMocks()

      delete process.env.AUTH_INTERNAL_TOKEN
      expectNoAuthorizationOnAll(
        await callAllMethods(new AuthClient('http://auth:8081', blank)),
      )
    })

    it('prefers a constructor token over AUTH_INTERNAL_TOKEN', async () => {
      process.env.AUTH_INTERNAL_TOKEN = ENV_TOKEN

      const fetchSpy = await callAllMethods(
        new AuthClient('http://auth:8081', TOKEN),
      )

      expectBearerOnAll(fetchSpy, TOKEN)
    })

    it('keeps the 2 s timeout signal and Content-Type alongside the token', async () => {
      const fetchSpy = mockFetchJson({ isAdmin: false })

      await new AuthClient('http://auth:8081', TOKEN).checkIsAdmin(
        'alice@example.com',
      )

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://auth:8081/admin/check?email=alice%40example.com',
        {
          headers: { ...JSON_HEADERS, Authorization: `Bearer ${TOKEN}` },
          signal: expect.any(AbortSignal),
        },
      )
    })

    it.each([
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
    ])(
      'rejects a %i with the status and without the token',
      async (status, statusText) => {
        const client = new AuthClient('http://auth:8081', TOKEN)
        const calls: [string, () => Promise<unknown>][] = [
          ['GET /admin/check', () => client.checkIsAdmin('alice@example.com')],
          [
            'GET /internal/discord-link',
            () => client.getDiscordLink({ userId: 'user_1' }),
          ],
          [
            'POST /internal/discord-identity',
            () =>
              client.registerDiscordIdentity({
                discordUserId: '123456789012345678',
                username: 'alice',
              }),
          ],
        ]

        for (const [route, call] of calls) {
          const fetchSpy = mockFetchStatus(status, statusText)
          const error = await call().then(
            () => {
              throw new Error(`${route} resolved on a ${status}`)
            },
            (e: unknown) => e as Error,
          )

          expect(error.message).toContain(`${route} failed with ${status}`)
          expect(error.message).not.toContain(TOKEN)
          expect(String(error.stack)).not.toContain(TOKEN)
          expect(fetchSpy.mock.calls[0][0]).not.toContain(TOKEN)
          fetchSpy.mockRestore()
        }
      },
    )

    it('keeps the token out of an inspected or serialized client', async () => {
      const { inspect } = await import('node:util')
      const client = new AuthClient('http://auth:8081', TOKEN)

      expect(inspect(client, { depth: 5 })).not.toContain(TOKEN)
      expect(JSON.stringify(client)).not.toContain(TOKEN)
    })
  })
})
