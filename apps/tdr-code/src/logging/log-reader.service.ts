import fs from 'node:fs'

import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'
import { LOG_DIR, logFilePath } from 'src/logging/log-paths'
import {
  type LogLine,
  type LogStream,
  type LogWindowDirection,
  type LogWindowResponse,
  parseLogLine,
} from 'src/logging/log-view.types'

const NEWLINE_BYTE = 0x0a // '\n' — UTF-8-safe: this byte value can never
// appear inside a multi-byte UTF-8 continuation/lead byte (those are always
// >= 0x80), so scanning a raw Buffer for 0x0a finds every real line break
// without ever needing to decode first. Decoding to a string happens only
// AFTER a line's byte range is fully known — see splitAndParseLines below.

// Bounded look-back block size for the backward newline scan (R15/R20): a
// single fs.read never grows past this, regardless of how far back the
// previous '\n' turns out to be, so a pathological run of non-JSON binary
// content preceding the anchor still cannot balloon one read to file-size.
const SCAN_BLOCK_BYTES = 65536 // 64 KiB
const MAX_SCAN_BLOCKS = 64 // hard ceiling: 64 * 64 KiB = 4 MiB max look-back

// Finds the nearest line-START boundary at or before `pos` — a byte offset
// that is either 0 or immediately follows a '\n'. If `pos` already sits on
// such a boundary (including `pos === buf.length` at a clean EOF, which is
// itself a boundary since nothing follows it), it is returned unchanged;
// otherwise this scans backward for the previous '\n' and returns one past
// it (or 0 if none exists before `pos`).
export function snapLineBoundaryBackward(buf: Buffer, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, buf.length))
  if (clamped === 0 || buf[clamped - 1] === NEWLINE_BYTE) {
    return clamped
  }
  for (let i = clamped - 1; i >= 0; i--) {
    if (buf[i] === NEWLINE_BYTE) {
      return i + 1
    }
  }
  return 0
}

// Finds the nearest line-START boundary at or after `pos` — symmetric to
// snapLineBoundaryBackward. If `pos` already sits on a boundary, it is
// returned unchanged; otherwise this scans forward for the next '\n' and
// returns one past it, or buf.length if the buffer ends without one (a
// partial final line — R14; the caller decides whether that's a valid
// window edge or a dropped trailing fragment).
export function snapLineBoundaryForward(buf: Buffer, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, buf.length))
  if (clamped === 0 || buf[clamped - 1] === NEWLINE_BYTE) {
    return clamped
  }
  for (let i = clamped; i < buf.length; i++) {
    if (buf[i] === NEWLINE_BYTE) {
      return i + 1
    }
  }
  return buf.length
}

export interface WindowBounds {
  start: number
  end: number
}

// Pure boundary math against an in-memory buffer (fileOffset 0 == buf start
// — log-reader.service.ts's real-file callers translate to/from absolute
// file offsets around this). The invariant every direction upholds: a
// window's [start, end) never splits a JSON line, and — for `before`/
// `after` — the line the raw anchor falls inside is never partially
// included; it is either wholly excluded (anchor point lies inside it) or
// wholly the window's own edge (anchor point IS its boundary).
export function snapWindow(
  buf: Buffer,
  anchor: number,
  direction: LogWindowDirection,
  maxBytes: number,
): WindowBounds {
  const clampedAnchor = Math.max(0, Math.min(anchor, buf.length))

  if (direction === 'before') {
    // The window covers complete lines strictly before the anchor. `end` is
    // the anchor snapped BACKWARD to a line-start boundary — this is what
    // "strictly before" means when the anchor lands mid-line: that
    // (partial, contains-the-anchor) line is excluded entirely, not
    // truncated. Then walk `maxBytes` further back and snap the resulting
    // start outward too, so the OTHER edge also never splits a line.
    const end = snapLineBoundaryBackward(buf, clampedAnchor)
    const rawStart = Math.max(0, end - maxBytes)
    const start = snapLineBoundaryBackward(buf, rawStart)
    return { start, end }
  }

  if (direction === 'after') {
    // Symmetric to `before`: `start` is the anchor snapped FORWARD to the
    // next line-start boundary, excluding the anchor's own (partial) line
    // entirely rather than including a fragment of it.
    const start = snapLineBoundaryForward(buf, clampedAnchor)
    const rawEnd = Math.min(buf.length, start + maxBytes)
    const end = snapLineBoundaryForward(buf, rawEnd)
    return { start, end }
  }

  // 'around': unlike before/after, the line CONTAINING the anchor must be
  // whole and present (this is the jump-to-hit contract Phase 2 U11 needs —
  // a search hit must always render, never sit on an excluded boundary
  // line). Find that line's own [lineStart, lineEnd) first, then extend
  // outward by ~maxBytes/2 on each side, snapping each new edge to its own
  // line boundary. Extending outward from the line's real edges (not from
  // the raw anchor point) guarantees the shrink-to-cap edge case (a
  // maxBytes smaller than the containing line itself) still never clips
  // that line — the outward walk starts already past it in both directions.
  const lineStart = snapLineBoundaryBackward(buf, clampedAnchor)
  const lineEnd = snapLineBoundaryForward(buf, clampedAnchor)
  const half = Math.floor(maxBytes / 2)
  const rawStart = Math.max(0, lineStart - half)
  const rawEnd = Math.min(buf.length, lineEnd + half)
  const start = snapLineBoundaryBackward(buf, rawStart)
  const end = snapLineBoundaryForward(buf, rawEnd)
  return { start, end }
}

// Splits an already-bounded buffer on the newline byte and parses each
// complete line, tagging each with its byte offset RELATIVE TO THE FILE
// (fileOffsetBase + the line's offset within this buffer) — never relative
// to the window itself, since callers (the virtualized list) key/anchor
// entries by absolute file position (getItemKey = byteOffset). A trailing
// partial line (buffer doesn't end on a '\n') is dropped: the adjacent
// window owns it (R14's malformed-line contract explicitly carves this out
// as "dropped," not "malformed" — it's a framing artifact of this window's
// edge, not a bad line in the file).
export function splitAndParseLines(
  buf: Buffer,
  fileOffsetBase: number,
): LogLine[] {
  const lines: LogLine[] = []
  let lineStart = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== NEWLINE_BYTE) continue
    // Decode only once a complete line's byte range is known (byte-level
    // scanning above is what keeps this UTF-8-safe — '\n' can never appear
    // inside a multi-byte sequence, so this decode boundary is always a
    // real character boundary too).
    const raw = buf.toString('utf8', lineStart, i)
    lines.push({
      byteOffset: fileOffsetBase + lineStart,
      byteLength: i - lineStart + 1, // include the '\n' itself
      raw,
      parsed: parseLogLine(raw),
    })
    lineStart = i + 1
  }
  return lines
}

export interface ReadWindowParams {
  stream: LogStream
  anchor: number
  direction: LogWindowDirection
  maxBytes: number
}

@Injectable()
export class LogReaderService {
  // Overridable only from tests (see setLogDirForTests) — production code
  // always resolves paths through log-paths.ts's own LOG_DIR constant, never
  // a client-supplied value (R17). Kept as an instance field rather than a
  // module-level override so parallel test files can't stomp each other's
  // temp-dir setting.
  private logDir: string = LOG_DIR

  constructor(private readonly logger: PinoLogger) {}

  // Test-only seam: points path resolution at a temp directory instead of
  // the real /tmp/tdr-code, so log-reader.service.spec.ts can prove real
  // seek-based reads against real files without touching the actual log
  // location. Never called from production code (no other call site exists
  // outside that spec file).
  setLogDirForTests(dir: string): void {
    this.logDir = dir
  }

  private resolvePath(stream: LogStream): string {
    return this.logDir === LOG_DIR
      ? logFilePath(stream)
      : logFilePath(stream).replace(LOG_DIR, this.logDir)
  }

  private clampMaxBytes(requested: number): number {
    const cap = parseInt(env(EnvKeys.LOG_WINDOW_MAX_BYTES, '131072'), 10)
    return Math.min(requested, cap)
  }

  async readWindow(params: ReadWindowParams): Promise<LogWindowResponse> {
    const { stream, direction } = params
    const maxBytes = this.clampMaxBytes(params.maxBytes)
    const filePath = this.resolvePath(stream)

    if (!fs.existsSync(filePath)) {
      // A stream that has never been written to (frontend-server before its
      // first request) is a normal empty state (R2), never an error.
      return {
        stream,
        fileSize: 0,
        windowStart: 0,
        windowEnd: 0,
        atStart: true,
        atEnd: true,
        lines: [],
      }
    }

    let handle: fs.promises.FileHandle | undefined
    try {
      const stat = await fs.promises.stat(filePath)
      const fileSize = stat.size
      const anchor = Math.max(0, Math.min(params.anchor, fileSize))

      if (fileSize === 0) {
        return {
          stream,
          fileSize: 0,
          windowStart: 0,
          windowEnd: 0,
          atStart: true,
          atEnd: true,
          lines: [],
        }
      }

      handle = await fs.promises.open(filePath, 'r')

      const { start, end } = await this.computeBounds(
        handle,
        fileSize,
        anchor,
        direction,
        maxBytes,
      )

      const buf = Buffer.alloc(end - start)
      if (buf.length > 0) {
        await handle.read(buf, 0, buf.length, start)
      }
      const lines = splitAndParseLines(buf, start)

      return {
        stream,
        fileSize,
        windowStart: start,
        windowEnd: end,
        // atEnd is derived from the read result (end >= the size AT READ
        // TIME), not a prior stat — a window touching EOF that races a
        // still-growing file must treat "current EOF" as the truth, never
        // throw on the size having moved between stat and read.
        atStart: start === 0,
        atEnd: end >= fileSize,
        lines,
      }
    } catch (err) {
      this.logger.error(
        { err, event: LOG_EVENTS.logWindowReadFailed, stream },
        'log window read failed',
      )
      throw err
    } finally {
      await handle?.close()
    }
  }

  // Resolves [start, end) for the requested direction using the SAME
  // snapWindow boundary math the pure in-memory tests exercise, but against
  // a bounded region read from the real file instead of the whole file in
  // memory (R15/R20: never a read proportional to file size).
  //
  // Every direction reads a region that starts STRICTLY BEFORE the anchor
  // whenever anchor > 0 — not just `before`/`around` — because
  // snapLineBoundaryForward/Backward decide "is this offset already a line
  // boundary" by inspecting the byte immediately preceding it. A region that
  // starts exactly AT the anchor has no such preceding byte in scope, so a
  // mid-line anchor with no backward context would be misread as already
  // being a boundary (relativeAnchor === 0 trivially satisfies the
  // boundary check) — this was a real bug caught by the `after`-direction
  // mid-line test. Reading even one byte of backward context fixes it, but
  // this reads a full lookBackBytes'-worth like `before`/`around` do, both
  // for uniformity and because `around` needs real backward-scan reach
  // anyway.
  //
  // The previous '\n' may lie further back than a single SCAN_BLOCK_BYTES
  // read — this grows the searched region one bounded block at a time
  // (never the whole file) until a boundary is found or MAX_SCAN_BLOCKS is
  // exhausted. The forward edge never needs its own retry loop: the next
  // '\n' is always within the single maxBytes-sized region already read
  // past the anchor.
  private async computeBounds(
    handle: fs.promises.FileHandle,
    fileSize: number,
    anchor: number,
    direction: LogWindowDirection,
    maxBytes: number,
  ): Promise<WindowBounds> {
    let lookBackBytes = Math.min(Math.max(maxBytes, SCAN_BLOCK_BYTES), anchor)
    for (let attempt = 0; attempt < MAX_SCAN_BLOCKS; attempt++) {
      const readStart = Math.max(0, anchor - lookBackBytes)
      const readEnd = Math.min(fileSize, anchor + maxBytes)
      const buf = await this.readRegion(handle, readStart, readEnd - readStart)
      const relativeAnchor = anchor - readStart

      const foundBackwardBoundary =
        readStart === 0 || bufferContainsNewlineBefore(buf, relativeAnchor)

      if (foundBackwardBoundary || lookBackBytes >= anchor) {
        const { start, end } = snapWindow(
          buf,
          relativeAnchor,
          direction,
          maxBytes,
        )
        return { start: readStart + start, end: readStart + end }
      }

      lookBackBytes = Math.min(lookBackBytes * 2, anchor)
    }

    // Look-back ceiling exhausted (a file with MAX_SCAN_BLOCKS-worth of
    // bytes and no '\n' anywhere before the anchor) — fall back to reading
    // from byte 0 rather than looping forever; byte 0 is always a valid
    // line-start boundary regardless.
    const readStart = 0
    const readEnd = Math.min(fileSize, anchor + maxBytes)
    const buf = await this.readRegion(handle, readStart, readEnd - readStart)
    const { start, end } = snapWindow(buf, anchor, direction, maxBytes)
    return { start: readStart + start, end: readStart + end }
  }

  private async readRegion(
    handle: fs.promises.FileHandle,
    start: number,
    length: number,
  ): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0)
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, start)
    // A read racing EOF (file shrank, or bytesRead < requested because we're
    // already at EOF) yields a shorter real buffer — never treated as an
    // error, just a smaller-than-requested region to snap against.
    return bytesRead === length ? buf : buf.subarray(0, bytesRead)
  }
}

// True if `buf` contains a '\n' at any position strictly before `pos` —
// used by the backward look-back loop to decide whether the CURRENT read
// region already reaches far enough back to contain the true previous line
// boundary, or whether another (larger) block read is needed.
function bufferContainsNewlineBefore(buf: Buffer, pos: number): boolean {
  const limit = Math.min(pos, buf.length)
  for (let i = 0; i < limit; i++) {
    if (buf[i] === NEWLINE_BYTE) return true
  }
  return false
}
