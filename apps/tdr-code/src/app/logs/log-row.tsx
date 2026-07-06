'use client'

import { cns } from '@lilnas/utils/cns'

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
const LEVEL_COLORS: Record<number, string> = {
  10: 'text-gray-500',
  20: 'text-gray-500',
  30: 'text-gray-300',
  40: 'text-yellow-400',
  50: 'text-red-400',
  60: 'text-red-400',
}

function levelLabel(level: unknown): string {
  if (typeof level !== 'number') return '—'
  return LEVEL_LABELS[level] ?? String(level)
}

function levelColor(level: unknown): string {
  if (typeof level !== 'number') return 'text-gray-400'
  return LEVEL_COLORS[level] ?? 'text-gray-400'
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
  onSelect: (byteOffset: number) => void
}

export function LogRow({ line, stream, onSelect }: LogRowProps) {
  const { parsed, raw, byteOffset } = line

  function handleSelect() {
    onSelect(byteOffset)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleSelect()
    }
  }

  const rowClassName = cns(
    'flex w-full cursor-pointer items-center gap-3 whitespace-nowrap px-2 font-mono text-xs text-gray-300 hover:bg-gray-900',
  )

  // R14: parsed === null → a single raw cell, no column structure at all.
  if (parsed === null) {
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
        <span className="truncate italic text-gray-500">{raw}</span>
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
      <span className="shrink-0 text-gray-500" title={formatUtcTitle(time)}>
        {formatLocalTime(time)}
      </span>

      <span className={cns('w-12 shrink-0 font-medium', levelColor(level))}>
        {levelLabel(level)}
      </span>

      <span className="shrink-0 rounded bg-gray-800 px-1.5 py-0.5 text-gray-300">
        {badgeLabel}
      </span>

      <span
        className={cns(
          'shrink-0',
          eventSlug ? 'text-gray-400' : 'italic text-gray-600',
        )}
      >
        {eventSlug ?? 'no-event'}
      </span>

      <span className="min-w-0 flex-1 truncate text-gray-200">{msg}</span>

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
}
