import { EventEmitter } from 'node:events'

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  type MessageEvent,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request } from 'express'
import { firstValueFrom, Observable, take, toArray } from 'rxjs'

import { NotifyBusService } from 'src/sse/notify-bus.service'
import { SseController } from 'src/sse/sse.controller'
import { SseStreamLimiter } from 'src/sse/sse-stream-limiter.service'
import type { AccessCacheService } from 'src/verify/access-cache.service'

process.env.SSE_KEEPALIVE_MS = '50'

function fakeAccessCache(
  session: { userId: string; email: string } | null,
): AccessCacheService {
  return {
    resolveSession: jest.fn().mockResolvedValue(session),
    isBlocked: jest.fn().mockReturnValue(false),
    hasGrant: jest.fn().mockReturnValue(false),
  } as unknown as AccessCacheService
}

function fakeRequest(cookie?: string): Request {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string | undefined>
    socket: { destroyed: boolean }
  }
  req.headers = { cookie }
  req.socket = { destroyed: false }
  return req as unknown as Request
}

function makeController(
  notifyBus: NotifyBusService,
  accessCache: AccessCacheService,
  limiter = new SseStreamLimiter(),
): SseController {
  return new SseController(notifyBus, accessCache, limiter)
}

// This suite tests the controller's own logic directly (real SseController,
// real NotifyBusService, real SseStreamLimiter, a stand-in
// AccessCacheService since session resolution itself is U5's own,
// already-tested concern) by calling the handlers and subscribing to the
// returned Observable in-process: the rejections, slot accounting and
// topic filtering. What the client actually sees over HTTP (status codes,
// content-type, the stream ending, a client hang-up freeing a slot) is
// covered by sse.http.spec.ts against a real Nest app.
describe('SseController', () => {
  it('rejects a request with no session before any stream starts, taking no slot', async () => {
    const notifyBus = new NotifyBusService()
    const limiter = new SseStreamLimiter()
    const controller = makeController(notifyBus, fakeAccessCache(null), limiter)

    await expect(
      controller.pending(fakeRequest(undefined), 'swole.lilnas.io'),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(limiter.trackedUsers()).toBe(0)
  })

  it.each([undefined, '', '   '])(
    'rejects a signed-in request with host %p as 400, taking no slot',
    async host => {
      const notifyBus = new NotifyBusService()
      const limiter = new SseStreamLimiter()
      const controller = makeController(
        notifyBus,
        fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
        limiter,
      )

      await expect(
        controller.pending(fakeRequest('cookie=x'), host),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(limiter.openStreams('user_1')).toBe(0)
    },
  )

  it('answers 429 at the cap', async () => {
    const notifyBus = new NotifyBusService()
    const limiter = new SseStreamLimiter()
    const controller = makeController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
      limiter,
    )
    for (let i = 0; i < limiter.cap; i++) {
      await controller.pending(fakeRequest('cookie=x'), 'swole.lilnas.io')
    }

    const caught = await controller
      .pending(fakeRequest('cookie=x'), 'swole.lilnas.io')
      .catch((err: unknown) => err)
    expect(caught).toBeInstanceOf(HttpException)
    expect((caught as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    )
    expect(limiter.openStreams('user_1')).toBe(limiter.cap)
  })

  it('releases the slot once when both the teardown and the request close fire', async () => {
    const notifyBus = new NotifyBusService()
    const limiter = new SseStreamLimiter()
    const controller = makeController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
      limiter,
    )
    const keep = fakeRequest('cookie=x')
    await controller.pending(keep, 'swole.lilnas.io')
    const req = fakeRequest('cookie=x')
    const stream = await controller.pending(req, 'swole.lilnas.io')
    expect(limiter.openStreams('user_1')).toBe(2)

    stream.subscribe().unsubscribe()
    req.emit('close')
    req.emit('close')

    expect(limiter.openStreams('user_1')).toBe(1)
  })

  it('releases the slot on request close even if the stream is never subscribed', async () => {
    const notifyBus = new NotifyBusService()
    const limiter = new SseStreamLimiter()
    const controller = makeController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
      limiter,
    )
    const req = fakeRequest('cookie=x')
    await controller.pending(req, 'swole.lilnas.io')
    expect(limiter.openStreams('user_1')).toBe(1)

    req.emit('close')
    expect(limiter.openStreams('user_1')).toBe(0)
    expect(limiter.trackedUsers()).toBe(0)
  })

  it('covers R9/AE3: a signed-in subscriber receives a status-changed event for its own (userId, serviceHost) topic', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
    )

    const stream = (await controller.pending(
      fakeRequest('cookie=x'),
      'swole.lilnas.io',
    )) as Observable<MessageEvent>

    const received = firstValueFrom(stream.pipe(take(1)))
    notifyBus.publishStatusChange('user_1', 'swole.lilnas.io')

    const event = await received
    expect(event.type).toBe('status-changed')
  })

  it('does not deliver a signal published for a DIFFERENT user on the same host', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
    )

    const stream = (await controller.pending(
      fakeRequest('cookie=x'),
      'swole.lilnas.io',
    )) as Observable<MessageEvent>

    // Publishes ONLY the non-matching signal — a prior version of this test
    // also published a matching one afterward and asserted the received
    // event was 'status-changed', which cannot distinguish "the wrong signal
    // was filtered" from "no filtering happened at all" (both publishes
    // produce an identically-shaped event). Asserting the FIRST emission is
    // a 'keepalive' (the 50ms timer set at module scope above) is the only
    // version of this assertion that actually fails if the topic filter()
    // were ever deleted — in that case the non-matching publish below would
    // reach this subscriber immediately, as 'status-changed', well before
    // the keepalive timer could fire.
    const eventPromise = firstValueFrom(stream.pipe(take(1)))
    notifyBus.publishStatusChange('some-other-user', 'swole.lilnas.io')

    const event = await eventPromise
    expect(event.type).toBe('keepalive')
  })

  it('does not deliver a signal published for a DIFFERENT service host for the same user', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
    )

    const stream = (await controller.pending(
      fakeRequest('cookie=x'),
      'swole.lilnas.io',
    )) as Observable<MessageEvent>

    // Same technique and rationale as the previous test — see its own
    // comment.
    const eventPromise = firstValueFrom(stream.pipe(take(1)))
    notifyBus.publishStatusChange('user_1', 'other-service.lilnas.io')

    const event = await eventPromise
    expect(event.type).toBe('keepalive')
  })

  it('assigns monotonic ids across keepalive and data events on one connection, never NaN', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
    )

    const stream = (await controller.pending(
      fakeRequest('cookie=x'),
      'swole.lilnas.io',
    )) as Observable<MessageEvent>

    const eventsPromise = firstValueFrom(stream.pipe(take(2), toArray()))
    notifyBus.publishStatusChange('user_1', 'swole.lilnas.io')
    // The keepalive timer (50ms, set at module scope above) supplies the
    // second event without a second publish.
    const events = await eventsPromise

    const ids = events.map(e => Number(e.id))
    expect(ids.every(id => Number.isInteger(id))).toBe(true)
    expect(ids[1]).toBeGreaterThan(ids[0] ?? -1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// admin() — the admin dashboard's own live channel, GET /sse/admin. Unlike
// pending() above there is no per-connection topic to derive, since every
// admin subscribes to the SAME flat ADMIN_TOPIC; the method resolves the
// session only for the userId the stream cap counts against.
// Authorization is the class-level @UseGuards(AdminGuard) decorator, which
// — like every guard in this app, see admin.controller.spec.ts's own header
// comment — has no effect on a directly-constructed controller instance
// and is proven separately by admin.guard.spec.ts; this suite only covers
// admin()'s OWN filtering logic, exactly mirroring the pending() suite
// above (same cross-topic-isolation and monotonic-id techniques).
// The cap and the 401/403 answers over real HTTP are covered by
// sse.http.spec.ts.
// ──────────────────────────────────────────────────────────────────────────────
function fakeAdminAccessCache(): AccessCacheService {
  return fakeAccessCache({ userId: 'admin_1', email: 'admin@example.com' })
}

describe('SseController.admin', () => {
  it('emits only keepalives with no publish at all', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(notifyBus, fakeAdminAccessCache())

    const stream = await controller.admin(fakeRequest('cookie=x'))
    const events = await firstValueFrom(stream.pipe(take(1), toArray()))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('keepalive')
  })

  it('emits an admin-changed event when publishAdminChange() fires', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(notifyBus, fakeAdminAccessCache())

    const stream = await controller.admin(fakeRequest('cookie=x'))
    const received = firstValueFrom(stream.pipe(take(1)))
    notifyBus.publishAdminChange()

    const event = await received
    expect(event.type).toBe('admin-changed')
  })

  it('does not deliver a per-user status-changed signal (a DIFFERENT topic) to the admin channel', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(notifyBus, fakeAdminAccessCache())

    const stream = await controller.admin(fakeRequest('cookie=x'))
    // Same "assert the FIRST emission is a keepalive" technique as the
    // pending() suite's own cross-topic tests above — see those tests' own
    // comment for why this is the only version of the assertion that
    // actually fails if the topic filter() were ever deleted (a matching
    // publish afterward would be indistinguishable from no filtering at
    // all, since both produce an identically-shaped event).
    const eventPromise = firstValueFrom(stream.pipe(take(1)))
    notifyBus.publishStatusChange('some-user', 'swole.lilnas.io')

    const event = await eventPromise
    expect(event.type).toBe('keepalive')
  })

  it('assigns monotonic ids across keepalive and data events on one connection, never NaN', async () => {
    const notifyBus = new NotifyBusService()
    const controller = makeController(notifyBus, fakeAdminAccessCache())

    const stream = await controller.admin(fakeRequest('cookie=x'))
    const eventsPromise = firstValueFrom(stream.pipe(take(2), toArray()))
    notifyBus.publishAdminChange()
    // The keepalive timer (50ms, set at module scope above) supplies the
    // second event without a second publish.
    const events = await eventsPromise

    const ids = events.map(e => Number(e.id))
    expect(ids.every(id => Number.isInteger(id))).toBe(true)
    expect(ids[1]).toBeGreaterThan(ids[0] ?? -1)
  })
})
