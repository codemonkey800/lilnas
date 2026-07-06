'use client'

import { cns } from '@lilnas/utils/cns'
import { memo } from 'react'

import type { LogLine } from 'src/logging/log-view.types'

// Fixed row height (px) — every LogRow renders at exactly this height
// regardless of content (R12: uniform single-line grid, never wraps or
// grows). Exported so U5's virtualizer can pass the same value to
// `estimateSize`/`getItemKey` math; keeping one source of truth means the
// row's own CSS height and the virtualizer's row-position math can never
// drift apart.
export const ROW_PX = 24

// Pino's standard numeric level scale (no `formatters.level` string override
// configured in src/logger.ts, confirmed against real dev-log lines — levels
// arrive as bare numbers, not strings).
const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

// Extends events/page.tsx's LEVEL_COLORS (string-keyed error/warn/info) to
// the full numeric pino scale rather than reusing it directly — that map is
// owned by a different feature and keyed by label string, not level number,
// and this unit's own spec calls for `text-gray-300` on info (that page uses
// `text-gray-400`), so duplicating locally avoids fighting either owner.
//
// U14: kept EXACTLY as the text-color-only map log-row.spec.tsx asserts
// against (`toHaveClass('text-yellow-400')` etc. on the level span itself) —
// the WARN/ERROR/FATAL background-pill treatment added below in
// `levelBadgeBackground` is layered on TOP of this same span via `cns()`,
// never replacing these classes, so every existing color assertion still
// passes unchanged.
const LEVEL_COLORS: Record<number, string> = {
  10: 'text-gray-500',
  20: 'text-gray-500',
  30: 'text-gray-300',
  40: 'text-yellow-400',
  50: 'text-red-400',
  60: 'text-red-400',
}

// U14: a subtle background pill for the levels an operator actually scans
// for (warn/error/fatal) — plain colored text alone reads as "yet another
// gray-ish column" at a glance in a dense monospace grid; a filled pill on
// exactly the three severities that matter is what makes them pop without
// adding visual noise to the overwhelmingly common info/debug/trace rows
// (which stay plain text, matching sessions/[id]'s own TurnCard status pill
// idiom of reserving a filled background for states worth flagging).
const LEVEL_BADGE_BG: Record<number, string> = {
  40: 'bg-yellow-950/60',
  50: 'bg-red-950/60',
  60: 'bg-red-950/60',
}

function levelLabel(level: unknown): string {
  if (typeof level !== 'number') return '—'
  return LEVEL_LABELS[level] ?? String(level)
}

function levelColor(level: unknown): string {
  if (typeof level !== 'number') return 'text-gray-400'
  return LEVEL_COLORS[level] ?? 'text-gray-400'
}

function levelBadgeBackground(level: unknown): string | undefined {
  if (typeof level !== 'number') return undefined
  return LEVEL_BADGE_BG[level]
}

// `time` is epoch-ms (confirmed against real dev-log lines). Manual field
// extraction rather than Intl.DateTimeFormat — no locale/timezone-name
// formatting is wanted here, just zero-padded local clock digits.
function formatLocalTime(time: unknown): string {
  if (typeof time !== 'number' || !Number.isFinite(time)) return '—'
  const d = new Date(time)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

// `toISOString()` is already UTC, but a bare trailing "Z" is easy to misread
// as local time at a glance — the title spells it out explicitly.
function formatUtcTitle(time: unknown): string | undefined {
  if (typeof time !== 'number' || !Number.isFinite(time)) return undefined
  return `${new Date(time).toISOString()} UTC`
}

const CONTEXT_KEYS_EXCLUDED = new Set([
  'time',
  'level',
  'process',
  'event',
  'msg',
])

interface ContextChip {
  key: string
  value: string
}

// U11: one contiguous run of `text`, tagged with whether it falls inside a
// match against `needle`. Splitting into runs (rather than e.g. returning
// match START/END indices) is what makes the render side a trivial `.map`
// over alternating plain/highlighted spans with no off-by-one index math
// in JSX itself — the indices are all resolved here, once, in a pure
// function that's cheap to test exhaustively (see log-row.spec.tsx).
export interface HighlightSegment {
  text: string
  highlighted: boolean
}

// Splits `text` into highlighted/non-highlighted runs against `needle`,
// case-INSENSITIVE (matching U9's own search semantics — log-search
// .service.ts's matchesPredicate does `.toLowerCase().includes(...)`) while
// preserving the ORIGINAL casing of every character in the output —only the
// comparison folds case, never the rendered text itself. An empty/absent
// needle is a no-op (the whole text as one non-highlighted segment) rather
// than a special case the caller has to guard against — `text.includes('')`
// would otherwise match at every position and highlight nothing but
// zero-width slices forever, so this function explicitly short-circuits
// before ever calling the case-folded search.
export function highlightSegments(
  text: string,
  needle: string,
): HighlightSegment[] {
  if (needle.length === 0) {
    return [{ text, highlighted: false }]
  }

  const lowerText = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(lowerNeedle, cursor)
    if (matchIndex === -1) {
      segments.push({ text: text.slice(cursor), highlighted: false })
      break
    }
    if (matchIndex > cursor) {
      segments.push({
        text: text.slice(cursor, matchIndex),
        highlighted: false,
      })
    }
    const matchEnd = matchIndex + needle.length
    // Sliced from the ORIGINAL (not lower-cased) string — this is the one
    // line that makes casing preservation hold: the match's POSITION comes
    // from the case-folded search above, but its actual rendered
    // characters come straight from `text` itself, untouched.
    segments.push({ text: text.slice(matchIndex, matchEnd), highlighted: true })
    cursor = matchEnd
  }

  return segments
}

// Renders `text` as plain text when there is nothing to highlight (the
// overwhelmingly common case — every row with no active search), or as a
// sequence of <mark>-wrapped/plain spans otherwise. A real <mark> element
// (not just a styled <span>) is used for the highlighted run — it is the
// semantically-correct element for "text highlighted for reference
// purposes" and gets a highlight-yellow background for free in most
// browsers' default stylesheets, which this codebase's own dark theme
// override below builds on rather than fights.
function Highlightable({
  text,
  highlightText,
}: {
  text: string
  highlightText?: string
}) {
  if (!highlightText) {
    return <>{text}</>
  }
  const segments = highlightSegments(text, highlightText)
  // A needle that never actually occurs in THIS particular text (e.g. this
  // row's msg doesn't contain the term, only some OTHER field does) yields
  // exactly one all-plain segment — cheaply fall back to the bare string
  // rather than wrapping it in a pointless extra <>...</> per segment.
  if (segments.length === 1 && !segments[0]!.highlighted) {
    return <>{text}</>
  }
  return (
    <>
      {segments.map((segment, i) =>
        segment.highlighted ? (
          <mark
            key={i}
            data-track-id="log-row-highlight"
            className="rounded-sm bg-yellow-500/40 text-yellow-100"
          >
            {segment.text}
          </mark>
        ) : (
          // Segments have no stable identity of their own (they're derived
          // fresh from a string split on every render); index is fine since
          // this list is never reordered/filtered independently of the
          // parent row re-rendering wholesale.
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  )
}

// Renders every remaining field as a dim key=val chip. Values are
// stringified defensively — `parsed` is an arbitrary JSON.parse result, so a
// context field can itself be an object/array/etc, not just a primitive.
function contextChips(parsed: Record<string, unknown>): ContextChip[] {
  return Object.keys(parsed)
    .filter(key => !CONTEXT_KEYS_EXCLUDED.has(key))
    .map(key => {
      const value = parsed[key]
      const rendered = typeof value === 'string' ? value : JSON.stringify(value)
      return { key, value: rendered ?? 'undefined' }
    })
}

export interface LogRowProps {
  line: LogLine
  stream: string
  // Takes the full line (not just its byteOffset) so the caller can pass a
  // referentially-stable callback straight through (e.g. `onSelectLine`)
  // instead of an inline `() => onSelectLine(line)` wrapper recreated every
  // render — see this component's own React.memo wrapping below for why
  // that stability matters.
  onSelect: (line: LogLine) => void
  // U11: the CURRENT matched search text to highlight in this row, or
  // absent/empty for no active highlight (the default — every pre-U11 call
  // site never passes this prop at all). Scoped to `msg` (the dominant,
  // most-visible text in a parsed row) and the raw fallback (a malformed/
  // `parsed === null` row's only text at all) — context chips are
  // deliberately NOT highlighted: U9's own text-match predicate searches
  // the LINE'S RAW TEXT as a whole (log-search.service.ts's
  // matchesPredicate), not any individual structured field, so a hit could
  // just as easily be sitting inside a context chip's value as inside msg
  // — but msg is where an operator's eye actually goes first when scanning
  // for a match, and wiring every chip through Highlightable too is a
  // straightforward (if slightly repetitive) follow-up if it's ever asked
  // for, not a structural limitation of highlightSegments/Highlightable
  // themselves.
  highlightText?: string
}

// Wrapped in React.memo (U15/REVIEW.md #5): under live follow, every
// incoming tail line re-renders LogViewer, which recreates a LogRow
// element for every visible row (~70 at ROW_PX=24 + overscan on 1080p).
// With `onSelect` now a stable per-line-independent reference (see that
// prop's own header comment) and `highlightText` a primitive, every prop
// this component receives is referentially stable across an unrelated
// re-render, so memoizing here means an append only re-renders the ONE
// row that actually changed instead of every visible row's own
// contextChips()/Highlightable work.
export const LogRow = memo(function LogRow({
  line,
  stream,
  onSelect,
  highlightText,
}: LogRowProps) {
  const { parsed, raw } = line

  function handleSelect() {
    onSelect(line)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }

  const rowClassName = cns(
    'flex w-full cursor-pointer items-center gap-3 whitespace-nowrap px-2 font-mono text-xs text-gray-300 transition-colors hover:bg-gray-900',
  )

  // R14: parsed === null → a single raw cell, no column structure at all.
  // U14: a thin left-edge rule (rather than just dim/italic text on an
  // otherwise identical row) is what makes a malformed line read as its own
  // distinct row TYPE at a glance while scrolling, not merely "a row with
  // slightly duller text" easy to mistake for a quiet debug/trace line.
  if (parsed === null) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-track-id="log-row-select"
        onClick={handleSelect}
        onKeyDown={handleKeyDown}
        className={cns(rowClassName, 'border-l-2 border-gray-700')}
        style={{ height: ROW_PX }}
      >
        <span className="truncate italic text-gray-500">
          <Highlightable text={raw} highlightText={highlightText} />
        </span>
      </div>
    )
  }

  const time = parsed.time
  const level = parsed.level
  const badgeLabel =
    typeof parsed.process === 'string' && parsed.process.length > 0
      ? parsed.process
      : stream
  const eventSlug = typeof parsed.event === 'string' ? parsed.event : null
  const msg = typeof parsed.msg === 'string' ? parsed.msg : ''
  const chips = contextChips(parsed)

  return (
    <div
      role="button"
      tabIndex={0}
      data-track-id="log-row-select"
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className={rowClassName}
      style={{ height: ROW_PX }}
    >
      <span
        className="shrink-0 tabular-nums text-gray-500"
        title={formatUtcTitle(time)}
      >
        {formatLocalTime(time)}
      </span>

      <span
        className={cns(
          'w-12 shrink-0 rounded px-1 text-center font-semibold',
          levelColor(level),
          levelBadgeBackground(level),
        )}
      >
        {levelLabel(level)}
      </span>

      <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">
        {badgeLabel}
      </span>

      <span
        className={cns(
          'max-w-48 shrink-0 truncate',
          eventSlug ? 'text-gray-400' : 'italic text-gray-600',
        )}
      >
        {eventSlug ?? 'no-event'}
      </span>

      <span className="min-w-0 flex-1 truncate text-gray-200">
        <Highlightable text={msg} highlightText={highlightText} />
      </span>

      {chips.length > 0 && (
        <span className="flex min-w-0 shrink gap-2 overflow-hidden text-gray-600">
          {chips.map(chip => (
            <span key={chip.key} className="shrink-0 truncate">
              {chip.key}={chip.value}
            </span>
          ))}
        </span>
      )}
    </div>
  )
})
