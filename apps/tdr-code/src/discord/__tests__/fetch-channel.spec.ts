import type { Client } from 'discord.js'

import { fetchChannel } from 'src/discord/fetch-channel'

function createMockClient(channelMap: Map<string, unknown> = new Map()) {
  return {
    channels: {
      cache: channelMap,
      fetch: jest.fn(),
    },
  } as unknown as Client
}

describe('fetchChannel', () => {
  it('returns the cached channel without calling fetch()', async () => {
    const cachedChannel = { id: 'ch1' }
    const client = createMockClient(new Map([['ch1', cachedChannel]]))

    const result = await fetchChannel(client, 'ch1')

    expect(result).toBe(cachedChannel)
    expect(client.channels.fetch).not.toHaveBeenCalled()
  })

  it('falls back to fetch() on a cache miss and returns its result', async () => {
    const fetchedChannel = { id: 'ch2' }
    const client = createMockClient()
    ;(client.channels.fetch as jest.Mock).mockResolvedValue(fetchedChannel)

    const result = await fetchChannel(client, 'ch2')

    expect(result).toBe(fetchedChannel)
    expect(client.channels.fetch).toHaveBeenCalledWith('ch2')
  })

  it('resolves null (does not throw) when fetch() rejects', async () => {
    const client = createMockClient()
    ;(client.channels.fetch as jest.Mock).mockRejectedValue(
      new Error('Unknown Channel'),
    )

    await expect(fetchChannel(client, 'ch-missing')).resolves.toBeNull()
  })

  it('resolves null when fetch() itself resolves null', async () => {
    const client = createMockClient()
    ;(client.channels.fetch as jest.Mock).mockResolvedValue(null)

    await expect(fetchChannel(client, 'ch-missing')).resolves.toBeNull()
  })
})
