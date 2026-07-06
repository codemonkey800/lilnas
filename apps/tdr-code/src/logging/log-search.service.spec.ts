import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { LOG_EVENTS } from 'src/logging/log-events'
import type { LogScanPredicate, LogStream } from 'src/logging/log-view.types'

import { LogSearchService } from './log-search.service'

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

// Node does not export a spy-able `FileHandle` class reference the way it
// exposes plain functions like fs.promises.stat — worse, empirically (verified
// against this Node version at test-writing time) `close` is assigned as an
// OWN property directly on each opened handle instance (not its shared
// prototype), while `read` lives one level up on the shared prototype every
// handle inherits from. That split rules out a single "spy on the shared
// prototype" strategy for both methods uniformly. Instead, this helper
// spies on fs.promises.open itself to intercept the REAL handle the service
// under test opens, then jest.spyOn's directly on THAT instance for both
// methods — instance-level spying works uniformly regardless of which
// prototype level a given method actually lives on, sidestepping the need
// to know that internal detail at all. Returns the spies so a test can
// assert on them and must restore them itself once done.
async function spyOnNextOpenedHandle(): Promise<{
  openSpy: jest.SpyInstance
  getReadSpy: () => jest.SpyInstance | undefined
  getCloseSpy: () => jest.SpyInstance | undefined
  restore: () => void
}> {
  let readSpy: jest.SpyInstance | undefined
  let closeSpy: jest.SpyInstance | undefined
  const realOpen = fs.promises.open.bind(fs.promises)
  const openSpy = jest
    .spyOn(fs.promises, 'open')
    .mockImplementation(
      async (...args: Parameters<typeof fs.promises.open>) => {
        const handle = await realOpen(...args)
        readSpy = jest.spyOn(handle, 'read')
        closeSpy = jest.spyOn(handle, 'close')
        return handle
      },
    )
  return {
    openSpy,
    getReadSpy: () => readSpy,
    getCloseSpy: () => closeSpy,
    restore: () => {
      openSpy.mockRestore()
      readSpy?.mockRestore()
      closeSpy?.mockRestore()
    },
  }
}

// Matches the service's own local constant — duplicated here (not imported)
// so this suite can construct byte-exact boundary-straddling fixtures
// without depending on the module exporting an internal implementation
// detail. If the service's own SEARCH_BLOCK_BYTES ever changes, the
// boundary-straddle test below is designed to still be meaningful (it always
// places a match spanning WHATEVER this value is), it just needs updating
// here too.
const SEARCH_BLOCK_BYTES = 65536

describe('LogSearchService (real temp files)', () => {
  let tmpDir: string
  let logger: PinoLogger
  let service: LogSearchService

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-code-log-search-'))
    logger = fakeLogger()
    const moduleRef = await Test.createTestingModule({
      providers: [LogSearchService, { provide: PinoLogger, useValue: logger }],
    }).compile()
    service = moduleRef.get(LogSearchService)
    service.setLogDirForTests(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeStream(stream: LogStream, content: string): string {
    const suffix = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
    const filePath = path.join(tmpDir, `${stream}.${suffix}.log`)
    fs.writeFileSync(filePath, content, 'utf8')
    return filePath
  }

  function jsonLine(obj: Record<string, unknown>): string {
    return JSON.stringify(obj) + '\n'
  }

  async function scanAll(
    stream: LogStream,
    predicate: LogScanPredicate,
  ): Promise<{ total: number; matches: number[]; nextCursor: string | null }> {
    const result = await service.scan({ stream, predicate })
    return {
      total: result.total,
      matches: result.matches.map(m => m.byteOffset),
      nextCursor: result.nextCursor,
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Execution note (per the plan/unit brief): the carry-over/offset math is
  // tested FIRST, with a FIXED multi-block fixture where a real matching
  // line straddles a block boundary — this is the classic streaming-search
  // bug class the plan calls out explicitly (a match split across two reads
  // either double-counted, missed, or reported at the wrong offset).
  // ───────────────────────────────────────────────────────────────────────
  describe('carry-over / block-boundary correctness (execution note — tested first)', () => {
    it('a match whose own bytes straddle a SEARCH_BLOCK_BYTES boundary is counted exactly once, with the correct byte offset', async () => {
      // Build filler content that lands the START of a special line just
      // a few bytes before the block boundary, so the special line's own
      // bytes are split across two block reads by construction — not by
      // chance. Deriving fillerCount from the MEASURED fillerBytes (never a
      // hardcoded byte count) is what keeps this deterministic regardless of
      // exactly how many bytes one filler line serializes to.
      const filler = jsonLine({ level: 30, time: 0, msg: 'x'.repeat(70) })
      const fillerBytes = Buffer.byteLength(filler, 'utf8')

      // As many whole filler lines as fit without reaching the boundary —
      // Math.floor's own definition guarantees the leftover gap before the
      // boundary is strictly SMALLER than one more filler line (adding one
      // more would overshoot past SEARCH_BLOCK_BYTES), without this test
      // needing to hardcode what that gap actually is.
      const fillerCount = Math.floor(SEARCH_BLOCK_BYTES / fillerBytes)
      const prefix = filler.repeat(fillerCount)
      const prefixBytes = Buffer.byteLength(prefix, 'utf8')
      expect(prefixBytes).toBeLessThan(SEARCH_BLOCK_BYTES)
      expect(SEARCH_BLOCK_BYTES - prefixBytes).toBeGreaterThan(0)
      expect(SEARCH_BLOCK_BYTES - prefixBytes).toBeLessThan(fillerBytes)

      // The special line's own msg is long enough that its bytes definitely
      // cross the boundary (prefixBytes + partial-of-this-line's-bytes ==
      // SEARCH_BLOCK_BYTES lands somewhere INSIDE this line, not at its
      // very start or end).
      const special = jsonLine({
        level: 30,
        time: 1,
        msg: 'STRADDLE-MARKER-' + 'y'.repeat(200),
      })
      const specialStart = prefixBytes
      const specialBytes = Buffer.byteLength(special, 'utf8')
      // Confirm the fixture actually straddles the boundary as intended —
      // this assertion is about the FIXTURE, not the service, but a broken
      // fixture would make every assertion below meaningless.
      expect(specialStart).toBeLessThan(SEARCH_BLOCK_BYTES)
      expect(specialStart + specialBytes).toBeGreaterThan(SEARCH_BLOCK_BYTES)

      const suffix = jsonLine({ level: 30, time: 2, msg: 'after' })
      writeStream('backend', prefix + special + suffix)

      const result = await scanAll('backend', { text: 'STRADDLE-MARKER' })

      expect(result.total).toBe(1)
      expect(result.matches).toEqual([specialStart])
      expect(result.nextCursor).toBeNull()
    })

    it('multiple matches, several of which straddle successive block boundaries, are each counted exactly once at the correct offset', async () => {
      // Three blocks' worth of filler (~3 * 64 KiB), with a matching line
      // deliberately placed to straddle EACH of the first two boundaries.
      const filler = jsonLine({ level: 30, time: 0, msg: 'x'.repeat(70) })
      const fillerBytes = Buffer.byteLength(filler, 'utf8')
      const special = jsonLine({
        level: 30,
        time: 1,
        msg: 'HIT-' + 'z'.repeat(200),
      })
      const specialBytes = Buffer.byteLength(special, 'utf8')

      function fillTo(targetBytes: number, currentBytes: number): string {
        const need = targetBytes - currentBytes
        const count = Math.max(0, Math.floor(need / fillerBytes))
        return filler.repeat(count)
      }

      let content = ''
      let bytes = 0
      // Land the first HIT so it straddles boundary #1 (65536).
      const chunk1 = fillTo(SEARCH_BLOCK_BYTES - 40, bytes)
      content += chunk1
      bytes += Buffer.byteLength(chunk1, 'utf8')
      const hit1Offset = bytes
      content += special
      bytes += specialBytes

      // Land the second HIT so it straddles boundary #2 (131072).
      const chunk2 = fillTo(SEARCH_BLOCK_BYTES * 2 - 40, bytes)
      content += chunk2
      bytes += Buffer.byteLength(chunk2, 'utf8')
      const hit2Offset = bytes
      content += special
      bytes += specialBytes

      content += jsonLine({ level: 30, time: 99, msg: 'tail' })

      // Sanity-check the fixture straddles both boundaries as intended.
      expect(hit1Offset).toBeLessThan(SEARCH_BLOCK_BYTES)
      expect(hit1Offset + specialBytes).toBeGreaterThan(SEARCH_BLOCK_BYTES)
      expect(hit2Offset).toBeLessThan(SEARCH_BLOCK_BYTES * 2)
      expect(hit2Offset + specialBytes).toBeGreaterThan(SEARCH_BLOCK_BYTES * 2)

      writeStream('backend', content)

      const result = await scanAll('backend', { text: 'HIT-' })
      expect(result.total).toBe(2)
      expect(result.matches).toEqual([hit1Offset, hit2Offset])
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Happy path (R9) + basic predicate semantics.
  // ───────────────────────────────────────────────────────────────────────
  describe('happy path (R9): exact count + correct offsets', () => {
    it('a term appearing 5 times across the file returns total:5 with the correct byte offsets', async () => {
      const lines = [
        jsonLine({ level: 30, time: 0, msg: 'hello world' }),
        jsonLine({ level: 30, time: 1, msg: 'nope' }),
        jsonLine({ level: 30, time: 2, msg: 'world tour' }),
        jsonLine({ level: 30, time: 3, msg: 'still nope' }),
        jsonLine({ level: 30, time: 4, msg: 'world' }),
        jsonLine({ level: 30, time: 5, msg: 'nothing here' }),
        jsonLine({ level: 30, time: 6, msg: 'a whole new world' }),
        jsonLine({ level: 30, time: 7, msg: 'the world is round' }),
      ]
      let offset = 0
      const expectedOffsets: number[] = []
      for (const line of lines) {
        if (line.includes('world')) expectedOffsets.push(offset)
        offset += Buffer.byteLength(line, 'utf8')
      }
      expect(expectedOffsets).toHaveLength(5)
      writeStream('backend', lines.join(''))

      const result = await scanAll('backend', { text: 'world' })
      expect(result.total).toBe(5)
      expect(result.matches).toEqual(expectedOffsets)
      expect(result.nextCursor).toBeNull()
    })

    it('text matching is case-insensitive', async () => {
      writeStream(
        'backend',
        jsonLine({ level: 30, msg: 'HELLO World' }) +
          jsonLine({ level: 30, msg: 'nothing' }),
      )
      const result = await scanAll('backend', { text: 'hello world' })
      expect(result.total).toBe(1)
    })

    it('a line containing the search term TWICE still counts as one match (matching lines, not raw occurrences)', async () => {
      writeStream(
        'backend',
        jsonLine({ level: 30, msg: 'boom boom' }) +
          jsonLine({ level: 30, msg: 'quiet' }),
      )
      const result = await scanAll('backend', { text: 'boom' })
      expect(result.total).toBe(1)
      expect(result.matches).toHaveLength(1)
    })

    it('an empty predicate ({}) matches every complete line', async () => {
      const lines = [
        jsonLine({ level: 30, msg: 'a' }),
        jsonLine({ level: 30, msg: 'b' }),
        jsonLine({ level: 30, msg: 'c' }),
      ]
      writeStream('backend', lines.join(''))
      const result = await scanAll('backend', {})
      expect(result.total).toBe(3)
    })

    it('a query with zero matches returns total:0, matches:[], nextCursor:null honestly (not an error)', async () => {
      writeStream('backend', jsonLine({ level: 30, msg: 'nothing relevant' }))
      const result = await scanAll('backend', { text: 'zzz-not-present' })
      expect(result).toEqual({ total: 0, matches: [], nextCursor: null })
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Covers AE2: a large fixture whose only match sits near the very top.
  // Mirrors log-reader.service.spec.ts's own precedent of reducing the
  // plan's literal "200 MB" figure to a CI-safe proxy size (24 MiB there);
  // the assertion under test (an exact whole-file count regardless of file
  // size, plus bounded memory) does not get any stronger with a bigger
  // file — it only gets slower to generate and scan.
  // ───────────────────────────────────────────────────────────────────────
  describe('AE2 + R20: large-file top-of-file match + bounded memory', () => {
    function writeLargeFixtureWithTopMatch(stream: LogStream): {
      filePath: string
      matchOffset: number
    } {
      const filePath = path.join(
        tmpDir,
        `${stream}.${process.env.NODE_ENV === 'production' ? 'prod' : 'dev'}.log`,
      )
      const matchLine = jsonLine({
        level: 30,
        time: 0,
        msg: 'NEEDLE-IN-HAYSTACK',
      })
      const fillerLine = jsonLine({ level: 30, time: 1, msg: 'x'.repeat(200) })
      const fillerBytes = Buffer.byteLength(fillerLine, 'utf8')
      const targetBytes = 24 * 1024 * 1024 // 24 MiB, see this describe's own header comment
      const fillerLineCount = Math.ceil(targetBytes / fillerBytes)

      const fd = fs.openSync(filePath, 'w')
      try {
        fs.writeSync(fd, matchLine) // the ONLY match, right at the top
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
      return { filePath, matchOffset: 0 }
    }

    it('finds the single top-of-file match with an exact count, regardless of file size', async () => {
      const { matchOffset } = writeLargeFixtureWithTopMatch('backend')
      const result = await scanAll('backend', { text: 'NEEDLE-IN-HAYSTACK' })
      expect(result.total).toBe(1)
      expect(result.matches).toEqual([matchOffset])
    }, 15000)

    it('peak memory during the scan stays bounded (roughly one block + one page of offsets), not proportional to file size', async () => {
      writeLargeFixtureWithTopMatch('backend')

      // Same proxy this codebase already uses for "peak allocation" in
      // log-reader.service.spec.ts's own R20/AE3 integration test: wrap
      // Buffer.allocUnsafe (the ONLY allocation primitive this service's
      // block-read loop calls per iteration) and track the largest single
      // allocation observed.
      let peakAlloc = 0
      const allocSpy = jest
        .spyOn(Buffer, 'allocUnsafe')
        .mockImplementation((size: number) => {
          peakAlloc = Math.max(peakAlloc, size)
          return Buffer.alloc(size)
        })

      try {
        const start = Date.now()
        const result = await service.scan({
          stream: 'backend',
          predicate: { text: 'NEEDLE-IN-HAYSTACK' },
        })
        const elapsedMs = Date.now() - start

        expect(result.total).toBe(1)
        // Bounded time: a whole-file scan must complete quickly even on a
        // 24 MiB file — never scale into multi-second territory for a CI
        // run.
        expect(elapsedMs).toBeLessThan(5000)
        // Bounded memory: no single read-loop allocation exceeded the
        // block size — never proportional to the 24 MiB file.
        expect(peakAlloc).toBeGreaterThan(0)
        expect(peakAlloc).toBeLessThanOrEqual(SEARCH_BLOCK_BYTES)
      } finally {
        allocSpy.mockRestore()
      }
    }, 15000)
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (scaling + pagination): a term matching a large fraction of
  // lines returns an exact total but only a bounded first page + nextCursor;
  // the next page resumes correctly and never re-derives page-1 matches.
  // ───────────────────────────────────────────────────────────────────────
  describe('pagination: bounded page + nextCursor, resume without rescanning from the top', () => {
    // MAX_MATCHES_PER_PAGE is 200 (the service's own local constant) — this
    // fixture has MORE matching lines than that, so a full page + a
    // non-null nextCursor is the genuinely correct outcome, not a fixture
    // that happens to undershoot the cap.
    function writeManyMatchesFixture(): { totalMatches: number } {
      const N = 250
      const lines: string[] = []
      for (let i = 0; i < N; i++) {
        lines.push(jsonLine({ level: 30, time: i, msg: `match-${i}` }))
      }
      writeStream('backend', lines.join(''))
      return { totalMatches: N }
    }

    it('page 1 returns exactly MAX_MATCHES_PER_PAGE (200) offsets, the exact total, and a non-null nextCursor', async () => {
      const { totalMatches } = writeManyMatchesFixture()
      const result = await service.scan({
        stream: 'backend',
        predicate: { text: 'match-' },
      })
      expect(result.total).toBe(totalMatches)
      expect(result.matches).toHaveLength(200)
      expect(result.nextCursor).not.toBeNull()
    })

    it('page 2 (via nextCursor) resumes correctly, returns the SAME total, and never re-derives page-1 offsets', async () => {
      const { totalMatches } = writeManyMatchesFixture()
      const page1 = await service.scan({
        stream: 'backend',
        predicate: { text: 'match-' },
      })
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await service.scan({
        stream: 'backend',
        predicate: { text: 'match-' },
        cursor: page1.nextCursor ?? undefined,
      })

      expect(page2.total).toBe(totalMatches)
      // 250 total, 200 on page 1 -> exactly 50 remain.
      expect(page2.matches).toHaveLength(50)
      expect(page2.nextCursor).toBeNull()

      // No overlap between the two pages' offsets, and every page-2 offset
      // is strictly greater than every page-1 offset (byte-monotonic
      // resume, never a rescan from the top).
      const page1Offsets = new Set(page1.matches.map(m => m.byteOffset))
      for (const m of page2.matches) {
        expect(page1Offsets.has(m.byteOffset)).toBe(false)
      }
      const maxPage1Offset = Math.max(...page1.matches.map(m => m.byteOffset))
      const minPage2Offset = Math.min(...page2.matches.map(m => m.byteOffset))
      expect(minPage2Offset).toBeGreaterThan(maxPage1Offset)
    })

    it('the second request never reads bytes before the first page resume point (proves no rescan-from-the-top, not just correct output)', async () => {
      writeManyMatchesFixture()
      const page1 = await service.scan({
        stream: 'backend',
        predicate: { text: 'match-' },
      })
      expect(page1.nextCursor).not.toBeNull()

      // Track every [position, length) region actually read via
      // handle.read — a resumed scan must never issue a read whose start
      // position is less than the cursor's own resumeOffset.
      const decodedResumeOffset = parseInt(
        (page1.nextCursor ?? '').split(':')[0] ?? '-1',
        10,
      )
      expect(decodedResumeOffset).toBeGreaterThan(0)

      const spies = await spyOnNextOpenedHandle()
      try {
        await service.scan({
          stream: 'backend',
          predicate: { text: 'match-' },
          cursor: page1.nextCursor ?? undefined,
        })

        const readSpy = spies.getReadSpy()
        expect(readSpy).toBeDefined()
        expect(readSpy?.mock.calls.length).toBeGreaterThan(0)
        for (const call of readSpy?.mock.calls ?? []) {
          // handle.read(buffer, offset, length, position) — position is
          // the 4th argument.
          const position = call[3] as number
          expect(position).toBeGreaterThanOrEqual(decodedResumeOffset)
        }
      } finally {
        spies.restore()
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (growing file, THE KEY CONSISTENCY TEST): total stays frozen
  // across pages even if the file grows with MORE matching lines in
  // between — because ceiling/total are baked into the cursor, never
  // re-derived from a fresh stat.
  // ───────────────────────────────────────────────────────────────────────
  describe('growing file: total stays frozen across pages (cursor-encoded ceiling/total, never re-derived)', () => {
    it("appending new matching lines after page 1 does NOT change page 2's total or surface the newly-appended matches", async () => {
      const N = 250 // > MAX_MATCHES_PER_PAGE(200), so page 1 leaves a nextCursor
      const lines: string[] = []
      for (let i = 0; i < N; i++) {
        lines.push(jsonLine({ level: 30, time: i, msg: `grow-${i}` }))
      }
      const filePath = writeStream('backend', lines.join(''))

      const page1 = await service.scan({
        stream: 'backend',
        predicate: { text: 'grow-' },
      })
      expect(page1.total).toBe(N)
      expect(page1.nextCursor).not.toBeNull()

      // Append MORE matching lines to the file AFTER page 1 completed, but
      // BEFORE fetching page 2 with page 1's own cursor.
      const appended = Array.from({ length: 25 }, (_, i) =>
        jsonLine({ level: 30, time: 1000 + i, msg: `grow-new-${i}` }),
      ).join('')
      fs.appendFileSync(filePath, appended)

      const page2 = await service.scan({
        stream: 'backend',
        predicate: { text: 'grow-' },
        cursor: page1.nextCursor ?? undefined,
      })

      // The KEY assertion: page 2's total is IDENTICAL to page 1's, even
      // though the file now unambiguously contains more matching lines.
      expect(page2.total).toBe(page1.total)
      expect(page2.total).toBe(N)

      // The newly-appended lines must not appear anywhere in page 2's
      // offsets (they live entirely past the frozen ceiling).
      const appendedOffsets = new Set<number>()
      let runningOffset = Buffer.byteLength(lines.join(''), 'utf8')
      for (const line of appended.split('\n').filter(l => l.length > 0)) {
        appendedOffsets.add(runningOffset)
        runningOffset += Buffer.byteLength(line + '\n', 'utf8')
      }
      for (const m of page2.matches) {
        expect(appendedOffsets.has(m.byteOffset)).toBe(false)
      }

      // A genuinely fresh (no-cursor) scan run AFTER the append, in
      // contrast, DOES see the larger total — proving the frozen behavior
      // above is specific to resuming an EXISTING cursor, not a permanent
      // inability to ever observe growth.
      const freshScan = await service.scan({
        stream: 'backend',
        predicate: { text: 'grow-' },
      })
      expect(freshScan.total).toBe(N + 25)
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Covers AE6 (R11): structured filters (process/level) compose with text.
  // ───────────────────────────────────────────────────────────────────────
  describe('AE6 (R11): structured filters compose with text', () => {
    it("stream=backend, process=bot, level>=40, text='x' reflects only bot warn+ lines containing 'x'", async () => {
      const lines = [
        jsonLine({ level: 40, process: 'bot', event: 'e', msg: 'has-x-here' }), // match
        jsonLine({ level: 30, process: 'bot', event: 'e', msg: 'has-x-here' }), // level too low
        jsonLine({ level: 50, process: 'main', event: 'e', msg: 'has-x-here' }), // wrong process
        jsonLine({
          level: 40,
          process: 'bot',
          event: 'e',
          msg: 'no-match-here',
        }), // no 'x' substring at all
        jsonLine({ level: 60, process: 'bot', event: 'e', msg: 'x-fatal' }), // match (level 60 >= 40)
      ]
      writeStream('backend', lines.join(''))

      const predicate: LogScanPredicate = {
        process: 'bot',
        level: 40,
        text: 'x',
      }
      const result = await scanAll('backend', predicate)

      // Line 0 (level 40, bot, "has-x-here") and line 4 (level 60, bot,
      // "x-fatal") both match; line 3 has no 'x' substring at all
      // ("no-match-here" does not contain 'x'), line 1's level is below the
      // threshold, line 2 is the wrong process.
      expect(result.total).toBe(2)
    })

    it("process:'both' (or omitted) imposes no process constraint at all", async () => {
      writeStream(
        'backend',
        jsonLine({ level: 30, process: 'main', msg: 'x' }) +
          jsonLine({ level: 30, process: 'bot', msg: 'x' }),
      )
      const withBoth = await scanAll('backend', { process: 'both', text: 'x' })
      const withOmitted = await scanAll('backend', { text: 'x' })
      expect(withBoth.total).toBe(2)
      expect(withOmitted.total).toBe(2)
    })

    it('level filter is a MINIMUM threshold (>=), not an exact match', async () => {
      writeStream(
        'backend',
        jsonLine({ level: 30, msg: 'a' }) +
          jsonLine({ level: 40, msg: 'a' }) +
          jsonLine({ level: 50, msg: 'a' }) +
          jsonLine({ level: 60, msg: 'a' }),
      )
      const result = await scanAll('backend', { level: 40 })
      expect(result.total).toBe(3) // 40, 50, 60 — not 30
    })

    it('event filter is an EXACT slug match, and excludes a valid debug line with no event field (not treated as malformed)', async () => {
      writeStream(
        'backend',
        jsonLine({ level: 20, msg: 'a debug line, no event field' }) + // valid, no event
          jsonLine({ level: 30, event: 'writer-fault', msg: 'b' }) + // matches
          jsonLine({ level: 30, event: 'other-event', msg: 'c' }), // wrong event
      )
      const result = await scanAll('backend', { event: 'writer-fault' })
      expect(result.total).toBe(1)
    })

    it('all active predicate fields AND together (every field must be satisfied, not any)', async () => {
      writeStream(
        'backend',
        jsonLine({ level: 50, process: 'bot', event: 'e1', msg: 'yes' }) + // matches all
          jsonLine({ level: 50, process: 'bot', event: 'e2', msg: 'yes' }) + // wrong event
          jsonLine({ level: 50, process: 'main', event: 'e1', msg: 'yes' }) + // wrong process
          jsonLine({ level: 30, process: 'bot', event: 'e1', msg: 'yes' }), // level too low
      )
      const result = await scanAll('backend', {
        level: 40,
        process: 'bot',
        event: 'e1',
        text: 'yes',
      })
      expect(result.total).toBe(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case (R14): malformed lines are text-searchable but excluded the
  // instant any structured filter is active.
  // ───────────────────────────────────────────────────────────────────────
  describe('R14: malformed-line handling', () => {
    it('a malformed (non-JSON) line matches a pure text query (findable)', async () => {
      writeStream(
        'backend',
        jsonLine({ level: 30, msg: 'a valid line' }) +
          'not json at all but contains MARKER\n' +
          jsonLine({ level: 30, msg: 'another valid line' }),
      )
      const result = await scanAll('backend', { text: 'MARKER' })
      expect(result.total).toBe(1)
    })

    it('the SAME malformed line is excluded the moment ANY structured filter is active (level)', async () => {
      writeStream(
        'backend',
        'not json at all but contains MARKER\n' +
          jsonLine({ level: 40, msg: 'MARKER too, but valid JSON' }),
      )
      const result = await scanAll('backend', { text: 'MARKER', level: 30 })
      expect(result.total).toBe(1) // only the valid JSON line
    })

    it('excluded the moment a process filter is active', async () => {
      writeStream(
        'backend',
        'not json at all but contains MARKER\n' +
          jsonLine({ level: 30, process: 'bot', msg: 'MARKER too' }),
      )
      const result = await scanAll('backend', {
        text: 'MARKER',
        process: 'bot',
      })
      expect(result.total).toBe(1)
    })

    it('excluded the moment an event filter is active', async () => {
      writeStream(
        'backend',
        'not json at all but contains MARKER\n' +
          jsonLine({ level: 30, event: 'e', msg: 'MARKER too' }),
      )
      const result = await scanAll('backend', { text: 'MARKER', event: 'e' })
      expect(result.total).toBe(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case: a final unterminated line (no trailing '\n') at true EOF is
  // still included in the scan (text-searchable), not silently dropped.
  // ───────────────────────────────────────────────────────────────────────
  describe('unterminated final line at true EOF', () => {
    it('a partial final line with no trailing newline is still text-searchable, not dropped', async () => {
      const complete = jsonLine({ level: 30, msg: 'complete line' })
      const partial = '{"level":30,"msg":"UNFINISHED-MARKER-tail' // no trailing \n
      writeStream('backend', complete + partial)

      const result = await scanAll('backend', { text: 'UNFINISHED-MARKER' })
      expect(result.total).toBe(1)
      expect(result.matches).toEqual([Buffer.byteLength(complete, 'utf8')])
    })

    it('an unterminated final line is excluded once a structured filter is active (it has no parsed fields — it is not valid JSON)', async () => {
      const partial = '{"level":30,"msg":"UNFINISHED-MARKER-tail'
      writeStream('backend', partial)

      const result = await scanAll('backend', {
        text: 'UNFINISHED-MARKER',
        level: 30,
      })
      expect(result.total).toBe(0)
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Error path: an invalid/tampered cursor string.
  // ───────────────────────────────────────────────────────────────────────
  describe('error path: invalid cursor', () => {
    beforeEach(() => {
      writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
    })

    it('non-numeric garbage is rejected with BadRequestException', async () => {
      await expect(
        service.scan({
          stream: 'backend',
          predicate: {},
          cursor: 'not-a-cursor-at-all',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('a resumeOffset greater than the encoded ceiling is rejected with BadRequestException', async () => {
      await expect(
        service.scan({
          stream: 'backend',
          predicate: {},
          cursor: '999:100:0', // resumeOffset(999) > ceiling(100)
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('a partially-numeric malformed cursor (wrong shape) is rejected', async () => {
      await expect(
        service.scan({
          stream: 'backend',
          predicate: {},
          cursor: '10:20', // missing the third segment
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('a negative-looking cursor segment is rejected (the pattern requires unsigned digits)', async () => {
      await expect(
        service.scan({
          stream: 'backend',
          predicate: {},
          cursor: '-5:100:0',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Error path: aborting mid-scan stops the read cleanly, no leaked handle.
  // ───────────────────────────────────────────────────────────────────────
  describe('error path: abort mid-scan', () => {
    it('aborting via the AbortSignal stops the read and closes the FileHandle (no dangling handle)', async () => {
      // A large-enough fixture that the scan spans multiple block reads,
      // giving the abort a real window to land mid-scan rather than the
      // whole file completing in a single block.
      const fillerLine = jsonLine({ level: 30, msg: 'x'.repeat(200) })
      const fillerBytes = Buffer.byteLength(fillerLine, 'utf8')
      const targetBytes = SEARCH_BLOCK_BYTES * 5
      const lineCount = Math.ceil(targetBytes / fillerBytes)
      writeStream('backend', fillerLine.repeat(lineCount))

      const abortController = new AbortController()
      let readCallCount = 0
      // Intercept the REAL handle the service opens (see
      // spyOnNextOpenedHandle's own header comment on why this is the
      // reliable way to spy on both read/close for one specific instance)
      // and additionally install a custom read behavior that counts calls
      // and triggers the abort partway through, while still calling straight
      // through to the real read implementation every time — this is what
      // lets the test observe "the loop was mid-scan, not yet at EOF"
      // without needing to fake any actual read behavior.
      const realOpen = fs.promises.open.bind(fs.promises)
      const openSpy = jest
        .spyOn(fs.promises, 'open')
        .mockImplementation(
          async (...args: Parameters<typeof fs.promises.open>) => {
            const handle = await realOpen(...args)
            const originalRead = handle.read.bind(handle)
            jest
              .spyOn(handle, 'read')
              .mockImplementation(
                (...readArgs: Parameters<typeof handle.read>) => {
                  readCallCount++
                  if (readCallCount === 2) abortController.abort()
                  return originalRead(...readArgs)
                },
              )
            jest.spyOn(handle, 'close')
            return handle
          },
        )

      try {
        await expect(
          service.scan({
            stream: 'backend',
            predicate: { text: 'x' },
            signal: abortController.signal,
          }),
        ).rejects.toThrow()

        // The abort fired right after the 2nd block read (see the mock
        // above) and the loop's own abort check runs at the TOP of each
        // iteration, before issuing the next read — so exactly 2 reads
        // happen, well short of the ~5 blocks the fixture would otherwise
        // require, proving the loop genuinely stopped rather than the scan
        // simply finishing naturally on its own before the signal mattered.
        expect(readCallCount).toBe(2)
        const openedHandle = await openSpy.mock.results[0]?.value
        expect(openedHandle?.close).toHaveBeenCalled()
      } finally {
        openSpy.mockRestore()
      }
    })

    it('a signal that is ALREADY aborted before scan() is called still closes the handle it opened, never reading a byte', async () => {
      writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
      const spies = await spyOnNextOpenedHandle()

      const abortController = new AbortController()
      abortController.abort()

      try {
        await expect(
          service.scan({
            stream: 'backend',
            predicate: {},
            signal: abortController.signal,
          }),
        ).rejects.toThrow()

        expect(spies.getReadSpy()).not.toHaveBeenCalled()
        expect(spies.getCloseSpy()).toHaveBeenCalled()
      } finally {
        spies.restore()
      }
    })

    it('does NOT log log-search-failed for a clean abort (only for a genuine read error)', async () => {
      writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
      const abortController = new AbortController()
      abortController.abort()

      await expect(
        service.scan({
          stream: 'backend',
          predicate: {},
          signal: abortController.signal,
        }),
      ).rejects.toThrow()

      expect(logger.error).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: LOG_EVENTS.logSearchFailed }),
        expect.any(String),
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Error path: unknown stream (R17) — enforced at the DTO/controller
  // layer, not by this service re-validating a string; documents the same
  // split as log-reader.service.spec.ts's own identical-purpose test.
  // ───────────────────────────────────────────────────────────────────────
  it('error path (R17): the service accepts every valid LogStream (rejection of unknown streams is enforced at the DTO/controller layer)', async () => {
    const validStreams: LogStream[] = [
      'backend',
      'frontend-server',
      'frontend-browser',
    ]
    for (const stream of validStreams) {
      writeStream(stream, jsonLine({ level: 30, msg: 'x' }))
      await expect(
        service.scan({ stream, predicate: {} }),
      ).resolves.toBeDefined()
    }
  })

  // ───────────────────────────────────────────────────────────────────────
  // Edge case: a stream that has never been written to (ENOENT) is a normal
  // empty state, not an error — mirrors every other logging/*.service.ts
  // file's identical ENOENT contract.
  // ───────────────────────────────────────────────────────────────────────
  it('a stream whose file does not exist yet returns an honest empty result, no error', async () => {
    const result = await service.scan({
      stream: 'frontend-server',
      predicate: { text: 'anything' },
    })
    expect(result).toEqual({ total: 0, matches: [], nextCursor: null })
    expect(logger.error).not.toHaveBeenCalled()
  })

  // ───────────────────────────────────────────────────────────────────────
  // Real read error path: a non-ENOENT stat failure is logged and thrown.
  // ───────────────────────────────────────────────────────────────────────
  it('on a genuine stat failure, logs log-search-failed and throws', async () => {
    writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
    const statSpy = jest.spyOn(fs.promises, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      }),
    )

    try {
      await expect(
        service.scan({ stream: 'backend', predicate: {} }),
      ).rejects.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: LOG_EVENTS.logSearchFailed,
          stream: 'backend',
        }),
        expect.any(String),
      )
    } finally {
      statSpy.mockRestore()
    }
  })
})
