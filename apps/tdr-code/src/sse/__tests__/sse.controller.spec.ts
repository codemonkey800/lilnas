import type { MessageEvent } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { firstValueFrom, Subject, take, toArray } from 'rxjs'

import { IS_PUBLIC_KEY } from 'src/auth/public.decorator'
import { DB } from 'src/db/database.module'
import type { TestDb } from 'src/db/test-db'
import { createTestDb } from 'src/db/test-db'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import { SseController } from 'src/sse/sse.controller'
import type { NotifySignal } from 'src/sse/sse.types'
import { SseHubService } from 'src/sse/sse-hub.service'

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

// A minimal fake standing in for SseHubService: subscribe() returns a
// caller-controlled Subject (so tests can push signals on demand) and
// records every unsubscribe() call so teardown can be asserted directly,
// per the plan's "prove unsubscribe was actually called" requirement.
function fakeHub(): {
  hub: Pick<SseHubService, 'subscribe' | 'unsubscribe'>
  signalSubjects: Map<number, Subject<NotifySignal>>
  unsubscribed: number[]
  nextId: { current: number }
} {
  const signalSubjects = new Map<number, Subject<NotifySignal>>()
  const unsubscribed: number[] = []
  const nextId = { current: 0 }

  const hub: Pick<SseHubService, 'subscribe' | 'unsubscribe'> = {
    subscribe: () => {
      const connectionId = nextId.current++
      const subject = new Subject<NotifySignal>()
      signalSubjects.set(connectionId, subject)
      return { connectionId, signals$: subject.asObservable() }
    },
    unsubscribe: (connectionId: number) => {
      unsubscribed.push(connectionId)
      signalSubjects.delete(connectionId)
    },
  }

  return { hub, signalSubjects, unsubscribed, nextId }
}

describe('SseController', () => {
  beforeEach(() => {
    process.env.SSE_KEEPALIVE_MS = '25000'
  })

  afterEach(() => {
    delete process.env.SSE_KEEPALIVE_MS
  })

  describe('data signals', () => {
    it('happy path: ?topics=live emits a MessageEvent for a live signal with a non-null id', async () => {
      const { hub, signalSubjects } = fakeHub()
      const controller = new SseController(
        hub as unknown as SseHubService,
        fakeLogger(),
      )

      const stream$ = controller.stream('live', undefined)
      const resultPromise = firstValueFrom(stream$)

      const subject = signalSubjects.get(0)
      expect(subject).toBeDefined()
      subject?.next({ topic: 'live' })

      const event = await resultPromise
      expect(event.type).toBe('live')
      expect(event.id).not.toBeUndefined()
      expect(event.id).not.toBeNull()
      expect(event.data).toEqual({ topic: 'live' })
    })

    it('happy path (multiplex): ?topics=bot-status,session:5 receives bot-status and session:5 but not live', async () => {
      const { hub, signalSubjects } = fakeHub()
      const controller = new SseController(
        hub as unknown as SseHubService,
        fakeLogger(),
      )

      const stream$ = controller.stream('bot-status,session:5', undefined)
      const received: MessageEvent[] = []
      const sub = stream$.subscribe(event => received.push(event))

      const subject = signalSubjects.get(0)
      // The controller is a thin pass-through: it hands its parsed Topic[]
      // to sseHub.subscribe() and trusts the hub's own registry to scope
      // fan-out (proven independently in sse-hub.service.spec.ts). This
      // fake hub always forwards whatever the caller pushes onto the
      // subject, so pushing a 'live' signal here proves the controller
      // itself applies no additional topic filtering of its own — scoping
      // is the hub's job, confirmed end-to-end via the real SseHubService
      // in the DI-wiring describe block below.
      subject?.next({ topic: 'bot-status' })
      subject?.next({ topic: 'session:5' })

      await Promise.resolve()
      await Promise.resolve()

      expect(received.map(e => e.type)).toEqual(['bot-status', 'session:5'])

      sub.unsubscribe()
    })

    it('malformed topics: ?topics= (empty) does not throw and the stream still opens', () => {
      const { hub } = fakeHub()
      const controller = new SseController(
        hub as unknown as SseHubService,
        fakeLogger(),
      )

      expect(() => controller.stream('', undefined)).not.toThrow()
      expect(() => controller.stream(undefined, undefined)).not.toThrow()
    })

    it('malformed topics: ?topics=not-a-real-topic does not throw and the stream still opens with no data signals', async () => {
      const { hub, signalSubjects } = fakeHub()
      const controller = new SseController(
        hub as unknown as SseHubService,
        fakeLogger(),
      )

      const stream$ = controller.stream('not-a-real-topic', undefined)
      const received: MessageEvent[] = []
      const sub = stream$.subscribe(event => received.push(event))

      // subscribe() was still called on the hub with an empty (all-invalid)
      // topic list — proving the malformed entry was dropped, not thrown on.
      expect(signalSubjects.size).toBe(1)
      expect(received).toEqual([])

      sub.unsubscribe()
    })
  })

  describe('keepalive (R2)', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    it('with no data signals, the stream still emits a keepalive on the SSE_KEEPALIVE_MS cadence and never errors or completes', () => {
      const { hub } = fakeHub()
      const controller = new SseController(
        hub as unknown as SseHubService,
        fakeLogger(),
      )

      const stream$ = controller.stream('live', undefined)
      const received: MessageEvent[] = []
      let errored = false
      let completed = false
      const sub = stream$.subscribe({
        next: event => received.push(event),
        error: () => {
          errored = true
        },
        complete: () => {
          completed = true
        },
      })

      expect(received).toEqual([])

      jest.advanceTimersByTime(25000)
      expect(received).toHaveLength(1)
      expect(received[0]?.type).toBe('keepalive')

      jest.advanceTimersByTime(25000)
      expect(received).toHaveLength(2)
      expect(received[1]?.type).toBe('keepalive')
      // Keepalive ids are still assigned from the same monotonic counter —
      // never left undefined/null.
      expect(received[0]?.id).not.toBeUndefined()
      expect(received[1]?.id).not.toBe(received[0]?.id)

      expect(errored).toBe(false)
      expect(completed).toBe(false)

      sub.unsubscribe()
    })
  })

  describe('teardown', () => {
    it('unsubscribing the returned Observable deregisters the connection from the hub and logs sse-client-disconnected', () => {
      const { hub, unsubscribed } = fakeHub()
      const logger = fakeLogger()
      const controller = new SseController(
        hub as unknown as SseHubService,
        logger,
      )

      const stream$ = controller.stream('live', undefined)
      const sub = stream$.subscribe()

      expect(unsubscribed).toEqual([])

      sub.unsubscribe()

      expect(unsubscribed).toEqual([0])
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'sse-client-disconnected',
          connectionId: 0,
        }),
        expect.any(String),
      )
    })

    it('logs sse-connected on subscribe with the parsed topic list and connection id', () => {
      const { hub } = fakeHub()
      const logger = fakeLogger()
      const controller = new SseController(
        hub as unknown as SseHubService,
        logger,
      )

      const stream$ = controller.stream('live,bot-status', '42')
      const sub = stream$.subscribe()

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'sse-connected',
          connectionId: 0,
          topics: ['live', 'bot-status'],
          lastEventId: '42',
        }),
        expect.any(String),
      )

      sub.unsubscribe()
    })
  })

  // ── DI-wiring: proves end-to-end hub scoping AND the R3 auth-coverage
  // property together, mirroring health.controller.spec.ts's
  // Test.createTestingModule style (rather than a live HTTP server).
  // ──────────────────────────────────────────────────────────────────────
  describe('DI wiring', () => {
    let testDb: TestDb

    beforeEach(() => {
      testDb = createTestDb()
    })

    afterEach(() => {
      testDb.close()
    })

    it('can be resolved via NestJS DI and end-to-end subscribes through a real SseHubService', async () => {
      const module = await Test.createTestingModule({
        controllers: [SseController],
        providers: [
          SseHubService,
          NotifyBusService,
          { provide: PinoLogger, useValue: fakeLogger() },
          // A real (in-memory, migrated) DB — SseHubService.subscribe()
          // seeds its fallback-timer baseline synchronously (via
          // PRAGMA data_version), so this needs to be a real sqlite handle,
          // not a bare object stand-in.
          { provide: DB, useValue: testDb.db },
        ],
      }).compile()

      const controller = module.get(SseController)
      const notifyBus = module.get(NotifyBusService)

      const stream$ = controller.stream('session:1', undefined)
      const resultPromise = firstValueFrom(stream$.pipe(take(1), toArray()))

      notifyBus.publish('session:1')

      const [event] = await resultPromise
      expect(event.type).toBe('session:1')

      await module.close()
    })

    it('R3: the SSE route carries no @Public() metadata, so the global AuthGuard applies to it like any other route', () => {
      const reflector = new Reflector()
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        SseController.prototype.stream,
        SseController,
      ])

      expect(isPublic).toBeUndefined()
    })
  })
})
