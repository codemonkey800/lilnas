import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { EmbyService } from 'src/emby/emby.service'

const EMBY_URL = 'http://emby:8096'
const EMBY_API_KEY = 'test-api-key'

/**
 * Builds the kind of Response `fetch` hands back. Uses the real global
 * Response rather than a hand-rolled stub so `ok`/`status`/`json()` behave
 * exactly as they do in production, including the JSON parse.
 */
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/** The arguments a given fetch call was made with, asserted to exist. */
function fetchCall(
  fetchSpy: jest.SpiedFunction<typeof fetch>,
  call: number,
): Parameters<typeof fetch> {
  const args = fetchSpy.mock.calls[call]

  if (!args) {
    throw new Error(`fetch was never called a ${call + 1}th time`)
  }

  return args
}

/** The URL a given fetch call was made against, parsed for assertions. */
function requestedUrl(
  fetchSpy: jest.SpiedFunction<typeof fetch>,
  call = 0,
): URL {
  const [input] = fetchCall(fetchSpy, call)
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

  return new URL(href)
}

/** The RequestInit a given fetch call was made with. */
function requestInit(
  fetchSpy: jest.SpiedFunction<typeof fetch>,
  call = 0,
): RequestInit {
  return fetchCall(fetchSpy, call)[1] ?? {}
}

describe('EmbyService', () => {
  let service: EmbyService
  let fetchSpy: jest.SpiedFunction<typeof fetch>
  let warnSpy: jest.SpiedFunction<Logger['warn']>
  let originalEnv: NodeJS.ProcessEnv

  async function createService(): Promise<EmbyService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmbyService],
    }).compile()

    return module.get<EmbyService>(EmbyService)
  }

  beforeEach(async () => {
    originalEnv = { ...process.env }
    process.env.EMBY_URL = EMBY_URL
    process.env.EMBY_API_KEY = EMBY_API_KEY

    fetchSpy = jest.spyOn(global, 'fetch')

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()

    service = await createService()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('fails loudly at construction when EMBY_URL is unset', async () => {
      jest.spyOn(console, 'error').mockImplementation()
      delete process.env.EMBY_URL

      await expect(createService()).rejects.toThrow('EMBY_URL not defined')
    })

    it('fails loudly at construction when EMBY_API_KEY is unset', async () => {
      jest.spyOn(console, 'error').mockImplementation()
      delete process.env.EMBY_API_KEY

      await expect(createService()).rejects.toThrow('EMBY_API_KEY not defined')
    })
  })

  describe('getUsers', () => {
    it('GETs /emby/Users with the api_key query param', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse([{ Id: 'user-1', Name: 'jeremy' }]),
      )

      const users = await service.getUsers()

      const url = requestedUrl(fetchSpy)
      expect(url.origin).toBe(EMBY_URL)
      expect(url.pathname).toBe('/emby/Users')
      expect(url.searchParams.get('api_key')).toBe(EMBY_API_KEY)
      expect(users).toEqual([{ Id: 'user-1', Name: 'jeremy' }])
    })

    it('does not double up the /emby prefix when EMBY_URL has a trailing slash', async () => {
      process.env.EMBY_URL = `${EMBY_URL}/`
      service = await createService()
      fetchSpy.mockResolvedValue(jsonResponse([]))

      await service.getUsers()

      expect(requestedUrl(fetchSpy).pathname).toBe('/emby/Users')
    })

    it('rejects a user entry that is missing the fields we depend on', async () => {
      fetchSpy.mockResolvedValue(jsonResponse([{ Id: 'user-1' }]))

      await expect(service.getUsers()).rejects.toThrow()
    })

    it('rejects an envelope where Emby returned an object instead of an array', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ Items: [{ Id: 'user-1', Name: 'jeremy' }] }),
      )

      await expect(service.getUsers()).rejects.toThrow()
    })
  })

  describe('getLibraryItems', () => {
    const items = [
      { Id: 'item-1', Name: 'Some Movie', Path: '/movies/some.mkv' },
    ]

    it('GETs /emby/Users/{userId}/Items with the movie+series query', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ Items: items, TotalRecordCount: 1 }),
      )

      const result = await service.getLibraryItems('user-1')

      const url = requestedUrl(fetchSpy)
      expect(url.origin).toBe(EMBY_URL)
      expect(url.pathname).toBe('/emby/Users/user-1/Items')
      expect(url.searchParams.get('IncludeItemTypes')).toBe('Movie,Series')
      expect(url.searchParams.get('Recursive')).toBe('true')
      expect(url.searchParams.get('Fields')).toBe('Path')
      expect(url.searchParams.get('api_key')).toBe(EMBY_API_KEY)
      expect(result).toEqual(items)
    })

    it('sends no Limit param - the endpoint is treated as unpaged', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ Items: items }))

      await service.getLibraryItems('user-1')

      expect(requestedUrl(fetchSpy).searchParams.has('Limit')).toBe(false)
    })

    it('URL-encodes a userId that needs it', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ Items: [] }))

      await service.getLibraryItems('weird/id?&=x')

      expect(requestedUrl(fetchSpy).pathname).toBe(
        `/emby/Users/${encodeURIComponent('weird/id?&=x')}/Items`,
      )
    })

    it('tolerates items that carry no Path (permission-gated field)', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ Items: [{ Id: 'item-1' }], TotalRecordCount: 1 }),
      )

      await expect(service.getLibraryItems('user-1')).resolves.toEqual([
        { Id: 'item-1' },
      ])
    })

    it('rejects an item that is missing Id', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ Items: [{ Name: 'Some Movie' }] }),
      )

      await expect(service.getLibraryItems('user-1')).rejects.toThrow()
    })

    it('rejects a body with no Items array at all', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ TotalRecordCount: 4 }))

      await expect(service.getLibraryItems('user-1')).rejects.toThrow()
    })

    it('warns that paging may be required when TotalRecordCount exceeds the items returned', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ Items: items, TotalRecordCount: 400 }),
      )

      await service.getLibraryItems('user-1')

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const message = String(warnSpy.mock.calls[0]?.[0])
      expect(message).toContain('1 of 400')
      expect(message).toContain('user-1')
      expect(message).toContain('StartIndex')
    })

    it('does not warn when TotalRecordCount matches the items returned', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ Items: items, TotalRecordCount: 1 }),
      )

      await service.getLibraryItems('user-1')

      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('does not warn when TotalRecordCount is absent', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ Items: items }))

      await service.getLibraryItems('user-1')

      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('getSystemInfo', () => {
    it('GETs /emby/System/Info with the api_key query param', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ Id: 'server-1' }))

      const info = await service.getSystemInfo()

      const url = requestedUrl(fetchSpy)
      expect(url.pathname).toBe('/emby/System/Info')
      expect(url.searchParams.get('api_key')).toBe(EMBY_API_KEY)
      expect(info).toEqual({ Id: 'server-1' })
    })

    it('rejects a body with no server Id', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ Version: '4.8.0.0' }))

      await expect(service.getSystemInfo()).rejects.toThrow()
    })
  })

  describe('failure propagation', () => {
    it('throws on a non-2xx response without leaking the api_key', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ error: 'nope' }, { status: 401, statusText: 'Unauth' }),
      )

      const error = await service.getSystemInfo().then(
        () => new Error('expected getSystemInfo() to reject'),
        (thrown: unknown) => thrown as Error,
      )

      expect(error.message).toBe('GET /emby/System/Info failed with 401 Unauth')
      expect(error.message).not.toContain(EMBY_API_KEY)
    })

    it('propagates a network/timeout error rather than mapping it to a sentinel', async () => {
      fetchSpy.mockRejectedValue(
        new DOMException('The operation was aborted.', 'TimeoutError'),
      )

      await expect(service.getUsers()).rejects.toThrow(
        'The operation was aborted.',
      )
    })
  })

  describe('timeout wiring', () => {
    it('passes a 10s AbortSignal.timeout to fetch', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
      fetchSpy.mockResolvedValue(jsonResponse({ Id: 'server-1' }))

      await service.getSystemInfo()

      const timeoutSignal = timeoutSpy.mock.results[0]?.value

      expect(timeoutSpy).toHaveBeenCalledWith(10_000)
      expect(timeoutSignal).toBeInstanceOf(AbortSignal)
      expect(requestInit(fetchSpy).signal).toBe(timeoutSignal)
    })
  })
})
