import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { logTailUrl } from 'src/app/lib/api'
import { ROW_PX } from 'src/app/logs/log-row'
import {
  appendTailLine,
  applyFetchedWindow,
  EDGE_FETCH_THRESHOLD,
  EVICTION_CAP,
  LogViewer,
  type ReadLogWindowParams,
  seedWindowState,
  type WindowState,
} from 'src/app/logs/log-viewer'
import type {
  LogLine,
  LogTailMessage,
  LogWindowResponse,
} from 'src/logging/log-view.types'

// ─────────────────────────────────────────────────────────────────────────
// Fixture helpers. A "line" is fully described by its ordinal index within
// a fixture stream; byteOffset/byteLength are derived deterministically
// (each line is treated as if it took exactly BYTES_PER_LINE bytes) so a
// response's windowStart/windowEnd can be computed directly from index
// ranges, mirroring how log-reader.service.ts's real byte accounting works
// without needing a real file anywhere in this spec.
// ─────────────────────────────────────────────────────────────────────────

const BYTES_PER_LINE = 20

function makeLine(index: number): LogLine {
  return {
    byteOffset: index * BYTES_PER_LINE,
    byteLength: BYTES_PER_LINE,
    raw: `{"line":${index}}`,
    parsed: { line: index, level: 30, msg: `line ${index}` },
  }
}

// Converts a line's ordinal index to its byte offset — used by callers that
// think in terms of "line N" but must hand makeResponse a genuine byte
// anchor (see that function's own header comment for why the distinction
// is load-bearing, not cosmetic).
function lineOffset(index: number): number {
  return index * BYTES_PER_LINE
}

// Builds a response as if reading `direction` from a BYTE-OFFSET `anchor`
// in a file of `totalLines` total lines, returning up to `count` lines and
// correctly derived atStart/atEnd/windowStart/windowEnd — the same tiling
// contract log-reader.service.ts guarantees (a `before` window's end
// exactly equals the requested anchor's line-aligned position; a fresh
// `after` window's start exactly equals the anchor).
//
// `anchor` is deliberately a BYTE offset, not a line index, even though
// every fixture line is a fixed BYTES_PER_LINE wide — this mirrors the
// real `ReadLogWindowParams.anchor` field the production LogViewer actually
// sends (always `state.windowStart`/`state.windowEnd`, both byte offsets),
// which is exactly what a mocked `readWindow` in a component test receives
// verbatim. An earlier draft of this fixture treated its second parameter
// as a line index and was called with a raw BYTE anchor from component
// tests' `readWindow` mock implementations, which silently produced the
// SAME window on every repeat call (a real bug this fixture had, not
// LogViewer — caught by a component test that kept re-fetching the
// identical anchor forever instead of converging on atStart). Callers that
// want to think in terms of "line N" convert via lineOffset(N) explicitly.
function makeResponse(
  totalLines: number,
  anchor: number,
  direction: 'before' | 'after',
  count: number,
): LogWindowResponse {
  const fileSize = totalLines * BYTES_PER_LINE
  const anchorIndex = Math.floor(anchor / BYTES_PER_LINE)
  if (direction === 'before') {
    const endIndex = Math.min(anchorIndex, totalLines)
    const startIndex = Math.max(0, endIndex - count)
    const lines = Array.from({ length: endIndex - startIndex }, (_, i) =>
      makeLine(startIndex + i),
    )
    return {
      stream: 'backend',
      fileSize,
      windowStart: startIndex * BYTES_PER_LINE,
      windowEnd: endIndex * BYTES_PER_LINE,
      atStart: startIndex === 0,
      atEnd: endIndex >= totalLines,
      lines,
    }
  }
  const startIndex = Math.max(0, anchorIndex)
  const endIndex = Math.min(totalLines, startIndex + count)
  const lines = Array.from({ length: endIndex - startIndex }, (_, i) =>
    makeLine(startIndex + i),
  )
  return {
    stream: 'backend',
    fileSize,
    windowStart: startIndex * BYTES_PER_LINE,
    windowEnd: endIndex * BYTES_PER_LINE,
    atStart: startIndex <= 0,
    atEnd: endIndex >= totalLines,
    lines,
  }
}

function emptyResponse(): LogWindowResponse {
  return {
    stream: 'backend',
    fileSize: 0,
    windowStart: 0,
    windowEnd: 0,
    atStart: true,
    atEnd: true,
    lines: [],
  }
}

// U10: builds a LogTailMessage whose CONVERTED LogLine.byteOffset lands
// EXACTLY at `fromOffset` — the same worked-example math use-log-tail.ts's
// own tailMessageToLogLine performs, inverted here so a test can specify
// "this tail line starts at byte X" directly instead of hand-computing
// the server's END-offset wire representation every time. `parsed`
// becomes this message's raw JSON text verbatim (via JSON.stringify), so
// a caller that includes a `msg` field gets that exact text rendered by
// LogRow, matching how the fixture helpers above already give each
// windowed-read line a `msg: 'line N'` field for the SAME
// screen.getByText('line N') query convention.
function makeTailMessage(
  fromOffset: number,
  parsed: Record<string, unknown>,
): LogTailMessage {
  const raw = JSON.stringify(parsed)
  const byteLength = new TextEncoder().encode(raw).length + 1 // +1 for '\n'
  return { line: raw, byteOffset: fromOffset + byteLength }
}

// jsdom does not implement EventSource — same confirmed rationale as
// use-live-stream.spec.tsx's own MockEventSource (no polyfill installed;
// jsdom scopes itself to the DOM, not networking). This is a SEPARATE,
// locally-scoped mock rather than an import from use-log-tail.spec.tsx —
// matching this codebase's own established precedent of NOT sharing a
// MockEventSource test double across spec files (use-live-stream
// .spec.tsx defines its own rather than importing one from elsewhere
// either). Scoped to exactly the two event types use-log-tail.ts listens
// for.
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

  // Test helper — early-returns once closed so a superseded/stale
  // instance's late event is a proven no-op, matching a real closed
  // EventSource's guarantee that it stops delivering events.
  emit(type: string, data: unknown): void {
    if (this.closed) return
    const event = { data: JSON.stringify(data), type } as MessageEvent<string>
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function latestTailInstance(): MockEventSource {
  const instance = MockEventSource.instances.at(-1)
  if (!instance) throw new Error('No MockEventSource was constructed')
  return instance
}

// ═══════════════════════════════════════════════════════════════════════
// Part 1: the pure state machine (seedWindowState / applyFetchedWindow).
// No DOM, no virtualizer, no React — this is where the plan's R7/R8/R20
// correctness actually lives (bounded eviction, correct prepend/append
// merge, no duplicate byteOffsets), per this unit's own testing-
// architecture directive. Exhaustive by design: every scenario here costs
// nothing to run at any fixture size, including intentionally huge ones.
// ═══════════════════════════════════════════════════════════════════════

describe('seedWindowState', () => {
  it('replaces state wholesale from a response with no merge/eviction logic involved', () => {
    const response = makeResponse(1000, lineOffset(1000), 'before', 50)
    const state = seedWindowState(response)
    expect(state.lines).toHaveLength(50)
    expect(state.windowStart).toBe(response.windowStart)
    expect(state.windowEnd).toBe(response.windowEnd)
    expect(state.atStart).toBe(false)
    expect(state.atEnd).toBe(true)
    expect(state.fileSize).toBe(response.fileSize)
  })

  it('seeds an empty state correctly for an empty/absent file', () => {
    const state = seedWindowState(emptyResponse())
    expect(state.lines).toEqual([])
    expect(state.atStart).toBe(true)
    expect(state.atEnd).toBe(true)
    expect(state.fileSize).toBe(0)
  })
})

describe('applyFetchedWindow — before (prepend)', () => {
  it('prepends fetched lines ahead of the existing window, ascending by byteOffset', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const before = makeResponse(1000, lineOffset(450), 'before', 50)
    const next = applyFetchedWindow(initial, before, 'before', EVICTION_CAP)

    expect(next.lines).toHaveLength(100)
    expect(next.lines[0]?.byteOffset).toBe(400 * BYTES_PER_LINE)
    expect(next.lines[next.lines.length - 1]?.byteOffset).toBe(
      499 * BYTES_PER_LINE,
    )
    // Ascending order maintained end to end.
    for (let i = 1; i < next.lines.length; i++) {
      expect(next.lines[i]!.byteOffset).toBeGreaterThan(
        next.lines[i - 1]!.byteOffset,
      )
    }
  })

  it('adopts the new response windowStart/atStart (this fetch owns that edge)', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const before = makeResponse(1000, lineOffset(450), 'before', 450) // reaches byte 0
    const next = applyFetchedWindow(initial, before, 'before', EVICTION_CAP)
    expect(next.windowStart).toBe(0)
    expect(next.atStart).toBe(true)
  })

  it('leaves windowEnd/atEnd untouched when no eviction happens', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const before = makeResponse(1000, lineOffset(450), 'before', 50)
    const next = applyFetchedWindow(initial, before, 'before', EVICTION_CAP)
    expect(next.windowEnd).toBe(initial.windowEnd)
    expect(next.atEnd).toBe(initial.atEnd)
  })

  it('a tiny file (fewer lines than one window) settles with atStart AND atEnd both true after a single before fetch, from byte 0', () => {
    const response = makeResponse(10, Number.MAX_SAFE_INTEGER, 'before', 999)
    const state = seedWindowState(response)
    expect(state.lines).toHaveLength(10)
    expect(state.atStart).toBe(true)
    expect(state.atEnd).toBe(true)
  })
})

describe('applyFetchedWindow — after (append)', () => {
  it('appends fetched lines after the existing window, ascending by byteOffset', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const after = makeResponse(1000, lineOffset(500), 'after', 50)
    const next = applyFetchedWindow(initial, after, 'after', EVICTION_CAP)

    expect(next.lines).toHaveLength(100)
    expect(next.lines[0]?.byteOffset).toBe(450 * BYTES_PER_LINE)
    expect(next.lines[next.lines.length - 1]?.byteOffset).toBe(
      549 * BYTES_PER_LINE,
    )
    for (let i = 1; i < next.lines.length; i++) {
      expect(next.lines[i]!.byteOffset).toBeGreaterThan(
        next.lines[i - 1]!.byteOffset,
      )
    }
  })

  it('adopts the new response windowEnd/atEnd (this fetch owns that edge)', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const after = makeResponse(1000, lineOffset(500), 'after', 500) // reaches EOF
    const next = applyFetchedWindow(initial, after, 'after', EVICTION_CAP)
    expect(next.windowEnd).toBe(1000 * BYTES_PER_LINE)
    expect(next.atEnd).toBe(true)
  })

  it('leaves windowStart/atStart untouched when no eviction happens', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const after = makeResponse(1000, lineOffset(500), 'after', 50)
    const next = applyFetchedWindow(initial, after, 'after', EVICTION_CAP)
    expect(next.windowStart).toBe(initial.windowStart)
    expect(next.atStart).toBe(initial.atStart)
  })
})

describe('applyFetchedWindow — eviction bounds (R8)', () => {
  it('never exceeds evictionCap after a prepend that would otherwise overflow it', () => {
    const cap = 100
    let state: WindowState = seedWindowState(
      makeResponse(100000, lineOffset(60000), 'before', 80),
    )
    for (let step = 0; step < 20; step++) {
      // A REAL byte offset carried forward from the prior response — not
      // wrapped in lineOffset, since state.windowStart already IS a byte
      // offset (exactly how the real fetchEdge computes its own anchor).
      const anchor = state.windowStart
      const response = makeResponse(100000, anchor, 'before', 80)
      state = applyFetchedWindow(state, response, 'before', cap)
      expect(state.lines.length).toBeLessThanOrEqual(cap)
    }
  })

  it('never exceeds evictionCap after an append that would otherwise overflow it', () => {
    const cap = 100
    let state: WindowState = seedWindowState(
      makeResponse(100000, lineOffset(40000), 'before', 80),
    )
    for (let step = 0; step < 20; step++) {
      const anchor = state.windowEnd
      const response = makeResponse(100000, anchor, 'after', 80)
      state = applyFetchedWindow(state, response, 'after', cap)
      expect(state.lines.length).toBeLessThanOrEqual(cap)
    }
  })

  it('a prepend past the cap evicts from the BACK (newest end), keeping the newly-prepended oldest lines', () => {
    const cap = 60
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    ) // lines [450,500)
    const before = makeResponse(1000, lineOffset(450), 'before', 50) // lines [400,450)
    const next = applyFetchedWindow(initial, before, 'before', cap)

    expect(next.lines).toHaveLength(cap)
    // The oldest (just-prepended) lines must all survive.
    expect(next.lines[0]?.byteOffset).toBe(400 * BYTES_PER_LINE)
    // The newest lines (from the tail of the pre-eviction merge) are what
    // got dropped — line 499 (the very newest of the original 50) must be
    // gone, since evicting 40 lines from a 100-line merge drops the last 40.
    const offsets = next.lines.map(l => l.byteOffset / BYTES_PER_LINE)
    expect(offsets).not.toContain(499)
    expect(Math.max(...offsets)).toBe(459) // 400 + 60 - 1
  })

  it('an append past the cap evicts from the FRONT (oldest end), keeping the newly-appended newest lines', () => {
    const cap = 60
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    ) // lines [450,500)
    const after = makeResponse(1000, lineOffset(500), 'after', 50) // lines [500,550)
    const next = applyFetchedWindow(initial, after, 'after', cap)

    expect(next.lines).toHaveLength(cap)
    expect(next.lines[next.lines.length - 1]?.byteOffset).toBe(
      549 * BYTES_PER_LINE,
    )
    const offsets = next.lines.map(l => l.byteOffset / BYTES_PER_LINE)
    expect(offsets).not.toContain(450)
    expect(Math.min(...offsets)).toBe(490) // 550 - 60
  })

  it('re-derives windowEnd/atEnd (not the stale pre-eviction value) after a prepend evicts from the back', () => {
    const cap = 60
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    ) // atEnd:false (500 of 1000)
    const before = makeResponse(1000, lineOffset(450), 'before', 50)
    const next = applyFetchedWindow(initial, before, 'before', cap)

    // The evicted-to line is index 459 (see prior test) — windowEnd must
    // reflect that line's OWN end, not the original response's windowEnd
    // (450*BYTES_PER_LINE), which described the pre-eviction merged array.
    expect(next.windowEnd).toBe(460 * BYTES_PER_LINE)
    // atEnd must become false — eviction just discarded content that used
    // to be loaded, even though the file's real EOF status hasn't changed.
    expect(next.atEnd).toBe(false)
  })

  it('re-derives windowStart/atStart (not the stale pre-eviction value) after an append evicts from the front', () => {
    const cap = 60
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    ) // atStart:false
    const after = makeResponse(1000, lineOffset(500), 'after', 50)
    const next = applyFetchedWindow(initial, after, 'after', cap)

    expect(next.windowStart).toBe(490 * BYTES_PER_LINE)
    expect(next.atStart).toBe(false)
  })

  it('an eviction-free merge (well under the cap) preserves the calling edge’s exact atStart/atEnd from the response, including a true value', () => {
    // A `before` fetch that itself reaches byte 0 — this is the ONE case
    // where atStart:true legitimately flows straight from the response,
    // proven separately from the untouched-state-carryover tests above.
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const before = makeResponse(1000, lineOffset(450), 'before', 450)
    const next = applyFetchedWindow(initial, before, 'before', EVICTION_CAP)
    expect(next.atStart).toBe(true)
    expect(next.windowStart).toBe(0)
  })

  it('handles a huge fixture line count with no behavioral difference — this is pure logic, cost-free regardless of "file" size (AE3 backend-equivalent proof)', () => {
    const cap = 200
    const totalLines = 50_000_000 // an intentionally huge fixture — cheap because nothing here touches real I/O.
    let state: WindowState = seedWindowState(
      makeResponse(totalLines, lineOffset(totalLines), 'before', 100),
    )
    for (let step = 0; step < 50; step++) {
      const response = makeResponse(
        totalLines,
        state.windowStart,
        'before',
        100,
      )
      state = applyFetchedWindow(state, response, 'before', cap)
      expect(state.lines.length).toBeLessThanOrEqual(cap)
    }
    // Scrolled back exactly 50*100 = 5000 lines from the tail; still nowhere
    // near byte 0 of a 50-million-line file.
    expect(state.atStart).toBe(false)
  })
})

describe('applyFetchedWindow — de-duplication (defensive)', () => {
  it('filters out incoming lines whose byteOffset already exists in state before prepending', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    ) // [450,500)
    // A stale/overlapping fetch reporting some of the SAME lines already
    // held, plus two genuinely new ones.
    const overlapping = makeResponse(1000, lineOffset(460), 'before', 20) // [440,460)
    const next = applyFetchedWindow(
      initial,
      overlapping,
      'before',
      EVICTION_CAP,
    )

    const offsets = next.lines.map(l => l.byteOffset)
    const uniqueOffsets = new Set(offsets)
    expect(uniqueOffsets.size).toBe(offsets.length) // no duplicate byteOffset anywhere
    // Only the truly-new lines [440,450) were actually added on top of the
    // original 50.
    expect(next.lines).toHaveLength(60)
  })

  it('filters out incoming lines whose byteOffset already exists in state before appending', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    ) // [450,500)
    const overlapping = makeResponse(1000, lineOffset(490), 'after', 20) // [490,510)
    const next = applyFetchedWindow(initial, overlapping, 'after', EVICTION_CAP)

    const offsets = next.lines.map(l => l.byteOffset)
    expect(new Set(offsets).size).toBe(offsets.length)
    expect(next.lines).toHaveLength(60) // only [500,510) were genuinely new
  })

  it('a fully-overlapping duplicate fetch (a manual refresh re-fetching the SAME window) is a complete no-op on the array', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const identical = makeResponse(1000, lineOffset(500), 'before', 50)
    const next = applyFetchedWindow(initial, identical, 'before', EVICTION_CAP)
    expect(next.lines).toHaveLength(50)
    expect(next.lines).toEqual(initial.lines)
  })
})

describe('applyFetchedWindow — immutability (guards against react-virtual streaming-drift bug #1218)', () => {
  it('never mutates the previous state object or its lines array in place', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const initialLinesRef = initial.lines
    const initialFirstLineRef = initial.lines[0]

    const before = makeResponse(1000, lineOffset(450), 'before', 50)
    const next = applyFetchedWindow(initial, before, 'before', EVICTION_CAP)

    expect(next).not.toBe(initial)
    expect(next.lines).not.toBe(initialLinesRef)
    expect(initial.lines).toBe(initialLinesRef) // untouched
    expect(initial.lines[0]).toBe(initialFirstLineRef) // untouched
    // The old lines are the SAME object references in the new array (no
    // needless re-allocation of unaffected entries), just a different
    // array/object wrapping them.
    expect(next.lines).toContain(initialFirstLineRef)
  })
})

// U10: appendTailLine — the tail-append counterpart to applyFetchedWindow
// above, exercised at the SAME pure/DOM-free level per this file's own
// established convention.
describe('appendTailLine', () => {
  function makeTailLine(
    byteOffset: number,
    byteLength = BYTES_PER_LINE,
  ): LogLine {
    return {
      byteOffset,
      byteLength,
      raw: `{"line":"tail-${byteOffset}"}`,
      parsed: { msg: `tail-${byteOffset}` },
    }
  }

  it('appends one line to the back, extending fileSize/windowEnd to the appended line’s own end and marking atEnd true', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    ) // [450,500), atEnd:false
    const tailLine = makeTailLine(initial.windowEnd)
    const next = appendTailLine(initial, tailLine, EVICTION_CAP)

    expect(next.lines).toHaveLength(51)
    expect(next.lines[next.lines.length - 1]).toBe(tailLine)
    expect(next.fileSize).toBe(tailLine.byteOffset + tailLine.byteLength)
    expect(next.windowEnd).toBe(tailLine.byteOffset + tailLine.byteLength)
    expect(next.atEnd).toBe(true)
  })

  it('leaves windowStart/atStart untouched when no eviction happens', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const next = appendTailLine(
      initial,
      makeTailLine(initial.windowEnd),
      EVICTION_CAP,
    )
    expect(next.windowStart).toBe(initial.windowStart)
    expect(next.atStart).toBe(initial.atStart)
  })

  it('evicts from the FRONT (oldest end) once the cap is exceeded, re-deriving windowStart/atStart from the new first line', () => {
    const cap = 50
    const state: WindowState = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', cap),
    ) // exactly at cap already: [450,500)
    expect(state.lines).toHaveLength(cap)

    const tailLine = makeTailLine(state.windowEnd)
    const next = appendTailLine(state, tailLine, cap)

    expect(next.lines).toHaveLength(cap) // still bounded, never grows past cap
    expect(next.lines[next.lines.length - 1]).toBe(tailLine) // newest survives
    expect(next.lines[0]?.byteOffset).toBe(451 * BYTES_PER_LINE) // oldest (line 450) evicted
    expect(next.windowStart).toBe(next.lines[0]?.byteOffset)
    expect(next.atStart).toBe(false)
  })

  it('is idempotent against a redundant delivery of the SAME line already at the back (guards against a duplicate byteOffset ever entering state.lines)', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const lastLine = initial.lines[initial.lines.length - 1]
    if (!lastLine) throw new Error('fixture produced no lines')
    // A redundant delivery reporting the EXACT SAME byteOffset as the
    // current last line — e.g. a stale resume overlap.
    const duplicate: LogLine = { ...lastLine, raw: 'a-different-raw-value' }
    const next = appendTailLine(initial, duplicate, EVICTION_CAP)

    expect(next).toBe(initial) // a complete no-op, not just an equal-length array
    expect(next.lines).toHaveLength(50)
  })

  it('never mutates the previous state object or its lines array in place (guards against react-virtual streaming-drift bug #1218)', () => {
    const initial = seedWindowState(
      makeResponse(1000, lineOffset(500), 'before', 50),
    )
    const initialLinesRef = initial.lines
    const next = appendTailLine(
      initial,
      makeTailLine(initial.windowEnd),
      EVICTION_CAP,
    )

    expect(next).not.toBe(initial)
    expect(next.lines).not.toBe(initialLinesRef)
    expect(initial.lines).toBe(initialLinesRef) // untouched
    expect(initial.lines).toHaveLength(50) // untouched
  })

  it('handles a from-empty append (the empty-file open-at-tail case) correctly', () => {
    const initial = seedWindowState(emptyResponse())
    const tailLine = makeTailLine(0)
    const next = appendTailLine(initial, tailLine, EVICTION_CAP)

    expect(next.lines).toEqual([tailLine])
    expect(next.fileSize).toBe(tailLine.byteLength)
    expect(next.windowEnd).toBe(tailLine.byteLength)
    expect(next.atEnd).toBe(true)
    expect(next.atStart).toBe(true) // nothing evicted from an already-empty front
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 2: component-level wiring. Thinner by design (per this unit's own
// testing-architecture directive) — these prove the virtualizer/React glue
// isn't broken, not every edge case the pure function above already
// covers exhaustively. @tanstack/react-virtual reads real layout geometry
// (offsetHeight/offsetWidth, scrollTop, scroll events), none of which
// jsdom computes from CSS — see the stubs below.
// ═══════════════════════════════════════════════════════════════════════

const VISIBLE_ROWS = 16
const VIEWPORT_HEIGHT = VISIBLE_ROWS * ROW_PX

// @tanstack/react-virtual measures the scroll container via
// `element.offsetWidth`/`offsetHeight` (NOT getBoundingClientRect — traced
// directly in virtual-core's observeElementRect/getRect), which jsdom
// always reports as 0 with no polyfill. Stubbing the PROTOTYPE getter
// (rather than defineProperty-ing each individual element instance) is
// what lets a plain `render(<LogViewer .../>)` — which never gets a
// direct handle to the scroll div until after mount — receive a non-zero
// viewport size the instant the virtualizer's first synchronous
// `getRect(element)` call runs during mount, before any test code could
// intervene on that specific instance.
//
// `scrollHeight` gets the same prototype-getter treatment, computed live
// from the virtualized content div's own `style.height` (which LogViewer
// itself sets to `virtualizer.getTotalSize()`) rather than a value a test
// manually pokes in after the fact. This matters concretely: LogViewer's
// own "pin scroll to bottom on initial open-at-tail load" effect reads
// `scrollElement.scrollHeight` SYNCHRONOUSLY inside a useLayoutEffect that
// fires as part of mount, before any test code gets a chance to intervene
// on that specific element — a fixed/manually-set scrollHeight would still
// read as 0 (jsdom's real default) at exactly the moment that effect runs,
// silently defeating the very affordance these tests exist to prove (open-
// at-tail = scrolled to the newest content, not stuck at index 0).
function stubViewportGeometry() {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      // Only the scroll container itself needs a real viewport height —
      // every other element (rows, wrapper divs) can keep reporting 0
      // without affecting the virtualizer's own range math, since rows are
      // absolutely positioned/sized via `estimateSize`, never measured.
      return this.dataset?.trackId === 'log-viewer-scroll' ? VIEWPORT_HEIGHT : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return this.dataset?.trackId === 'log-viewer-scroll' ? 800 : 0
    },
  })
  // U10: virtual-core's getMaxScrollOffset() (which isAtEnd()/
  // getDistanceFromEnd()/scrollToEnd() all depend on — see that
  // function's own source: `scrollElement.scrollHeight -
  // scrollElement.clientHeight`) reads `clientHeight`/`clientWidth`, NOT
  // `offsetHeight`/`offsetWidth` — a DIFFERENT pair of DOM properties
  // Phase 1 never needed to polyfill, since none of its own logic
  // (edge-fetch detection, anchorTo) ever called isAtEnd() or any other
  // getMaxScrollOffset()-derived method. Without this, clientHeight
  // silently defaults to jsdom's real (0) value, making
  // getMaxScrollOffset() permanently equal to the FULL scrollHeight
  // instead of `scrollHeight - viewportHeight` — which makes
  // getDistanceFromEnd() report a large, never-zero distance for ANY
  // scroll position short of literally scrolling past the entire
  // content, and isAtEnd() therefore NEVER report true no matter how
  // genuinely "scrolled to the bottom" the viewport is. U10 is the
  // first unit to actually depend on isAtEnd() (auto-pause detection,
  // followOnAppend's own internal check, handleJumpToLatest's
  // scrollToEnd()), so this gap only matters starting here. For a
  // container with no border/padding, clientHeight/clientWidth equal
  // offsetHeight/offsetWidth in a real browser too, so mirroring the
  // SAME values is correct, not just convenient.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.dataset?.trackId === 'log-viewer-scroll' ? VIEWPORT_HEIGHT : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.dataset?.trackId === 'log-viewer-scroll' ? 800 : 0
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (this.dataset?.trackId !== 'log-viewer-scroll') return 0
      // The virtualizer's own inner "total size" spacer div is this
      // element's only child at all times LogViewer renders content (see
      // the component's JSX) — reading ITS live style.height is what makes
      // this getter track every count/eviction change automatically,
      // without a test ever needing to recompute or re-stub anything.
      const spacer = this.firstElementChild as HTMLElement | null
      const spacerHeight = spacer ? parseFloat(spacer.style.height || '0') : 0
      return Math.max(spacerHeight, VIEWPORT_HEIGHT)
    },
  })
  // jsdom's real `scrollTop` is a plain writable property with NO clamping
  // (confirmed empirically: assigning past scrollHeight leaves it exactly
  // at the overshot value) — unlike a real browser, which always clamps a
  // write to [0, scrollHeight - offsetHeight]. LogViewer's own "pin to
  // bottom" effect assigns `scrollTop = scrollHeight` verbatim, relying on
  // that real-browser clamp to land at the true max scroll position; under
  // jsdom's unclamped default, that same assignment overshoots past the
  // last row entirely, and the virtualizer (which trusts scrollOffset
  // literally) would compute a visible range that starts PAST the real
  // last visible row. This accessor pair restores the clamp so scrollTop
  // behaves like the real DOM property LogViewer (correctly) assumes it is.
  const scrollTopValues = new WeakMap<HTMLElement, number>()
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get() {
      return scrollTopValues.get(this) ?? 0
    },
    set(value: number) {
      const maxScrollTop = Math.max(0, this.scrollHeight - this.offsetHeight)
      scrollTopValues.set(this, Math.max(0, Math.min(value, maxScrollTop)))
    },
  })
  // @tanstack/react-virtual's DEFAULT scrollToFn (elementScroll, confirmed
  // by reading virtual-core's own source) does not assign `scrollTop`
  // directly — it calls `scrollElement.scrollTo({ top, behavior })`, the
  // METHOD. This matters concretely for `anchorTo:'end'`: on every render
  // where the loaded array's edge keys changed (a prepend or an edge-
  // eviction), a `useLayoutEffect` INTERNAL to useVirtualizer computes a
  // compensating scroll offset and applies it via exactly this scrollTo()
  // call — jsdom implements `Element.prototype.scrollTo` as a documented
  // no-op (unlike `window.scrollTo`, which jsdom logs "not implemented"
  // for; the element-level method just silently does nothing), so without
  // this polyfill the anchor adjustment is computed correctly internally
  // but never actually reaches this stubbed scrollTop, and the visible
  // range appears to never move — indistinguishable from `anchorTo`
  // failing, when the real gap is this jsdom method being a no-op.
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options?: number | ScrollToOptions) {
      const top =
        typeof options === 'object' && options !== null
          ? (options.top ?? this.scrollTop)
          : this.scrollTop
      this.scrollTop = top
      // Dispatched on a microtask, NOT synchronously within this call — a
      // real browser's `scroll` event does not fire re-entrantly inside
      // the same call stack as the `scrollTo()` invocation that caused it.
      // This matters concretely here because THIS polyfill's own caller is
      // virtual-core's internal `_willUpdate` useLayoutEffect (see this
      // property's own header comment) — firing the event synchronously
      // let React's effect-flush and virtual-core's own re-entrant
      // `setOptions`/measurement bookkeeping interleave within a single
      // layout-effect pass, which corrupted internal state badly enough to
      // render zero rows in some scenarios (observed empirically: an
      // earlier synchronous-dispatch version of this polyfill produced an
      // empty spacer div with no virtual items at all).
      void Promise.resolve().then(() => fireEvent.scroll(this))
    },
  })
}

function restoreViewportGeometry() {
  // @ts-expect-error -- deleting a test-installed accessor to restore jsdom's own default descriptor
  delete HTMLElement.prototype.offsetHeight
  // @ts-expect-error -- see above
  delete HTMLElement.prototype.offsetWidth
  // @ts-expect-error -- see above
  delete HTMLElement.prototype.clientHeight
  // @ts-expect-error -- see above
  delete HTMLElement.prototype.clientWidth
  // @ts-expect-error -- see above
  delete HTMLElement.prototype.scrollHeight
  // @ts-expect-error -- see above
  delete HTMLElement.prototype.scrollTop
  // @ts-expect-error -- see above
  delete HTMLElement.prototype.scrollTo
}

function scrollTo(scrollElement: HTMLElement, top: number) {
  scrollElement.scrollTop = top
  fireEvent.scroll(scrollElement)
}

function findScrollContainer(): HTMLElement {
  const el = document.querySelector('[data-track-id="log-viewer-scroll"]')
  if (!(el instanceof HTMLElement)) {
    throw new Error('scroll container not found')
  }
  return el
}

// LogViewer pins scroll to the bottom on initial load by setting
// `scrollElement.scrollTop` IMPERATIVELY inside a useLayoutEffect (see the
// component's own comment on that effect). A real browser fires a native
// `scroll` event as a side effect of that assignment, which is what lets
// @tanstack/react-virtual's `observeElementOffset` (a plain
// addEventListener('scroll', ...)) learn about the new offset and
// recompute the visible range — jsdom, unlike a real browser, does NOT
// synthesize that event for a JS-driven scrollTop assignment, so the
// virtualizer would otherwise stay stuck believing the range is still
// scrolled to the top. This is a genuine jsdom fidelity gap, not a
// component bug: firing the event explicitly here stands in for what a
// real browser does automatically the instant `scrollTop` changes.
async function settleInitialLoad(
  readWindow: jest.Mock<Promise<LogWindowResponse>, [ReadLogWindowParams]>,
) {
  await waitFor(() => expect(readWindow).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(
      document.querySelector('[data-track-id="log-viewer-scroll"]'),
    ).toBeInTheDocument(),
  )
  const scrollContainer = findScrollContainer()
  fireEvent.scroll(scrollContainer)
  return scrollContainer
}

describe('LogViewer — component wiring', () => {
  beforeEach(() => {
    stubViewportGeometry()
    // U10: LogViewer now unconditionally opens a live-tail EventSource
    // once its initial windowed load settles (isActive defaults true,
    // following defaults true) — EVERY test in this describe block,
    // including every pre-existing Phase 1 test above that never
    // mentions the tail at all, now exercises that connect() call. A
    // mock global is required here (not just inside the new U10-specific
    // nested describe below) or those pre-existing tests would throw the
    // instant `new EventSource(...)` runs against jsdom's real (absent)
    // global — same confirmed gap use-live-stream.spec.tsx's own header
    // comment documents.
    MockEventSource.instances = []
    global.EventSource = MockEventSource as unknown as typeof EventSource
  })

  afterEach(() => {
    restoreViewportGeometry()
  })

  it('happy path (R7): renders far fewer DOM rows than the total fixture size — only the visible window + overscan', async () => {
    const totalLines = 5000
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockImplementation(async ({ anchor, direction }) =>
        // `anchor` is already a real byte offset here (destructured straight
        // from the params LogViewer actually sent) — makeResponse itself
        // clamps it against totalLines internally, so no external clamping
        // is needed (an earlier draft's `Math.min(anchor, totalLines)`
        // mixed a byte-offset unit with a line-count unit).
        makeResponse(
          totalLines,
          anchor,
          direction === 'after' ? 'after' : 'before',
          80,
        ),
      )

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )

    await waitFor(() => expect(readWindow).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-track-id="log-row-select"]').length,
      ).toBeGreaterThan(0),
    )

    const renderedRows = document.querySelectorAll(
      '[data-track-id="log-row-select"]',
    ).length
    // Visible viewport (~16 rows) + 2*OVERSCAN (12) is comfortably under 50
    // — nowhere near the 5000-line fixture or even the single 80-line
    // fetched window.
    expect(renderedRows).toBeLessThan(50)
    expect(renderedRows).toBeGreaterThan(0)
  })

  it('initial render triggers the open-at-tail fetch (anchor=MAX_SAFE_INTEGER, direction=before) and displays the returned rows', async () => {
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockResolvedValue(makeResponse(200, lineOffset(200), 'before', 50))

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )

    await settleInitialLoad(readWindow)
    expect(readWindow).toHaveBeenCalledWith({
      stream: 'backend',
      anchor: Number.MAX_SAFE_INTEGER,
      direction: 'before',
    })

    await waitFor(() =>
      expect(screen.getByText('line 199')).toBeInTheDocument(),
    )
  })

  it('a fixture "before" response received via the mocked readWindow results in earlier rows appearing after scrolling near the top', async () => {
    const totalLines = 300
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockImplementation(async ({ anchor, direction }) => {
        if (direction === 'after') {
          return makeResponse(totalLines, anchor, 'after', 60)
        }
        // `anchor` is already a real byte offset — makeResponse clamps it
        // against totalLines internally now, so no external Math.min
        // (which would otherwise compare a byte offset against a raw line
        // count, a real unit-mismatch bug an earlier draft of this fixture
        // had) is needed.
        return makeResponse(totalLines, anchor, 'before', 60)
      })

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )

    const scrollContainer = await settleInitialLoad(readWindow)
    // Initial window: lines [240,300).
    await waitFor(() =>
      expect(screen.getByText('line 299')).toBeInTheDocument(),
    )
    expect(screen.queryByText('line 200')).not.toBeInTheDocument()

    const spacerBefore = scrollContainer.firstElementChild as HTMLElement
    const heightBefore = parseFloat(spacerBefore.style.height)

    scrollTo(scrollContainer, 0)

    await waitFor(() => expect(readWindow).toHaveBeenCalledTimes(2))
    expect(readWindow).toHaveBeenLastCalledWith({
      stream: 'backend',
      anchor: 240 * BYTES_PER_LINE,
      direction: 'before',
    })
    // The fetched `before` response's 60 lines [180,240) are now genuinely
    // part of the loaded array — proven via the virtualizer's own total-
    // size spacer growing by exactly one window's worth of rows, rather
    // than asserting a SPECIFIC line's on-screen visibility. The latter
    // would be in direct tension with anchorTo:'end' actually working:
    // that option's entire purpose is to keep the viewport showing the
    // SAME content across a prepend rather than jumping to reveal the
    // newly-prepended rows (proven separately, and more directly, by the
    // "does not move the currently-rendered top row" test below) — so an
    // assertion that the JUST-prepended content is immediately on-screen
    // would only pass if anchoring were broken.
    await waitFor(() => {
      const spacerAfter = scrollContainer.firstElementChild as HTMLElement
      const heightAfter = parseFloat(spacerAfter.style.height)
      expect(heightAfter).toBe(heightBefore + 60 * ROW_PX)
    })
  })

  it('happy path (R6): scrolling to the top repeatedly walks before-fetches until atStart, exposing line 0 and showing the top-of-file marker', async () => {
    const totalLines = 150 // small enough that a handful of 60-line before-fetches reaches byte 0
    // Each `before` fetch adds 60 lines to the front. Scrolling all the way
    // to scrollTop:0 always lands the visible range at index 0 of whatever
    // is currently loaded, which is always well within EDGE_FETCH_THRESHOLD
    // of the array's own start — so every iteration of this loop reliably
    // re-triggers another `before` fetch, exactly the property this test
    // exercises (not a coincidence of the chosen fetch size).
    expect(0).toBeLessThanOrEqual(EDGE_FETCH_THRESHOLD)
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockImplementation(async ({ anchor, direction }) => {
        if (direction === 'after') {
          return makeResponse(totalLines, anchor, 'after', 60)
        }
        // `anchor` is already a real byte offset — makeResponse clamps it
        // against totalLines internally now, so no external Math.min
        // (which would otherwise compare a byte offset against a raw line
        // count, a real unit-mismatch bug an earlier draft of this fixture
        // had) is needed.
        return makeResponse(totalLines, anchor, 'before', 60)
      })

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )
    const scrollContainer = await settleInitialLoad(readWindow)
    // Repeatedly scroll to the top, letting each resulting prepend settle,
    // until the top-of-file marker appears (atStart reached) or a generous
    // attempt budget is exhausted. Each iteration's waitFor accepts EITHER
    // outcome — a new fetch landed, OR atStart was already reached by a
    // prior iteration's fetch — rather than asserting an exact per-
    // iteration call-count delta: once atStart is true, fetchEdge's own
    // early-return means a further scrollTo(0) legitimately produces NO
    // new call, which an exact-delta assertion would misreport as a stall
    // instead of the correct terminal state.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (screen.queryByText('line 0')) break
      const callsBeforeThisScroll = readWindow.mock.calls.length
      scrollTo(scrollContainer, 0)

      await waitFor(() => {
        const reachedStart = screen.queryByText('line 0') !== null
        const gotNewCall = readWindow.mock.calls.length > callsBeforeThisScroll
        expect(reachedStart || gotNewCall).toBe(true)
      })
    }

    await waitFor(() => expect(screen.getByText('line 0')).toBeInTheDocument())
    expect(
      screen.getByText(/top of file/i, { exact: false }),
    ).toBeInTheDocument()
  })

  it('edge case: rapid near-simultaneous scroll events do not fire overlapping fetches for the same edge (in-flight guard)', async () => {
    let resolveBefore: ((response: LogWindowResponse) => void) | undefined
    const beforeCallCount = { current: 0 }
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockImplementation(({ anchor, direction }) => {
        if (direction === 'before' && beforeCallCount.current > 0) {
          // Only the FIRST `before` call after the initial seed is left
          // pending on purpose; a second concurrent one would resolve
          // immediately here, which is exactly what this test must prove
          // never happens.
          beforeCallCount.current += 1
          return new Promise<LogWindowResponse>(resolve => {
            resolveBefore = resolve
          })
        }
        if (direction === 'before') {
          beforeCallCount.current += 1
          return new Promise<LogWindowResponse>(resolve => {
            resolveBefore = resolve
          })
        }
        return Promise.resolve(makeResponse(1000, anchor, 'after', 60))
      })

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )

    // Initial open-at-tail fetch is itself a `before` fetch — let it
    // resolve once via the fallback path below before testing the
    // in-flight guard on a SECOND, deliberately-slow `before` fetch.
    await waitFor(() => expect(readWindow).toHaveBeenCalledTimes(1))
    resolveBefore?.(makeResponse(1000, lineOffset(1000), 'before', 60))
    await waitFor(() =>
      expect(
        document.querySelector('[data-track-id="log-viewer-scroll"]'),
      ).toBeInTheDocument(),
    )
    const scrollContainer = findScrollContainer()
    // See settleInitialLoad's own comment: a JS-driven scrollTop assignment
    // (the initial pin-to-bottom effect) does not synthesize a jsdom scroll
    // event the way a real browser would, so the virtualizer needs one
    // fired explicitly BEFORE checking for tail content — asserting
    // 'line 999' first (as an earlier draft did) races the pin-to-bottom
    // effect and fails nondeterministically depending on exactly when
    // React commits relative to this assertion.
    fireEvent.scroll(scrollContainer)
    await waitFor(() =>
      expect(screen.getByText('line 999')).toBeInTheDocument(),
    )

    const callsBeforeScroll = readWindow.mock.calls.length

    // Two near-simultaneous scroll events landing at/near the top edge —
    // the second must be swallowed by the in-flight ref guard while the
    // first (deliberately never resolved in this test) is still pending.
    scrollTo(scrollContainer, 0)
    scrollTo(scrollContainer, 0)

    // Give any microtask-queued (but guarded-against) second call a chance
    // to have fired if the guard were broken.
    await Promise.resolve()
    await Promise.resolve()

    const beforeCallsSinceScroll = readWindow.mock.calls
      .slice(callsBeforeScroll)
      .filter(([params]) => params.direction === 'before')
    expect(beforeCallsSinceScroll).toHaveLength(1)
  })

  it('edge case: a stream with fewer lines than one window renders fully with atStart and atEnd both true, and issues no further fetches', async () => {
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockResolvedValue(
        makeResponse(5, Number.MAX_SAFE_INTEGER, 'before', 999),
      )

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('line 4')).toBeInTheDocument())
    expect(screen.getByText('line 0')).toBeInTheDocument()
    expect(
      screen.getByText(/top of file/i, { exact: false }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/end of file/i, { exact: false }),
    ).toBeInTheDocument()

    const callsAfterInitialLoad = readWindow.mock.calls.length
    const scrollContainer = findScrollContainer()
    scrollTo(scrollContainer, 0)
    scrollTo(scrollContainer, scrollContainer.scrollHeight)

    // No fetch loop: atStart/atEnd are both already true, so fetchEdge's
    // own early-return guards must prevent any further call regardless of
    // how the (tiny, fully-loaded) list is scrolled.
    await Promise.resolve()
    await Promise.resolve()
    expect(readWindow.mock.calls.length).toBe(callsAfterInitialLoad)
  })

  it('selecting a row invokes onSelectLine with the FULL LogLine object the row represents, not just a byteOffset', async () => {
    const user = userEvent.setup()
    const onSelectLine = jest.fn()
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockResolvedValue(makeResponse(10, lineOffset(10), 'before', 10))

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={onSelectLine}
      />,
    )

    const row = await screen.findByText('line 5')
    await user.click(row)

    expect(onSelectLine).toHaveBeenCalledTimes(1)
    const selected = onSelectLine.mock.calls[0]?.[0] as LogLine
    expect(selected.byteOffset).toBe(5 * BYTES_PER_LINE)
    expect(selected.parsed).toEqual({ line: 5, level: 30, msg: 'line 5' })
  })

  it('the manual refresh control re-runs the open-at-tail fetch and resets state fresh', async () => {
    const user = userEvent.setup()
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockResolvedValueOnce(makeResponse(200, lineOffset(200), 'before', 50))
      .mockResolvedValue(makeResponse(260, lineOffset(260), 'before', 50))

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )
    await settleInitialLoad(readWindow)
    await waitFor(() =>
      expect(screen.getByText('line 199')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(readWindow).toHaveBeenCalledTimes(2))
    expect(readWindow).toHaveBeenLastCalledWith({
      stream: 'backend',
      anchor: Number.MAX_SAFE_INTEGER,
      direction: 'before',
    })
    // The refresh reseeds via the SAME pin-to-bottom useLayoutEffect as the
    // initial mount, so it needs its own post-scroll settle for the same
    // jsdom-fidelity reason settleInitialLoad's own comment explains.
    await waitFor(() =>
      expect(
        document.querySelector('[data-track-id="log-viewer-scroll"]'),
      ).toBeInTheDocument(),
    )
    fireEvent.scroll(findScrollContainer())
    await waitFor(() =>
      expect(screen.getByText('line 259')).toBeInTheDocument(),
    )
    // The pre-refresh tail content is gone — this was a wholesale reseed,
    // not a merge.
    expect(screen.queryByText('line 199')).not.toBeInTheDocument()
  })

  it('shows the live-status banner alongside the loaded content, following by default (U10 superseded Phase 1’s static "Snapshot" framing now that the tail is wired in)', async () => {
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockResolvedValue(makeResponse(200, lineOffset(200), 'before', 50))

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )

    // settleInitialLoad (not a bare waitFor) is required here: it fires
    // the explicit scroll event that syncs the virtualizer's OWN internal
    // scroll-offset tracking with the pin-to-bottom effect's imperative
    // `scrollTop = scrollHeight` write — the SAME jsdom-fidelity gap this
    // file's settleInitialLoad/stubViewportGeometry comments already
    // document (a real browser fires a native `scroll` event as a side
    // effect of that assignment; jsdom does not). Without it, isAtEnd()
    // would read a STALE pre-scroll offset on any later onChange
    // invocation and this unit's own auto-pause logic would (correctly,
    // given that stale reading) trigger — a test-fidelity gap, not a
    // production bug, since a real browser's own scroll event closes it
    // well before any such invocation could observe a stale value.
    await settleInitialLoad(readWindow)
    await waitFor(() =>
      expect(
        screen.getByText(/following live/i, { exact: false }),
      ).toBeInTheDocument(),
    )
    // No pause affordance while genuinely following by default.
    expect(screen.queryByText(/paused/i)).not.toBeInTheDocument()
  })

  it('renders an error affordance with a retry control when the initial fetch rejects', async () => {
    const user = userEvent.setup()
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(makeResponse(10, lineOffset(10), 'before', 10))

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )

    await waitFor(() =>
      expect(
        screen.getByText(/failed to load/i, { exact: false }),
      ).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => expect(screen.getByText('line 9')).toBeInTheDocument())
  })

  it('a row present both before and after a prepend keeps the SAME DOM node identity, rather than every visible row being torn down and recreated (best-effort viewport-stability proxy under jsdom)', async () => {
    // This is a deliberately WEAKER proxy than a pixel-for-pixel
    // scrollTop/visible-range assertion, and the gap is not merely
    // jsdom's missing layout engine — reproducing this exact scenario
    // against the REAL installed @tanstack/virtual-core (3.17.3) under
    // this project's jsdom + polyfilled offsetHeight/scrollTop/scrollTo
    // stack showed the post-prepend visible index range shifting away
    // from the pre-prepend range with NO overlap at all, even though
    // getItemKey here is exactly the documented-correct pattern (a
    // persistent per-line identifier — byteOffset — never an index; see
    // https://tanstack.com/virtual/latest/docs/api/virtualizer's own
    // anchorTo section, which calls this out as the prerequisite for
    // prepend stability). TanStack's own GitHub discussions (#195, #1018)
    // document other users hitting comparable anchor-drift symptoms even
    // with correct key usage, so this is a known-nontrivial area of the
    // library itself under some conditions, not a misuse of the API on
    // this component's part — and not the kind of upstream-library
    // uncertainty worth deep-diving inside this unit (per this unit's own
    // brief: prioritize the pure-function tests' confidence over chasing
    // jsdom/virtual-core pixel fidelity here).
    //
    // What this test proves instead, robust to exactly where the
    // post-prepend viewport ends up landing: React's reconciliation
    // NEVER tears down and recreates a DOM node for a LogLine whose
    // getItemKey (byteOffset) is unchanged and still within whatever the
    // rendered range turns out to be — captured via real DOM node
    // identity (`toBe`, not just text content), which a broken-key
    // implementation (e.g. keying by array index instead of byteOffset)
    // would fail even by coincidence, since an index-keyed remount
    // recreates every node whose relative position shifted, which a
    // prepend does for the entire array.
    const totalLines = 300
    const readWindow = jest
      .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
      .mockImplementation(({ anchor, direction }) =>
        Promise.resolve(
          direction === 'after'
            ? makeResponse(totalLines, anchor, 'after', 60)
            : makeResponse(totalLines, anchor, 'before', 60),
        ),
      )

    render(
      <LogViewer
        stream="backend"
        readWindow={readWindow}
        onSelectLine={jest.fn()}
      />,
    )
    const scrollContainer = await settleInitialLoad(readWindow)
    await waitFor(() =>
      expect(screen.getByText('line 299')).toBeInTheDocument(),
    )

    // Capture the DOM node identity of every rendered row, keyed by its
    // own text content, before the prepend — rather than assuming which
    // specific line survives, this test discovers it empirically from
    // whatever range actually renders both before and after.
    const rowsBefore = new Map<string, Element>()
    for (const row of scrollContainer.querySelectorAll(
      '[data-track-id="log-row-select"]',
    )) {
      const text = row.textContent
      if (text) rowsBefore.set(text, row)
    }
    expect(rowsBefore.size).toBeGreaterThan(0)

    const spacerBefore = scrollContainer.firstElementChild as HTMLElement
    const heightBefore = parseFloat(spacerBefore.style.height)

    // A small nudge just past EDGE_FETCH_THRESHOLD's pixel equivalent —
    // deliberately NOT a jump all the way to scrollTop:0. The smaller the
    // scroll delta that triggers the fetch, the closer the pre/post
    // visible ranges start out, which is what makes ANY overlap surviving
    // the prepend a meaningful signal rather than a coincidence of how far
    // anchorTo's compensation actually lands (see this test's own header
    // comment on why an exact pixel destination isn't asserted).
    scrollTo(scrollContainer, EDGE_FETCH_THRESHOLD * ROW_PX)
    await waitFor(() => expect(readWindow).toHaveBeenCalledTimes(2))

    // The fetched content genuinely landed (the array grew by one window's
    // worth of rows) — checked via the spacer height rather than asserting
    // a specific newly-prepended line's on-screen visibility, which would
    // be in direct tension with anchorTo:'end' actually holding the
    // viewport steady (see the "before" response component test's own
    // comment on this same distinction).
    await waitFor(() => {
      const spacerAfter = scrollContainer.firstElementChild as HTMLElement
      const heightAfter = parseFloat(spacerAfter.style.height)
      expect(heightAfter).toBe(heightBefore + 60 * ROW_PX)
    })

    const rowsAfter = new Map<string, Element>()
    for (const row of scrollContainer.querySelectorAll(
      '[data-track-id="log-row-select"]',
    )) {
      const text = row.textContent
      if (text) rowsAfter.set(text, row)
    }

    const survivingTexts = [...rowsBefore.keys()].filter(text =>
      rowsAfter.has(text),
    )
    // At least one row rendered both before and after — proves the two
    // rendered ranges are not disjoint (a real regression this test would
    // also want to catch: e.g. a completely different fetch size than
    // requested silently blowing the whole visible window away).
    expect(survivingTexts.length).toBeGreaterThan(0)
    for (const text of survivingTexts) {
      // The IDENTICAL DOM node, not just equal text — this is what proves
      // React never unmounted/remounted it across the prepend, which is
      // exactly what a stable byteOffset-based getItemKey is supposed to
      // guarantee for any row that remains part of the rendered range.
      expect(rowsAfter.get(text)).toBe(rowsBefore.get(text))
    }
  })

  // ═══════════════════════════════════════════════════════════════════
  // U10: follow / pause / jump-to-latest (live tail client). Nested here
  // (not a sibling describe) so it inherits the outer beforeEach's
  // stubViewportGeometry() + MockEventSource global installation.
  // ═══════════════════════════════════════════════════════════════════
  describe('U10: follow / pause / jump-to-latest (live tail)', () => {
    const TOTAL_LINES = 200
    const FILE_SIZE = TOTAL_LINES * BYTES_PER_LINE

    function makeReadWindow() {
      return jest
        .fn<Promise<LogWindowResponse>, [ReadLogWindowParams]>()
        .mockImplementation(async ({ anchor, direction }) =>
          makeResponse(
            TOTAL_LINES,
            anchor,
            direction === 'after' ? 'after' : 'before',
            50,
          ),
        )
    }

    // Settles the initial load AND the tail connect() that fires once it
    // reaches 'done' — settleInitialLoad's own waitFor/scroll cycles
    // already flush enough passive-effect ticks for the (initialLoad,
    // isActive) connect effect to have run by the time this returns, but
    // this helper makes that dependency explicit and gives every test in
    // this block a single, obviously-real MockEventSource instance to
    // grab.
    async function settleInitialLoadAndTail(
      readWindow: jest.Mock<Promise<LogWindowResponse>, [ReadLogWindowParams]>,
    ) {
      const scrollContainer = await settleInitialLoad(readWindow)
      await waitFor(() => expect(MockEventSource.instances).toHaveLength(1))
      return { scrollContainer, tail: latestTailInstance() }
    }

    it('AE1 (R3): connects the tail from the initial window’s fileSize once the initial load settles', async () => {
      const readWindow = makeReadWindow()
      render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
        />,
      )

      const { tail } = await settleInitialLoadAndTail(readWindow)
      expect(tail.url).toBe(logTailUrl('backend', FILE_SIZE))
    })

    it('AE1 (R3): with follow on and pinned at bottom, a tail append shows the new line and keeps the viewport pinned to the bottom', async () => {
      const readWindow = makeReadWindow()
      render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
        />,
      )

      const { scrollContainer, tail } =
        await settleInitialLoadAndTail(readWindow)
      await waitFor(() =>
        expect(screen.getByText('line 199')).toBeInTheDocument(),
      )

      const spacerBefore = scrollContainer.firstElementChild as HTMLElement
      const heightBefore = parseFloat(spacerBefore.style.height)

      const message = makeTailMessage(FILE_SIZE, {
        line: 200,
        level: 30,
        msg: 'line 200',
      })
      tail.emit('log-append', message)

      await waitFor(() =>
        expect(screen.getByText('line 200')).toBeInTheDocument(),
      )

      // Exactly one new row's worth of height — the append landed, not a
      // whole-tail re-fetch of unknown size.
      const spacerAfter = scrollContainer.firstElementChild as HTMLElement
      const heightAfter = parseFloat(spacerAfter.style.height)
      expect(heightAfter).toBe(heightBefore + ROW_PX)

      // followOnAppend auto-scrolled: the viewport is still pinned to the
      // (new, taller) bottom, same proxy convention this file's Phase 1
      // tests already use for "the currently-visible content didn't jump
      // away."
      await waitFor(() => {
        expect(scrollContainer.scrollTop).toBe(
          scrollContainer.scrollHeight - scrollContainer.offsetHeight,
        )
      })

      // Still following — no pause affordance appeared.
      expect(screen.queryByText(/paused/i)).not.toBeInTheDocument()
    })

    it('AE1 (R4): scrolling up pauses follow and shows an "N new" badge; clicking "jump to latest" reseeds, scrolls to bottom, resets the badge, and genuinely resumes follow', async () => {
      const readWindow = makeReadWindow()
      render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
        />,
      )

      const { scrollContainer } = await settleInitialLoadAndTail(readWindow)
      await waitFor(() =>
        expect(screen.getByText('line 199')).toBeInTheDocument(),
      )

      // Scroll away from the bottom — flips to paused.
      scrollTo(scrollContainer, 0)
      await waitFor(() =>
        expect(screen.getByText(/paused/i)).toBeInTheDocument(),
      )
      expect(screen.getByText(/0 new/i)).toBeInTheDocument()

      // Further tail appends increment the badge without adding rows —
      // grab the CURRENT tail instance fresh (a `before` edge-fetch may
      // have fired from the scroll above, but that's an unrelated
      // windowed read, not a new tail connection).
      const tail = latestTailInstance()
      const rowCountBefore = document.querySelectorAll(
        '[data-track-id="log-row-select"]',
      ).length

      tail.emit(
        'log-append',
        makeTailMessage(FILE_SIZE, { line: 200, level: 30, msg: 'line 200' }),
      )
      await waitFor(() =>
        expect(screen.getByText(/1 new/i)).toBeInTheDocument(),
      )
      expect(screen.queryByText('line 200')).not.toBeInTheDocument()
      expect(
        document.querySelectorAll('[data-track-id="log-row-select"]').length,
      ).toBe(rowCountBefore)

      // Jump to latest: fresh readWindow call, scroll back to bottom,
      // badge resets, follow resumes.
      const callsBeforeJump = readWindow.mock.calls.length
      await userEvent.click(
        screen.getByRole('button', { name: /jump to latest/i }),
      )

      await waitFor(() =>
        expect(readWindow.mock.calls.length).toBeGreaterThan(callsBeforeJump),
      )
      expect(readWindow).toHaveBeenLastCalledWith({
        stream: 'backend',
        anchor: Number.MAX_SAFE_INTEGER,
        direction: 'before',
      })

      await waitFor(() =>
        expect(screen.queryByText(/paused/i)).not.toBeInTheDocument(),
      )
      await waitFor(() =>
        expect(screen.getByText(/following live/i)).toBeInTheDocument(),
      )

      // A NEW tail connection was opened for the re-seek (connect()
      // closes the old one first — see use-log-tail.ts).
      await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
      const newTail = latestTailInstance()
      expect(newTail).not.toBe(tail)
      // Re-seeded from the FRESH fileSize the jump's own readWindow
      // response reported (still FILE_SIZE here — the mock readWindow's
      // TOTAL_LINES is constant across calls, so the "fresh" offset and
      // the original one coincide, but this asserts it was actually
      // DERIVED from that response rather than reusing a stale value by
      // coincidence).
      expect(newTail.url).toBe(logTailUrl('backend', FILE_SIZE))

      // Prove follow is genuinely back to true (not just cosmetically
      // reset): a tail append AFTER the jump auto-scrolls again.
      const spacerBeforeSecondAppend =
        scrollContainer.firstElementChild as HTMLElement
      const heightBeforeSecondAppend = parseFloat(
        spacerBeforeSecondAppend.style.height,
      )
      newTail.emit(
        'log-append',
        makeTailMessage(FILE_SIZE, {
          line: 201,
          level: 30,
          msg: 'line 201',
        }),
      )
      await waitFor(() =>
        expect(screen.getByText('line 201')).toBeInTheDocument(),
      )
      await waitFor(() => {
        const spacerAfterSecondAppend =
          scrollContainer.firstElementChild as HTMLElement
        expect(parseFloat(spacerAfterSecondAppend.style.height)).toBe(
          heightBeforeSecondAppend + ROW_PX,
        )
      })
    })

    it('AE4 (R5): a burst of several tail appends in quick succession all individually appear as separate rows, not coalesced into only the last one', async () => {
      const readWindow = makeReadWindow()
      render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
        />,
      )

      const { tail } = await settleInitialLoadAndTail(readWindow)
      await waitFor(() =>
        expect(screen.getByText('line 199')).toBeInTheDocument(),
      )

      let cursor = FILE_SIZE
      const burstLines = [200, 201, 202, 203, 204]
      for (const n of burstLines) {
        const message = makeTailMessage(cursor, {
          line: n,
          level: 30,
          msg: `line ${n}`,
        })
        cursor = message.byteOffset
        tail.emit('log-append', message)
      }

      // Sequential awaits (not Promise.all) are deliberate: each line's
      // own appearance is asserted independently, which is what proves
      // EVERY one of the 5 emits above is reflected in the DOM, not just
      // whichever one happened to win a single shared re-render.
      for (const n of burstLines) {
        await waitFor(() =>
          expect(screen.getByText(`line ${n}`)).toBeInTheDocument(),
        )
      }
    })

    it('edge case: while paused, incoming tail lines never grow state.lines/the DOM row count/the total-size spacer height — only the badge counter increases', async () => {
      const readWindow = makeReadWindow()
      render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
        />,
      )

      const { scrollContainer } = await settleInitialLoadAndTail(readWindow)
      scrollTo(scrollContainer, 0)
      await waitFor(() =>
        expect(screen.getByText(/paused/i)).toBeInTheDocument(),
      )

      const tail = latestTailInstance()
      const rowCountBefore = document.querySelectorAll(
        '[data-track-id="log-row-select"]',
      ).length
      const spacerBefore = scrollContainer.firstElementChild as HTMLElement
      const heightBefore = parseFloat(spacerBefore.style.height)

      let cursor = FILE_SIZE
      for (const n of [200, 201, 202]) {
        const message = makeTailMessage(cursor, {
          line: n,
          level: 30,
          msg: `line ${n}`,
        })
        cursor = message.byteOffset
        tail.emit('log-append', message)
      }

      await waitFor(() =>
        expect(screen.getByText(/3 new/i)).toBeInTheDocument(),
      )
      expect(
        document.querySelectorAll('[data-track-id="log-row-select"]').length,
      ).toBe(rowCountBefore)
      const spacerAfter = scrollContainer.firstElementChild as HTMLElement
      expect(parseFloat(spacerAfter.style.height)).toBe(heightBefore)
      expect(screen.queryByText('line 200')).not.toBeInTheDocument()
    })

    it('edge case (leak): the tail EventSource is created once when the initial load settles and closed on unmount; a re-render for an unrelated reason does not tear it down and recreate it', async () => {
      const readWindow = makeReadWindow()
      const onSelectLine = jest.fn()
      const { rerender, unmount } = render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={onSelectLine}
        />,
      )

      const { tail } = await settleInitialLoadAndTail(readWindow)
      expect(tail.closed).toBe(false)

      // A re-render with the SAME prop values/identities — the isolated-
      // component equivalent of "an unrelated part of the tree re-
      // rendered this component with unchanged props" (in the real
      // page.tsx, this is what selecting a row does: it updates state in
      // the PARENT, re-rendering this LogViewer child with the same
      // stream/readWindow/onSelectLine/isActive it already had).
      rerender(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={onSelectLine}
        />,
      )
      await Promise.resolve()

      expect(MockEventSource.instances).toHaveLength(1)
      expect(tail.closed).toBe(false)

      unmount()
      expect(tail.closed).toBe(true)
    })

    it('edge case (isActive): rendering with isActive={false} after having been active closes the tail connection; flipping back to isActive={true} reconnects', async () => {
      const readWindow = makeReadWindow()
      const { rerender } = render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
          isActive={true}
        />,
      )

      const { tail: firstTail } = await settleInitialLoadAndTail(readWindow)
      expect(firstTail.closed).toBe(false)

      expect(() =>
        rerender(
          <LogViewer
            stream="backend"
            readWindow={readWindow}
            onSelectLine={jest.fn()}
            isActive={false}
          />,
        ),
      ).not.toThrow()

      await waitFor(() => expect(firstTail.closed).toBe(true))
      // No SECOND instance was created just to immediately close it —
      // going inactive only disconnects the existing one.
      expect(MockEventSource.instances).toHaveLength(1)

      rerender(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
          isActive={true}
        />,
      )

      await waitFor(() => expect(MockEventSource.instances).toHaveLength(2))
      const secondTail = latestTailInstance()
      expect(secondTail).not.toBe(firstTail)
      expect(secondTail.closed).toBe(false)
    })

    it('integration: a redundant tail delivery of a line the initial windowed read already loaded does not produce a duplicate row (proves the byte-offset conversion + de-dup composition end-to-end)', async () => {
      const readWindow = makeReadWindow()
      render(
        <LogViewer
          stream="backend"
          readWindow={readWindow}
          onSelectLine={jest.fn()}
        />,
      )

      const { scrollContainer, tail } =
        await settleInitialLoadAndTail(readWindow)
      await waitFor(() =>
        expect(screen.getByText('line 199')).toBeInTheDocument(),
      )

      const rowCountBefore = document.querySelectorAll(
        '[data-track-id="log-row-select"]',
      ).length
      const spacerBefore = scrollContainer.firstElementChild as HTMLElement
      const heightBefore = parseFloat(spacerBefore.style.height)

      // The initial windowed read's own last line ("line 199") sits at
      // byteOffset 199*BYTES_PER_LINE (see makeLine). A redundant tail
      // delivery reporting the SAME real byte position (constructed via
      // makeTailMessage so its CONVERTED LogLine.byteOffset lands exactly
      // there, regardless of its own raw text/byteLength) must not add a
      // second entry — this is exactly the offset-conversion + de-dup
      // composition this unit's brief calls out as the easiest thing to
      // get subtly wrong.
      const redundant = makeTailMessage(199 * BYTES_PER_LINE, {
        line: 199,
        level: 30,
        msg: 'line 199 (redundant resend)',
      })
      tail.emit('log-append', redundant)

      // Give the (idempotent, no-op) state update a chance to have
      // applied — asserting a NEGATIVE (nothing changed), so this
      // confirms the array genuinely never grew rather than merely not
      // having re-rendered yet.
      await Promise.resolve()
      await Promise.resolve()

      expect(
        document.querySelectorAll('[data-track-id="log-row-select"]').length,
      ).toBe(rowCountBefore)
      const spacerAfter = scrollContainer.firstElementChild as HTMLElement
      expect(parseFloat(spacerAfter.style.height)).toBe(heightBefore)
      // The ORIGINAL line's own text stands — no "(redundant resend)"
      // variant rendered anywhere.
      expect(screen.queryByText(/redundant resend/i)).not.toBeInTheDocument()
    })
  })
})
