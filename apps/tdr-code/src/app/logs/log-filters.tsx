'use client'

import { Button, Input, Select } from '@lilnas/ui'

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

// A Select can't hold '' (that reads as "nothing chosen"), so "no constraint"
// is a sentinel the handlers map back to the unset filter. 'both' is already a
// real value for process, so only the level needs one.
const ANY_LEVEL = '__any__'

const LEVEL_ITEMS: Record<string, string> = {
  [ANY_LEVEL]: 'Any level',
  ...Object.fromEntries(LEVEL_OPTIONS.map(o => [String(o.value), o.label])),
}

const PROCESS_ITEMS: Record<string, string> = {
  both: 'Any process',
  main: 'main',
  bot: 'bot',
}

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

  function handleLevelChange(value: string | null) {
    onFiltersChange({
      level: value === null || value === ANY_LEVEL ? undefined : Number(value),
    })
  }

  function handleProcessChange(value: string | null) {
    onFiltersChange({
      process: value === 'main' || value === 'bot' ? value : 'both',
    })
  }

  function handleEventChange(value: string) {
    const trimmed = value.trim()
    onFiltersChange({ event: trimmed.length === 0 ? undefined : trimmed })
  }

  return (
    <div
      data-track-id="log-filters"
      // One strip row of the toolbar: log-viewer.tsx wraps this and
      // LogSearchBar in a single bordered surface. On a phone the row scrolls
      // sideways instead of wrapping, and every control grows to 44px.
      className="flex items-center gap-2 overflow-x-auto px-3 py-2 md:flex-wrap md:overflow-visible"
    >
      <span className="shrink-0 text-label text-ink-3 uppercase">Filters</span>

      <Select.Root
        items={LEVEL_ITEMS}
        onValueChange={handleLevelChange}
        value={filters.level === undefined ? ANY_LEVEL : String(filters.level)}
      >
        <Select.Trigger
          aria-label="Level"
          className="w-32 shrink-0 max-md:h-11"
          data-track-id="log-filters-level"
        >
          <Select.Value />
        </Select.Trigger>
        <Select.Popup>
          <Select.Item value={ANY_LEVEL}>Any level</Select.Item>
          {LEVEL_OPTIONS.map(opt => (
            <Select.Item key={opt.value} value={String(opt.value)}>
              {opt.label}
            </Select.Item>
          ))}
        </Select.Popup>
      </Select.Root>

      {/*
        Source/process is only meaningful for `backend` — main/bot both live
        under that ONE stream (the structured-logging convention's own
        `process` field), so frontend-server/frontend-browser have no
        process dimension to filter on at all, per this unit's own brief
        ("for backend: main/bot/both; other tabs: none").
      */}
      {stream === 'backend' && (
        <Select.Root
          items={PROCESS_ITEMS}
          onValueChange={handleProcessChange}
          value={processValue}
        >
          <Select.Trigger
            aria-label="Process"
            className="w-36 shrink-0 max-md:h-11"
            data-track-id="log-filters-process"
          >
            <Select.Value />
          </Select.Trigger>
          <Select.Popup>
            <Select.Item value="both">Any process</Select.Item>
            <Select.Item value="main">main</Select.Item>
            <Select.Item value="bot">bot</Select.Item>
          </Select.Popup>
        </Select.Root>
      )}

      <Input
        aria-label="Event slug"
        className="max-md:h-11"
        data-track-id="log-filters-event"
        // Free-text, exact-match semantics (U9's own matchesPredicate does
        // a literal `===` against parsed.event, never a substring) — a
        // dropdown is deliberately NOT used here: this app has no endpoint
        // enumerating which event slugs actually occur in a given file.
        mono
        onChange={e => handleEventChange(e.target.value)}
        placeholder="Event slug…"
        value={filters.event ?? ''}
        wrapperClassName="w-44 shrink-0"
      />

      {hasActiveFilter && (
        <Button
          className="ml-auto shrink-0 pointer-coarse:min-h-11"
          data-track-id="log-filters-clear"
          onClick={onClearFilters}
          size="sm"
          variant="ghost"
        >
          Clear filters
        </Button>
      )}
    </div>
  )
}
