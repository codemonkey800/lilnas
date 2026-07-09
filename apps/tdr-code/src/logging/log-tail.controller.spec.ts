import { BadRequestException } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'
import { Test } from '@nestjs/testing'
import { firstValueFrom, Observable, Subject, take, toArray } from 'rxjs'

import {
  LOG_TAIL_EVENT_TYPE,
  LOG_TAIL_KEEPALIVE_EVENT_TYPE,
} from 'src/logging/log-view.types'

import { LogTailController } from './log-tail.controller'
import type { LogTailEvent, WatchTailParams } from './log-tail.service'
import { LogTailService } from './log-tail.service'

describe('LogTailController (unit, mocked service)', () => {
  let controller: LogTailController
  let mockWatch: jest.Mock<
    ReturnType<LogTailService['watch']>,
    [WatchTailParams]
  >

  beforeEach(async () => {
    mockWatch = jest.fn()
    const moduleRef = await Test.createTestingModule({
      controllers: [LogTailController],
      providers: [{ provide: LogTailService, useValue: { watch: mockWatch } }],
    }).compile()
    controller = moduleRef.get(LogTailController)
  })

  // ───────────────────────────────────────────────────────────────────────
  // Route shape (constraint #1): a NestJS unit test can't directly assert
  // the composed HTTP path (that requires an app-level listen, which
  // logs.controller.spec.ts's own peers also don't do), but this asserts
  // the two decorator inputs whose composition IS the path: @Controller
  // ('logs') + @Sse('tail'). A regression here (e.g. someone "simplifying"
  // this to @Sse('logs/tail')) would double the prefix to /logs/logs/tail
  // and silently 404 the nginx location this endpoint needs (U13) — this
  // test exists specifically to catch that class of edit.
  // ───────────────────────────────────────────────────────────────────────
  it('is registered under the "logs" controller prefix with an own "tail" SSE path (composes to exactly /logs/tail, never /logs/logs/tail)', () => {
    const controllerPathMetadata = Reflect.getMetadata(
      PATH_METADATA,
      LogTailController,
    ) as unknown
    expect(controllerPathMetadata).toBe('logs')

    const ssePathMetadata = Reflect.getMetadata(
      PATH_METADATA,
      LogTailController.prototype.tail,
    ) as unknown
    expect(ssePathMetadata).toBe('tail')
  })

  // ───────────────────────────────────────────────────────────────────────
  // R17: an unknown stream is rejected by parseQuery/zod BEFORE the service
  // is ever called — no fs access can occur downstream of a rejected
  // request. Mirrors logs.controller.spec.ts's own identical-purpose test
  // for the sibling /logs/window route.
  // ───────────────────────────────────────────────────────────────────────
  describe('R17: stream allowlist enforcement', () => {
    it('rejects an unknown stream value with BadRequestException before calling the service', () => {
      expect(() =>
        controller.tail({ stream: '../../etc/passwd' }, undefined),
      ).toThrow(BadRequestException)
      expect(mockWatch).not.toHaveBeenCalled()
    })

    it('rejects a value outside the LogStream union (not path-traversal-shaped, still invalid)', () => {
      expect(() =>
        controller.tail({ stream: 'totally-bogus-stream' }, undefined),
      ).toThrow(BadRequestException)
      expect(mockWatch).not.toHaveBeenCalled()
    })

    it('rejects a missing stream query param', () => {
      expect(() =>
        controller.tail({} as Record<string, string>, undefined),
      ).toThrow(BadRequestException)
      expect(mockWatch).not.toHaveBeenCalled()
    })

    it('accepts every valid LogStream value and forwards it to the service', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      for (const stream of ['backend', 'frontend-server', 'frontend-browser']) {
        controller.tail({ stream }, undefined)
        expect(mockWatch).toHaveBeenCalledWith(
          expect.objectContaining({ stream }),
        )
      }
    })

    it('rejects a non-numeric `from` query value', () => {
      expect(() =>
        controller.tail({ stream: 'backend', from: 'not-a-number' }, undefined),
      ).toThrow(BadRequestException)
      expect(mockWatch).not.toHaveBeenCalled()
    })

    it('rejects a negative `from` query value', () => {
      expect(() =>
        controller.tail({ stream: 'backend', from: '-5' }, undefined),
      ).toThrow(BadRequestException)
      expect(mockWatch).not.toHaveBeenCalled()
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Constraint #2: resume-offset precedence. Last-Event-ID (header) wins
  // over ?from= (query) whenever both are present; ?from= is used on a bare
  // first connect; and neither present means "let the service pick its own
  // default" (undefined passed through, not a controller-invented offset).
  // ───────────────────────────────────────────────────────────────────────
  describe('resume-offset precedence', () => {
    it('with only ?from= present (first connect), forwards its numeric value as `from`', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      controller.tail({ stream: 'backend', from: '1234' }, undefined)
      expect(mockWatch).toHaveBeenCalledWith({ stream: 'backend', from: 1234 })
    })

    it('with only Last-Event-ID present (reconnect, no ?from= — EventSource cannot rewrite its own URL), forwards its numeric value as `from`', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      controller.tail({ stream: 'backend' }, '5678')
      expect(mockWatch).toHaveBeenCalledWith({ stream: 'backend', from: 5678 })
    })

    it('with BOTH present, Last-Event-ID (header) wins over ?from= (query)', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      controller.tail({ stream: 'backend', from: '111' }, '999')
      expect(mockWatch).toHaveBeenCalledWith({ stream: 'backend', from: 999 })
    })

    it('with neither present, forwards `from: undefined` (the service resolves its own current-EOF default)', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      controller.tail({ stream: 'backend' }, undefined)
      expect(mockWatch).toHaveBeenCalledWith({
        stream: 'backend',
        from: undefined,
      })
    })

    it('a malformed (non-numeric) Last-Event-ID header degrades to the ?from= query value rather than throwing', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      controller.tail({ stream: 'backend', from: '42' }, 'not-a-number')
      expect(mockWatch).toHaveBeenCalledWith({ stream: 'backend', from: 42 })
    })

    it('a malformed Last-Event-ID with no ?from= present degrades to undefined (current EOF), not a thrown error', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      controller.tail({ stream: 'backend' }, 'garbage')
      expect(mockWatch).toHaveBeenCalledWith({
        stream: 'backend',
        from: undefined,
      })
    })

    it('a negative Last-Event-ID header degrades to the ?from= fallback (never forwarded as-is)', () => {
      mockWatch.mockReturnValue(new Subject<LogTailEvent>().asObservable())
      controller.tail({ stream: 'backend', from: '7' }, '-1')
      expect(mockWatch).toHaveBeenCalledWith({ stream: 'backend', from: 7 })
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Constraint #4 + #13: MessageEvent mapping. A real append's `id` is the
  // byteOffset (never a bare counter); a keepalive carries no `id` at all
  // (see the controller's own header comment on why omitting it, not
  // reusing the last offset, is correct).
  // ───────────────────────────────────────────────────────────────────────
  describe('MessageEvent mapping', () => {
    it('maps an append event to a MessageEvent with id=byteOffset, the log-append type, and the message as data', async () => {
      const subject = new Subject<LogTailEvent>()
      mockWatch.mockReturnValue(subject.asObservable())

      const stream$ = controller.tail({ stream: 'backend' }, undefined)
      const resultPromise = firstValueFrom(stream$)

      subject.next({
        kind: 'append',
        message: { line: '{"msg":"hello"}', byteOffset: 42 },
      })

      const event = await resultPromise
      expect(event).toEqual({
        data: { line: '{"msg":"hello"}', byteOffset: 42 },
        id: '42',
        type: LOG_TAIL_EVENT_TYPE,
      })
    })

    it('maps a keepalive event to a MessageEvent with the keepalive type and NO id field', async () => {
      const subject = new Subject<LogTailEvent>()
      mockWatch.mockReturnValue(subject.asObservable())

      const stream$ = controller.tail({ stream: 'backend' }, undefined)
      const resultPromise = firstValueFrom(stream$)

      subject.next({ kind: 'keepalive' })

      const event = await resultPromise
      expect(event.type).toBe(LOG_TAIL_KEEPALIVE_EVENT_TYPE)
      expect(event.id).toBeUndefined()
    })

    it('a burst of multiple append events maps to that many distinct MessageEvents with monotonically increasing ids, not one combined emission', async () => {
      const subject = new Subject<LogTailEvent>()
      mockWatch.mockReturnValue(subject.asObservable())

      const stream$ = controller.tail({ stream: 'backend' }, undefined)
      const resultPromise = firstValueFrom(stream$.pipe(take(3), toArray()))

      subject.next({
        kind: 'append',
        message: { line: 'one', byteOffset: 10 },
      })
      subject.next({
        kind: 'append',
        message: { line: 'two', byteOffset: 20 },
      })
      subject.next({
        kind: 'append',
        message: { line: 'three', byteOffset: 30 },
      })

      const events = await resultPromise
      expect(events.map(e => e.id)).toEqual(['10', '20', '30'])
      expect(events.map(e => (e.data as { line: string }).line)).toEqual([
        'one',
        'two',
        'three',
      ])
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Teardown pass-through: the controller itself holds no independent
  // handle/timer state of its own (that all lives in LogTailService — see
  // log-tail.service.spec.ts's own dedicated leak suite), but this proves
  // the controller's map() pipe doesn't swallow or interfere with
  // unsubscription reaching the underlying service Observable.
  // ───────────────────────────────────────────────────────────────────────
  it('unsubscribing the returned Observable propagates to the underlying service Observable (no controller-level swallowing)', () => {
    let serviceUnsubscribed = false
    // A real Observable whose teardown function is the assertion itself —
    // rxjs's own map() operator (used by the controller's .pipe(map(...)))
    // is guaranteed to propagate unsubscription to its source, so this
    // proves the controller doesn't insert anything (e.g. a share()/
    // publish() that would change that) between the service's Observable
    // and what it returns.
    mockWatch.mockReturnValue(
      new Observable<LogTailEvent>(() => {
        return () => {
          serviceUnsubscribed = true
        }
      }),
    )

    const stream$ = controller.tail({ stream: 'backend' }, undefined)
    const sub = stream$.subscribe()
    sub.unsubscribe()

    expect(serviceUnsubscribed).toBe(true)
  })
})
