import { ServiceUnavailableException } from '@nestjs/common'
import { http as mswHttp, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { DiscordDirectoryService } from 'src/console/discord-directory.service'

// setup.ts already sets DISCORD_GUILD_ID = 'test-guild-id' and
// DISCORD_API_TOKEN = 'test-token' (shared fixtures).
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? 'test-guild-id'
const MEMBERS_URL = `https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000`

describe('DiscordDirectoryService', () => {
  const server = setupServer()

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => server.resetHandlers())
  afterAll(() => server.close())

  it('authenticates with the bot token, filters bots, prefers nick > global_name > username, and sorts by displayName', async () => {
    server.use(
      mswHttp.get(MEMBERS_URL, ({ request: req }) => {
        expect(req.headers.get('authorization')).toBe('Bot test-token')
        return HttpResponse.json([
          {
            user: { id: '3', username: 'a-bot', global_name: null, bot: true },
            nick: null,
          },
          {
            user: { id: '1', username: 'bob', global_name: 'Bobby' },
            nick: null,
          },
          {
            user: { id: '2', username: 'alice', global_name: null },
            nick: 'AliceNick',
          },
        ])
      }),
    )

    const svc = new DiscordDirectoryService()
    const result = await svc.listGuildMembers()

    // Bot filtered out; sorted by displayName (AliceNick < Bobby); nick beats
    // global_name, global_name beats username.
    expect(result).toEqual([
      { id: '2', username: 'alice', displayName: 'AliceNick' },
      { id: '1', username: 'bob', displayName: 'Bobby' },
    ])
  })

  it('caches within the TTL — a second call does not refetch', async () => {
    let callCount = 0
    server.use(
      mswHttp.get(MEMBERS_URL, () => {
        callCount++
        return HttpResponse.json([
          { user: { id: '1', username: 'bob', global_name: null }, nick: null },
        ])
      }),
    )

    const svc = new DiscordDirectoryService()
    await svc.listGuildMembers()
    await svc.listGuildMembers()

    expect(callCount).toBe(1)
  })

  it('force=true bypasses the cache and refetches immediately', async () => {
    let callCount = 0
    server.use(
      mswHttp.get(MEMBERS_URL, () => {
        callCount++
        return HttpResponse.json([
          { user: { id: '1', username: 'bob', global_name: null }, nick: null },
        ])
      }),
    )

    const svc = new DiscordDirectoryService()
    await svc.listGuildMembers()
    await svc.listGuildMembers(true)

    expect(callCount).toBe(2)
  })

  it('refetches once the cache TTL has elapsed', async () => {
    let callCount = 0
    server.use(
      mswHttp.get(MEMBERS_URL, () => {
        callCount++
        return HttpResponse.json([
          { user: { id: '1', username: 'bob', global_name: null }, nick: null },
        ])
      }),
    )

    // Mock only Date.now (not fake timers wholesale) so fetch/AbortSignal
    // scheduling is untouched — this test cares about the cache's own clock
    // check, not about faking the event loop.
    let mockedNow = Date.now()
    jest.spyOn(Date, 'now').mockImplementation(() => mockedNow)

    const svc = new DiscordDirectoryService()
    await svc.listGuildMembers()
    mockedNow += 5 * 60_000 + 1
    await svc.listGuildMembers()

    expect(callCount).toBe(2)
    jest.restoreAllMocks()
  })

  it('a non-2xx Discord response throws ServiceUnavailableException, cache stays empty', async () => {
    server.use(
      mswHttp.get(MEMBERS_URL, () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
      ),
    )

    const svc = new DiscordDirectoryService()
    await expect(svc.listGuildMembers()).rejects.toThrow(
      ServiceUnavailableException,
    )
  })

  it('a network error throws ServiceUnavailableException', async () => {
    server.use(mswHttp.get(MEMBERS_URL, () => HttpResponse.error()))

    const svc = new DiscordDirectoryService()
    await expect(svc.listGuildMembers()).rejects.toThrow(
      ServiceUnavailableException,
    )
  })
})
