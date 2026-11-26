import http from 'node:http'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AdminGuard } from 'src/admin/admin.guard'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import { SseController } from 'src/sse/sse.controller'
import { SseStreamLimiter } from 'src/sse/sse-stream-limiter.service'
import { AccessCacheService } from 'src/verify/access-cache.service'

// Drives SseController through a real Nest app over real HTTP, like
// src/verify/__tests__/strip-cookie.controller.spec.ts: what a browser's
// EventSource actually gets back (status, content-type, whether the
// response ends) and whether a client hang-up frees its stream slot.

process.env.SSE_KEEPALIVE_MS = '20'
process.env.ADMIN_EMAILS = 'admin@example.com'
delete process.env.SSE_MAX_STREAMS_PER_USER

const SESSIONS: Record<string, { userId: string; email: string }> = {
  alice: { userId: 'alice', email: 'alice@example.com' },
  bob: { userId: 'bob', email: 'bob@example.com' },
  admin: { userId: 'admin_1', email: 'admin@example.com' },
}

// Stands in for AccessCacheService: the cookie `session=<name>` resolves
// to SESSIONS[name], anything else to no session.
const fakeAccessCache = {
  resolveSession: jest.fn(async (cookie: string | undefined) => {
    const name = cookie?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
    return (name && SESSIONS[name]) || null
  }),
}

type OpenStream = {
  status: number
  headers: http.IncomingHttpHeaders
  body: () => string
  ended: Promise<void>
  close: () => void
}

const openStreams: OpenStream[] = []

function open(
  port: number,
  path: string,
  session?: string,
): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path,
        agent: false,
        headers: session ? { cookie: `session=${session}` } : {},
      },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        const ended = new Promise<void>(done => {
          res.on('end', done)
          res.on('close', done)
        })
        const stream: OpenStream = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: () => body,
          ended,
          close: () => req.destroy(),
        }
        openStreams.push(stream)
        resolve(stream)
      },
    )
    req.on('error', err => {
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err)
    })
    req.end()
  })
}

async function waitUntil(
  check: () => boolean,
  what: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, 5))
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

const pendingPath = (host = 'swole.lilnas.io') =>
  `/sse/pending?host=${encodeURIComponent(host)}`

describe('SseController (real NestJS app, real HTTP)', () => {
  let app: INestApplication
  let port: number
  let limiter: SseStreamLimiter
  let notifyBus: NotifyBusService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SseController],
      providers: [
        NotifyBusService,
        SseStreamLimiter,
        AdminGuard,
        { provide: AccessCacheService, useValue: fakeAccessCache },
      ],
    }).compile()
    app = moduleRef.createNestApplication({ logger: false })
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected app to listen on a resolved TCP address')
    }
    port = address.port
    limiter = app.get(SseStreamLimiter)
    notifyBus = app.get(NotifyBusService)
  })

  afterEach(async () => {
    for (const stream of openStreams.splice(0)) stream.close()
    await waitUntil(() => limiter.trackedUsers() === 0, 'all slots released')
  })

  afterAll(async () => {
    await app.close()
  })

  describe('/sse/pending', () => {
    it('answers 401 JSON with no session, ends the response and takes no slot', async () => {
      const res = await open(port, pendingPath())
      await res.ended

      expect(res.status).toBe(401)
      expect(res.headers['content-type']).not.toMatch(/text\/event-stream/)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(JSON.parse(res.body())).toMatchObject({ statusCode: 401 })
      expect(limiter.trackedUsers()).toBe(0)
    })

    it('streams keepalives, and a status-changed event only for its own user and host', async () => {
      const res = await open(port, pendingPath('swole.lilnas.io'), 'alice')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/event-stream/)
      await waitUntil(
        () => res.body().includes('event: keepalive'),
        'a keepalive',
      )
      expect(limiter.openStreams('alice')).toBe(1)

      notifyBus.publishStatusChange('bob', 'swole.lilnas.io')
      notifyBus.publishStatusChange('alice', 'other.lilnas.io')
      notifyBus.publishStatusChange('alice', 'swole.lilnas.io')
      await waitUntil(
        () => res.body().includes('event: status-changed'),
        'a status-changed event',
      )
      // Let a few more keepalives through so a stray event would show.
      const seen = count(res.body(), 'event: keepalive')
      await waitUntil(
        () => count(res.body(), 'event: keepalive') >= seen + 2,
        'more keepalives',
      )

      expect(count(res.body(), 'event: status-changed')).toBe(1)
    })

    it.each(['/sse/pending', '/sse/pending?host=', '/sse/pending?host=%20%20'])(
      'answers 400 for a session with no host (%s)',
      async path => {
        const res = await open(port, path, 'alice')
        await res.ended

        expect(res.status).toBe(400)
        expect(res.headers['content-type']).not.toMatch(/text\/event-stream/)
        expect(limiter.openStreams('alice')).toBe(0)
      },
    )

    it('answers 429 to a seventh stream for one user, while another user still gets 200', async () => {
      for (let i = 0; i < 6; i++) {
        expect((await open(port, pendingPath(), 'alice')).status).toBe(200)
      }
      expect(limiter.openStreams('alice')).toBe(6)

      const seventh = await open(port, pendingPath(), 'alice')
      await seventh.ended
      expect(seventh.status).toBe(429)
      expect(seventh.headers['content-type']).not.toMatch(/text\/event-stream/)
      expect(JSON.parse(seventh.body())).toMatchObject({
        statusCode: 429,
        message: 'Too many open streams',
      })
      expect(limiter.openStreams('alice')).toBe(6)

      expect((await open(port, pendingPath(), 'bob')).status).toBe(200)
    })

    it('frees a slot when the client closes one of the six streams', async () => {
      const streams: OpenStream[] = []
      for (let i = 0; i < 6; i++) {
        streams.push(await open(port, pendingPath(), 'alice'))
      }
      expect((await open(port, pendingPath(), 'alice')).status).toBe(429)

      streams[0]?.close()
      await waitUntil(
        () => limiter.openStreams('alice') === 5,
        'openStreams to drop to 5',
      )

      expect((await open(port, pendingPath(), 'alice')).status).toBe(200)
      expect(limiter.openStreams('alice')).toBe(6)
    })

    it('releases once when both the teardown and the close event fire (never below zero)', async () => {
      const first = await open(port, pendingPath(), 'alice')
      const second = await open(port, pendingPath(), 'alice')
      await waitUntil(
        () => second.body().includes('event: keepalive'),
        'the second stream to be subscribed',
      )
      expect(limiter.openStreams('alice')).toBe(2)

      first.close()
      await waitUntil(() => limiter.openStreams('alice') === 1, 'one release')
      // Both release paths have had time to run; a double release would
      // have taken the other stream's slot too.
      await new Promise(r => setTimeout(r, 100))
      expect(limiter.openStreams('alice')).toBe(1)

      second.close()
      await waitUntil(() => limiter.trackedUsers() === 0, 'entry removed')
      expect(limiter.openStreams('alice')).toBe(0)
    })
  })

  describe('/sse/admin', () => {
    it('answers 401 with no session', async () => {
      const res = await open(port, '/sse/admin')
      await res.ended

      expect(res.status).toBe(401)
      expect(res.headers['content-type']).not.toMatch(/text\/event-stream/)
      expect(limiter.trackedUsers()).toBe(0)
    })

    it('answers 403 for a signed-in non-admin', async () => {
      const res = await open(port, '/sse/admin', 'bob')
      await res.ended

      expect(res.status).toBe(403)
      expect(limiter.trackedUsers()).toBe(0)
    })

    it('streams to an admin, with admin-changed events', async () => {
      const res = await open(port, '/sse/admin', 'admin')

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/event-stream/)
      await waitUntil(
        () => res.body().includes('event: keepalive'),
        'a keepalive',
      )
      notifyBus.publishAdminChange()
      await waitUntil(
        () => res.body().includes('event: admin-changed'),
        'an admin-changed event',
      )
      expect(limiter.openStreams('admin_1')).toBe(1)
    })

    it('counts admin streams toward the same cap as pending streams', async () => {
      for (let i = 0; i < 3; i++) {
        expect((await open(port, '/sse/admin', 'admin')).status).toBe(200)
        expect((await open(port, pendingPath(), 'admin')).status).toBe(200)
      }
      expect(limiter.openStreams('admin_1')).toBe(6)

      const admin7 = await open(port, '/sse/admin', 'admin')
      await admin7.ended
      expect(admin7.status).toBe(429)

      const pending7 = await open(port, pendingPath(), 'admin')
      await pending7.ended
      expect(pending7.status).toBe(429)
      expect(limiter.openStreams('admin_1')).toBe(6)
    })
  })
})
