import { PinoLogger } from 'nestjs-pino'

import { NotifyEmitterService } from 'src/discord/notify-emitter.service'
import type { Topic } from 'src/sse/sse.types'

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

// process.send is undefined outside a spawned-with-ipc child — every test
// that wants the "IPC connected" path stubs it in via installSend()/restore
// afterEach, mirroring how the production supervisor's spawn effect (U4)
// will actually attach it.
function installSend(): jest.Mock {
  const send = jest.fn().mockReturnValue(true)
  process.send = send as unknown as typeof process.send
  return send
}

describe('NotifyEmitterService (U3 — bot-side notify emitter)', () => {
  const originalSend = process.send

  afterEach(() => {
    process.send = originalSend
    jest.useRealTimers()
  })

  describe('Happy path', () => {
    it('notify(["session:1"]) sends exactly one process.send after the coalesce window', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      svc.notify(['session:1'])
      expect(send).not.toHaveBeenCalled()

      jest.advanceTimersByTime(50)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['session:1'],
      })
    })
  })

  describe('Coalesce (R7)', () => {
    it('five notify(["session:1"]) calls within the window produce exactly one send', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      // First call opens the window (fires at t=50 relative to itself).
      // The remaining four calls land at t=8,16,24,32 — all well inside the
      // still-open window — and are absorbed as no-ops (no new timer).
      svc.notify(['session:1'])
      for (let i = 0; i < 4; i++) {
        jest.advanceTimersByTime(8)
        svc.notify(['session:1'])
      }

      // t=32 so far — the window (opened at t=0, 50ms long) hasn't closed yet.
      expect(send).not.toHaveBeenCalled()

      jest.advanceTimersByTime(18) // t=50 relative to the first call
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['session:1'],
      })
    })

    // Coalesce shape (documented choice — see notify-emitter.service.ts's
    // header comment): ONE MESSAGE PER TOPIC, each with its own independent
    // coalescing window (a Map<Topic, Timer>). Distinct topics arriving in
    // the same tick therefore produce one send per topic, not one batched
    // message carrying all of them — this keeps a burst on one topic from
    // ever delaying or being conflated with a different topic's signal.
    it('distinct topics arriving together each get their own send (one message per topic, not one batched message)', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      svc.notify(['session:1', 'bot-status', 'live'])
      jest.advanceTimersByTime(50)

      expect(send).toHaveBeenCalledTimes(3)
      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['session:1'],
      })
      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['bot-status'],
      })
      expect(send).toHaveBeenCalledWith({ type: 'notify', topics: ['live'] })
    })

    it('a burst on one topic never delays a different topic waiting behind it', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      svc.notify(['session:1'])
      jest.advanceTimersByTime(20)
      svc.notify(['session:1']) // absorbed into the still-open window
      svc.notify(['bot-status']) // opens its OWN independent window at t=20

      jest.advanceTimersByTime(30) // t=50 relative to start — session:1 fires
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['session:1'],
      })

      jest.advanceTimersByTime(20) // t=50 relative to bot-status's own open
      expect(send).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['bot-status'],
      })
    })

    it('re-notifying the same topic after its window has closed opens a fresh window (not merged into the prior send)', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      svc.notify(['session:1'])
      jest.advanceTimersByTime(50)
      expect(send).toHaveBeenCalledTimes(1)

      svc.notify(['session:1'])
      jest.advanceTimersByTime(50)
      expect(send).toHaveBeenCalledTimes(2)
    })
  })

  describe('No-IPC guard (R14 / standalone / tests)', () => {
    it('notify() does not throw and sends nothing when process.send is undefined', () => {
      jest.useFakeTimers()
      process.send = undefined
      const svc = new NotifyEmitterService(makeLogger())

      expect(() => svc.notify(['session:1'])).not.toThrow()
      expect(() => jest.advanceTimersByTime(50)).not.toThrow()
    })

    it('logs notify-emit-skipped-no-ipc at debug when process.send is undefined', () => {
      jest.useFakeTimers()
      process.send = undefined
      const logger = makeLogger()
      const svc = new NotifyEmitterService(logger)

      svc.notify(['session:1'])
      jest.advanceTimersByTime(50)

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'notify-emit-skipped-no-ipc',
          topic: 'session:1',
        }),
        expect.any(String),
      )
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('Fire-and-forget failure handling', () => {
    it('a throwing process.send is swallowed — notify() itself never throws', () => {
      jest.useFakeTimers()
      process.send = jest.fn(() => {
        throw new Error('EPIPE: parent gone')
      }) as unknown as typeof process.send
      const logger = makeLogger()
      const svc = new NotifyEmitterService(logger)

      svc.notify(['session:1'])
      expect(() => jest.advanceTimersByTime(50)).not.toThrow()
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'session:1' }),
        expect.any(String),
      )
    })

    it('a process.send returning false (backpressure) is treated as fire-and-forget, no retry', () => {
      jest.useFakeTimers()
      const send = jest.fn().mockReturnValue(false)
      process.send = send as unknown as typeof process.send
      const svc = new NotifyEmitterService(makeLogger())

      svc.notify(['session:1'])
      jest.advanceTimersByTime(50)
      expect(send).toHaveBeenCalledTimes(1)

      // No further sends fire on their own — no retry loop.
      jest.advanceTimersByTime(1000)
      expect(send).toHaveBeenCalledTimes(1)
    })
  })

  describe('notify([]) — no topics', () => {
    it('is a no-op: no timers scheduled, nothing sent', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      svc.notify([])
      jest.advanceTimersByTime(1000)

      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('Coalesce window timer does not keep the process alive', () => {
    it('the scheduled timer is unref()d', () => {
      jest.useFakeTimers()
      const unrefSpy = jest.spyOn(global, 'setTimeout')
      installSend()
      const svc = new NotifyEmitterService(makeLogger())

      svc.notify(['session:1'])

      expect(unrefSpy).toHaveReturnedWith(
        expect.objectContaining({ unref: expect.any(Function) }),
      )
      unrefSpy.mockRestore()
    })
  })

  describe('Integration-style: chokepoint success vs. failure gating', () => {
    // These mirror the shape of composite-acp-handler.spec.ts's real
    // chokepoint tests, but exercised directly against NotifyEmitterService
    // to prove the emitter itself has no opinion on success/failure — the
    // conditioning (notify only after a writer call succeeds) lives at the
    // call site (see composite-acp-handler.spec.ts), not in this service.
    it('a caller that only calls notify() after its own try succeeds produces exactly one coalesced emit', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      // Simulates CompositeAcpHandler's onAgentMessageChunk-equivalent
      // chokepoint: writer succeeds, notify() is called with a topic.
      const topics: Topic[] = ['session:7']
      const simulateSuccessfulWrite = () => {
        svc.notify(topics)
      }
      const simulateFailedWrite = () => {
        try {
          throw new Error('writer fault')
        } catch {
          // caller's catch block — never reaches notify()
        }
      }

      simulateSuccessfulWrite()
      simulateFailedWrite()
      simulateSuccessfulWrite() // coalesces with the first within the window

      jest.advanceTimersByTime(50)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['session:7'],
      })
    })

    it('an update-bearing chokepoint (e.g. updateToolCallStatus-equivalent) still triggers a coalesced emit', () => {
      jest.useFakeTimers()
      const send = installSend()
      const svc = new NotifyEmitterService(makeLogger())

      // The notify layer treats an in-place UPDATE identically to an
      // INSERT — it only ever sees "this topic changed", never the write
      // shape. R5's coverage of update-bearing writes is proven at the
      // chokepoint level (composite-acp-handler.spec.ts); this just confirms
      // the emitter has no INSERT-only special-casing that would silently
      // drop an update-triggered notify.
      svc.notify(['session:9'])
      jest.advanceTimersByTime(50)

      expect(send).toHaveBeenCalledWith({
        type: 'notify',
        topics: ['session:9'],
      })
    })
  })
})
