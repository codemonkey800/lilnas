import { AuthClient } from 'src/auth/client'

function mockFetchJson(body: unknown): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
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
        { headers: JSON_HEADERS },
      )
    })

    it('dockerInstance targets the internal docker hostname', async () => {
      const fetchSpy = mockFetchJson({ isAdmin: false })

      await AuthClient.dockerInstance.checkIsAdmin('alice@example.com')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://auth:8081/admin/check?email=alice%40example.com',
        { headers: JSON_HEADERS },
      )
    })
  })

  describe('checkIsAdmin', () => {
    it('URL-encodes the email and returns the parsed body', async () => {
      mockFetchJson({ isAdmin: true })

      const result = await AuthClient.localInstance.checkIsAdmin('a b@x.com')

      expect(result).toEqual({ isAdmin: true })
    })
  })
})
