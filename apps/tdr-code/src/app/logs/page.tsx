'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { api, queryKeys } from 'src/app/lib/api'
import { LogDetailPanel } from 'src/app/logs/log-detail-panel'
import { LogViewer } from 'src/app/logs/log-viewer'
import type { LogLine, LogStream } from 'src/logging/log-view.types'

// Matches log-detail-panel.tsx's own internal (unexported) PANEL_WIDTH
// constant. Duplicated rather than imported: that constant is deliberately
// not exported (nothing outside that file needs it, per its own header
// comment), and adding an export solely so this page could reuse one
// Tailwind width class is more coupling than the value justifies. If U7's
// PANEL_WIDTH ever changes, this needs a matching update — a minor
// visual-overlap risk accepted for Phase 1 rather than exporting a constant
// across a file this unit was told not to touch.
const PANEL_SPACE = 'pr-[28rem]'

// Fixed tab order — mirrors the LogStream union itself (log-paths.ts) so
// this is the one and only place the tab order is declared; log-sources
// .service.ts already returns entries in this same fixed order (U3), so no
// client-side sorting is needed.
const TABS: { stream: LogStream; label: string }[] = [
  { stream: 'backend', label: 'backend' },
  { stream: 'frontend-server', label: 'frontend-server' },
  { stream: 'frontend-browser', label: 'frontend-browser' },
]

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<LogStream>('backend')
  const [selectedLine, setSelectedLine] = useState<LogLine | null>(null)

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
    <div
      className={cns(
        'mx-auto max-w-7xl space-y-4',
        selectedLine && PANEL_SPACE,
      )}
    >
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
            />
          </div>
        )
      })}

      <LogDetailPanel
        line={selectedLine}
        stream={activeTab}
        onClose={() => setSelectedLine(null)}
      />
    </div>
  )
}
