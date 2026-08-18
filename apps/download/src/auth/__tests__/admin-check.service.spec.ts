import { AuthClient } from '@lilnas/utils/auth/client'
import { Logger } from '@nestjs/common'

import { AdminCheckService } from 'src/auth/admin-check.service'

jest.mock('@lilnas/utils/auth/client', () => ({
  AuthClient: { dockerInstance: { checkIsAdmin: jest.fn() } },
}))

describe('AdminCheckService', () => {
  const mockAuthClient = AuthClient.dockerInstance as unknown as {
    checkIsAdmin: jest.Mock
  }
  let service: AdminCheckService

  beforeEach(() => {
    service = new AdminCheckService()
    jest.useFakeTimers()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('calls AuthClient.checkIsAdmin() on a cold cache', async () => {
    mockAuthClient.checkIsAdmin.mockResolvedValue({ isAdmin: true })

    await expect(service.checkIsAdmin('alice@example.com')).resolves.toBe(true)
    expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledWith(
      'alice@example.com',
    )
  })

  it('serves a repeat call within the TTL from cache', async () => {
    mockAuthClient.checkIsAdmin.mockResolvedValue({ isAdmin: false })

    await service.checkIsAdmin('bob@example.com')
    await service.checkIsAdmin('bob@example.com')

    expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledTimes(1)
  })

  it('re-checks after the TTL elapses', async () => {
    mockAuthClient.checkIsAdmin.mockResolvedValue({ isAdmin: false })

    await service.checkIsAdmin('carol@example.com')
    jest.advanceTimersByTime(60_001)
    await service.checkIsAdmin('carol@example.com')

    expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledTimes(2)
  })

  it('normalizes email casing/whitespace to one cache key', async () => {
    mockAuthClient.checkIsAdmin.mockResolvedValue({ isAdmin: true })

    await service.checkIsAdmin('  Dave@Example.com ')
    await service.checkIsAdmin('dave@example.com')

    expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledTimes(1)
  })

  describe('fail-closed behavior', () => {
    it('resolves to false (not a rejection) when the auth client call rejects', async () => {
      mockAuthClient.checkIsAdmin.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(service.checkIsAdmin('erin@example.com')).resolves.toBe(
        false,
      )
    })

    it('short-circuits repeat calls within the failure TTL without re-hitting auth', async () => {
      mockAuthClient.checkIsAdmin.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.checkIsAdmin('frank@example.com')
      await service.checkIsAdmin('frank@example.com')

      expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledTimes(1)
    })

    it('retries after the (shorter) failure TTL elapses', async () => {
      mockAuthClient.checkIsAdmin.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.checkIsAdmin('grace@example.com')
      jest.advanceTimersByTime(10_001)
      await service.checkIsAdmin('grace@example.com')

      expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledTimes(2)
    })

    it('does not poison the cache for a later, successful check of the same email', async () => {
      mockAuthClient.checkIsAdmin.mockRejectedValueOnce(
        new Error('ECONNREFUSED'),
      )
      mockAuthClient.checkIsAdmin.mockResolvedValueOnce({ isAdmin: true })

      await expect(service.checkIsAdmin('heidi@example.com')).resolves.toBe(
        false,
      )
      jest.advanceTimersByTime(10_001)
      await expect(service.checkIsAdmin('heidi@example.com')).resolves.toBe(
        true,
      )
    })
  })

  describe('cache eviction', () => {
    it('evicts the oldest entry once the cache exceeds its max size', async () => {
      mockAuthClient.checkIsAdmin.mockResolvedValue({ isAdmin: false })

      // Fill the cache to its cap with distinct emails.
      for (let i = 0; i < 500; i++) {
        await service.checkIsAdmin(`user${i}@example.com`)
      }
      mockAuthClient.checkIsAdmin.mockClear()

      // One more distinct email pushes the cache past its cap, evicting the
      // very first entry inserted (user0@example.com).
      await service.checkIsAdmin('user500@example.com')
      await service.checkIsAdmin('user0@example.com')

      // The evicted entry must be re-fetched rather than served from cache.
      expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledWith(
        'user0@example.com',
      )
      expect(mockAuthClient.checkIsAdmin).toHaveBeenCalledTimes(2)
    })
  })
})
