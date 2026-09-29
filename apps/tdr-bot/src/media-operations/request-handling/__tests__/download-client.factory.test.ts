import { Test } from '@nestjs/testing'

import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import { DiscordIdentity } from 'src/media-operations/request-handling/types/request-context.type'

const ALICE: DiscordIdentity = {
  userId: '221093544588935169',
  username: 'alice.codes',
  displayName: 'Alice',
}

// The factory's clients are only observable through the requests they make,
// so every test drives one `getJob` through a stubbed `fetch` and inspects
// the URL and headers it was called with. Nothing reaches the network.
function mockFetch(): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  } as unknown as Response)
}

async function createFactory(): Promise<DownloadClientFactory> {
  const module = await Test.createTestingModule({
    providers: [DownloadClientFactory],
  }).compile()

  return module.get(DownloadClientFactory)
}

function requestOf(fetchSpy: jest.SpyInstance, call = 0) {
  const [url, init] = fetchSpy.mock.calls[call] as [string, RequestInit]
  return { url, headers: init.headers as Record<string, string> }
}

describe('DownloadClientFactory', () => {
  const originalApiUrl = process.env.DOWNLOAD_API_URL

  beforeEach(() => {
    delete process.env.DOWNLOAD_API_URL
  })

  afterEach(() => {
    jest.restoreAllMocks()

    if (originalApiUrl === undefined) {
      delete process.env.DOWNLOAD_API_URL
    } else {
      process.env.DOWNLOAD_API_URL = originalApiUrl
    }
  })

  describe('forDiscord', () => {
    it("stamps the user's identity onto every request as x-discord-* headers", async () => {
      const fetchSpy = mockFetch()
      const factory = await createFactory()

      await factory.forDiscord(ALICE).getJob('job-1')

      expect(requestOf(fetchSpy).headers).toEqual({
        'Content-Type': 'application/json',
        'x-discord-user-id': '221093544588935169',
        'x-discord-username': 'alice.codes',
        'x-discord-display-name': 'Alice',
      })
    })

    it('omits x-discord-display-name when the user has no display name', async () => {
      const fetchSpy = mockFetch()
      const factory = await createFactory()

      await factory
        .forDiscord({ userId: ALICE.userId, username: ALICE.username })
        .getJob('job-1')

      const { headers } = requestOf(fetchSpy)
      expect(headers).toMatchObject({
        'x-discord-user-id': '221093544588935169',
        'x-discord-username': 'alice.codes',
      })
      expect(headers).not.toHaveProperty('x-discord-display-name')
    })

    it("keeps each user's headers on their own client", async () => {
      const fetchSpy = mockFetch()
      const factory = await createFactory()

      const alice = factory.forDiscord(ALICE)
      const bob = factory.forDiscord({ userId: '42', username: 'bob' })
      await alice.getJob('job-1')
      await bob.getJob('job-2')

      expect(requestOf(fetchSpy, 0).headers).toMatchObject({
        'x-discord-user-id': '221093544588935169',
        'x-discord-username': 'alice.codes',
      })
      expect(requestOf(fetchSpy, 1).headers).toMatchObject({
        'x-discord-user-id': '42',
        'x-discord-username': 'bob',
      })
      expect(requestOf(fetchSpy, 1).headers).not.toHaveProperty(
        'x-discord-display-name',
      )
    })

    it("targets production's download service by default", async () => {
      const fetchSpy = mockFetch()
      const factory = await createFactory()

      await factory.forDiscord(ALICE).getJob('job-1')

      expect(requestOf(fetchSpy).url).toBe(
        'http://download:8081/download/videos/job-1',
      )
    })

    it('targets DOWNLOAD_API_URL when set', async () => {
      process.env.DOWNLOAD_API_URL = 'http://lilnas-download-dev:8081'
      const fetchSpy = mockFetch()
      const factory = await createFactory()

      await factory.forDiscord(ALICE).getJob('job-1')

      expect(requestOf(fetchSpy).url).toBe(
        'http://lilnas-download-dev:8081/download/videos/job-1',
      )
    })
  })
})
