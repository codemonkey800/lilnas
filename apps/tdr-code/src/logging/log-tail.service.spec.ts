import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { Subscription } from 'rxjs'

import { LOG_EVENTS } from 'src/logging/log-events'
import type { LogStream } from 'src/logging/log-view.types'

import type { LogTailEvent } from './log-tail.service'
import { LogTailService } from './log-tail.service'

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
  } as unknown as PinoLogger
}

// A short real sleep — this suite drives the service with REAL timers (not
// jest.useFakeTimers()) because the service's own start()/checkForChanges()
// paths are real async fs.promises I/O, which does not cooperate with fake
// timers the way a pure-RxJS Subject-driven service (e.g. sse-hub.service
// .spec.ts) does. A short real debounce (see DEBOUNCE_MS below) keeps this
// suite fast while still exercising the real coalescing behavior.
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Collects every LogTailEvent emitted on a subscription into an array,
// alongside the Subscription itself (so a test can unsubscribe() on demand)
// and any terminal error/complete state. Mirrors the collect() helper shape
// sse-hub.service.spec.ts uses for its own Subject-driven connections,
// adapted for an async, real-fs-backed Observable.
interface CollectedConnection {
  received: LogTailEvent[]
  sub: Subscription
  readonly errored: unknown
  readonly completed: boolean
}

function collect(
  service: LogTailService,
  params: { stream: LogStream; from?: number },
): CollectedConnection {
  const received: LogTailEvent[] = []
  const state = { errored: undefined as unknown, completed: false }
  const sub = service
    .watch({ stream: params.stream, from: params.from })
    .subscribe({
      next: event => received.push(event),
      error: err => {
        state.errored = err
      },
      complete: () => {
        state.completed = true
      },
    })
  return {
    received,
    sub,
    get errored() {
      return state.errored
    },
    get completed() {
      return state.completed
    },
  }
}

// Very short so the suite runs fast; the debounce COALESCING behavior
// itself (not its exact duration) is what the "duplicate change events"
// test below proves.
const DEBOUNCE_MS = 15

describe('LogTailService (real temp files, real timers)', () => {
  let tmpDir: string
  let logger: PinoLogger
  let service: LogTailService

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-code-log-tail-'))
    logger = fakeLogger()
    process.env.LOG_TAIL_DEBOUNCE_MS = String(DEBOUNCE_MS)
    // Long enough that no test below ever reaches it — the keepalive path
    // itself is exercised separately with a short override.
    process.env.LOG_TAIL_KEEPALIVE_MS = '3600000'
    const moduleRef = await Test.createTestingModule({
      providers: [LogTailService, { provide: PinoLogger, useValue: logger }],
    }).compile()
    service = moduleRef.get(LogTailService)
    service.setLogDirForTests(tmpDir)
  })

  afterEach(async () => {
    // Belt-and-suspenders test-isolation guarantee: force-tear-down any
    // connection an individual test left open without unsubscribing (or
    // whose own unsubscribe() teardown hadn't fully settled yet), THEN wait
    // for the FSEventWrap handle count to actually reach zero before this
    // test is considered finished. Without this, a still-in-flight
    // handle.close() from one test's teardown can race the NEXT test's own
    // baseline snapshot in the leak-detection suite above — a real
    // cross-test flake this fix closes, not merely a cleanliness nicety
    // (this exact race was caught empirically while writing this suite).
    service.onModuleDestroy()
    const deadline = Date.now() + 5000
    while (
      process.getActiveResourcesInfo().filter(k => k === 'FSEventWrap').length >
      0
    ) {
      if (Date.now() > deadline) {
        throw new Error(
          'afterEach: an FSEventWrap handle from this test never settled',
        )
      }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    delete process.env.LOG_TAIL_DEBOUNCE_MS
    delete process.env.LOG_TAIL_KEEPALIVE_MS
    delete process.env.LOG_TAIL_POLL_FALLBACK
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function streamFilePath(stream: LogStream): string {
    const suffix = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
    return path.join(tmpDir, `${stream}.${suffix}.log`)
  }

  function writeStream(stream: LogStream, content: string): string {
    const filePath = streamFilePath(stream)
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  function jsonLine(obj: Record<string, unknown>): string {
    return JSON.stringify(obj) + '\n'
  }

  // Waits until `predicate()` is true or `timeoutMs` elapses, polling every
  // 10ms — used throughout instead of a single fixed sleep so the suite
  // reacts as soon as the debounced read actually lands rather than always
  // paying the full worst-case wait. The default is deliberately generous
  // (5s against a 15ms debounce — 300x+ margin) rather than tuned tight:
  // this suite drives real fs.watch/setTimeout scheduling, which is at the
  // mercy of the host's actual CPU scheduler under heavy parallel test-run
  // load (many Jest workers, each opening real OS-level watch handles) —
  // widening the ceiling costs nothing in the common case (waitFor returns
  // the moment the predicate is true) but meaningfully reduces flakiness
  // under CI/local machine contention.
  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 5000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error('waitFor: timed out waiting for predicate')
      }
      await sleep(10)
    }
  }

  // Counts Node's own real active-resource entries of one `kind`
  // ('FSEventWrap' for an open fs.watch, 'Timeout' for a pending
  // setTimeout/setInterval) — the ground-truth signal the leak tests below
  // are built on, since it reflects the runtime's actual open handles
  // rather than an inference from a mock's call count.
  function activeResourceCount(kind: string): number {
    return process.getActiveResourcesInfo().filter(k => k === kind).length
  }

  function appendLines(filePath: string, ...lines: string[]): void {
    fs.appendFileSync(filePath, lines.join(''))
  }

  // ───────────────────────────────────────────────────────────────────────
  // Execution note (per the plan): the leak/teardown test comes FIRST,
  // proving zero fs.watch handles and zero pending timers survive
  // disconnect — the exact REVIEW.md #4 gap this unit exists to close.
  // process.getActiveResourcesInfo() is used as the ground-truth signal (not
  // an inference from mock call-counts): it reports the Node runtime's own
  // real open-handle kinds (e.g. 'FSEventWrap' for an open fs.watch,
  // 'Timeout'/'Immediate' for pending timers), so a diff against a
  // before/after snapshot proves the OS-level resource was actually
  // released, not merely that some internal flag was set.
  // ───────────────────────────────────────────────────────────────────────
  describe('leak/teardown (REVIEW.md #4 — mandatory)', () => {
    it('tearing down the subscription (unsubscribe) leaves zero fs.watch handles and zero pending timers behind', async () => {
      writeStream('backend', jsonLine({ level: 30, msg: 'x' }))

      const baselineFsEvents = activeResourceCount('FSEventWrap')
      const baselineTimeouts = activeResourceCount('Timeout')

      const conn = collect(service, { stream: 'backend' })
      await waitFor(() => activeResourceCount('FSEventWrap') > baselineFsEvents)
      expect(activeResourceCount('FSEventWrap')).toBeGreaterThan(
        baselineFsEvents,
      )

      conn.sub.unsubscribe()
      // Cleanup's own work (abort(), handle.close()) is synchronous/
      // near-synchronous, but handle.close() is a real fs promise — give it
      // a beat to actually settle before asserting the handle count.
      await waitFor(
        () => activeResourceCount('FSEventWrap') === baselineFsEvents,
      )

      expect(activeResourceCount('FSEventWrap')).toBe(baselineFsEvents)
      // No net-new pending Timeout handles either (the debounce timer, if
      // one happened to be pending, must also have been cleared).
      expect(activeResourceCount('Timeout')).toBeLessThanOrEqual(
        baselineTimeouts,
      )
    })

    it('onModuleDestroy tears down every active connection, even ones still open with no explicit unsubscribe', async () => {
      writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
      writeStream('frontend-server', jsonLine({ level: 30, msg: 'y' }))

      const baselineFsEvents = activeResourceCount('FSEventWrap')

      collect(service, { stream: 'backend' }) // left open, no unsubscribe
      collect(service, { stream: 'frontend-server' }) // left open, no unsubscribe

      await waitFor(
        () => activeResourceCount('FSEventWrap') >= baselineFsEvents + 2,
      )

      service.onModuleDestroy()

      await waitFor(
        () => activeResourceCount('FSEventWrap') === baselineFsEvents,
      )
      expect(activeResourceCount('FSEventWrap')).toBe(baselineFsEvents)
    })

    it('cleanup is idempotent: unsubscribing twice (and calling onModuleDestroy after) does not throw', async () => {
      writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
      const conn = collect(service, { stream: 'backend' })
      await waitFor(() => conn.received.length >= 0, 200).catch(() => undefined)

      expect(() => conn.sub.unsubscribe()).not.toThrow()
      expect(() => conn.sub.unsubscribe()).not.toThrow()
      expect(() => service.onModuleDestroy()).not.toThrow()
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Happy path: two complete lines appended -> two append-delta messages
  // with correct byteOffset ids and exact line text.
  // ───────────────────────────────────────────────────────────────────────
  it('happy path: appending two complete lines emits two append messages with correct byteOffset and exact text', async () => {
    const line1 = jsonLine({ level: 30, time: 1, msg: 'one' })
    const filePath = writeStream('backend', line1)
    const conn = collect(service, { stream: 'backend' })

    await sleep(50) // let the initial connect/backlog phase settle at EOF

    const line2 = jsonLine({ level: 30, time: 2, msg: 'two' })
    const line3 = jsonLine({ level: 30, time: 3, msg: 'three' })
    appendLines(filePath, line2, line3)

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 2,
    )

    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(2)
    expect(appends[0]?.message.line).toBe(
      JSON.stringify({
        level: 30,
        time: 2,
        msg: 'two',
      }),
    )
    expect(appends[0]?.message.byteOffset).toBe(
      Buffer.byteLength(line1, 'utf8') + Buffer.byteLength(line2, 'utf8'),
    )
    expect(appends[1]?.message.line).toBe(
      JSON.stringify({
        level: 30,
        time: 3,
        msg: 'three',
      }),
    )
    expect(appends[1]?.message.byteOffset).toBe(
      Buffer.byteLength(line1, 'utf8') +
        Buffer.byteLength(line2, 'utf8') +
        Buffer.byteLength(line3, 'utf8'),
    )

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Happy path (resume): first-connect ?from= and reconnect Last-Event-ID
  // both deliver the backlog before live streaming; the controller resolves
  // the precedence (tested separately in log-tail.controller.spec.ts) — this
  // service-level test proves the SERVICE half: whatever numeric `from` it
  // is given, the backlog from that offset emits before anything live.
  // ───────────────────────────────────────────────────────────────────────
  it('happy path (resume): connecting with an explicit `from` mid-file emits the backlog from that offset before live streaming', async () => {
    const line1 = jsonLine({ level: 30, time: 1, msg: 'one' })
    const line2 = jsonLine({ level: 30, time: 2, msg: 'two' })
    const line3 = jsonLine({ level: 30, time: 3, msg: 'three' })
    const filePath = writeStream('backend', line1 + line2 + line3)

    // Resume from right after line1 — expect line2 and line3 as backlog.
    const fromOffset = Buffer.byteLength(line1, 'utf8')
    const conn = collect(service, { stream: 'backend', from: fromOffset })

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 2,
    )

    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends.map(a => a.message.line)).toEqual([
      JSON.stringify({ level: 30, time: 2, msg: 'two' }),
      JSON.stringify({ level: 30, time: 3, msg: 'three' }),
    ])

    // Now a genuinely LIVE append arrives after the backlog.
    const line4 = jsonLine({ level: 30, time: 4, msg: 'four' })
    appendLines(filePath, line4)
    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 3,
    )
    const allAppends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(allAppends[2]?.message.line).toBe(
      JSON.stringify({ level: 30, time: 4, msg: 'four' }),
    )

    conn.sub.unsubscribe()
  })

  it('resuming with `from` at current EOF (the default when unspecified) emits no backlog, only later live appends', async () => {
    const line1 = jsonLine({ level: 30, time: 1, msg: 'one' })
    const filePath = writeStream('backend', line1)
    const conn = collect(service, { stream: 'backend' }) // from undefined -> EOF

    await sleep(80) // give the (empty) backlog phase time to settle
    expect(conn.received.filter(e => e.kind === 'append')).toHaveLength(0)

    const line2 = jsonLine({ level: 30, time: 2, msg: 'two' })
    appendLines(filePath, line2)
    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 1,
    )

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (backlog -> attach race): the plan's core correctness
  // requirement — a line appended in the narrow window between the initial
  // backlog read and the watcher's attach must be emitted EXACTLY once (not
  // zero times via a missed race, not twice via a double-drain). This
  // suite cannot literally freeze time between "attach the watcher" and
  // "read the backlog" (that ordering is internal to the service), so
  // instead it proves the OBSERVABLE property the design guarantees: a
  // rapid sequence of appends immediately after connecting — arriving
  // squarely across that internal window on a real, unmodified clock — are
  // each captured exactly once, with none doubled or dropped, across many
  // real runs (flakiness here would mean the race is real).
  // ───────────────────────────────────────────────────────────────────────
  it('edge case (backlog-attach race): a line appended immediately after connecting is captured exactly once, never dropped or duplicated', async () => {
    const filePath = writeStream('backend', '')
    // Deliberately `from: 0` — NOT the default "current EOF" a bare
    // `{ stream: 'backend' }` connect would resolve to. With no explicit
    // `from`, "current EOF" is snapshotted by start()'s OWN first stat()
    // call, whose exact timing relative to this test's own synchronous
    // fs.appendFileSync() below is NOT guaranteed under real OS scheduling
    // (both run on the same thread; under enough delay the write can
    // legitimately complete before that first stat() call's underlying
    // syscall even issues) — under that ordering, a from-EOF connection
    // would CORRECTLY exclude the race line as pre-existing backlog, which
    // is a real, valid outcome for that mode, not a bug (a genuine flake
    // this test used to have, confirmed via trace: 'from: undefined'
    // resolved lastOffset to the file's SIZE AT THAT MOMENT, which already
    // included the race line, so both drains at start were no-ops and no
    // live event followed). Anchoring the resume point to a fixed, always-
    // earlier-than-the-race-line offset (0) makes "this line must be
    // captured" unconditionally the correct expectation regardless of
    // whether it lands in the backlog phase or the live-watch phase — which
    // is the actual property this test exists to prove (both paths are
    // reachable and each other's fallback, never a double-emit).
    const conn = collect(service, { stream: 'backend', from: 0 })

    // Fire the append as early as possible after subscribing — no artificial
    // delay — to land inside (or very near) the real backlog-read/
    // watcher-attach window on every run.
    const raceLine = jsonLine({ level: 30, time: 99, msg: 'race' })
    appendLines(filePath, raceLine)

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 1,
    )
    // Give any (incorrect) double-emit a chance to also land before
    // asserting the final count.
    await sleep(100)

    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(1)
    expect(appends[0]?.message.line).toBe(
      JSON.stringify({ level: 30, time: 99, msg: 'race' }),
    )

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (partial-final-line): a half-written final line (no '\n') is
  // held, NOT emitted live; it emits once complete on the next append.
  // ───────────────────────────────────────────────────────────────────────
  it('edge case (partial-final-line): a change event with no trailing newline is held, not emitted; completing it on the next append emits exactly the completed line', async () => {
    const line1 = jsonLine({ level: 30, time: 1, msg: 'one' })
    const filePath = writeStream('backend', line1)
    const conn = collect(service, { stream: 'backend' })
    await sleep(80)

    // Append a partial line with NO trailing newline.
    const partial = '{"level":30,"time":2,"msg":"unfinis'
    fs.appendFileSync(filePath, partial)

    // Give the debounced read plenty of time to fire and confirm nothing
    // was emitted for the still-incomplete line.
    await sleep(150)
    expect(conn.received.filter(e => e.kind === 'append')).toHaveLength(0)

    // Complete the line.
    const rest = 'hed"}\n'
    fs.appendFileSync(filePath, rest)

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 1,
    )
    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(1)
    expect(appends[0]?.message.line).toBe(
      JSON.stringify({ level: 30, time: 2, msg: 'unfinished' }),
    )

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (AE4): a burst of N appends emits N incremental messages, not
  // one blob.
  // ───────────────────────────────────────────────────────────────────────
  it('edge case (AE4, burst): N rapid appends emit N incremental append messages, not one combined blob', async () => {
    const filePath = writeStream('backend', '')
    const conn = collect(service, { stream: 'backend' })
    await sleep(80)

    const N = 8
    for (let i = 0; i < N; i++) {
      appendLines(filePath, jsonLine({ level: 30, time: i, msg: `burst-${i}` }))
    }

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= N,
    )
    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(N)
    for (let i = 0; i < N; i++) {
      expect(appends[i]?.message.line).toBe(
        JSON.stringify({ level: 30, time: i, msg: `burst-${i}` }),
      )
    }
    // Monotonically increasing byte offsets — never a bare counter.
    for (let i = 1; i < appends.length; i++) {
      expect(appends[i]!.message.byteOffset).toBeGreaterThan(
        appends[i - 1]!.message.byteOffset,
      )
    }

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case: duplicate 'change' events for one write produce at most one
  // read/emit (debounce + offset-vs-size idempotency).
  // ───────────────────────────────────────────────────────────────────────
  it('edge case: multiple rapid appends inside one debounce window still emit each complete line exactly once (no duplicate emits)', async () => {
    const filePath = writeStream('backend', '')
    const conn = collect(service, { stream: 'backend' })
    await sleep(80)

    // Two writes fired back-to-back, well inside the DEBOUNCE_MS window —
    // this is what the real kernel's duplicate-change-event behavior looks
    // like from the service's perspective: multiple 'change' signals, one
    // underlying write burst.
    const lineA = jsonLine({ level: 30, time: 1, msg: 'a' })
    const lineB = jsonLine({ level: 30, time: 2, msg: 'b' })
    fs.appendFileSync(filePath, lineA)
    fs.appendFileSync(filePath, lineB)

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 2,
    )
    // Settle further to make sure no LATE duplicate arrives from a second
    // coalesced-but-not-deduped 'change' firing.
    await sleep(150)

    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(2)
    expect(appends.map(a => a.message.line)).toEqual([
      JSON.stringify({ level: 30, time: 1, msg: 'a' }),
      JSON.stringify({ level: 30, time: 2, msg: 'b' }),
    ])

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (UTF-8): a multi-byte character split across two
  // change-triggered reads decodes intact via the persistent StringDecoder.
  // A .length-based (not Buffer.byteLength-based) byteOffset bug would
  // still pass a test that only checks the DECODED text, so this test also
  // asserts the byteOffset value itself against a hand-computed byte count.
  // ───────────────────────────────────────────────────────────────────────
  it('edge case (UTF-8): a multi-byte character split across two debounced reads decodes intact with a byte-accurate offset', async () => {
    const filePath = writeStream('backend', '')
    const conn = collect(service, { stream: 'backend' })
    await sleep(80)

    // '日本語' is 3 chars but 9 BYTES in UTF-8 (3 bytes each) — a
    // .length-based offset (3) would diverge sharply from the real byte
    // count (9), making this a genuine regression trap for that bug class.
    const fullLine = jsonLine({
      level: 30,
      time: 1,
      msg: '日本語テスト 🎉 café',
    })
    const fullBuf = Buffer.from(fullLine, 'utf8')
    // Split mid-way through a multi-byte sequence — not on a clean
    // character boundary — to force the decoder to actually hold state
    // across the two writes.
    const splitPoint = Math.floor(fullBuf.length / 2)

    fs.appendFileSync(filePath, fullBuf.subarray(0, splitPoint))
    await sleep(DEBOUNCE_MS * 3) // let one debounced read fire on the partial bytes
    fs.appendFileSync(filePath, fullBuf.subarray(splitPoint))

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 1,
    )
    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(1)
    expect(appends[0]?.message.line).toBe(
      JSON.stringify({ level: 30, time: 1, msg: '日本語テスト 🎉 café' }),
    )
    expect(appends[0]?.message.byteOffset).toBe(fullBuf.length)

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (truncation): file truncated -> offset resets to 0,
  // pendingPartial cleared, streaming resumes from new content.
  // ───────────────────────────────────────────────────────────────────────
  it('edge case (truncation): the file is truncated shorter than lastOffset -> offset resets to 0 and new content streams correctly', async () => {
    const initial = jsonLine({ level: 30, time: 1, msg: 'a'.repeat(50) })
    const filePath = writeStream('backend', initial)
    const conn = collect(service, { stream: 'backend' })
    await sleep(80)

    // Truncate to empty (size 0 < lastOffset) then write shorter new
    // content — same inode, same path, just ftruncate'd in place.
    fs.truncateSync(filePath, 0)
    const afterTruncate = jsonLine({ level: 30, time: 2, msg: 'new' })
    fs.appendFileSync(filePath, afterTruncate)

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 1,
    )
    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(1)
    expect(appends[0]?.message.line).toBe(
      JSON.stringify({ level: 30, time: 2, msg: 'new' }),
    )
    // Offset is relative to the NEW (post-truncation) content, not a
    // continuation of the old (now-invalid) byte range.
    expect(appends[0]?.message.byteOffset).toBe(
      Buffer.byteLength(afterTruncate, 'utf8'),
    )

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (rotation): file renamed + recreated (new inode) -> watcher
  // reopens and follows the new file; logs 'log-tail-reopened'. Uses the
  // poll-fallback path (LOG_TAIL_POLL_FALLBACK) for this ONE test, since
  // this platform's native fs.watch stops reporting events for a path once
  // that path is renamed away (confirmed empirically against this
  // environment's fs.watch backend) — the poll-fallback's own periodic
  // stat() is what reliably notices the new inode and is exactly the
  // mechanism the plan calls out for "exotic mounts" but which also
  // happens to be the only mechanism this suite can drive deterministically
  // for rotation across every platform.
  // ───────────────────────────────────────────────────────────────────────
  it('edge case (rotation, poll-fallback path): renaming the file away and recreating it under the same path reopens and follows the new file', async () => {
    process.env.LOG_TAIL_POLL_FALLBACK = 'true'
    const line1 = jsonLine({ level: 30, time: 1, msg: 'before-rotation' })
    const filePath = writeStream('backend', line1)
    const conn = collect(service, { stream: 'backend' })
    await sleep(80)

    fs.renameSync(filePath, `${filePath}.old`)
    const line2 = jsonLine({ level: 30, time: 2, msg: 'after-rotation' })
    fs.writeFileSync(filePath, line2)

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 1,
      3000,
    )
    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    expect(appends).toHaveLength(1)
    expect(appends[0]?.message.line).toBe(
      JSON.stringify({ level: 30, time: 2, msg: 'after-rotation' }),
    )
    // byteOffset is relative to the NEW file, starting fresh from 0.
    expect(appends[0]?.message.byteOffset).toBe(
      Buffer.byteLength(line2, 'utf8'),
    )

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LOG_EVENTS.logTailReopened,
        stream: 'backend',
      }),
      expect.any(String),
    )

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Error path (R17 boundary, service half): the service's own type
  // signature only accepts LogStream — this documents (mirroring
  // log-reader.service.spec.ts's own identical-purpose test) that the R17
  // rejection itself happens at the controller/DTO layer, not by this
  // service re-validating a string. See log-tail.controller.spec.ts for the
  // actual BadRequestException assertion with no fs access.
  // ───────────────────────────────────────────────────────────────────────
  it('error path (R17): the service accepts every valid LogStream (rejection of unknown streams is enforced at the DTO/controller layer)', async () => {
    const validStreams: LogStream[] = [
      'backend',
      'frontend-server',
      'frontend-browser',
    ]
    for (const stream of validStreams) {
      writeStream(stream, jsonLine({ level: 30, msg: 'x' }))
      const baselineFsEvents = activeResourceCount('FSEventWrap')
      const conn = collect(service, { stream })
      await sleep(50)
      expect(conn.errored).toBeUndefined()
      conn.sub.unsubscribe()
      // Wait for this iteration's own teardown to fully settle before
      // moving to the next stream (or returning from the test) — otherwise
      // a still-in-flight handle.close() from THIS iteration can race the
      // NEXT test's own baseline snapshot in the leak-test suite above,
      // making an unrelated test flaky (a real cross-test pollution bug
      // this fix closes, not a test-only nicety).
      await waitFor(
        () => activeResourceCount('FSEventWrap') === baselineFsEvents,
      )
    }
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (R2 precedent): a stream that has never been written to
  // completes gracefully (no throw, no hang) rather than erroring — mirrors
  // LogReaderService/LogSourcesService's identical ENOENT-is-not-an-error
  // contract.
  // ───────────────────────────────────────────────────────────────────────
  it('edge case: a stream whose file does not exist yet completes gracefully with no error and no leaked handles', async () => {
    // Deliberately do NOT write frontend-server.
    const baseline = activeResourceCount('FSEventWrap')

    const conn = collect(service, { stream: 'frontend-server' })
    await waitFor(() => conn.completed, 2000)

    expect(conn.completed).toBe(true)
    expect(conn.errored).toBeUndefined()
    expect(conn.received).toEqual([])
    expect(activeResourceCount('FSEventWrap')).toBe(baseline)
  })

  // ───────────────────────────────────────────────────────────────────────
  // Keepalive: emits a bare { kind: 'keepalive' } event on the configured
  // cadence, independent of any append activity.
  // ───────────────────────────────────────────────────────────────────────
  it('keepalive: emits a keepalive event on the configured cadence with no line data', async () => {
    process.env.LOG_TAIL_KEEPALIVE_MS = '50'
    writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
    const conn = collect(service, { stream: 'backend' })

    await waitFor(
      () => conn.received.filter(e => e.kind === 'keepalive').length >= 2,
      2000,
    )
    const keepalives = conn.received.filter(e => e.kind === 'keepalive')
    expect(keepalives.length).toBeGreaterThanOrEqual(2)

    conn.sub.unsubscribe()
  })
})
