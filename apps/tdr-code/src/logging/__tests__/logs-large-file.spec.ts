import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { Subscription } from 'rxjs'

import { LogReaderService } from 'src/logging/log-reader.service'
import { LogSearchService } from 'src/logging/log-search.service'
import type { LogTailEvent } from 'src/logging/log-tail.service'
import { LogTailService } from 'src/logging/log-tail.service'
import type { LogStream } from 'src/logging/log-view.types'
import { parseLogLine } from 'src/logging/log-view.types'

// ─────────────────────────────────────────────────────────────────────────
// U15 — cross-cutting large-file integration proof.
//
// Every OTHER logging/*.service.spec.ts file already proves its own unit's
// large-file behavior against a large fixture it generates and tears down
// itself (log-reader.service.spec.ts's own R20/AE3 test, log-search.service
// .spec.ts's own AE2+R20 describe block, log-tail.service.spec.ts's own
// small-fixture AE4 burst test). That per-unit coverage is real and stays —
// this file's job is different: it generates ONE large fixture ONCE and
// exercises LogReaderService, LogSearchService, and LogTailService AGAINST
// THE SAME FILE, together, in one suite — proving the pieces compose against
// a shared realistic file rather than each having only ever been proven in
// isolation against its own separately-generated fixture.
//
// Fixture sizing (per this unit's own execution note): the plan's own prior
// art (log-reader.service.spec.ts's R20/AE3 test, log-search.service.spec
// .ts's AE2+R20 describe block) already reduced the plan's literal "200 MB"
// figure to a 24 MiB CI-safe proxy — reused verbatim here for consistency
// with that established precedent, not re-derived. The property under test
// (bounded memory, exact whole-file count, incremental bursts) does not get
// any STRONGER with a bigger file; a bigger file only makes the suite
// slower. To manually verify at a genuinely large scale (hundreds of MB, the
// plan's literal figure), bump LARGE_FIXTURE_TARGET_BYTES below to e.g.
// `256 * 1024 * 1024` and re-run this file alone — every assertion in this
// suite is written size-agnostically (byte offsets and counts are always
// derived from the fixture's own construction, never hardcoded), so no
// other change is required to run this file against a much larger fixture
// locally.
const LARGE_FIXTURE_TARGET_BYTES = 24 * 1024 * 1024 // 24 MiB — see header.

// Matches LogSearchService's own local SEARCH_BLOCK_BYTES (duplicated here,
// not imported, for the identical reason log-search.service.spec.ts's own
// top-of-file comment gives: this suite needs a byte-exact value to reason
// about block-bounded peak allocation, and importing an internal
// implementation detail would be worse than a documented, intentional
// duplication that is easy to keep in sync if that constant ever changes).
const SEARCH_BLOCK_BYTES = 65536
// Matches LogReaderService's own default LOG_WINDOW_MAX_BYTES env default
// (see logs.controller.ts's `maxBytes ?? Number.MAX_SAFE_INTEGER` and
// LogReaderService.clampMaxBytes's own '131072' fallback) — the window read
// test below requests exactly this value so its own peak-allocation bound is
// meaningful (bounded by the window cap, not an arbitrary smaller number
// that would pass trivially).
const WINDOW_MAX_BYTES = 131072

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

function jsonLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + '\n'
}

function streamFileName(stream: LogStream): string {
  const suffix = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
  return `${stream}.${suffix}.log`
}

// Streamed writes via fs.openSync/fs.writeSync in fixed-size chunks — never
// building one giant in-memory string — mirroring log-search.service.spec
// .ts's own writeLargeFixtureWithTopMatch and log-reader.service.spec.ts's
// own integration-test fixture-generation technique verbatim. The marker
// line (the ONLY occurrence of its own needle text, per AE2) is written
// FIRST, at byte offset 0, exactly like both of those precedents.
function writeLargeFixtureWithTopMatch(
  filePath: string,
  markerLine: string,
  targetBytes: number,
): void {
  const fillerLine = jsonLine({ level: 30, time: 1, msg: 'x'.repeat(200) })
  const fillerBytes = Buffer.byteLength(fillerLine, 'utf8')
  const fillerLineCount = Math.ceil(targetBytes / fillerBytes)

  const fd = fs.openSync(filePath, 'w')
  try {
    fs.writeSync(fd, markerLine) // the ONLY match, right at the top (AE2)
    const chunk = fillerLine.repeat(1000)
    const fullChunks = Math.floor(fillerLineCount / 1000)
    for (let i = 0; i < fullChunks; i++) {
      fs.writeSync(fd, chunk)
    }
    const remainder = fillerLineCount % 1000
    if (remainder > 0) fs.writeSync(fd, fillerLine.repeat(remainder))
  } finally {
    fs.closeSync(fd)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Section 1: LogReaderService + LogSearchService against ONE shared,
// read-only 24 MiB fixture (generated once in beforeAll, never mutated by
// any test in this section) — bounded memory (R20/AE3) for both services,
// plus the exact top-of-file match (AE2), proven against the SAME bytes.
// ─────────────────────────────────────────────────────────────────────────
describe('U15: large-file cross-cutting proof — LogReaderService + LogSearchService (shared read-only fixture)', () => {
  let tmpDir: string
  let filePath: string
  let fileSize: number
  const MARKER_TEXT = 'NEEDLE-IN-HAYSTACK'
  const markerLine = jsonLine({ level: 30, time: 0, msg: MARKER_TEXT })

  let readerService: LogReaderService
  let searchService: LogSearchService

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-code-logs-large-'))
    filePath = path.join(tmpDir, streamFileName('backend'))
    writeLargeFixtureWithTopMatch(
      filePath,
      markerLine,
      LARGE_FIXTURE_TARGET_BYTES,
    )
    fileSize = fs.statSync(filePath).size
    expect(fileSize).toBeGreaterThanOrEqual(LARGE_FIXTURE_TARGET_BYTES)

    const readerModule = await Test.createTestingModule({
      providers: [
        LogReaderService,
        { provide: PinoLogger, useValue: fakeLogger() },
      ],
    }).compile()
    readerService = readerModule.get(LogReaderService)
    readerService.setLogDirForTests(tmpDir)

    const searchModule = await Test.createTestingModule({
      providers: [
        LogSearchService,
        { provide: PinoLogger, useValue: fakeLogger() },
      ],
    }).compile()
    searchService = searchModule.get(LogSearchService)
    searchService.setLogDirForTests(tmpDir)
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────
  // R20/AE3: LogReaderService.readWindow() peak allocation stays bounded by
  // the window cap, not the file size — reuses the Buffer.alloc-spy
  // technique log-reader.service.spec.ts's own large-file test established.
  // ───────────────────────────────────────────────────────────────────────
  it('LogReaderService.readWindow() keeps peak Buffer.alloc allocation bounded by maxBytes, not proportional to the 24 MiB file (R20/AE3)', async () => {
    let peakAlloc = 0
    const allocSpy = jest
      .spyOn(Buffer, 'alloc')
      .mockImplementation((size: number) => {
        peakAlloc = Math.max(peakAlloc, size)
        return Buffer.allocUnsafe(size)
      })

    try {
      const start = Date.now()
      const result = await readerService.readWindow({
        stream: 'backend',
        anchor: fileSize,
        direction: 'before',
        maxBytes: WINDOW_MAX_BYTES,
      })
      const elapsedMs = Date.now() - start

      expect(result.atEnd).toBe(true)
      expect(result.lines.length).toBeGreaterThan(0)
      expect(elapsedMs).toBeLessThan(2000)
      expect(peakAlloc).toBeGreaterThan(0)
      expect(peakAlloc).toBeLessThanOrEqual(WINDOW_MAX_BYTES)
    } finally {
      allocSpy.mockRestore()
    }
  }, 15000)

  // ───────────────────────────────────────────────────────────────────────
  // R20/AE3: LogSearchService.scan() peak allocation stays bounded by the
  // search block size, not the file size — reuses log-search.service.spec
  // .ts's own Buffer.allocUnsafe-spy technique (the ONE allocation
  // primitive that service's block-read loop calls per iteration), against
  // the SAME 24 MiB file the windowed-read test above just ran against.
  // ───────────────────────────────────────────────────────────────────────
  it('LogSearchService.scan() keeps peak Buffer.allocUnsafe allocation bounded by the search block size, not proportional to the 24 MiB file (R20/AE3)', async () => {
    let peakAlloc = 0
    const allocSpy = jest
      .spyOn(Buffer, 'allocUnsafe')
      .mockImplementation((size: number) => {
        peakAlloc = Math.max(peakAlloc, size)
        return Buffer.alloc(size)
      })

    try {
      const start = Date.now()
      const result = await searchService.scan({
        stream: 'backend',
        predicate: { text: MARKER_TEXT },
      })
      const elapsedMs = Date.now() - start

      expect(result.total).toBe(1)
      expect(elapsedMs).toBeLessThan(5000)
      expect(peakAlloc).toBeGreaterThan(0)
      expect(peakAlloc).toBeLessThanOrEqual(SEARCH_BLOCK_BYTES)
    } finally {
      allocSpy.mockRestore()
    }
  }, 15000)

  // ───────────────────────────────────────────────────────────────────────
  // AE2: a scan for a term whose only occurrence is near the very top of
  // this large fixture returns total:1 with the correct byte offset — the
  // SAME fixture the two bounded-memory tests above just ran against, so
  // this proves count-correctness and bounded-memory hold simultaneously
  // against one shared file rather than two separately-generated fixtures
  // that happen to look similar.
  // ───────────────────────────────────────────────────────────────────────
  it('AE2: a scan for the top-of-file marker returns total:1 at byte offset 0, on the same shared 24 MiB fixture', async () => {
    const result = await searchService.scan({
      stream: 'backend',
      predicate: { text: MARKER_TEXT },
    })
    expect(result.total).toBe(1)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.byteOffset).toBe(0)
    expect(result.matches[0]?.raw).toBe(markerLine.trimEnd())
    expect(result.nextCursor).toBeNull()
  }, 15000)

  // ───────────────────────────────────────────────────────────────────────
  // AE5 (windowed-read half, per the Open Questions decision): an on-disk
  // malformed (non-JSON, but newline-TERMINATED) line renders via
  // parseLogLine's raw/null-parsed fallback, not a thrown error — this is
  // deliberately a MALFORMED-but-complete line, not an unterminated one:
  // log-reader.service.spec.ts's own two R14 precedents draw exactly this
  // distinction (its "final line lacking a trailing newline is dropped"
  // test vs. its "a stray non-JSON line mid-file yields {raw, parsed:null}"
  // test) — a trailing line with no '\n' is DROPPED by splitAndParseLines
  // (the adjacent window/live-tail owns that fragment instead, per Section
  // 2's own AE5 live-tail test below), while a malformed line that DOES end
  // in '\n' is exactly the "renders raw, then upgrades" case AE5's windowed-
  // read half describes. Proven here against a snapshot of the SAME shared
  // large fixture with a malformed line appended (read-only from the
  // perspective of the earlier tests above: this appends AFTER both already
  // ran, and no later test in this describe block depends on the file's
  // earlier exact size).
  // ───────────────────────────────────────────────────────────────────────
  it('AE5 (windowed-read half): an on-disk malformed (non-JSON) line on the large fixture renders as {raw, parsed:null}, never throws', async () => {
    const malformed = 'not json at all but contains MALFORMED-ON-LARGE-FILE\n'
    const trailingValid = jsonLine({ level: 30, time: 999, msg: 'after' })
    fs.appendFileSync(filePath, malformed + trailingValid)
    const newFileSize = fs.statSync(filePath).size

    const result = await readerService.readWindow({
      stream: 'backend',
      anchor: newFileSize,
      direction: 'before',
      maxBytes: WINDOW_MAX_BYTES,
    })

    expect(result.atEnd).toBe(true)
    const lines = result.lines
    expect(lines.at(-1)?.parsed).toEqual({ level: 30, time: 999, msg: 'after' })
    const malformedLine = lines.at(-2)
    expect(malformedLine?.raw).toBe(malformed.trimEnd())
    expect(malformedLine?.parsed).toBeNull()
    // Confirms this is exactly parseLogLine's own documented fallback (the
    // same guarded JSON.parse both planes share), not a coincidentally-null
    // value from an unrelated code path.
    expect(parseLogLine(malformed.trimEnd())).toBeNull()
  }, 15000)
})

// ─────────────────────────────────────────────────────────────────────────
// Section 2: LogTailService against an ALREADY-LARGE, already-populated
// fixture — a stronger version of U8's own small-fixture AE4 test (proving
// burst behavior doesn't change when the file backing it is large) and the
// live-tail half of AE5 (a half-written final line is held, then emitted
// once complete), run as ONE connected story per the plan's own "Open
// Questions" resolution. This fixture is mutated (appended to) by design,
// so it is kept separate from Section 1's read-only fixture — but its
// FILLER CONTENT is generated with the exact same writeLargeFixtureWithTopMatch
// helper (the "generate once" intent applies to the filler-generation
// TECHNIQUE/content shape, not to sharing one literal file across mutating
// and non-mutating concerns, which would make the two kinds of tests
// order-dependent on each other for no benefit).
// ─────────────────────────────────────────────────────────────────────────
describe('U15: large-file cross-cutting proof — LogTailService (already-large, mutated fixture)', () => {
  let tmpDir: string
  let filePath: string
  let service: LogTailService
  const DEBOUNCE_MS = 15

  function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  interface CollectedConnection {
    received: LogTailEvent[]
    sub: Subscription
  }

  function collect(params: {
    stream: LogStream
    from?: number
  }): CollectedConnection {
    const received: LogTailEvent[] = []
    // Explicitly spread `from: params.from` (never pass `params` straight
    // through) — mirrors log-tail.service.spec.ts's own identical collect()
    // helper: WatchTailParams.from is a REQUIRED key typed `number |
    // undefined`, not an OPTIONAL key, which this file's own `from?: number`
    // helper signature is (a deliberately looser test-helper convenience).
    // Passing `params` directly would violate exactOptionalPropertyTypes.
    const sub = service
      .watch({ stream: params.stream, from: params.from })
      .subscribe({
        next: event => received.push(event),
      })
    return { received, sub }
  }

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

  function activeResourceCount(kind: string): number {
    return process.getActiveResourcesInfo().filter(k => k === kind).length
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-code-logs-large-tail-'))
    filePath = path.join(tmpDir, streamFileName('backend'))
    // Same filler-generation technique as Section 1's shared fixture — see
    // this describe block's own header comment for why this is a SEPARATE
    // file rather than the same literal file Section 1 already used.
    writeLargeFixtureWithTopMatch(
      filePath,
      jsonLine({ level: 30, time: 0, msg: 'pre-existing-top-line' }),
      LARGE_FIXTURE_TARGET_BYTES,
    )
    expect(fs.statSync(filePath).size).toBeGreaterThanOrEqual(
      LARGE_FIXTURE_TARGET_BYTES,
    )
  })

  beforeEach(async () => {
    process.env.LOG_TAIL_DEBOUNCE_MS = String(DEBOUNCE_MS)
    process.env.LOG_TAIL_KEEPALIVE_MS = '3600000' // never reached in this suite
    const moduleRef = await Test.createTestingModule({
      providers: [
        LogTailService,
        { provide: PinoLogger, useValue: fakeLogger() },
      ],
    }).compile()
    service = moduleRef.get(LogTailService)
    service.setLogDirForTests(tmpDir)
  })

  afterEach(async () => {
    // Same belt-and-suspenders teardown discipline log-tail.service.spec.ts
    // itself uses: force-tear-down anything left open, then wait for the
    // real FSEventWrap handle count to reach zero before the next test's
    // own baseline snapshot runs.
    service.onModuleDestroy()
    const deadline = Date.now() + 5000
    while (activeResourceCount('FSEventWrap') > 0) {
      if (Date.now() > deadline) {
        throw new Error(
          'afterEach: an FSEventWrap handle from this test never settled',
        )
      }
      await sleep(10)
    }
    delete process.env.LOG_TAIL_DEBOUNCE_MS
    delete process.env.LOG_TAIL_KEEPALIVE_MS
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────
  // AE4, on an ALREADY-large file: connect anchored at the current EOF of
  // this 24 MiB fixture, append a burst of N new lines, and assert N
  // incremental append messages arrive — not one coalesced blob. This is
  // U8's own small-fixture AE4 test, but proving the SAME property holds
  // when the file backing the tail connection is already large (the
  // connection's own resume-offset arithmetic, debounce/idempotency, and
  // per-line emission must all still behave identically at a 24 MiB anchor
  // as they do at a near-zero one).
  // ───────────────────────────────────────────────────────────────────────
  it('AE4 on an already-large file: a burst of N appends past a 24 MiB EOF emits N incremental append messages, not one blob', async () => {
    const startOffset = fs.statSync(filePath).size
    const conn = collect({ stream: 'backend', from: startOffset })
    await sleep(80) // let the (empty, since from === current EOF) backlog phase settle

    const N = 8
    for (let i = 0; i < N; i++) {
      fs.appendFileSync(
        filePath,
        jsonLine({ level: 30, time: i, msg: `large-file-burst-${i}` }),
      )
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
        JSON.stringify({ level: 30, time: i, msg: `large-file-burst-${i}` }),
      )
    }
    // Monotonically increasing byte offsets, all past the 24 MiB anchor —
    // never a bare small-integer counter that happened to work only because
    // a small-fixture test starts near offset 0.
    expect(appends[0]!.message.byteOffset).toBeGreaterThan(startOffset)
    for (let i = 1; i < appends.length; i++) {
      expect(appends[i]!.message.byteOffset).toBeGreaterThan(
        appends[i - 1]!.message.byteOffset,
      )
    }

    conn.sub.unsubscribe()
  })

  // ───────────────────────────────────────────────────────────────────────
  // AE5, live-tail half — the capstone this file exists for: proves the two
  // halves the plan explicitly split AE5 into (live-tail "held, then
  // emitted" vs windowed-read "raw, then upgrades") are BOTH true and
  // CONNECTED, against ONE half-written line on this large fixture. A tail
  // connection is watching when the partial line lands; it must be held
  // (not emitted live) — then, once the SAME line is completed with a
  // trailing '\n', it emits exactly that completed line. This is the direct
  // live-tail analogue of Section 1's own windowed-read AE5 test above,
  // proving both halves of the plan's AE5 split against the large-file
  // scenario in one connected story, per the plan's own Open Questions
  // resolution: "AE5's literal 'appears as raw, then upgrades' is satisfied
  // by the windowed-read rendering... not by the live tail" — the live
  // tail's own contract is "held while incomplete, emitted once complete,"
  // which this test proves directly.
  // ───────────────────────────────────────────────────────────────────────
  it('AE5, connected story: a half-written line on the large fixture is held by the live tail (not emitted), then emitted exactly once completed', async () => {
    const startOffset = fs.statSync(filePath).size
    const conn = collect({ stream: 'backend', from: startOffset })
    await sleep(80)

    // Append a partial line with NO trailing newline, directly past the 24
    // MiB EOF this connection is anchored at.
    const partial = '{"level":30,"time":9000,"msg":"large-file-unfinis'
    fs.appendFileSync(filePath, partial)

    // Give the debounced read plenty of time to fire and confirm nothing
    // was emitted for the still-incomplete line — this is the "held, not
    // emitted live" half of AE5's connected story.
    await sleep(150)
    expect(conn.received.filter(e => e.kind === 'append')).toHaveLength(0)

    // Complete the SAME line.
    const rest = 'hed-on-large-file"}\n'
    fs.appendFileSync(filePath, rest)

    await waitFor(
      () => conn.received.filter(e => e.kind === 'append').length >= 1,
    )
    const appends = conn.received.filter(
      (e): e is Extract<LogTailEvent, { kind: 'append' }> =>
        e.kind === 'append',
    )
    // Exactly once — never held-then-double-emitted, never split into two
    // partial emissions.
    expect(appends).toHaveLength(1)
    expect(appends[0]?.message.line).toBe(
      JSON.stringify({
        level: 30,
        time: 9000,
        msg: 'large-file-unfinished-on-large-file',
      }),
    )

    // The completed line's own byteOffset is consistent with the windowed-
    // read side of this same story (Section 1's AE5 test): once this line
    // is on disk complete, a windowed read from EOF must render it as a
    // normal parsed line, not as a raw/null fallback — proving the two
    // halves are not just individually true but genuinely connected: what
    // the tail eventually emits is exactly what later lands on disk as a
    // normal, parseable line.
    const finalFileSize = fs.statSync(filePath).size
    const readerModule = await Test.createTestingModule({
      providers: [
        LogReaderService,
        { provide: PinoLogger, useValue: fakeLogger() },
      ],
    }).compile()
    const readerService = readerModule.get(LogReaderService)
    readerService.setLogDirForTests(tmpDir)
    const windowResult = await readerService.readWindow({
      stream: 'backend',
      anchor: finalFileSize,
      direction: 'before',
      maxBytes: WINDOW_MAX_BYTES,
    })
    const lastLine = windowResult.lines.at(-1)
    expect(lastLine?.parsed).toEqual({
      level: 30,
      time: 9000,
      msg: 'large-file-unfinished-on-large-file',
    })

    conn.sub.unsubscribe()
  })
})
