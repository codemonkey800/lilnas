import { renderHook } from '@testing-library/react'

import { logTailUrl } from 'src/app/lib/api'
import { tailMessageToLogLine, useLogTail } from 'src/app/logs/use-log-tail'
import type { LogLine, LogTailMessage } from 'src/logging/log-view.types'

// jsdom does not implement EventSource (see use-live-stream.spec.tsx's own
// header comment for the confirmed rationale) — this mock is the same
// shape as that file's MockEventSource, scoped to exactly the two event
// types this hook actually listens for (`log-append`/`keepalive`) instead
// of an arbitrary topic list, since use-log-tail.ts has no per-topic
// listener registration to exercise the way use-live-stream.ts does.
class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  onerror: (() => void) | null = null
  closed = false
  private readonly listeners = new Map<
    string,
    Set<(event: MessageEvent<string>) => void>
  >()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.closed = true
  }

  // Test helper — dispatches a NAMED event (the only kind a real
  // EventSource for this endpoint ever delivers) to exactly the listeners
  // registered for `type`, mirroring real dispatch-by-event-name behavior.
  // `close()` marks this instance closed but otherwise leaves its listener
  // map intact; emit() below checks `closed` itself so a superseded
  // instance's late event is a proven no-op, matching what a real closed
  // EventSource guarantees (it stops delivering events once closed).
  emit(type: string, data: unknown): void {
    if (this.closed) return
    const event = { data: JSON.stringify(data), type } as MessageEvent<string>
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

function latestInstance(): MockEventSource {
  const instance = MockEventSource.instances.at(-1)
  if (!instance) throw new Error('No MockEventSource was constructed')
  return instance
}

beforeEach(() => {
  MockEventSource.instances = []
  global.EventSource = MockEventSource as unknown as typeof EventSource
})

describe('tailMessageToLogLine — the byte-offset conversion (the trickiest part of this unit)', () => {
  it('converts a server END-offset tail message to a LogLine with the correct START offset, matching the worked example in the plan', () => {
    // The file's first line is `{"a":1}\n` (8 bytes) — if the tail
    // delivers it as the very first append, the server sends
    // byteOffset: 8 (the position right after the line, since
    // LogTailMessage.byteOffset is an END offset — see log-view.types.ts's
    // own header comment on LogTailMessage and log-tail.controller.ts's
    // `id: String(event.message.byteOffset)`). The converted LogLine's
    // byteOffset must be 0 (its START), matching exactly what a windowed
    // read of the same file would have produced for this identical line —
    // this is the exact invariant applyFetchedWindow's de-dup and the
    // virtualizer's getItemKey both depend on.
    const message: LogTailMessage = { line: '{"a":1}', byteOffset: 8 }
    const logLine = tailMessageToLogLine(message)

    expect(logLine.byteOffset).toBe(0)
    expect(logLine.byteLength).toBe(8)
    expect(logLine.raw).toBe('{"a":1}')
    expect(logLine.parsed).toEqual({ a: 1 })
  })

  it('accounts for multi-byte UTF-8 characters using their real encoded byte length, not string .length', () => {
    // '"café"' as a bare raw line: 'é' is 2 bytes in UTF-8 but 1 UTF-16
    // code unit — a naive `.length`-based byte accounting would
    // undercount by exactly 1 byte per such character, corrupting the
    // conversion in exactly the "silently misaligns offsets by a few
    // dozen bytes per line" way this unit's own brief warns about.
    const line = '{"msg":"café"}'
    const textEncoder = new TextEncoder()
    const realByteLength = textEncoder.encode(line).length
    expect(realByteLength).toBe(line.length + 1) // 'é' costs one extra byte

    const serverEndOffset = 500 + realByteLength + 1 // some arbitrary anchor + this line's bytes + trailing '\n'
    const message: LogTailMessage = { line, byteOffset: serverEndOffset }
    const logLine = tailMessageToLogLine(message)

    expect(logLine.byteOffset).toBe(500)
    expect(logLine.byteLength).toBe(realByteLength + 1)
  })

  it('parses malformed JSON as a raw line with parsed: null, same as the windowed-read parseLogLine contract', () => {
    const message: LogTailMessage = { line: 'not json at all', byteOffset: 16 }
    const logLine = tailMessageToLogLine(message)
    expect(logLine.parsed).toBeNull()
    expect(logLine.raw).toBe('not json at all')
  })
})

describe('useLogTail', () => {
  it('connect(from) opens exactly one EventSource at the URL logTailUrl(stream, from) produces', () => {
    const onLine = jest.fn()
    const { result } = renderHook(() => useLogTail('backend', onLine))

    result.current.connect(1234)

    expect(MockEventSource.instances).toHaveLength(1)
    expect(latestInstance().url).toBe(logTailUrl('backend', 1234))
  })

  it('converts a log-append wire event to the correct LogLine and invokes onLine with it', () => {
    const onLine = jest.fn()
    const { result } = renderHook(() => useLogTail('backend', onLine))
    result.current.connect(0)

    const message: LogTailMessage = { line: '{"a":1}', byteOffset: 8 }
    latestInstance().emit('log-append', message)

    expect(onLine).toHaveBeenCalledTimes(1)
    const received = onLine.mock.calls[0]?.[0]
    expect(received).toEqual({
      byteOffset: 0,
      byteLength: 8,
      raw: '{"a":1}',
      parsed: { a: 1 },
    })
  })

  it('a burst of several log-append events each individually invoke onLine once, in order — not batched or coalesced', () => {
    const onLine = jest.fn()
    const { result } = renderHook(() => useLogTail('backend', onLine))
    result.current.connect(0)

    // Three lines back to back, each 9 bytes including its own newline
    // ('{"n":0}\n' etc — 8 chars + 1 newline = 9), anchored from offset 0.
    const lines = ['{"n":0}', '{"n":1}', '{"n":2}']
    let cursor = 0
    for (const line of lines) {
      cursor += new TextEncoder().encode(line).length + 1
      latestInstance().emit('log-append', { line, byteOffset: cursor })
    }

    expect(onLine).toHaveBeenCalledTimes(3)
    expect(
      onLine.mock.calls.map(call => (call[0] as { raw: string }).raw),
    ).toEqual(lines)
  })

  it('a keepalive event does not invoke onLine and does not throw', () => {
    const onLine = jest.fn()
    const { result } = renderHook(() => useLogTail('backend', onLine))
    result.current.connect(0)

    expect(() => latestInstance().emit('keepalive', {})).not.toThrow()
    expect(onLine).not.toHaveBeenCalled()
  })

  it('onLine always reflects the LATEST callback passed to the hook across re-renders, without needing a fresh connect() call', () => {
    const firstOnLine = jest.fn<void, [LogLine]>()
    const secondOnLine = jest.fn<void, [LogLine]>()
    const { result, rerender } = renderHook(
      ({ onLine }: { onLine: (line: LogLine) => void }) =>
        useLogTail('backend', onLine),
      { initialProps: { onLine: firstOnLine } },
    )
    result.current.connect(0)

    rerender({ onLine: secondOnLine })

    // No connect() call happened after the rerender — the SAME underlying
    // EventSource instance delivers this event, proving the ref-forwarded
    // callback (not a stale closure captured at connect-time) is what
    // fires.
    expect(MockEventSource.instances).toHaveLength(1)
    latestInstance().emit('log-append', { line: '{"x":1}', byteOffset: 9 })

    expect(firstOnLine).not.toHaveBeenCalled()
    expect(secondOnLine).toHaveBeenCalledTimes(1)
  })

  it('unmounting closes the EventSource (leak guard)', () => {
    const onLine = jest.fn()
    const { result, unmount } = renderHook(() => useLogTail('backend', onLine))
    result.current.connect(0)
    const instance = latestInstance()

    expect(instance.closed).toBe(false)
    unmount()
    expect(instance.closed).toBe(true)
  })

  it('calling connect() a second time (a re-seek) closes the FIRST EventSource and opens a genuinely new one; an event on the superseded first instance after that does NOT invoke onLine', () => {
    const onLine = jest.fn()
    const { result } = renderHook(() => useLogTail('backend', onLine))

    result.current.connect(0)
    const first = latestInstance()
    expect(MockEventSource.instances).toHaveLength(1)

    result.current.connect(500) // e.g. jump-to-latest re-seeding from a fresh fileSize
    expect(MockEventSource.instances).toHaveLength(2)
    const second = latestInstance()
    expect(second).not.toBe(first)
    expect(first.closed).toBe(true)
    expect(first.url).toBe(logTailUrl('backend', 0))
    expect(second.url).toBe(logTailUrl('backend', 500))

    // The superseded first instance firing an event after being closed
    // must not reach onLine — this is the "guard against a stale
    // connection's late event" requirement: closing it is what makes this
    // true (the mock's own emit() early-returns on `closed`, matching a
    // real closed EventSource's guarantee that it stops delivering
    // events).
    first.emit('log-append', { line: '{"stale":true}', byteOffset: 20 })
    expect(onLine).not.toHaveBeenCalled()

    // The NEW connection still works normally.
    second.emit('log-append', { line: '{"fresh":true}', byteOffset: 20 })
    expect(onLine).toHaveBeenCalledTimes(1)
  })

  it('disconnect() is idempotent and safe to call when nothing is connected', () => {
    const onLine = jest.fn()
    const { result } = renderHook(() => useLogTail('backend', onLine))
    expect(() => result.current.disconnect()).not.toThrow()
    expect(() => result.current.disconnect()).not.toThrow()
  })

  it('an onerror event does not throw (401-fallback logic is explicitly deferred to a later unit)', () => {
    const onLine = jest.fn()
    const { result } = renderHook(() => useLogTail('backend', onLine))
    result.current.connect(0)
    expect(() => latestInstance().onerror?.()).not.toThrow()
  })
})
