import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { LOG_EVENTS } from 'src/logging/log-events'
import type { LogStream } from 'src/logging/log-view.types'

import {
  LogReaderService,
  snapLineBoundaryBackward,
  snapLineBoundaryForward,
  snapWindow,
} from './log-reader.service'

// ─────────────────────────────────────────────────────────────────────────
// Part 1: pure byte-scanning/snapping helpers — no fs at all, fixed Buffers
// only. This is the highest-risk logic (an off-by-one here corrupts every
// rendered line downstream), so it is exercised first and in isolation, per
// the unit's own execution note.
// ─────────────────────────────────────────────────────────────────────────

describe('snapLineBoundaryBackward (pure, in-memory buffer)', () => {
  // 'line1\nline2\nline3\n' — byte offsets: line1\n = [0,6), line2\n = [6,12),
  // line3\n = [12,18).
  const buf = Buffer.from('line1\nline2\nline3\n', 'utf8')

  it('an offset already at a line-start boundary (0) snaps to itself', () => {
    expect(snapLineBoundaryBackward(buf, 0)).toBe(0)
  })

  it('an offset already at a line-start boundary (mid-file) snaps to itself', () => {
    expect(snapLineBoundaryBackward(buf, 6)).toBe(6)
    expect(snapLineBoundaryBackward(buf, 12)).toBe(12)
  })

  it('an offset landing mid-line snaps backward to the start of that line', () => {
    expect(snapLineBoundaryBackward(buf, 8)).toBe(6) // mid "line2"
    expect(snapLineBoundaryBackward(buf, 17)).toBe(12) // mid "line3"
  })

  it('an offset at EOF that is itself already a line-start boundary snaps to itself', () => {
    // buf ends in '\n' (a clean EOF), so buf.length is itself already a
    // valid line-start boundary — nothing follows it to snap back over.
    expect(snapLineBoundaryBackward(buf, buf.length)).toBe(buf.length)
  })

  it("an offset at EOF with a trailing partial (unterminated) line snaps to that line's start", () => {
    const noTrailingNl = Buffer.from('line1\nline2\npartial', 'utf8')
    expect(snapLineBoundaryBackward(noTrailingNl, noTrailingNl.length)).toBe(12)
  })

  it('an offset with no preceding newline at all snaps to byte 0', () => {
    expect(snapLineBoundaryBackward(buf, 3)).toBe(0)
  })
})

describe('snapLineBoundaryForward (pure, in-memory buffer)', () => {
  const buf = Buffer.from('line1\nline2\nline3\n', 'utf8')

  it('an offset already at a line-start boundary snaps to itself', () => {
    expect(snapLineBoundaryForward(buf, 0)).toBe(0)
    expect(snapLineBoundaryForward(buf, 6)).toBe(6)
    expect(snapLineBoundaryForward(buf, 12)).toBe(12)
    expect(snapLineBoundaryForward(buf, 18)).toBe(18)
  })

  it("an offset landing mid-line snaps forward to just past that line's newline", () => {
    expect(snapLineBoundaryForward(buf, 8)).toBe(12) // mid "line2" -> after line2's \n
    expect(snapLineBoundaryForward(buf, 1)).toBe(6) // mid "line1" -> after line1's \n
  })

  it('an offset inside a final line with NO trailing newline snaps forward to EOF', () => {
    const noTrailingNl = Buffer.from('line1\nline2\npartial', 'utf8')
    expect(snapLineBoundaryForward(noTrailingNl, 15)).toBe(noTrailingNl.length)
  })
})

describe('snapWindow (pure, in-memory buffer, direction semantics)', () => {
  // Buffer is treated as if it were the WHOLE file (fileOffset 0), so this
  // exercises snapWindow's own boundary math against a buffer directly,
  // decoupled from any fs concern (bounded look-back is a log-reader.service
  // detail layered on top for real files).
  const buf = Buffer.from('line1\nline2\nline3\n', 'utf8') // length 18

  it('before: anchor at EOF (fileSize) returns a window ending at EOF, start snapped to a maxBytes-bounded line boundary', () => {
    const { start, end } = snapWindow(buf, buf.length, 'before', 100)
    expect(end).toBe(18) // anchor was already a line boundary (EOF == end of line3)
    expect(start).toBe(0) // maxBytes(100) exceeds the whole buffer, so start floors at 0
  })

  it('before: anchor mid-line excludes that line entirely (never a split line)', () => {
    // anchor=8 is mid "line2" (bytes [6,12)). The window must end at 6 (the
    // START of line2), not include any part of line2.
    const { start, end } = snapWindow(buf, 8, 'before', 100)
    expect(end).toBe(6)
    expect(start).toBe(0)
  })

  it('before: anchor exactly at a line-start boundary (12) excludes line3, includes line1+line2', () => {
    const { start, end } = snapWindow(buf, 12, 'before', 100)
    expect(end).toBe(12)
    expect(start).toBe(0)
  })

  it('before: a small maxBytes bounds the start (does not walk back past the cap)', () => {
    // end=18 (EOF); maxBytes=5 -> raw start = 13, snapped BACKWARD to the
    // nearest line boundary at or before 13, which is 12.
    const { start, end } = snapWindow(buf, 18, 'before', 5)
    expect(end).toBe(18)
    expect(start).toBe(12)
  })

  it('after: anchor at byte 0 (already a line-start) returns a window starting at 0', () => {
    const { start, end } = snapWindow(buf, 0, 'after', 100)
    expect(start).toBe(0)
    expect(end).toBe(18)
  })

  it('after: anchor mid-line excludes that line entirely, starts at the NEXT line', () => {
    // anchor=8 is mid "line2". The window must start at 12 (line3's start),
    // never re-including any part of line2.
    const { start, end } = snapWindow(buf, 8, 'after', 100)
    expect(start).toBe(12)
    expect(end).toBe(18)
  })

  it('after: a small maxBytes bounds the end (does not walk forward past the cap)', () => {
    // start=0; maxBytes=4 -> raw end = 4, snapped FORWARD to the nearest
    // line boundary at or after 4, which is 6 (end of "line1\n").
    const { start, end } = snapWindow(buf, 0, 'after', 4)
    expect(start).toBe(0)
    expect(end).toBe(6)
  })

  it('around: centers on the anchor, guaranteeing the containing line is whole and present', () => {
    // anchor=8 (mid "line2", [6,12)). maxBytes=100 easily covers the whole
    // buffer once centered, so the result should just be the full buffer.
    const { start, end } = snapWindow(buf, 8, 'around', 100)
    expect(start).toBe(0)
    expect(end).toBe(18)
  })

  it('around: a tight maxBytes still keeps the containing line whole', () => {
    // anchor=8 is mid "line2" ([6,12)). Even with a maxBytes of 1 (smaller
    // than half the containing line itself), the containing line must not
    // be split: start must be <=6 and end must be >=12.
    const { start, end } = snapWindow(buf, 8, 'around', 1)
    expect(start).toBeLessThanOrEqual(6)
    expect(end).toBeGreaterThanOrEqual(12)
    // And both bounds are still snapped to real line boundaries.
    expect(snapLineBoundaryBackward(buf, start)).toBe(start)
    expect(snapLineBoundaryForward(buf, end)).toBe(end)
  })

  it('around: anchor exactly on a boundary still includes a containing line, not an empty window', () => {
    // anchor=6 sits exactly between line1 and line2 — the "containing line"
    // for a boundary anchor is defined as the line that STARTS at anchor
    // (line2, [6,12)), matching the `after` convention above.
    const { start, end } = snapWindow(buf, 6, 'around', 100)
    expect(start).toBe(0)
    expect(end).toBe(18)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Part 2: LogReaderService — real seek-based reads against real temp files.
// No fs mocking: the plan wants real positioned reads proven against real
// files (memory/time bounds, EOF races, multi-byte UTF-8 framing).
// ─────────────────────────────────────────────────────────────────────────

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

describe('LogReaderService (real temp files)', () => {
  let tmpDir: string
  let logger: PinoLogger
  let service: LogReaderService

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-code-log-reader-'))
    logger = fakeLogger()
    const moduleRef = await Test.createTestingModule({
      providers: [LogReaderService, { provide: PinoLogger, useValue: logger }],
    }).compile()
    service = moduleRef.get(LogReaderService)
    // Point the service at our temp dir instead of the real /tmp/tdr-code —
    // see log-reader.service.ts's own header comment on this test seam.
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

  it("happy path: direction=before from fileSize returns the file's last complete lines with correct offsets and atEnd:true", async () => {
    const lines = [
      jsonLine({ level: 30, time: 1, msg: 'one' }),
      jsonLine({ level: 30, time: 2, msg: 'two' }),
      jsonLine({ level: 30, time: 3, msg: 'three' }),
    ]
    const content = lines.join('')
    writeStream('backend', content)

    const result = await service.readWindow({
      stream: 'backend',
      anchor: content.length,
      direction: 'before',
      maxBytes: 4096,
    })

    expect(result.fileSize).toBe(content.length)
    expect(result.atEnd).toBe(true)
    expect(result.windowEnd).toBe(content.length)
    expect(result.lines).toHaveLength(3)
    expect(result.lines[2]?.parsed).toEqual({
      level: 30,
      time: 3,
      msg: 'three',
    })
    // byteOffsets are cumulative and correct.
    let expectedOffset = 0
    for (let i = 0; i < result.lines.length; i++) {
      const line = result.lines[i]
      expect(line?.byteOffset).toBe(expectedOffset)
      expect(line?.byteLength).toBe(lines[i]?.length)
      expectedOffset += lines[i]?.length ?? 0
    }
  })

  it('happy path: direction=before from a mid-file offset returns lines strictly before it, atStart:false; walking before repeatedly reaches atStart:true at byte 0', async () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      jsonLine({ level: 30, time: i, msg: `line-${i}` }),
    )
    const content = lines.join('')
    writeStream('backend', content)

    // Anchor at the offset where line 10 begins — "before" should return
    // lines strictly before it, never line 10 itself. maxBytes is
    // deliberately small (less than the 0..9 span) so this genuinely
    // exercises "atStart:false, more to fetch" rather than a maxBytes large
    // enough to already reach byte 0 in one call (which the walk-to-atStart
    // loop below covers separately with an even tighter cap).
    const anchorOffset = lines.slice(0, 10).join('').length
    const firstWindow = await service.readWindow({
      stream: 'backend',
      anchor: anchorOffset,
      direction: 'before',
      maxBytes: 64,
    })

    expect(firstWindow.windowEnd).toBe(anchorOffset)
    expect(firstWindow.atStart).toBe(false)
    const lastLineMsg = firstWindow.lines.at(-1)?.parsed?.msg
    expect(lastLineMsg).toBe('line-9')

    // Walk `before` repeatedly using a tight maxBytes until atStart.
    let cursor = firstWindow.windowStart
    let atStart = firstWindow.atStart
    let guard = 0
    while (!atStart && guard < 50) {
      const w = await service.readWindow({
        stream: 'backend',
        anchor: cursor,
        direction: 'before',
        maxBytes: 64,
      })
      cursor = w.windowStart
      atStart = w.atStart
      guard++
    }
    expect(atStart).toBe(true)
    expect(cursor).toBe(0)
  })

  it('edge case: anchor landing mid-line snaps outward — never a split JSON line', async () => {
    const lines = [
      jsonLine({ level: 30, time: 1, msg: 'aaaaaaaaaa' }),
      jsonLine({ level: 30, time: 2, msg: 'bbbbbbbbbb' }),
      jsonLine({ level: 30, time: 3, msg: 'cccccccccc' }),
    ]
    const content = lines.join('')
    writeStream('backend', content)

    // Anchor lands squarely inside line 2 (index 1).
    const line1Start = lines[0]?.length ?? 0
    const midLine2 = line1Start + Math.floor((lines[1]?.length ?? 0) / 2)

    const before = await service.readWindow({
      stream: 'backend',
      anchor: midLine2,
      direction: 'before',
      maxBytes: 4096,
    })
    // "before" must exclude line2 entirely (it contains the anchor).
    expect(before.lines.map(l => l.parsed?.msg)).toEqual(['aaaaaaaaaa'])
    expect(before.windowEnd).toBe(line1Start)

    const after = await service.readWindow({
      stream: 'backend',
      anchor: midLine2,
      direction: 'after',
      maxBytes: 4096,
    })
    // "after" must also exclude line2 entirely, starting at line3.
    expect(after.lines.map(l => l.parsed?.msg)).toEqual(['cccccccccc'])
    expect(after.windowStart).toBe(line1Start + (lines[1]?.length ?? 0))

    // Every raw line is valid, complete JSON — never truncated mid-object.
    for (const l of [...before.lines, ...after.lines]) {
      expect(() => JSON.parse(l.raw)).not.toThrow()
    }
  })

  it("happy path (around): centered window contains the anchor's line whole and present, boundaries line-aligned", async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      jsonLine({ level: 30, time: i, msg: `line-${i}` }),
    )
    const content = lines.join('')
    writeStream('backend', content)

    const line5Start = lines.slice(0, 5).join('').length
    const midLine5 = line5Start + Math.floor((lines[5]?.length ?? 0) / 2)

    const result = await service.readWindow({
      stream: 'backend',
      anchor: midLine5,
      direction: 'around',
      maxBytes: 4096,
    })

    const msgs = result.lines.map(l => l.parsed?.msg)
    expect(msgs).toContain('line-5')
    // Boundaries are exact line starts (never a split JSON line).
    for (const l of result.lines) {
      expect(() => JSON.parse(l.raw)).not.toThrow()
    }
  })

  it('edge case (R14): a final line lacking a trailing newline is dropped; preceding complete lines parse; no throw', async () => {
    const complete = jsonLine({ level: 30, time: 1, msg: 'complete' })
    const partial = '{"level":30,"time":2,"msg":"unfinis' // no trailing \n, truncated
    writeStream('backend', complete + partial)

    const result = await service.readWindow({
      stream: 'backend',
      anchor: complete.length + partial.length,
      direction: 'before',
      maxBytes: 4096,
    })

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.parsed).toEqual({
      level: 30,
      time: 1,
      msg: 'complete',
    })
  })

  it('edge case (R14): a stray non-JSON line mid-file yields {raw, parsed:null} without aborting the window; the next line parses', async () => {
    const line1 = jsonLine({ level: 30, time: 1, msg: 'good-one' })
    const strayLine = 'not json at all\n'
    const line3 = jsonLine({ level: 30, time: 3, msg: 'good-two' })
    writeStream('backend', line1 + strayLine + line3)

    const result = await service.readWindow({
      stream: 'backend',
      anchor: (line1 + strayLine + line3).length,
      direction: 'before',
      maxBytes: 4096,
    })

    expect(result.lines).toHaveLength(3)
    expect(result.lines[0]?.parsed).toEqual({
      level: 30,
      time: 1,
      msg: 'good-one',
    })
    expect(result.lines[1]?.parsed).toBeNull()
    expect(result.lines[1]?.raw).toBe('not json at all')
    expect(result.lines[2]?.parsed).toEqual({
      level: 30,
      time: 3,
      msg: 'good-two',
    })
  })

  it('edge case: an empty file resolves to fileSize:0, lines:[], atStart:true, atEnd:true, no error', async () => {
    writeStream('backend', '')

    const result = await service.readWindow({
      stream: 'backend',
      anchor: 0,
      direction: 'before',
      maxBytes: 4096,
    })

    expect(result).toEqual({
      stream: 'backend',
      fileSize: 0,
      windowStart: 0,
      windowEnd: 0,
      atStart: true,
      atEnd: true,
      lines: [],
    })
  })

  it('edge case: an absent file (frontend-server never created) resolves the same empty shape, no error', async () => {
    // Deliberately do NOT call writeStream for frontend-server.
    const result = await service.readWindow({
      stream: 'frontend-server',
      anchor: 0,
      direction: 'before',
      maxBytes: 4096,
    })

    expect(result).toEqual({
      stream: 'frontend-server',
      fileSize: 0,
      windowStart: 0,
      windowEnd: 0,
      atStart: true,
      atEnd: true,
      lines: [],
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('edge case (UTF-8): a line with a multi-byte character across the nominal window edge decodes intact', async () => {
    // Multi-byte content (emoji + accented chars) padded so the line sits
    // right at a maxBytes boundary the backward scan must cross correctly.
    // Anchors/offsets below are always BYTE lengths (Buffer.byteLength), not
    // JS string .length (UTF-16 code units) — the two diverge for this
    // fixture's multibyte content, and readWindow's anchor is a byte offset.
    const filler = jsonLine({ level: 30, time: 1, msg: 'x'.repeat(50) })
    const multibyte = jsonLine({
      level: 30,
      time: 2,
      msg: '日本語テスト 🎉 café',
    })
    const content = filler + multibyte
    const contentBytes = Buffer.byteLength(content, 'utf8')
    writeStream('backend', content)

    const result = await service.readWindow({
      stream: 'backend',
      anchor: contentBytes,
      direction: 'before',
      // Tight enough that the raw byte cut could land inside the multibyte
      // line's UTF-8 sequence if boundary-finding weren't newline-anchored.
      maxBytes: Buffer.byteLength(multibyte, 'utf8') + 10,
    })

    const last = result.lines.at(-1)
    expect(last?.parsed).toEqual({
      level: 30,
      time: 2,
      msg: '日本語テスト 🎉 café',
    })
  })

  it('error path (R17): an unknown stream value is rejected by the controller layer before any fs call (see logs.controller.spec.ts); service itself only accepts LogStream', async () => {
    // The service's own type signature only accepts LogStream — this test
    // documents that the R17 boundary is enforced at the DTO/controller
    // layer (BadRequestException), not by this service re-validating a
    // string. See logs.controller.spec.ts for the actual rejection-path
    // assertion with a stat/fs spy proving no file access occurs.
    const validStreams: LogStream[] = [
      'backend',
      'frontend-server',
      'frontend-browser',
    ]
    for (const stream of validStreams) {
      await expect(
        service.readWindow({
          stream,
          anchor: 0,
          direction: 'before',
          maxBytes: 4096,
        }),
      ).resolves.toBeDefined()
    }
  })

  it('error path: maxBytes above the env cap is clamped by the service, never honored as-is', async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      jsonLine({ level: 30, time: i, msg: `line-${i}` }),
    )
    const content = lines.join('')
    writeStream('backend', content)

    // Request an absurdly large maxBytes — the service must clamp to its
    // own configured cap rather than allocating an oversized buffer.
    const result = await service.readWindow({
      stream: 'backend',
      anchor: content.length,
      direction: 'before',
      maxBytes: Number.MAX_SAFE_INTEGER,
    })

    // Still returns a correct, bounded result (all 5 lines fit easily
    // within the real cap) — the point is that this does not throw or hang
    // attempting to allocate MAX_SAFE_INTEGER bytes.
    expect(result.lines).toHaveLength(5)
  })

  it('on a read failure, logs the log-window-read-failed event and throws', async () => {
    const filePath = writeStream('backend', jsonLine({ level: 30, msg: 'x' }))
    // Force a stat failure by removing read permission's underlying file
    // entirely mid-flight (simulates an unreadable/removed file racing the
    // request) — statSync itself will throw ENOENT-shaped errors that are
    // NOT the "file never existed" case this service already special-cases
    // via existsSync, so instead directly assert the logger call shape by
    // spying on fs.promises.stat to force a non-ENOENT error.
    const statSpy = jest.spyOn(fs.promises, 'stat').mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
      }),
    )

    try {
      await expect(
        service.readWindow({
          stream: 'backend',
          anchor: 0,
          direction: 'before',
          maxBytes: 4096,
        }),
      ).rejects.toThrow()

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: LOG_EVENTS.logWindowReadFailed,
          stream: 'backend',
        }),
        expect.any(String),
      )
    } finally {
      statSpy.mockRestore()
      void filePath
    }
  })

  // ───────────────────────────────────────────────────────────────────────
  // REVIEW.md #7 + #8: computeBounds' backward look-back growth (and its
  // byte-0-region fallback) and the 'around'/'after' forward-read retry are
  // only ever reached when a single line's own byte length exceeds
  // SCAN_BLOCK_BYTES (64 KiB) — every other fixture in this suite uses
  // ~200-byte lines, so those paths were previously never exercised. A
  // large JSON payload or long stack trace is exactly the realistic case
  // that produces a line this size.
  // ───────────────────────────────────────────────────────────────────────
  describe('backward look-back growth and forward-read retry on an oversized line (REVIEW.md #7, #8)', () => {
    it("REVIEW.md #7: an anchor deep inside a line longer than SCAN_BLOCK_BYTES forces the look-back region to grow before resolving; 'before' still excludes that whole line, never a split JSON line", async () => {
      const prefix = jsonLine({ level: 30, time: 1, msg: 'prefix' })
      // No internal '\n' at all — long enough that the FIRST look-back
      // attempt (SCAN_BLOCK_BYTES=64 KiB, since maxBytes below is smaller)
      // lands entirely inside this line with zero newlines in view, forcing
      // at least one lookBackBytes doubling before a boundary is found.
      const longLine = jsonLine({
        level: 30,
        time: 2,
        msg: 'x'.repeat(100_000),
      })
      writeStream('backend', prefix + longLine)

      // Anchor well inside longLine — far enough from its own start that a
      // single 64 KiB look-back does not reach back to prefix's newline.
      const anchor = prefix.length + 90_000

      const result = await service.readWindow({
        stream: 'backend',
        anchor,
        direction: 'before',
        maxBytes: 256,
      })

      // 'before' excludes the anchor's own (longLine) entirely — only
      // prefix, never a fragment of longLine.
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]?.parsed).toEqual({
        level: 30,
        time: 1,
        msg: 'prefix',
      })
      expect(result.windowEnd).toBe(prefix.length)
      for (const l of result.lines) {
        expect(() => JSON.parse(l.raw)).not.toThrow()
      }
    })

    it("REVIEW.md #7 + #8: a single line far longer than maxBytes is still returned WHOLE and parseable for 'around' (jump-to-hit contract), exercising both the backward growth AND the forward-read retry", async () => {
      const prefix = jsonLine({ level: 30, time: 1, msg: 'prefix' })
      const bigMsg = 'y'.repeat(200_000)
      const longLine = jsonLine({ level: 30, time: 2, msg: bigMsg })
      const suffix = jsonLine({ level: 30, time: 3, msg: 'suffix' })
      writeStream('backend', prefix + longLine + suffix)

      // Anchor mid-way through longLine — a maxBytes this small could never
      // reach either of longLine's own edges via a single un-retried read in
      // EITHER direction.
      const anchor = prefix.length + Math.floor(longLine.length / 2)

      const result = await service.readWindow({
        stream: 'backend',
        anchor,
        direction: 'around',
        maxBytes: 1024,
      })

      const longLineResult = result.lines.find(l => l.parsed?.time === 2)
      expect(longLineResult).toBeDefined()
      expect(longLineResult?.parsed).toEqual({
        level: 30,
        time: 2,
        msg: bigMsg,
      })
      // Every returned line is complete, valid JSON — the anchor's own line
      // was never split by either edge.
      for (const l of result.lines) {
        expect(() => JSON.parse(l.raw)).not.toThrow()
      }
    })

    it('REVIEW.md #7: a run of newline-free bytes spanning several look-back doublings (>4 MiB) still resolves correctly (start clamped to byte 0), never hangs or throws', async () => {
      // 2^23 = 8 MiB of 'x' — comfortably past the MAX_SCAN_BLOCKS-ceiling
      // comment's own "4 MiB max look-back" figure, forcing several
      // lookBackBytes doublings (65536 -> ... -> beyond the anchor) before
      // resolving. The whole file is this ONE line: byte 0 is the only
      // valid boundary before it.
      const bigMsg = 'x'.repeat(5 * 1024 * 1024)
      const bigLine = jsonLine({ level: 30, time: 1, msg: bigMsg })
      writeStream('backend', bigLine)

      const result = await service.readWindow({
        stream: 'backend',
        anchor: bigLine.length,
        direction: 'before',
        // Deliberately tiny: proves the "never split a line" guarantee
        // holds even when honoring it means returning far more than
        // maxBytes was nominally asked for.
        maxBytes: 256,
      })

      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]?.parsed).toEqual({
        level: 30,
        time: 1,
        msg: bigMsg,
      })
      expect(result.windowStart).toBe(0)
      expect(result.atStart).toBe(true)
      expect(result.atEnd).toBe(true)
    }, 10000)
  })

  // ───────────────────────────────────────────────────────────────────────
  // Integration (R20/AE3 backend half): a single window read on a large
  // file completes in bounded time and its buffer allocation is bounded by
  // the window cap, not the file size. 200 MB (the plan's own figure) is
  // reduced to 24 MB here — large enough that a whole-file read would be
  // measurably slow/memory-heavy in a CI sandbox, small enough that the
  // suite doesn't pay multi-second I/O tax on every run; the assertion
  // being tested (peak allocation bounded by maxBytes) does not get
  // stronger with a bigger file; it only gets slower to set up.
  // ───────────────────────────────────────────────────────────────────────
  it('integration (R20/AE3): a single window read on a large file completes quickly with bounded memory allocation', async () => {
    const filePath = path.join(tmpDir, 'backend.dev.log')
    const lineTemplate = jsonLine({
      level: 30,
      time: 1,
      msg: 'x'.repeat(200),
    })
    const lineBytes = Buffer.byteLength(lineTemplate, 'utf8')
    const targetBytes = 24 * 1024 * 1024 // 24 MiB
    const lineCount = Math.ceil(targetBytes / lineBytes)

    // Stream-write rather than building one giant string in memory (this is
    // test-fixture setup, not the code under test, but there is no reason
    // to make the FIXTURE itself violate the same "don't hold a huge buffer"
    // principle the service is being tested for).
    const fd = fs.openSync(filePath, 'w')
    try {
      const chunk = lineTemplate.repeat(1000)
      const fullChunks = Math.floor(lineCount / 1000)
      for (let i = 0; i < fullChunks; i++) {
        fs.writeSync(fd, chunk)
      }
      const remainder = lineCount % 1000
      if (remainder > 0) {
        fs.writeSync(fd, lineTemplate.repeat(remainder))
      }
    } finally {
      fs.closeSync(fd)
    }

    const fileSize = fs.statSync(filePath).size
    expect(fileSize).toBeGreaterThanOrEqual(targetBytes)

    const maxBytes = 131072 // 128 KiB — the plan's own default window cap.

    // Track the largest Buffer.alloc the service performs during this read
    // by wrapping Buffer.alloc — a direct, concrete proxy for "peak
    // allocation," not merely inferred from wall-clock time. The service
    // only ever calls the single-argument form (Buffer.alloc(size)), so the
    // mock only needs to match that one overload rather than the full
    // fill/encoding-overloaded signature.
    let peakAlloc = 0
    const allocSpy = jest
      .spyOn(Buffer, 'alloc')
      .mockImplementation((size: number) => {
        peakAlloc = Math.max(peakAlloc, size)
        return Buffer.allocUnsafe(size)
      })

    try {
      const start = Date.now()
      const result = await service.readWindow({
        stream: 'backend',
        anchor: fileSize,
        direction: 'before',
        maxBytes,
      })
      const elapsedMs = Date.now() - start

      expect(result.atEnd).toBe(true)
      expect(result.lines.length).toBeGreaterThan(0)
      // Bounded time: a single windowed read must not scale with file size.
      expect(elapsedMs).toBeLessThan(2000)
      // Bounded memory: no single allocation this read performed exceeded
      // the window cap — never proportional to the 24 MiB file.
      expect(peakAlloc).toBeGreaterThan(0)
      expect(peakAlloc).toBeLessThanOrEqual(maxBytes)
    } finally {
      allocSpy.mockRestore()
    }
  }, 15000)
})
