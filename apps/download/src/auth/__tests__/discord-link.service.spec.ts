import { AuthClient } from '@lilnas/utils/auth/client'
import type { DiscordLinkLookupResponse } from '@lilnas/utils/auth/types'
import { Logger } from '@nestjs/common'

import { DiscordLinkService } from 'src/auth/discord-link.service'

jest.mock('@lilnas/utils/auth/client', () => ({
  AuthClient: {
    dockerInstance: {
      getDiscordLink: jest.fn(),
      registerDiscordIdentity: jest.fn(),
    },
  },
}))

// Real snowflakes exceed Number.MAX_SAFE_INTEGER, so they are string literals
// here (a numeric literal would also trip eslint's no-loss-of-precision).
const SNOWFLAKE = '123456789012345678'

const LINKED: DiscordLinkLookupResponse = {
  identity: {
    discordUserId: SNOWFLAKE,
    username: 'alice',
    displayName: 'Alice',
  },
  user: {
    userId: 'user-1',
    email: 'alice@example.com',
    name: 'Alice Example',
  },
}

const UNLINKED: DiscordLinkLookupResponse = { identity: null, user: null }

/** Lets the fire-and-forget registration's .catch() handler run. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('DiscordLinkService', () => {
  const mockAuthClient = AuthClient.dockerInstance as unknown as {
    getDiscordLink: jest.Mock
    registerDiscordIdentity: jest.Mock
  }
  let service: DiscordLinkService

  beforeEach(() => {
    service = new DiscordLinkService()
    jest.useFakeTimers()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  describe('resolveDiscordUser', () => {
    it('calls AuthClient.getDiscordLink() by snowflake on a cold cache', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)

      await expect(service.resolveDiscordUser(SNOWFLAKE)).resolves.toEqual(
        LINKED,
      )
      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledWith({
        discordUserId: SNOWFLAKE,
      })
    })

    it('serves a repeat call within the TTL from cache', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)

      await service.resolveDiscordUser(SNOWFLAKE)
      await service.resolveDiscordUser(SNOWFLAKE)

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(1)
    })

    it('re-looks-up after the TTL elapses', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)

      await service.resolveDiscordUser(SNOWFLAKE)
      jest.advanceTimersByTime(60_001)
      await service.resolveDiscordUser(SNOWFLAKE)

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(2)
    })

    it('returns an observed-but-unlinked identity with a null user', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue({
        identity: LINKED.identity,
        user: null,
      })

      await expect(service.resolveDiscordUser(SNOWFLAKE)).resolves.toEqual({
        identity: LINKED.identity,
        user: null,
      })
    })
  })

  describe('getLinkedDiscordUserId', () => {
    it('looks the link up by lilnas user id and returns the snowflake', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)

      await expect(service.getLinkedDiscordUserId('user-1')).resolves.toBe(
        SNOWFLAKE,
      )
      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledWith({
        userId: 'user-1',
      })
    })

    it('resolves to null when the user has no linked Discord account', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      await expect(service.getLinkedDiscordUserId('user-2')).resolves.toBeNull()
    })

    it('does not share a cache entry with the snowflake keyspace', async () => {
      // A lilnas user id and a snowflake are both opaque strings; an
      // unprefixed key would let one answer the other's question.
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      await service.resolveDiscordUser('shared-id')
      await service.getLinkedDiscordUserId('shared-id')

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(2)
      expect(mockAuthClient.getDiscordLink).toHaveBeenNthCalledWith(1, {
        discordUserId: 'shared-id',
      })
      expect(mockAuthClient.getDiscordLink).toHaveBeenNthCalledWith(2, {
        userId: 'shared-id',
      })
    })
  })

  describe('getLinkedDiscordUserIdByEmail', () => {
    it('looks the link up by email and returns the snowflake', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)

      await expect(
        service.getLinkedDiscordUserIdByEmail('alice@example.com'),
      ).resolves.toBe(SNOWFLAKE)
      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledWith({
        email: 'alice@example.com',
      })
    })

    it('resolves to null when the email has no linked Discord account', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      await expect(
        service.getLinkedDiscordUserIdByEmail('nobody@example.com'),
      ).resolves.toBeNull()
    })

    // The cache key is normalized, the wire value is not: auth owns the
    // matching rule (it is case-insensitive there), this only stops two
    // casings of one address from occupying two entries.
    it('shares one cache entry across casings and surrounding whitespace', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)

      await service.resolveEmail('Alice@Example.com')
      await service.resolveEmail('  alice@example.com  ')

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(1)
    })

    it('sends the email to auth unnormalized', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)

      await service.resolveEmail('Alice@Example.com')

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledWith({
        email: 'Alice@Example.com',
      })
    })

    it('does not share a cache entry with the user-id or snowflake keyspaces', async () => {
      // All three keyspaces are opaque strings; an unprefixed key would let
      // one answer another's question.
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      await service.resolveDiscordUser('shared-id')
      await service.resolveLilnasUser('shared-id')
      await service.resolveEmail('shared-id')

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(3)
      expect(mockAuthClient.getDiscordLink).toHaveBeenNthCalledWith(3, {
        email: 'shared-id',
      })
    })

    it('caches a null answer for the full TTL, like the other keyspaces', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      await service.getLinkedDiscordUserIdByEmail('alice@example.com')
      jest.advanceTimersByTime(10_001)
      await expect(
        service.getLinkedDiscordUserIdByEmail('alice@example.com'),
      ).resolves.toBeNull()

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(1)
    })

    // ⚠️ Fails open, like every other lookup here: "I could not ask" and
    // "there is no link" collapse to null on purpose, because the callers are
    // building a widening OR-arm onto a filter that is already correct
    // without it.
    it('resolves to null rather than rejecting when auth is unreachable', async () => {
      mockAuthClient.getDiscordLink.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(
        service.getLinkedDiscordUserIdByEmail('alice@example.com'),
      ).resolves.toBeNull()
      expect(Logger.prototype.warn).toHaveBeenCalled()
    })

    it('retries a thrown lookup after the short failure TTL', async () => {
      mockAuthClient.getDiscordLink.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.getLinkedDiscordUserIdByEmail('alice@example.com')
      jest.advanceTimersByTime(10_001)

      mockAuthClient.getDiscordLink.mockResolvedValue(LINKED)
      await expect(
        service.getLinkedDiscordUserIdByEmail('alice@example.com'),
      ).resolves.toBe(SNOWFLAKE)
    })
  })

  describe('negative caching', () => {
    it('caches a "not linked" answer for the FULL TTL, not the failure TTL', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      await service.resolveDiscordUser(SNOWFLAKE)
      // Well past the 10s failure TTL: a successful negative answer must not
      // be treated as a failure, or every unlinked requester re-hits auth.
      jest.advanceTimersByTime(10_001)
      await service.resolveDiscordUser(SNOWFLAKE)

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(1)

      jest.advanceTimersByTime(50_001)
      await service.resolveDiscordUser(SNOWFLAKE)

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(2)
    })

    it('caches a null reverse lookup for the full TTL too', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      await service.getLinkedDiscordUserId('user-3')
      jest.advanceTimersByTime(10_001)
      await expect(service.getLinkedDiscordUserId('user-3')).resolves.toBeNull()

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(1)
    })
  })

  describe('fail-open behavior', () => {
    it('resolves to an empty envelope (not a rejection) when the lookup rejects', async () => {
      mockAuthClient.getDiscordLink.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(service.resolveDiscordUser(SNOWFLAKE)).resolves.toEqual(
        UNLINKED,
      )
      expect(Logger.prototype.warn).toHaveBeenCalled()
    })

    it('degrades the reverse lookup to null rather than rejecting', async () => {
      mockAuthClient.getDiscordLink.mockRejectedValue(
        new Error('GET /internal/discord-link failed with 404 Not Found'),
      )

      await expect(service.getLinkedDiscordUserId('user-4')).resolves.toBeNull()
    })

    it('short-circuits repeat calls within the failure TTL without re-hitting auth', async () => {
      mockAuthClient.getDiscordLink.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.resolveDiscordUser(SNOWFLAKE)
      await service.resolveDiscordUser(SNOWFLAKE)

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(1)
    })

    it('retries after the (shorter) failure TTL elapses', async () => {
      mockAuthClient.getDiscordLink.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.resolveDiscordUser(SNOWFLAKE)
      jest.advanceTimersByTime(10_001)
      await service.resolveDiscordUser(SNOWFLAKE)

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(2)
    })

    it('does not poison the cache for a later, successful lookup', async () => {
      mockAuthClient.getDiscordLink.mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      )
      mockAuthClient.getDiscordLink.mockResolvedValueOnce(LINKED)

      await expect(service.resolveDiscordUser(SNOWFLAKE)).resolves.toEqual(
        UNLINKED,
      )
      jest.advanceTimersByTime(10_001)
      await expect(service.resolveDiscordUser(SNOWFLAKE)).resolves.toEqual(
        LINKED,
      )
    })
  })

  describe('registerObservedIdentity', () => {
    const identity = {
      discordUserId: SNOWFLAKE,
      username: 'alice',
      displayName: 'Alice',
    }

    it('reports the identity to auth and returns synchronously', () => {
      mockAuthClient.registerDiscordIdentity.mockResolvedValue(undefined)

      expect(service.registerObservedIdentity(identity)).toBeUndefined()
      expect(mockAuthClient.registerDiscordIdentity).toHaveBeenCalledWith(
        identity,
      )
    })

    it('swallows a rejected registration', async () => {
      mockAuthClient.registerDiscordIdentity.mockRejectedValue(
        new Error('POST /internal/discord-identity failed with 404 Not Found'),
      )

      expect(() => service.registerObservedIdentity(identity)).not.toThrow()
      await flushMicrotasks()

      expect(Logger.prototype.debug).toHaveBeenCalled()
    })

    it('swallows a synchronous throw out of the client', () => {
      mockAuthClient.registerDiscordIdentity.mockImplementation(() => {
        throw new Error('boom')
      })

      expect(() => service.registerObservedIdentity(identity)).not.toThrow()
    })

    it('sends nothing for a repeat identity inside the memo window', () => {
      mockAuthClient.registerDiscordIdentity.mockResolvedValue(undefined)

      service.registerObservedIdentity(identity)
      service.registerObservedIdentity(identity)
      service.registerObservedIdentity(identity)

      expect(mockAuthClient.registerDiscordIdentity).toHaveBeenCalledTimes(1)
    })

    it('reports again immediately when the handle changes (rename detection)', () => {
      mockAuthClient.registerDiscordIdentity.mockResolvedValue(undefined)

      service.registerObservedIdentity(identity)
      service.registerObservedIdentity({ ...identity, username: 'alice2' })

      expect(mockAuthClient.registerDiscordIdentity).toHaveBeenCalledTimes(2)
      expect(mockAuthClient.registerDiscordIdentity).toHaveBeenLastCalledWith({
        ...identity,
        username: 'alice2',
      })
    })

    it('does not report again for a display-name-only change inside the window', () => {
      // displayName is deliberately outside the memo key - it is free text
      // used only by auth's admin link picker.
      mockAuthClient.registerDiscordIdentity.mockResolvedValue(undefined)

      service.registerObservedIdentity(identity)
      service.registerObservedIdentity({ ...identity, displayName: 'Alicia' })

      expect(mockAuthClient.registerDiscordIdentity).toHaveBeenCalledTimes(1)
    })

    it('reports again once the memo expires', () => {
      mockAuthClient.registerDiscordIdentity.mockResolvedValue(undefined)

      service.registerObservedIdentity(identity)
      jest.advanceTimersByTime(60_001)
      service.registerObservedIdentity(identity)

      expect(mockAuthClient.registerDiscordIdentity).toHaveBeenCalledTimes(2)
    })

    it('retries on the failure TTL after a rejected registration', async () => {
      mockAuthClient.registerDiscordIdentity.mockRejectedValue(
        new Error('ECONNREFUSED'),
      )

      service.registerObservedIdentity(identity)
      await flushMicrotasks()
      jest.advanceTimersByTime(10_001)
      service.registerObservedIdentity(identity)

      expect(mockAuthClient.registerDiscordIdentity).toHaveBeenCalledTimes(2)
    })
  })

  describe('cache eviction', () => {
    it('evicts the oldest entry once the cache exceeds its max size', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)

      // Fill the cache to its cap with distinct snowflakes.
      for (let i = 0; i < 500; i++) {
        await service.resolveDiscordUser(
          `10000000000000${i.toString().padStart(4, '0')}`,
        )
      }
      mockAuthClient.getDiscordLink.mockClear()

      // One more distinct snowflake pushes the cache past its cap, evicting
      // the very first entry inserted.
      await service.resolveDiscordUser('100000000000000500')
      await service.resolveDiscordUser('100000000000000000')

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledWith({
        discordUserId: '100000000000000000',
      })
      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(2)
    })

    it('counts registration memos against the same budget', async () => {
      mockAuthClient.getDiscordLink.mockResolvedValue(UNLINKED)
      mockAuthClient.registerDiscordIdentity.mockResolvedValue(undefined)

      await service.resolveDiscordUser(SNOWFLAKE)
      for (let i = 0; i < 500; i++) {
        service.registerObservedIdentity({
          discordUserId: `20000000000000${i.toString().padStart(4, '0')}`,
          username: `user${i}`,
        })
      }
      mockAuthClient.getDiscordLink.mockClear()

      // The memos filled the shared map and pushed the link entry out.
      await service.resolveDiscordUser(SNOWFLAKE)

      expect(mockAuthClient.getDiscordLink).toHaveBeenCalledTimes(1)
    })
  })
})
