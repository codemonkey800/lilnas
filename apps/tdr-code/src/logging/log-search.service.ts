import fs from 'node:fs'

import { BadRequestException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { LOG_EVENTS } from 'src/logging/log-events'
import { LOG_DIR, resolveLogPath } from 'src/logging/log-paths'
import {
  type LogScanPredicate,
  type LogSearchResponse,
  type LogStream,
  parseLogLine,
} from 'src/logging/log-view.types'

// Fixed-size streaming read block (ripgrep-style: "Thou Shalt Not Search
// Line By Line" — a constant-sized buffer plus partial-line carry-over,
// never readFile/a read proportional to file size). Matches the ORDER OF
// MAGNITUDE of log-reader.service.ts's own SCAN_BLOCK_BYTES (64 KiB) for a
// different but related bounded-read invariant; the exact value is one of
// the plan's own explicitly-flagged "tune against the real file" constants,
// not something to agonize over.
const SEARCH_BLOCK_BYTES = 65536 // 64 KiB

// Bounds how many {byteOffset} entries one page of the response carries —
// the whole point of cursor pagination (R9/R20): a term matching millions of
// lines in a huge file must never materialize millions of offsets in one
// response, even though `total` itself is still exact. Also one of the
// plan's own "tune against the real file" constants.
const MAX_MATCHES_PER_PAGE = 200

// The opaque cursor's own wire encoding: a colon-delimited triple of
// non-negative integers, "<resumeOffset>:<ceiling>:<total>". Validated by
// this regex BEFORE any parseInt/range check — user-controlled input
// reaching a byte-range file read is the same R17/R15-style trust boundary
// as the rest of this module, so this is deliberately not a bare
// `JSON.parse` on client-supplied text (which would need its own shape
// validation anyway, with none of a regex's up-front rejection cheapness).
const CURSOR_PATTERN = /^(\d+):(\d+):(\d+)$/

interface DecodedCursor {
  resumeOffset: number
  ceiling: number
  total: number
}

// Encodes the frozen scan state a later page resumes from. See this
// service's own header comment on scan() for why the cursor must CARRY this
// state rather than the caller re-deriving it: a fresh Nest request handler
// runs per HTTP request (no server-side session), so the only way to keep
// `total`/`ceiling` pinned to one point-in-time snapshot across multiple
// paginated requests is to round-trip them through the cursor itself.
function encodeCursor(state: DecodedCursor): string {
  return `${state.resumeOffset}:${state.ceiling}:${state.total}`
}

// Rejects anything that doesn't match CURSOR_PATTERN outright, then enforces
// the one structural invariant a genuine cursor from THIS service always
// satisfies: resumeOffset can never exceed the ceiling it was minted
// against (a resumeOffset > ceiling could only come from a hand-tampered or
// corrupted value, since encodeCursor never produces one). Throwing
// BadRequestException on any violation mirrors parseQuery's own
// throw-on-invalid convention elsewhere in this module (console/
// query-params.ts), even though this cursor is intentionally NOT routed
// through that shared zod-based helper (see logs.dto.ts's own comment on
// why `cursor` stays a bare optional string at the DTO layer).
function decodeCursor(raw: string): DecodedCursor {
  const match = CURSOR_PATTERN.exec(raw)
  if (!match) {
    throw new BadRequestException('cursor is malformed')
  }
  const resumeOffset = parseInt(match[1] as string, 10)
  const ceiling = parseInt(match[2] as string, 10)
  const total = parseInt(match[3] as string, 10)
  if (resumeOffset > ceiling) {
    throw new BadRequestException(
      'cursor is invalid: resumeOffset exceeds ceiling',
    )
  }
  return { resumeOffset, ceiling, total }
}

// One complete line's raw text plus its already-parsed JSON (or null),
// paired with the byte offset of its own START — the shape scanRange's
// per-line predicate check operates on. Deliberately a LOCAL type, not a
// reuse of log-view.types.ts's LogLine: that type also carries byteLength,
// which this scan has no use for (it never needs to re-slice a line's raw
// bytes back out of a buffer the way the windowed read's callers do).
interface ScannedLine {
  byteOffset: number
  raw: string
  parsed: Record<string, unknown> | null
}

// Applies every active LogScanPredicate field as an AND — a line must
// satisfy EVERY field that is actually set to match at all. An entirely
// empty predicate ({}) matches every line without any special-casing here:
// each field's own check already short-circuits to `true` when that field
// is absent (see each branch's own comment), so "no filters at all" falls
// out of the general case for free rather than needing an explicit "return
// true if predicate is empty" branch that could silently drift out of sync
// with the individual field checks below.
function matchesPredicate(
  line: ScannedLine,
  predicate: LogScanPredicate,
): boolean {
  if (predicate.text !== undefined) {
    // Case-insensitive substring against the RAW text (R14): this is what
    // makes `text` findable on a malformed/non-JSON line too, since that
    // line has no `parsed` fields for a structured filter to ever match.
    if (!line.raw.toLowerCase().includes(predicate.text.toLowerCase())) {
      return false
    }
  }

  if (predicate.level !== undefined) {
    // A MINIMUM threshold (numeric pino level >= this value), never an
    // exact match. A malformed line's `parsed` is null and therefore has no
    // numeric `level` field at all — `typeof undefined === 'number'` is
    // false, so this correctly excludes it (R14) without a separate
    // null-check branch.
    const level = line.parsed?.level
    if (typeof level !== 'number' || level < predicate.level) {
      return false
    }
  }

  if (predicate.process !== undefined && predicate.process !== 'both') {
    // 'both' (or the field being entirely absent, handled by the outer
    // `if`) imposes NO process constraint — this branch only runs for the
    // genuinely restrictive 'main'/'bot' values. A malformed line has no
    // `parsed.process` at all and is excluded here exactly like the level
    // check above (R14).
    if (line.parsed?.process !== predicate.process) {
      return false
    }
  }

  if (predicate.event !== undefined) {
    // Exact slug match, never a substring match (unlike `text` above) — a
    // valid `debug`-level line with no `event` field at all is normal (per
    // the structured-logging convention: only info+ requires one), so this
    // simply excludes it rather than treating the absence as malformed.
    if (line.parsed?.event !== predicate.event) {
      return false
    }
  }

  return true
}

export interface ScanParams {
  stream: LogStream
  predicate: LogScanPredicate
  cursor?: string
  signal?: AbortSignal
}

// Thrown internally to unwind scanRange's read loop the instant an abort is
// observed, without the loop's own per-block plumbing having to thread a
// "was this an abort or a real error" flag back up through every return
// path. Caught by scan() itself, which is the one place that needs to tell
// "the caller cancelled this deliberately" apart from "a real read error
// happened" (see scan()'s own catch block) — LOG_EVENTS.logSearchFailed is
// never logged for this class, only for a genuine I/O failure.
class ScanAborted extends Error {}

@Injectable()
export class LogSearchService {
  // Same test-only override seam as every other logging/*.service.ts file —
  // production code always resolves paths through log-paths.ts's own
  // LOG_DIR constant, never a client-supplied value (R17).
  private logDir: string = LOG_DIR

  constructor(private readonly logger: PinoLogger) {}

  setLogDirForTests(dir: string): void {
    this.logDir = dir
  }

  private resolvePath(stream: LogStream): string {
    return resolveLogPath(stream, this.logDir)
  }

  // The two-phase whole-file scan engine (R9/R10/R11). See this class's own
  // module header for the block-read/carry-over mechanics; this method's own
  // job is resolving WHICH byte range to scan and how to interpret/produce a
  // cursor for it.
  //
  // Why the cursor must CARRY {resumeOffset, ceiling, total} instead of a
  // naive "just remember where I left off" byte offset: this is a stateless
  // HTTP API — a fresh NestJS request handler runs per request, with no
  // server-side session connecting page 1 of one logical search to page 2 of
  // the SAME search. The plan's own test scenarios require BOTH of these
  // simultaneously: (a) page 2 must resume reading at resumeOffset WITHOUT
  // re-reading [0, resumeOffset) at all, and (b) page 2's `total` must be
  // IDENTICAL to page 1's `total` even if the file grew in between (follow
  // is on by default, so the file is very plausibly still growing while an
  // operator pages through search results). A cursor that only encoded
  // "resume from byte N" and re-derived `ceiling`/`total` via a fresh stat()
  // + fresh count on every page would violate (b): a freshly-stat'd EOF on
  // page 2 could be larger than page 1's, and a freshly-recomputed count
  // over that larger range could differ from what page 1 reported —
  // "growing file" test in this unit's own spec proves this concretely.
  // Freezing {ceiling, total} into the cursor itself (opaque to the client,
  // but round-tripped byte-for-byte) is what makes both properties hold with
  // zero server-side session/memory: page 2 is just as stateless as page 1,
  // it just happens to have been handed the frozen values to echo back.
  async scan(params: ScanParams): Promise<LogSearchResponse> {
    const filePath = this.resolvePath(params.stream)

    if (params.cursor !== undefined) {
      // Resuming an in-progress search: never re-stat, never re-derive
      // ceiling/total, never re-read [0, resumeOffset). Only walk forward
      // from exactly where page 1 (or a prior page) left off.
      const decoded = decodeCursor(params.cursor)
      return this.scanFromCursor(filePath, params.stream, params, decoded)
    }

    // First request for this logical search: snapshot the CURRENT file size
    // once, up front, as the ceiling every subsequent page of THIS search
    // will use — never re-derived from a later, possibly-larger stat() (see
    // this method's own header comment on why).
    let ceiling: number
    try {
      const stat = await fs.promises.stat(filePath)
      ceiling = stat.size
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // A stream that has never been written to (R2's existing empty-state
        // precedent — mirrors LogReaderService/LogSourcesService/
        // LogTailService's identical ENOENT handling): there is nothing to
        // scan, so this is an honest zero-match result, not an error.
        return { total: 0, matches: [], nextCursor: null }
      }
      this.logger.error(
        { err, event: LOG_EVENTS.logSearchFailed, stream: params.stream },
        'log search stat failed',
      )
      throw err
    }

    return this.scanRange(filePath, params.stream, params, {
      readFrom: 0,
      ceiling,
      countFromZero: true,
      priorTotal: 0,
    })
  }

  private async scanFromCursor(
    filePath: string,
    stream: LogStream,
    params: ScanParams,
    decoded: DecodedCursor,
  ): Promise<LogSearchResponse> {
    return this.scanRange(filePath, stream, params, {
      readFrom: decoded.resumeOffset,
      ceiling: decoded.ceiling,
      // Page 2+ never recounts — `total` is echoed straight through from
      // the cursor, never recomputed (see this class's own scan() header
      // comment on why: recomputing here is exactly the bug this design
      // exists to prevent).
      countFromZero: false,
      priorTotal: decoded.total,
    })
  }

  // Shared core of both the first-page and resumed-page paths: stream
  // [readFrom, ceiling) in fixed blocks with carry-over, apply the predicate
  // to every complete line, optionally counting (`countFromZero`) and always
  // collecting up to MAX_MATCHES_PER_PAGE offsets, and produce the response
  // + next cursor.
  private async scanRange(
    filePath: string,
    stream: LogStream,
    params: ScanParams,
    opts: {
      readFrom: number
      ceiling: number
      countFromZero: boolean
      priorTotal: number
    },
  ): Promise<LogSearchResponse> {
    const { predicate, signal } = params
    let handle: fs.promises.FileHandle | undefined
    try {
      handle = await fs.promises.open(filePath, 'r')

      let total = opts.priorTotal
      const matches: { byteOffset: number; raw: string }[] = []
      // Set the instant this page's own MAX_MATCHES_PER_PAGE cap is hit —
      // from that point on, the loop still walks every remaining byte up to
      // `ceiling` (countFromZero pages still need the EXACT total, which
      // requires seeing every line, not just the first N matches) but stops
      // pushing further offsets into `matches`. The loop tracks the byte
      // position immediately after the last line actually collected — NOT
      // simply "wherever the loop happens to be when the cap is hit" — since
      // that is the exact resume point a later page's cursor must encode
      // (see the trailing carry-over remainder's own comment below for why
      // this can differ from the current read position by more than zero
      // bytes).
      let resumeAfterLastCollected: number | undefined

      // Streaming state, ripgrep-style: a persistent trailing remainder
      // carried from one block read into the next. Deliberately plain UTF-8
      // string concatenation here (not a StringDecoder like
      // log-tail.service.ts's live tail) — this scan re-opens a fresh handle
      // per request and reads STRICTLY WITHIN [readFrom, ceiling) in one
      // shot, so there is no cross-CONNECTION decoder state to preserve the
      // way the tail's persistent watch does; a multi-byte UTF-8 sequence
      // split across a block boundary is instead handled by carrying the
      // PARTIAL LINE's raw bytes forward (never decoding a block in
      // isolation) — decode only happens once a complete line's full byte
      // range is known, mirroring log-reader.service.ts's own
      // splitAndParseLines discipline.
      let carry = Buffer.alloc(0)
      // The byte offset of the start of `carry` (i.e. of whatever complete
      // line is currently being assembled) — walked forward by each
      // completed line's own Buffer.byteLength, never inferred from the
      // block read position, for the identical reason log-tail.service.ts's
      // own pendingPartialStartOffset field is tracked independently of its
      // read-position bookkeeping (see that field's own comment): the two
      // can only ever coincide when there is no pending partial content at
      // all, and conflating them elsewhere is a real, previously-caught bug
      // class.
      let lineStartOffset = opts.readFrom
      let readPos = opts.readFrom

      while (readPos < opts.ceiling) {
        if (signal?.aborted) {
          throw new ScanAborted('scan aborted')
        }

        const remaining = opts.ceiling - readPos
        const toRead = Math.min(SEARCH_BLOCK_BYTES, remaining)
        const buf = Buffer.allocUnsafe(toRead)
        const { bytesRead } = await handle.read(buf, 0, toRead, readPos)
        if (bytesRead === 0) break // race: file shrank under us mid-scan
        const region = bytesRead === toRead ? buf : buf.subarray(0, bytesRead)
        readPos += bytesRead

        // Find every '\n' inside `region` and process the resulting
        // complete line(s) — byte-level scanning (never decoding `region`
        // wholesale first) is what keeps this correct in the presence of a
        // multi-byte UTF-8 character straddling a block boundary: '\n'
        // (0x0a) can never appear inside a multi-byte UTF-8 continuation/
        // lead byte (those are always >= 0x80), so this search is safe
        // against a raw Buffer regardless of where the block edge falls —
        // mirrors log-reader.service.ts's own NEWLINE_BYTE-scanning
        // rationale.
        let searchStart = 0
        for (let i = 0; i < region.length; i++) {
          if (region[i] !== 0x0a) continue
          const lineBytes = Buffer.concat([
            carry,
            region.subarray(searchStart, i),
          ])
          carry = Buffer.alloc(0)
          searchStart = i + 1

          const raw = lineBytes.toString('utf8')
          const scanned: ScannedLine = {
            byteOffset: lineStartOffset,
            raw,
            parsed: parseLogLine(raw),
          }
          if (matchesPredicate(scanned, predicate)) {
            if (opts.countFromZero) total++
            if (matches.length < MAX_MATCHES_PER_PAGE) {
              // `raw` (U12) is `scanned.raw` verbatim — already decoded above
              // to run matchesPredicate, so holding onto it here for the
              // response costs nothing extra in THIS streaming pass; see
              // LogSearchResponse's own header comment in log-view.types.ts
              // for why the filtered-projection view needs the matched
              // line's actual text, not just its offset.
              matches.push({ byteOffset: scanned.byteOffset, raw: scanned.raw })
              // +1 for the '\n' this iteration just consumed — the resume
              // point for a LATER page must start reading strictly AFTER
              // this line's own trailing newline, never re-including it.
              resumeAfterLastCollected = lineStartOffset + lineBytes.length + 1
            }
          }
          lineStartOffset += lineBytes.length + 1
        }
        // Whatever is left after the last '\n' in this block (or the whole
        // block, if it contained none) becomes the carry-over remainder for
        // the NEXT block read — never processed as a line yet, since it may
        // continue into content this method hasn't read.
        carry = Buffer.concat([carry, region.subarray(searchStart)])

        // A resumed page (countFromZero: false) already knows `total` —
        // it's echoed from the cursor, never recomputed here — so once this
        // page's own MAX_MATCHES_PER_PAGE quota is full there is nothing
        // further this call needs from the rest of [readFrom, ceiling): a
        // LATER page's cursor already resumes from resumeAfterLastCollected,
        // which is fully determined by this point. Stopping here is what
        // keeps a deep-pagination request over a huge match set bounded by
        // "read until 200 matches," not "read the rest of the file" (R20) —
        // unlike the FIRST page (countFromZero: true), which must keep
        // walking all the way to `ceiling` regardless of how early its own
        // quota filled, since only that walk can produce an exact `total`.
        if (!opts.countFromZero && matches.length >= MAX_MATCHES_PER_PAGE) {
          break
        }
      }

      // Flush a final trailing remainder that never got its own '\n' before
      // `ceiling` — an unterminated final line at true EOF (R14: still
      // text-searchable via the raw fallback, deliberately NOT dropped the
      // way log-reader.service.ts's WINDOWED read drops a trailing partial —
      // that read has an adjacent window to hand the fragment to; this scan
      // owns the entire requested range with nothing further to hand off
      // to). Only flush when this page's own read range reached `ceiling` —
      // a page that stopped early because it filled its own match quota
      // must NOT treat "we happened to stop mid-block" as EOF and flush a
      // spurious partial line; readPos genuinely reaching ceiling is what
      // distinguishes a real end-of-range from a mere loop-iteration
      // boundary.
      if (readPos >= opts.ceiling && carry.length > 0) {
        const raw = carry.toString('utf8')
        const scanned: ScannedLine = {
          byteOffset: lineStartOffset,
          raw,
          parsed: parseLogLine(raw),
        }
        if (matchesPredicate(scanned, predicate)) {
          if (opts.countFromZero) total++
          if (matches.length < MAX_MATCHES_PER_PAGE) {
            // See the mid-block push above for why `raw` is included here
            // too — this is the second (final-remainder) of the two call
            // sites the U12 unit brief calls out.
            matches.push({ byteOffset: scanned.byteOffset, raw: scanned.raw })
            resumeAfterLastCollected = lineStartOffset + carry.length
          }
        }
      }

      // nextCursor exists exactly when there is more of [readFrom, ceiling)
      // that COULD still contain matches this page didn't collect —
      // resumeAfterLastCollected is only ever set when at least one match
      // was actually pushed into `matches` on THIS call, so a page that
      // collected fewer than MAX_MATCHES_PER_PAGE matches in total (i.e.
      // every match in range fit) correctly yields nextCursor: null once the
      // loop above has walked the whole range — there is nothing left to
      // resume INTO. A page that filled its quota exactly at the last
      // collectible match (no further matches exist after it, but the scan
      // hadn't yet reached `ceiling` when it filled up) is handled the same
      // way: matches.length === MAX_MATCHES_PER_PAGE here always means
      // "resume from right after the last one collected," which is correct
      // regardless of whether anything further actually exists — a resumed
      // scan that finds zero further matches simply returns nextCursor:
      // null on ITS OWN next call, rather than this call having to look
      // ahead to know that in advance.
      const nextCursor =
        matches.length >= MAX_MATCHES_PER_PAGE &&
        resumeAfterLastCollected !== undefined
          ? encodeCursor({
              resumeOffset: resumeAfterLastCollected,
              ceiling: opts.ceiling,
              total,
            })
          : null

      return { total, matches, nextCursor }
    } catch (err) {
      if (err instanceof ScanAborted) {
        // A superseding request cancelling this one is expected and
        // deliberate (the client aborts on every query change) — never
        // logged as a failure, and re-thrown as-is so the controller layer
        // can let it propagate/settle naturally rather than this service
        // manufacturing a fake successful response for a scan that never
        // finished.
        throw err
      }
      this.logger.error(
        { err, event: LOG_EVENTS.logSearchFailed, stream },
        'log search read failed',
      )
      throw err
    } finally {
      // Always close, including on an aborted scan — an AbortSignal must
      // never leak an open FileHandle (this unit's own explicit test
      // requirement), matching the finally-based close discipline every
      // other logging/*.service.ts file in this module already uses.
      await handle?.close()
    }
  }
}
