'use client'

import { cns } from '@lilnas/utils/cns'

import type { LogStream } from 'src/logging/log-view.types'

// The fixed numeric-level options this control exposes, in ascending
// severity order — deliberately the SAME six values (10/20/30/40/50/60) and
// the SAME TRACE/DEBUG/INFO/WARN/ERROR/FATAL naming log-row.tsx's own
// LEVEL_LABELS already establishes for the row display, so an operator sees
// one consistent level vocabulary across the row grid and this filter
// control rather than two independently-invented namings for the identical
// pino scale. Kept as a small local tuple (not imported from log-row.tsx)
// since that file's LEVEL_LABELS is a value->label lookup map, not an
// ordered list of selectable options — this needs its own "+"-suffixed
// option labels ("Trace+", not "Trace") to make the >= threshold semantics
// explicit in the UI, which isn't something log-row.tsx's map has any
// reason to carry.
const LEVEL_OPTIONS: { value: number; label: string }[] = [
  { value: 10, label: 'Trace+' },
  { value: 20, label: 'Debug+' },
  { value: 30, label: 'Info+' },
  { value: 40, label: 'Warn+' },
  { value: 50, label: 'Error+' },
  { value: 60, label: 'Fatal' },
]

// The plane-neutral LogScanPredicate (log-view.types.ts) also carries
// `text`, which this component intentionally has NO control for — free-text
// search stays LogSearchBar's (U11) own responsibility; this component only
// ever reads/writes the THREE structured fields, per this unit's own brief.
export interface LogFiltersValue {
  level?: number
  process?: 'main' | 'bot' | 'both'
  event?: string
}

export interface LogFiltersProps {
  stream: LogStream
  filters: LogFiltersValue
  onFiltersChange: (patch: Partial<LogFiltersValue>) => void
  onClearFilters: () => void
}

// Structured filter controls (level / source-process / event slug) that
// compose with LogSearchBar's own free-text query into ONE predicate (AE6) —
// this component itself is a simple controlled pass-through: it owns no
// state of its own, reading `filters` and calling `onFiltersChange`/
// `onClearFilters` for every interaction, exactly mirroring
// events/page.tsx's own <select>/<input>/"Clear filters" idiom (the
// PRECEDENT this component was told to follow) rather than introducing a
// second, differently-shaped filter-bar pattern into this codebase.
export function LogFilters({
  stream,
  filters,
  onFiltersChange,
  onClearFilters,
}: LogFiltersProps) {
  // 'both' and "the field being entirely absent" are equivalent per
  // LogScanPredicate's own documented semantics (log-view.types.ts,
  // matchesPredicate in log-search.service.ts) — this control emits
  // 'both' rather than `undefined` for its own "no constraint" option so
  // the <select>'s value is always a real, always-selected option string
  // (never the empty-string sentinel a bare unset <select> would otherwise
  // need), while log-viewer.tsx's own isFilteredProjection check already
  // treats 'both' as "not an active filter" for the SAME reason U9's
  // predicate does.
  const processValue = filters.process ?? 'both'
  const hasActiveFilter =
    filters.level !== undefined ||
    (filters.process !== undefined && filters.process !== 'both') ||
    filters.event !== undefined

  function handleLevelChange(value: string) {
    onFiltersChange({ level: value === '' ? undefined : Number(value) })
  }

  function handleProcessChange(value: string) {
    onFiltersChange({
      process: value === 'both' ? 'both' : (value as 'main' | 'bot'),
    })
  }

  function handleEventChange(value: string) {
    const trimmed = value.trim()
    onFiltersChange({ event: trimmed.length === 0 ? undefined : trimmed })
  }

  return (
    <div
      data-track-id="log-filters"
      className="flex flex-wrap items-center gap-2 rounded border border-gray-800 bg-gray-900/50 px-3 py-1.5 text-xs"
    >
      <select
        data-track-id="log-filters-level"
        value={filters.level ?? ''}
        onChange={e => handleLevelChange(e.target.value)}
        className="rounded bg-gray-800 px-2 py-1 text-gray-200 focus:outline-none"
      >
        <option value="">Any level</option>
        {LEVEL_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/*
        Source/process is only meaningful for `backend` — main/bot both live
        under that ONE stream (the structured-logging convention's own
        `process` field), so frontend-server/frontend-browser have no
        process dimension to filter on at all, per this unit's own brief
        ("for backend: main/bot/both; other tabs: none").
      */}
      {stream === 'backend' && (
        <select
          data-track-id="log-filters-process"
          value={processValue}
          onChange={e => handleProcessChange(e.target.value)}
          className="rounded bg-gray-800 px-2 py-1 text-gray-200 focus:outline-none"
        >
          <option value="both">Any process</option>
          <option value="main">main</option>
          <option value="bot">bot</option>
        </select>
      )}

      <input
        type="text"
        data-track-id="log-filters-event"
        value={filters.event ?? ''}
        onChange={e => handleEventChange(e.target.value)}
        placeholder="Event slug…"
        // Free-text, exact-match semantics (U9's own matchesPredicate does
        // a literal `===` against parsed.event, never a substring) — a
        // dropdown is deliberately NOT used here: this app has no endpoint
        // enumerating which event slugs actually occur in a given file, and
        // LOG_EVENTS' full catalog (log-events.ts) is a huge, mostly-
        // irrelevant-per-file list that would make a poor picker for "which
        // of these actually appear in THIS file."
        className="w-40 rounded bg-gray-800 px-2 py-1 text-gray-200 placeholder-gray-600 focus:outline-none"
      />

      {hasActiveFilter && (
        <button
          type="button"
          data-track-id="log-filters-clear"
          onClick={onClearFilters}
          className={cns('text-gray-500 transition-colors hover:text-gray-300')}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
