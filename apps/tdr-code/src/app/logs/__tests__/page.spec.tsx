import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'

import { api } from 'src/app/lib/api'
import LogsPage from 'src/app/logs/page'
import type { LogSource } from 'src/logging/log-view.types'

// LogViewer/LogDetailPanel are mocked at the module level (not spied) so
// this file can assert the mount-all-hide-inactive CONTRACT itself (decision
// #1 of this unit's brief) — whether a real LogViewer instance ever
// unmounts across a tab switch — without depending on its real internal
// fetch/virtualizer machinery, which log-viewer.spec.tsx already covers
// exhaustively on its own. A `useEffect` mount/unmount tracker is a
// stronger signal than a call-count assertion: React re-renders an
// already-mounted component on every parent re-render without unmounting
// it, so "was the component function invoked N times" cannot distinguish
// "still mounted, rendered twice" from "unmounted and remounted twice" —
// only an explicit mount/unmount effect can.
const mountEvents: string[] = []

// U10 (isActive wiring): the CURRENT isActive prop each mocked LogViewer
// instance was rendered with, keyed by stream — updated on every render
// (not just mount/unmount, unlike mountEvents above), since this is
// specifically proving page.tsx threads its own `isActive` local variable
// through to the real prop rather than merely computing it and never using
// it (a real gap this test file caught once already: LogViewer's isActive
// prop defaults to true, so an omitted prop passes silently with no type
// error and no visible behavior difference in a shallow render).
const isActiveByStream: Record<string, boolean | undefined> = {}

// U12: the CURRENT `filters` prop each mocked LogViewer instance was
// rendered with, keyed by stream — the SAME "prove page.tsx actually
// threads the value through, not just computes it" rationale
// isActiveByStream's own header comment documents, applied to filters
// instead of isActive. ALSO rendered into the DOM (via the span below) so a
// test can assert through this file's existing querySelector idiom too —
// either read path observes the same value at the same moment.
const filtersByStreamSeen: Record<string, unknown> = {}

jest.mock('src/app/logs/log-viewer', () => ({
  LogViewer: (props: {
    stream: string
    onSelectLine: (line: unknown) => void
    isActive?: boolean
    filters?: unknown
    onFiltersChange?: (patch: unknown) => void
    onClearFilters?: () => void
  }) => {
    isActiveByStream[props.stream] = props.isActive
    filtersByStreamSeen[props.stream] = props.filters
    useEffect(() => {
      mountEvents.push(`mount:${props.stream}`)
      return () => {
        mountEvents.push(`unmount:${props.stream}`)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount/unmount-only tracking, not a per-render effect.
    }, [])
    return (
      <div data-track-id={`mock-log-viewer-${props.stream}`}>
        <span data-track-id={`mock-log-viewer-filters-${props.stream}`}>
          {JSON.stringify(props.filters ?? {})}
        </span>
        <button
          type="button"
          onClick={() =>
            props.onSelectLine({
              byteOffset: 0,
              byteLength: 0,
              raw: '{}',
              parsed: { msg: `line from ${props.stream}` },
            })
          }
        >
          select a line in {props.stream}
        </button>
      </div>
    )
  },
}))

jest.mock('src/app/logs/log-detail-panel', () => ({
  LogDetailPanel: (props: {
    line: { parsed: { msg?: string } | null } | null
    onClose: () => void
    onFilterByLevel?: (level: number) => void
    onFilterByProcess?: (process: string) => void
    onFilterByEvent?: (eventSlug: string) => void
  }) =>
    props.line ? (
      <div data-track-id="mock-log-detail-panel">
        <span>{props.line.parsed?.msg}</span>
        <button type="button" onClick={props.onClose}>
          close panel
        </button>
        {/*
          U12: mock triggers for the detail panel's own "filter by this
          field/value" actions — this file (unlike log-detail-panel.spec.tsx,
          which exhaustively covers the real component's own rendering/
          field-guard logic) only needs a seam to prove page.tsx wires these
          callbacks to the correct stream's patchFilters call, exactly the
          same "mock exposes ONE trigger per callback under test" idiom the
          pre-existing onSelectLine button above already establishes.
        */}
        <button type="button" onClick={() => props.onFilterByLevel?.(40)}>
          filter by level 40
        </button>
        <button type="button" onClick={() => props.onFilterByProcess?.('bot')}>
          filter by process bot
        </button>
        <button
          type="button"
          onClick={() => props.onFilterByEvent?.('writer-fault')}
        >
          filter by event writer-fault
        </button>
      </div>
    ) : null,
}))

function makeSources(
  overrides: Partial<Record<LogSource['stream'], Partial<LogSource>>> = {},
): LogSource[] {
  const base: Record<LogSource['stream'], LogSource> = {
    backend: { stream: 'backend', exists: true, size: 4096 },
    'frontend-server': {
      stream: 'frontend-server',
      exists: true,
      size: 2048,
    },
    'frontend-browser': {
      stream: 'frontend-browser',
      exists: true,
      size: 1024,
    },
  }
  return (['backend', 'frontend-server', 'frontend-browser'] as const).map(
    stream => ({ ...base[stream], ...overrides[stream] }),
  )
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <LogsPage />
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  mountEvents.length = 0
  for (const key of Object.keys(isActiveByStream)) {
    delete isActiveByStream[key]
  }
  for (const key of Object.keys(filtersByStreamSeen)) {
    delete filtersByStreamSeen[key]
  }
  jest.spyOn(api, 'getLogSources').mockReset()
})

describe('LogsPage — happy path', () => {
  it('renders three tabs in the fixed LogStream order, with backend active by default and its LogViewer mounted', async () => {
    jest.spyOn(api, 'getLogSources').mockResolvedValue(makeSources())
    renderPage()

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual([
      'backend',
      'frontend-server',
      'frontend-browser',
    ])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false')

    const backendViewer = document.querySelector(
      '[data-track-id="mock-log-viewer-backend"]',
    )
    expect(backendViewer).toBeInTheDocument()
    expect(
      document.querySelector('[data-track-id="logs-panel-backend"]'),
    ).toHaveClass('block')
  })
})

describe('LogsPage — per-tab state preservation (R2)', () => {
  it('mounts a LogViewer for every stream that has content exactly once, and never unmounts it across a tab switch and back — only its visibility class toggles', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'getLogSources').mockResolvedValue(makeSources())
    renderPage()

    await screen.findAllByRole('tab')

    // All three (all have content) are already mounted, hidden or not, the
    // instant sources resolves — mount-all-hide-inactive means the inactive
    // ones never wait for a click to exist in the DOM at all.
    const backendPanel = document.querySelector(
      '[data-track-id="logs-panel-backend"]',
    )
    const browserPanel = document.querySelector(
      '[data-track-id="logs-panel-frontend-browser"]',
    )
    expect(backendPanel).toBeInTheDocument()
    expect(browserPanel).toBeInTheDocument()
    expect(backendPanel).toHaveClass('block')
    expect(browserPanel).toHaveClass('hidden')

    expect(mountEvents).toEqual([
      'mount:backend',
      'mount:frontend-server',
      'mount:frontend-browser',
    ])

    await user.click(screen.getByRole('tab', { name: 'frontend-browser' }))

    expect(backendPanel).toHaveClass('hidden')
    expect(browserPanel).toHaveClass('block')

    await user.click(screen.getByRole('tab', { name: 'backend' }))

    expect(backendPanel).toHaveClass('block')
    expect(browserPanel).toHaveClass('hidden')

    // The load-bearing assertion: no unmount event was ever recorded for
    // any stream, across two full tab switches. If the page had instead
    // rendered ONE shared <LogViewer stream={activeTab} .../> and swapped
    // its stream prop, React would tear down and recreate the component on
    // every switch (a changed `stream` prop is not itself a remount trigger
    // unless keyed on it, but this assertion is intentionally about the
    // CONTRACT this unit chose — permanently-mounted per-stream instances —
    // not merely "React happened not to remount here").
    expect(mountEvents.filter(e => e.startsWith('unmount:'))).toEqual([])
    // Still exactly one mount per stream — the DOM nodes are the SAME
    // instances observed at the top of this test, not new ones.
    expect(mountEvents).toEqual([
      'mount:backend',
      'mount:frontend-server',
      'mount:frontend-browser',
    ])
  })

  it('threads its own isActive computation through to each mounted LogViewer, flipping on every tab switch (U10: idle tabs must hold no live tail connection)', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'getLogSources').mockResolvedValue(makeSources())
    renderPage()

    await screen.findAllByRole('tab')

    // Every stream with content is mounted up front (mount-all-hide-
    // inactive), but only the DEFAULT active tab (backend) should ever see
    // isActive:true — LogViewer's own default (isActive prop omitted ->
    // true) would silently mask a page.tsx regression that computes
    // `isActive` locally but forgets to pass it down, which is exactly the
    // gap this test exists to pin.
    expect(isActiveByStream.backend).toBe(true)
    expect(isActiveByStream['frontend-server']).toBe(false)
    expect(isActiveByStream['frontend-browser']).toBe(false)

    await user.click(screen.getByRole('tab', { name: 'frontend-browser' }))

    expect(isActiveByStream.backend).toBe(false)
    expect(isActiveByStream['frontend-server']).toBe(false)
    expect(isActiveByStream['frontend-browser']).toBe(true)

    await user.click(screen.getByRole('tab', { name: 'backend' }))

    expect(isActiveByStream.backend).toBe(true)
    expect(isActiveByStream['frontend-browser']).toBe(false)
  })

  it('closes the detail panel when switching tabs, per decision #3 (panel belongs to whatever is on screen)', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'getLogSources').mockResolvedValue(makeSources())
    renderPage()

    await screen.findAllByRole('tab')

    await user.click(
      screen.getByRole('button', { name: 'select a line in backend' }),
    )
    expect(screen.getByText('line from backend')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'frontend-browser' }))

    expect(screen.queryByText('line from backend')).not.toBeInTheDocument()
    expect(
      document.querySelector('[data-track-id="mock-log-detail-panel"]'),
    ).not.toBeInTheDocument()
  })
})

// U12: filter state was lifted from LogViewer into THIS page precisely
// because LogDetailPanel (a sibling of every LogViewer instance, rendered
// once and shared across tabs — Decision #3, Phase 1) needs to WRITE to it
// via its own "filter by this field" actions, while each LogViewer instance
// needs to READ its own stream's slice — see page.tsx's own header comment
// on filtersByStream for the full architectural rationale. This is the
// right layer to prove the round-trip end-to-end (detail-panel click ->
// page.tsx's patchFilters -> the correct stream's LogViewer instance),
// since log-viewer.tsx's own tests (a fresh, standalone-rendered instance)
// have no sibling detail panel to receive a click from at all, and this is
// ALSO the right layer to prove R2 (per-tab filter survival across a tab
// switch) now that the state genuinely lives here rather than inside any
// one LogViewer instance.
describe('LogsPage — filter state round-trip (U12, R2)', () => {
  it('a detail-panel filter action patches the ACTIVE tab’s filters and reaches that exact stream’s LogViewer instance, leaving every other stream’s filters untouched', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'getLogSources').mockResolvedValue(makeSources())
    renderPage()

    await screen.findAllByRole('tab')

    // Every stream starts with an empty filter slice.
    expect(filtersByStreamSeen.backend).toEqual({})
    expect(filtersByStreamSeen['frontend-browser']).toEqual({})

    // Select a line in backend (the default active tab) so the (mocked)
    // detail panel mounts with a real `line`, then fire its own "filter by
    // level" action.
    await user.click(
      screen.getByRole('button', { name: 'select a line in backend' }),
    )
    await user.click(screen.getByRole('button', { name: 'filter by level 40' }))

    expect(filtersByStreamSeen.backend).toEqual({ level: 40 })
    // A DIFFERENT stream's slice is completely untouched — filters are
    // per-tab, not one shared object (per-stream keying is what makes this
    // true, not anything LogViewer/LogDetailPanel themselves do).
    expect(filtersByStreamSeen['frontend-browser']).toEqual({})
    expect(filtersByStreamSeen['frontend-server']).toEqual({})

    // Composing filters (process, then event) on the SAME active tab
    // merges into the existing patch rather than replacing it wholesale —
    // proving patchFilters' own `{ ...prev[stream], ...patch }` merge
    // semantics hold through this page's real wiring, not just in
    // isolation.
    await user.click(
      screen.getByRole('button', { name: 'filter by process bot' }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'filter by event writer-fault',
      }),
    )
    expect(filtersByStreamSeen.backend).toEqual({
      level: 40,
      process: 'bot',
      event: 'writer-fault',
    })
  })

  it('filter state set on one tab survives switching away and back (R2) — proven here since the state now lives in page.tsx, not inside any one LogViewer instance', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'getLogSources').mockResolvedValue(makeSources())
    renderPage()

    await screen.findAllByRole('tab')

    await user.click(
      screen.getByRole('button', { name: 'select a line in backend' }),
    )
    await user.click(screen.getByRole('button', { name: 'filter by level 40' }))
    expect(filtersByStreamSeen.backend).toEqual({ level: 40 })

    // Switch away — decision #3 closes the detail panel, but backend's OWN
    // LogViewer instance stays mounted (mount-all-hide-inactive, R2's
    // pre-existing precedent) with its filters slice untouched by the
    // switch itself.
    await user.click(screen.getByRole('tab', { name: 'frontend-browser' }))
    expect(filtersByStreamSeen.backend).toEqual({ level: 40 })
    expect(filtersByStreamSeen['frontend-browser']).toEqual({})

    // Switch back — backend's filters are EXACTLY as left, never reset by
    // the round trip.
    await user.click(screen.getByRole('tab', { name: 'backend' }))
    expect(filtersByStreamSeen.backend).toEqual({ level: 40 })

    // Also verifiable through the DOM read path (the span each mocked
    // LogViewer renders), not just the module-level tracking object —
    // confirms the ACTUAL rendered prop, not merely a value this test
    // double happened to record on the side.
    const backendFiltersSpan = document.querySelector(
      '[data-track-id="mock-log-viewer-filters-backend"]',
    )
    expect(backendFiltersSpan).toHaveTextContent(JSON.stringify({ level: 40 }))
  })
})

describe('LogsPage — empty source (R2)', () => {
  it('shows the empty state (not an error) for an absent stream, and the tab remains selectable/clickable', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'getLogSources').mockResolvedValue(
      makeSources({
        'frontend-server': { exists: false, size: 0 },
      }),
    )
    renderPage()

    await screen.findAllByRole('tab')

    await user.click(screen.getByRole('tab', { name: 'frontend-server' }))

    expect(
      screen.getByText(/empty or has not been created/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      document.querySelector(
        '[data-track-id="mock-log-viewer-frontend-server"]',
      ),
    ).not.toBeInTheDocument()

    // Still selectable — switching away and back doesn't throw or strand
    // the tab bar.
    await user.click(screen.getByRole('tab', { name: 'backend' }))
    await user.click(screen.getByRole('tab', { name: 'frontend-server' }))
    expect(
      screen.getByRole('tab', { name: 'frontend-server' }),
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('a size:0-but-existing file is also treated as empty, not mounted', async () => {
    jest.spyOn(api, 'getLogSources').mockResolvedValue(
      makeSources({
        'frontend-server': { exists: true, size: 0 },
      }),
    )
    renderPage()

    const user = userEvent.setup()
    await screen.findAllByRole('tab')
    await user.click(screen.getByRole('tab', { name: 'frontend-server' }))

    expect(
      screen.getByText(/empty or has not been created/i),
    ).toBeInTheDocument()
  })
})

describe('LogsPage — error path', () => {
  it('renders ErrorState for a failed sources query and does not render any tabs or LogViewers underneath', async () => {
    jest.spyOn(api, 'getLogSources').mockRejectedValue(new Error('boom'))
    renderPage()

    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(
      document.querySelector('[data-track-id^="mock-log-viewer-"]'),
    ).not.toBeInTheDocument()
    expect(mountEvents).toEqual([])
  })
})
