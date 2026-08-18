import { AuthClient } from '@lilnas/utils/auth/client'

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
})
