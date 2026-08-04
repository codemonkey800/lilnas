import type { MessageEvent } from '@nestjs/common'
import type { Request } from 'express'
import { firstValueFrom, Observable, take, toArray } from 'rxjs'

import { NotifyBusService } from 'src/sse/notify-bus.service'
import { SseController } from 'src/sse/sse.controller'
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
  return { headers: { cookie } } as unknown as Request
}

// This suite tests the controller's FILTERING/topic-scoping logic directly
// (real SseController, real NotifyBusService, a stand-in AccessCacheService
// since session resolution itself is U5's own, already-tested concern) by
// subscribing to the returned Observable in-process, rather than driving a
// live HTTP SSE connection end to end. A true HTTP-level test would mostly
// re-prove that @nestjs/common's @Sse() decorator correctly pipes an
// Observable to a chunked response, which is framework behavior, not this
// controller's own logic — the filtering behavior below IS this controller's
// own logic and is what these tests actually exercise.
describe('SseController', () => {
  it('emits only keepalives when there is no session (no data leaks to an unauthenticated connection)', async () => {
    const notifyBus = new NotifyBusService()
    const controller = new SseController(notifyBus, fakeAccessCache(null))

    const stream = await controller.pending(
      fakeRequest(undefined),
      'swole.lilnas.io',
    )
    notifyBus.publishStatusChange('some-user', 'swole.lilnas.io')

    const events = await firstValueFrom(
      (stream as Observable<MessageEvent>).pipe(take(1), toArray()),
    )

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('keepalive')
  })

  it('emits only keepalives when no host query param is given', async () => {
    const notifyBus = new NotifyBusService()
    const controller = new SseController(
      notifyBus,
      fakeAccessCache({ userId: 'user_1', email: 'a@example.com' }),
    )

    const stream = await controller.pending(fakeRequest('cookie=x'), undefined)
    notifyBus.publishStatusChange('user_1', 'swole.lilnas.io')

    const events = await firstValueFrom(
      (stream as Observable<MessageEvent>).pipe(take(1), toArray()),
    )

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('keepalive')
  })

  it('covers R9/AE3: a signed-in subscriber receives a status-changed event for its own (userId, serviceHost) topic', async () => {
    const notifyBus = new NotifyBusService()
    const controller = new SseController(
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
    const controller = new SseController(
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
    const controller = new SseController(
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
    const controller = new SseController(
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
// pending() above, the method itself takes no request/query params and
// never calls AccessCacheService at all — there is no per-connection topic
// to derive, since every admin subscribes to the SAME flat ADMIN_TOPIC.
// Authorization is the class-level @UseGuards(AdminGuard) decorator, which
// — like every guard in this app, see admin.controller.spec.ts's own header
// comment — has no effect on a directly-constructed controller instance
// and is proven separately by admin.guard.spec.ts; this suite only covers
// admin()'s OWN filtering logic, exactly mirroring the pending() suite
// above (same cross-topic-isolation and monotonic-id techniques).
// admin() is synchronous (unlike pending()'s async signature — it has no
// session to resolve), so it is called directly, never awaited.
// ──────────────────────────────────────────────────────────────────────────────
describe('SseController.admin', () => {
  it('emits only keepalives with no publish at all', async () => {
    const notifyBus = new NotifyBusService()
    const controller = new SseController(notifyBus, fakeAccessCache(null))

    const stream = controller.admin()
    const events = await firstValueFrom(stream.pipe(take(1), toArray()))

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('keepalive')
  })

  it('emits an admin-changed event when publishAdminChange() fires', async () => {
    const notifyBus = new NotifyBusService()
    const controller = new SseController(notifyBus, fakeAccessCache(null))

    const stream = controller.admin()
    const received = firstValueFrom(stream.pipe(take(1)))
    notifyBus.publishAdminChange()

    const event = await received
    expect(event.type).toBe('admin-changed')
  })

  it('does not deliver a per-user status-changed signal (a DIFFERENT topic) to the admin channel', async () => {
    const notifyBus = new NotifyBusService()
    const controller = new SseController(notifyBus, fakeAccessCache(null))

    const stream = controller.admin()
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
    const controller = new SseController(notifyBus, fakeAccessCache(null))

    const stream = controller.admin()
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
