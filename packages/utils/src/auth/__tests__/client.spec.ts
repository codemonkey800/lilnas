import { AuthClient } from 'src/auth/client'

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
})
