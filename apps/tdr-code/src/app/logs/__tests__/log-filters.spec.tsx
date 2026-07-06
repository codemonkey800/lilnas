import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { LogFilters, type LogFiltersValue } from 'src/app/logs/log-filters'

// LogFilters is a controlled component (per its own header comment) — it
// renders whatever `filters` its caller currently passes and never holds
// its own copy. A test harness that passes a STATIC `filters` object (never
// updated in response to onFiltersChange) would leave the event <input>'s
// displayed value permanently pinned to whatever it started as, which is
// wrong for any test that simulates typing multiple characters: each
// keystroke's onChange handler reads e.target.value off an input that React
// keeps resetting back to the stale prop value every render, so only the
// SINGLE most-recently-typed character would ever be observed rather than
// the accumulated string a real (also-controlled, e.g. log-viewer.tsx's
// own) caller would produce by actually updating `filters` in response.
// This small stateful wrapper closes that gap — it mirrors the real
// round-trip (apply the patch into local state, re-render with the new
// value) while STILL exposing the underlying onFiltersChange/onClearFilters
// spies for every assertion below.
function renderFilters(
  overrides: Partial<{
    stream: 'backend' | 'frontend-server' | 'frontend-browser'
    filters: LogFiltersValue
    onFiltersChange: (patch: Partial<LogFiltersValue>) => void
    onClearFilters: () => void
  }> = {},
) {
  const onFiltersChangeSpy = overrides.onFiltersChange ?? jest.fn()
  const onClearFiltersSpy = overrides.onClearFilters ?? jest.fn()

  function Harness() {
    const [filters, setFilters] = useState<LogFiltersValue>(
      overrides.filters ?? {},
    )
    return (
      <LogFilters
        stream={overrides.stream ?? 'backend'}
        filters={filters}
        onFiltersChange={patch => {
          onFiltersChangeSpy(patch)
          setFilters(prev => ({ ...prev, ...patch }))
        }}
        onClearFilters={() => {
          onClearFiltersSpy()
          setFilters({})
        }}
      />
    )
  }

  const utils = render(<Harness />)
  return {
    ...utils,
    onFiltersChange: onFiltersChangeSpy,
    onClearFilters: onClearFiltersSpy,
  }
}

describe('LogFilters', () => {
  function levelSelect() {
    const el = document.querySelector('[data-track-id="log-filters-level"]')
    if (!(el instanceof HTMLSelectElement)) {
      throw new Error('level select not found')
    }
    return el
  }

  function processSelect() {
    return document.querySelector('[data-track-id="log-filters-process"]')
  }

  function eventInput() {
    const el = document.querySelector('[data-track-id="log-filters-event"]')
    if (!(el instanceof HTMLInputElement)) {
      throw new Error('event input not found')
    }
    return el
  }

  describe('level selection', () => {
    it('selecting "Warn+" calls onFiltersChange with { level: 40 }', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters()

      await user.selectOptions(levelSelect(), '40')

      expect(onFiltersChange).toHaveBeenCalledWith({ level: 40 })
    })

    it('selecting "Any level" (back to unset) calls onFiltersChange with { level: undefined }', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters({ filters: { level: 40 } })

      await user.selectOptions(levelSelect(), '')

      expect(onFiltersChange).toHaveBeenCalledWith({ level: undefined })
    })

    it('renders every level option using the SAME TRACE/DEBUG/INFO/WARN/ERROR/FATAL vocabulary as log-row.tsx', () => {
      renderFilters()
      expect(screen.getByText('Trace+')).toBeInTheDocument()
      expect(screen.getByText('Debug+')).toBeInTheDocument()
      expect(screen.getByText('Info+')).toBeInTheDocument()
      expect(screen.getByText('Warn+')).toBeInTheDocument()
      expect(screen.getByText('Error+')).toBeInTheDocument()
      expect(screen.getByText('Fatal')).toBeInTheDocument()
    })
  })

  describe('process selection', () => {
    it('selecting "bot" calls onFiltersChange with { process: "bot" }', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters({ stream: 'backend' })

      const select = processSelect()
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error('process select not found')
      }
      await user.selectOptions(select, 'bot')

      expect(onFiltersChange).toHaveBeenCalledWith({ process: 'bot' })
    })

    it('selecting "Any process" calls onFiltersChange with { process: "both" }', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters({
        stream: 'backend',
        filters: { process: 'bot' },
      })

      const select = processSelect()
      if (!(select instanceof HTMLSelectElement)) {
        throw new Error('process select not found')
      }
      await user.selectOptions(select, 'both')

      expect(onFiltersChange).toHaveBeenCalledWith({ process: 'both' })
    })

    it('is rendered for stream="backend"', () => {
      renderFilters({ stream: 'backend' })
      expect(processSelect()).toBeInTheDocument()
    })

    it('is NOT rendered for stream="frontend-server"', () => {
      renderFilters({ stream: 'frontend-server' })
      expect(processSelect()).not.toBeInTheDocument()
    })

    it('is NOT rendered for stream="frontend-browser"', () => {
      renderFilters({ stream: 'frontend-browser' })
      expect(processSelect()).not.toBeInTheDocument()
    })
  })

  describe('event slug input', () => {
    it('typing an event slug calls onFiltersChange with the trimmed value', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters()

      await user.type(eventInput(), 'writer-fault')

      // Fires once per keystroke (a plain controlled <input>, no debounce
      // of its own — unlike LogSearchBar's free-text field, this is exact-
      // match structured-filter input, not a whole-file re-scan trigger
      // that would need debouncing at THIS layer; log-viewer.tsx's own
      // filtered-projection fetch is what actually re-queries, and that
      // re-query is driven off `filters` changing, not off keystroke
      // cadence). The LAST call carries the full accumulated value.
      expect(onFiltersChange).toHaveBeenLastCalledWith({
        event: 'writer-fault',
      })
    })

    it('clearing the event input back to empty calls onFiltersChange with { event: undefined }', async () => {
      const user = userEvent.setup()
      const { onFiltersChange } = renderFilters({
        filters: { event: 'writer-fault' },
      })

      await user.clear(eventInput())

      expect(onFiltersChange).toHaveBeenLastCalledWith({ event: undefined })
    })
  })

  describe('"Clear filters" visibility + wiring', () => {
    it('does NOT appear when no filter is active', () => {
      renderFilters({ filters: {} })
      expect(
        screen.queryByRole('button', { name: /clear filters/i }),
      ).not.toBeInTheDocument()
    })

    it('does NOT appear when process is explicitly "both" (equivalent to unset, not an active filter)', () => {
      renderFilters({ filters: { process: 'both' } })
      expect(
        screen.queryByRole('button', { name: /clear filters/i }),
      ).not.toBeInTheDocument()
    })

    it('appears when level is set and calls onClearFilters on click', async () => {
      const user = userEvent.setup()
      const { onClearFilters } = renderFilters({ filters: { level: 50 } })

      const clearButton = screen.getByRole('button', {
        name: /clear filters/i,
      })
      await user.click(clearButton)

      expect(onClearFilters).toHaveBeenCalledTimes(1)
    })

    it('appears when process is set to a restrictive value ("main"/"bot")', () => {
      renderFilters({ filters: { process: 'bot' } })
      expect(
        screen.getByRole('button', { name: /clear filters/i }),
      ).toBeInTheDocument()
    })

    it('appears when event is set', () => {
      renderFilters({ filters: { event: 'writer-fault' } })
      expect(
        screen.getByRole('button', { name: /clear filters/i }),
      ).toBeInTheDocument()
    })
  })
})
