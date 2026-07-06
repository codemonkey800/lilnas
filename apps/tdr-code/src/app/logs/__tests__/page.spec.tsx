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

jest.mock('src/app/logs/log-viewer', () => ({
  LogViewer: (props: {
    stream: string
    onSelectLine: (line: unknown) => void
  }) => {
    useEffect(() => {
      mountEvents.push(`mount:${props.stream}`)
      return () => {
        mountEvents.push(`unmount:${props.stream}`)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount/unmount-only tracking, not a per-render effect.
    }, [])
    return (
      <div data-track-id={`mock-log-viewer-${props.stream}`}>
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
  }) =>
    props.line ? (
      <div data-track-id="mock-log-detail-panel">
        <span>{props.line.parsed?.msg}</span>
        <button type="button" onClick={props.onClose}>
          close panel
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
