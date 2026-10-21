import http from 'http'
import { AddressInfo } from 'net'

import { HostActivityService } from 'src/activity/host-activity.service'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void

const activity = {
  host: 'download.dev.lilnas.io',
  windowHours: 2,
  activeUsers: 1,
  lastVisitAt: '2026-10-19T10:00:00.000Z',
}

describe('HostActivityService', () => {
  let server: http.Server
  let handler: Handler
  let requests: string[]
  let originalAuthUrl: string | undefined

  beforeEach(async () => {
    requests = []
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(activity))
    }
    server = http.createServer((req, res) => {
      requests.push(req.url ?? '')
      handler(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    originalAuthUrl = process.env.AUTH_URL
    process.env.AUTH_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    if (originalAuthUrl === undefined) delete process.env.AUTH_URL
    else process.env.AUTH_URL = originalAuthUrl
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  it('returns the body of a 200 and sends host and hours', async () => {
    const result = await new HostActivityService().get(
      'download.dev.lilnas.io',
      2,
    )

    expect(result).toEqual(activity)
    expect(requests).toEqual([
      '/internal/host-activity?host=download.dev.lilnas.io&hours=2',
    ])
  })

  it('accepts a null lastVisitAt', async () => {
    const body = { ...activity, activeUsers: 0, lastVisitAt: null }
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    expect(await new HostActivityService().get('h', 2)).toEqual(body)
  })

  it.each([404, 500])('returns null on a %i', async status => {
    handler = (_req, res) => {
      res.writeHead(status)
      res.end('nope')
    }

    expect(await new HostActivityService().get('h', 2)).toBeNull()
  })

  it('returns null on malformed JSON', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{not json')
    }

    expect(await new HostActivityService().get('h', 2)).toBeNull()
  })

  it('returns null on a body of the wrong shape', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ host: 'h', activeUsers: 'many' }))
    }

    expect(await new HostActivityService().get('h', 2)).toBeNull()
  })

  it('returns null when the server is unreachable', async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))

    expect(await new HostActivityService().get('h', 2)).toBeNull()

    // afterEach closes the server again; reopen so that close succeeds.
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  })

  it('returns null within the timeout when the server hangs', async () => {
    handler = (_req, res) => {
      setTimeout(() => res.end(JSON.stringify(activity)), 4000).unref()
    }

    const start = Date.now()
    const result = await new HostActivityService().get('h', 2)

    expect(result).toBeNull()
    expect(Date.now() - start).toBeLessThan(3800)
  })

  it('serves a second call from the cache', async () => {
    const service = new HostActivityService()

    await service.get('h', 2)
    await service.get('h', 2)
    expect(requests).toHaveLength(1)

    await service.get('h', 6)
    await service.get('other', 2)
    expect(requests).toHaveLength(3)
  })

  it('expires cache entries after 30 seconds', async () => {
    const now = jest.spyOn(Date, 'now')
    const service = new HostActivityService()

    now.mockReturnValue(1_000_000)
    await service.get('h', 2)
    now.mockReturnValue(1_029_000)
    await service.get('h', 2)
    expect(requests).toHaveLength(1)

    now.mockReturnValue(1_031_000)
    await service.get('h', 2)
    expect(requests).toHaveLength(2)
  })

  it('does not cache failures', async () => {
    const service = new HostActivityService()
    handler = (_req, res) => {
      res.writeHead(500)
      res.end()
    }
    expect(await service.get('h', 2)).toBeNull()

    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(activity))
    }
    expect(await service.get('h', 2)).toEqual(activity)
    expect(requests).toHaveLength(2)
  })
})
