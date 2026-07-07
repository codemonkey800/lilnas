'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { api, queryKeys } from 'src/app/lib/api'
import { LogDetailPanel } from 'src/app/logs/log-detail-panel'
import type { LogFiltersValue } from 'src/app/logs/log-filters'
import { LogViewer } from 'src/app/logs/log-viewer'
import type { LogLine, LogStream } from 'src/logging/log-view.types'

// Fixed tab order — mirrors the LogStream union itself (log-paths.ts) so
// this is the one and only place the tab order is declared; log-sources
// .service.ts already returns entries in this same fixed order (U3), so no
// client-side sorting is needed.
const TABS: { stream: LogStream; label: string }[] = [
  { stream: 'backend', label: 'backend' },
  { stream: 'frontend-server', label: 'frontend-server' },
  { stream: 'frontend-browser', label: 'frontend-browser' },
]

// U12: structured filter state (level/source-process/event) needs to be
// readable/writable from TWO components that are SIBLINGS under this page,
// not parent/child — LogViewer reads it to build its filtered-projection
// query, and LogDetailPanel WRITES to it via its own "filter by this field"
// actions, but LogDetailPanel is rendered ONCE at this page's own level
// (Decision #3, Phase 1), shared across every tab, not owned by any single
// LogViewer instance. The standard React resolution is lifting this
// specific state to the nearest shared ancestor — this page — rather than
// letting each LogViewer hold its own copy (which LogDetailPanel would then
// have no way to reach) or letting LogDetailPanel hold it (which no
// LogViewer instance would ever see).
//
// Keyed per-stream (not one shared filter object) for the IDENTICAL reason
// each LogViewer instance's own internal windowed-view state already
// survives a tab switch (R2, Phase 1 decision #1): this page's own state
// object never resets on a tab click, and each stream's own slice is
// independent of every other stream's — switching tabs away and back
// preserves whatever filters were set on the tab being returned to, with
// no special-casing needed beyond the state simply never being cleared.
const EMPTY_STREAM_FILTERS: Record<LogStream, LogFiltersValue> = {
  backend: {},
  'frontend-server': {},
  'frontend-browser': {},
}

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<LogStream>('backend')
  const [selectedLine, setSelectedLine] = useState<LogLine | null>(null)
  const [filtersByStream, setFiltersByStream] =
    useState<Record<LogStream, LogFiltersValue>>(EMPTY_STREAM_FILTERS)

  // Merges `patch` into ONE stream's own slice, leaving every other
  // stream's filters completely untouched — the functional setState form
  // (not a direct object mutation) is what keeps this safe to call from
  // multiple independent callers (every LogViewer's own onFiltersChange,
  // AND LogDetailPanel's filter-action callbacks below) without either one
  // risking a lost update against the other's most recent change.
  function patchFilters(stream: LogStream, patch: Partial<LogFiltersValue>) {
    setFiltersByStream(prev => ({
      ...prev,
      [stream]: { ...prev[stream], ...patch },
    }))
  }

  function clearFilters(stream: LogStream) {
    setFiltersByStream(prev => ({ ...prev, [stream]: {} }))
  }

  const {
    data: sources,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.logSources,
    queryFn: api.getLogSources,
    retry: false,
  })

  function handleTabChange(stream: LogStream) {
    setActiveTab(stream)
    // Decision #3: the panel visually belongs to whatever's on screen, so a
    // tab switch always closes it rather than trying to show a selection
    // from a now-hidden stream.
    setSelectedLine(null)
  }

  if (isLoading && !sources) return <LoadingState />
  if (isError && !sources)
    return <ErrorState message={(error as Error)?.message} />
  if (!sources) return null

  const sourceByStream = new Map(sources.map(s => [s.stream, s]))

  return (
    // The detail panel now OVERLAYS the row grid (fixed, with a backdrop that
    // closes it on outside click — see LogDetailPanel), so this container no
    // longer reserves a right-hand column: it stays full-width whether or not
    // a line is selected, and nothing shifts when the drawer opens/closes.
    <div className="mx-auto max-w-7xl space-y-4">
      <h1 className="text-lg font-semibold text-white">Logs</h1>

      <div
        role="tablist"
        aria-label="Log source"
        className="flex items-center gap-1 border-b border-gray-800"
      >
        {TABS.map(({ stream, label }) => (
          <button
            key={stream}
            type="button"
            role="tab"
            aria-selected={activeTab === stream}
            data-track-id={`logs-tab-${stream}`}
            onClick={() => handleTabChange(stream)}
            className={cns(
              'rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === stream
                ? 'bg-gray-800 text-white'
                : 'text-gray-500 hover:bg-gray-900 hover:text-gray-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        Decision #1 (mount-all-hide-inactive): every stream that HAS content
        gets its own permanently-mounted LogViewer instance, toggled via a
        CSS display class rather than conditional rendering — LogViewer
        resets all internal state (window, scroll, eviction) whenever its
        `stream` prop's identity changes, so swapping ONE shared instance's
        `stream` on tab click would blow away scroll position on every
        switch (violates R2). A stream with no content yet (decision #2)
        renders EmptyState only while active — there is nothing to mount,
        and no LogViewer means no wasted fetch.
      */}
      {TABS.map(({ stream }) => {
        const source = sourceByStream.get(stream)
        const hasContent = source && source.exists && source.size > 0
        const isActive = activeTab === stream

        if (!hasContent) {
          return isActive ? (
            <EmptyState
              key={stream}
              message="This log file is empty or has not been created."
            />
          ) : null
        }

        return (
          <div
            key={stream}
            className={cns(isActive ? 'block' : 'hidden')}
            data-track-id={`logs-panel-${stream}`}
          >
            <LogViewer
              stream={stream}
              readWindow={api.readLogWindow}
              onSelectLine={setSelectedLine}
              isActive={isActive}
              // U12: each instance gets its OWN slice of filtersByStream —
              // this (not anything LogViewer itself does) is what makes
              // filter state genuinely per-tab/preserved-across-switches
              // (R2), the identical reasoning that already makes each
              // instance's own internal windowed-view state survive a tab
              // switch (this page's own state object never resets, and
              // every stream's slice is independent of every other's).
              filters={filtersByStream[stream]}
              onFiltersChange={patch => patchFilters(stream, patch)}
              onClearFilters={() => clearFilters(stream)}
            />
          </div>
        )
      })}

      <LogDetailPanel
        line={selectedLine}
        stream={activeTab}
        onClose={() => setSelectedLine(null)}
        // U12 (R13, filter-actions half): LogDetailPanel only ever shows a
        // line from `activeTab` (Decision #3: the panel closes on tab
        // switch — see handleTabChange above), so there is no ambiguity
        // about which tab's filters a click here should touch; wiring
        // straight to `patchFilters(activeTab, ...)` is unconditionally
        // correct.
        onFilterByLevel={level => patchFilters(activeTab, { level })}
        onFilterByProcess={process => {
          // LogDetailPanelProps types this callback's own param as a bare
          // `string` (it's read off an arbitrary log line's `parsed.process`
          // field, which the structured-logging convention documents as
          // ALWAYS 'main' or 'bot' on a real backend line — but that
          // convention is not itself enforced at this type boundary, so a
          // narrowing check here, rather than a blind cast, is what keeps
          // an unexpected value from ever reaching LogScanPredicate's own
          // stricter 'main' | 'bot' | 'both' union as a silently-wrong
          // filter value).
          if (process === 'main' || process === 'bot') {
            patchFilters(activeTab, { process })
          }
        }}
        onFilterByEvent={event => patchFilters(activeTab, { event })}
      />
    </div>
  )
}
