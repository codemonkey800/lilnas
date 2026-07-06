import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { highlightSegments, LogRow, ROW_PX } from 'src/app/logs/log-row'
import type { LogLine } from 'src/logging/log-view.types'

function makeLine(
  parsed: Record<string, unknown> | null,
  overrides: Partial<LogLine> = {},
): LogLine {
  return {
    byteOffset: 0,
    byteLength: 0,
    raw: parsed === null ? '<malformed>' : JSON.stringify(parsed),
    parsed,
    ...overrides,
  }
}

describe('LogRow — happy path', () => {
  it('renders an info (level 30) backend line: local time, INFO label/color, process badge, event slug, msg, and a generationId chip', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      generationId: 424,
      event: 'generation-inserted',
      msg: 'Inserted bot generation',
    })

    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)

    const expected = new Date(1783247968175)
    const hh = String(expected.getHours()).padStart(2, '0')
    const mm = String(expected.getMinutes()).padStart(2, '0')
    const ss = String(expected.getSeconds()).padStart(2, '0')
    const ms = String(expected.getMilliseconds()).padStart(3, '0')
    expect(screen.getByText(`${hh}:${mm}:${ss}.${ms}`)).toBeInTheDocument()

    const level = screen.getByText('INFO')
    expect(level).toBeInTheDocument()
    expect(level).toHaveClass('text-gray-300')

    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('generation-inserted')).toBeInTheDocument()
    expect(screen.getByText('Inserted bot generation')).toBeInTheDocument()
    expect(screen.getByText('generationId=424')).toBeInTheDocument()
  })

  it('renders a warn (40) line in amber/yellow', () => {
    const line = makeLine({
      level: 40,
      time: 1783247968175,
      process: 'main',
      event: 'something-off',
      msg: 'careful',
    })
    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)
    const level = screen.getByText('WARN')
    expect(level).toHaveClass('text-yellow-400')
  })

  it('renders an error (50) line in red', () => {
    const line = makeLine({
      level: 50,
      time: 1783247968175,
      process: 'main',
      msg: 'boom',
    })
    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)
    expect(screen.getByText('ERROR')).toHaveClass('text-red-400')
  })

  it('renders a fatal (60) line in red', () => {
    const line = makeLine({
      level: 60,
      time: 1783247968175,
      process: 'main',
      msg: 'dead',
    })
    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)
    expect(screen.getByText('FATAL')).toHaveClass('text-red-400')
  })

  it('renders a debug (20) line dim, with no event shown, and does NOT flag it as malformed', () => {
    const line = makeLine({
      level: 20,
      time: 1783247968175,
      process: 'main',
      msg: 'Supervisor FSM transition',
    })
    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)

    const level = screen.getByText('DEBUG')
    expect(level).toHaveClass('text-gray-500')
    // Absent event renders a dim placeholder, not an error/malformed marker.
    expect(screen.getByText('no-event')).toBeInTheDocument()
    expect(screen.queryByText(/malformed/i)).not.toBeInTheDocument()
    expect(screen.getByText('Supervisor FSM transition')).toBeInTheDocument()
  })
})

describe('LogRow — fixed height and overflow (R12)', () => {
  it('keeps the fixed ROW_PX height and truncates overflow instead of wrapping, even with a long msg and many context keys', () => {
    const manyKeys: Record<string, unknown> = {
      level: 30,
      time: 1783247968175,
      process: 'main',
      event: 'generation-inserted',
      msg: 'x'.repeat(500),
    }
    for (let i = 0; i < 30; i++) {
      manyKeys[`extraKey${i}`] = `value${i}`
    }
    const line = makeLine(manyKeys)

    const { container } = render(
      <LogRow line={line} stream="backend" onSelect={jest.fn()} />,
    )

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveStyle({ height: `${ROW_PX}px` })

    const msgEl = screen.getByText('x'.repeat(500))
    expect(msgEl).toHaveClass('truncate')
  })
})

describe('LogRow — missing process (browser line)', () => {
  it('renders the stream fallback badge instead of crashing or leaking "undefined"', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      event: 'page-view',
      msg: 'Rendered /logs',
    })

    render(
      <LogRow line={line} stream="frontend-browser" onSelect={jest.fn()} />,
    )

    expect(screen.getByText('frontend-browser')).toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })
})

describe('LogRow — malformed line (R14)', () => {
  it('renders raw text in a single dim/italic cell with no column structure, still at fixed height', () => {
    const line = makeLine(null, {
      raw: '<half json',
      byteOffset: 42,
    })

    const { container } = render(
      <LogRow line={line} stream="backend" onSelect={jest.fn()} />,
    )

    const raw = screen.getByText('<half json')
    expect(raw).toHaveClass('italic')

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveStyle({ height: `${ROW_PX}px` })

    // No column structure: none of the happy-path column content exists.
    expect(screen.queryByText('INFO')).not.toBeInTheDocument()
    expect(screen.queryByText('main')).not.toBeInTheDocument()
  })

  it('a malformed row is still clickable and invokes onSelect with its byteOffset', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    const line = makeLine(null, { raw: '<half json', byteOffset: 99 })

    render(<LogRow line={line} stream="backend" onSelect={onSelect} />)

    await user.click(screen.getByText('<half json'))
    expect(onSelect).toHaveBeenCalledWith(99)
  })
})

describe('LogRow — interaction', () => {
  it('clicking a row calls onSelect with the line byteOffset', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    const line = makeLine(
      {
        level: 30,
        time: 1783247968175,
        process: 'main',
        event: 'generation-inserted',
        msg: 'Inserted bot generation',
      },
      { byteOffset: 12345 },
    )

    render(<LogRow line={line} stream="backend" onSelect={onSelect} />)

    await user.click(screen.getByText('Inserted bot generation'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(12345)
  })

  it('has a data-track-id attribute for click tracking', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      msg: 'hi',
    })
    const { container } = render(
      <LogRow line={line} stream="backend" onSelect={jest.fn()} />,
    )
    expect(
      container.querySelector('[data-track-id="log-row-select"]'),
    ).toBeInTheDocument()
  })
})

describe('LogRow — edge cases', () => {
  it('an unrecognized numeric level (e.g. 25) renders sensibly without crashing or showing blank', () => {
    const line = makeLine({
      level: 25,
      time: 1783247968175,
      process: 'main',
      msg: 'weird level',
    })

    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)

    // Falls back to the raw numeric value rather than a blank cell.
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('weird level')).toBeInTheDocument()
  })

  it('a parsed object with no msg field at all renders without crashing', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      event: 'generation-inserted',
    })

    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)

    expect(screen.getByText('generation-inserted')).toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// highlightSegments — the pure, DOM-free helper U11 introduces. Mirrors
// this app's own established convention (log-viewer.tsx's applyFetchedWindow/
// appendTailLine) of testing pure logic independently of any component/DOM
// concern — every casing/multi-occurrence/no-match edge case is cheap to
// prove exhaustively here without ever rendering anything.
// ═══════════════════════════════════════════════════════════════════════

describe('highlightSegments', () => {
  it('no needle (empty string): returns the whole text as one non-highlighted segment', () => {
    expect(highlightSegments('hello world', '')).toEqual([
      { text: 'hello world', highlighted: false },
    ])
  })

  it('a needle present as a substring: wraps the matching run, leaves the rest plain, and the concatenated segments reproduce the ORIGINAL text exactly (nothing dropped or duplicated)', () => {
    const segments = highlightSegments('the quick brown fox', 'quick')
    expect(segments).toEqual([
      { text: 'the ', highlighted: false },
      { text: 'quick', highlighted: true },
      { text: ' brown fox', highlighted: false },
    ])
    expect(segments.map(s => s.text).join('')).toBe('the quick brown fox')
  })

  it('case-insensitive matching: a differently-cased needle still matches, and the ORIGINAL casing of the match is preserved (not forced to the needle’s own casing)', () => {
    const segments = highlightSegments('Hello WORLD', 'world')
    expect(segments).toEqual([
      { text: 'Hello ', highlighted: false },
      { text: 'WORLD', highlighted: true }, // preserved as-typed in the text, not lower-cased to match the needle
    ])
  })

  it('a needle typed in a DIFFERENT case than a lowercase occurrence also matches, preserving THAT occurrence’s own original casing', () => {
    const segments = highlightSegments('an error occurred', 'ERROR')
    expect(segments).toEqual([
      { text: 'an ', highlighted: false },
      { text: 'error', highlighted: true },
      { text: ' occurred', highlighted: false },
    ])
  })

  it('multiple occurrences within one field are ALL highlighted, not just the first', () => {
    const segments = highlightSegments('cat dog cat bird cat', 'cat')
    const highlighted = segments.filter(s => s.highlighted)
    expect(highlighted).toHaveLength(3)
    expect(highlighted.every(s => s.text === 'cat')).toBe(true)
    expect(segments.map(s => s.text).join('')).toBe('cat dog cat bird cat')
  })

  it('a needle that does not occur at all returns the whole text as one non-highlighted segment', () => {
    expect(highlightSegments('nothing to see here', 'zzz')).toEqual([
      { text: 'nothing to see here', highlighted: false },
    ])
  })

  it('a needle occupying the ENTIRE text yields a single highlighted segment with no surrounding plain runs', () => {
    expect(highlightSegments('exact', 'exact')).toEqual([
      { text: 'exact', highlighted: true },
    ])
  })

  it('adjacent/overlapping-looking occurrences (needle appearing back-to-back) each match distinctly, advancing past each match rather than re-scanning into it', () => {
    const segments = highlightSegments('aaaa', 'aa')
    // Non-overlapping, left-to-right greedy matching: 'aa' + 'aa', not
    // 'aa' + overlapping into itself a third time.
    expect(segments).toEqual([
      { text: 'aa', highlighted: true },
      { text: 'aa', highlighted: true },
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════
// LogRow — highlightText prop (U11). Component-level: proves the prop
// actually reaches the DOM as visible <mark>-wrapped content, scoped to
// msg (parsed rows) and the raw fallback (malformed rows) per this unit's
// own brief — highlightSegments' own describe block above already proves
// the underlying splitting logic exhaustively as a pure function, so these
// tests stay thin (just wiring/scope), matching this file's established
// "component tests are thinner; pure-function tests are exhaustive"
// convention (mirrors log-viewer.spec.tsx's own two-part structure).
// ═══════════════════════════════════════════════════════════════════════

describe('LogRow — highlightText (U11)', () => {
  it('no highlightText prop: renders plain text, no highlight markup at all', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      msg: 'Inserted bot generation',
    })
    render(<LogRow line={line} stream="backend" onSelect={jest.fn()} />)

    expect(screen.getByText('Inserted bot generation')).toBeInTheDocument()
    expect(
      document.querySelector('[data-track-id="log-row-highlight"]'),
    ).not.toBeInTheDocument()
  })

  it('an empty-string highlightText prop is treated the same as absent: no highlight markup', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      msg: 'Inserted bot generation',
    })
    render(
      <LogRow
        line={line}
        stream="backend"
        onSelect={jest.fn()}
        highlightText=""
      />,
    )

    expect(
      document.querySelector('[data-track-id="log-row-highlight"]'),
    ).not.toBeInTheDocument()
  })

  it('a highlightText present as a substring of msg is wrapped/marked distinctly, the rest renders plainly', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      msg: 'Inserted bot generation',
    })
    render(
      <LogRow
        line={line}
        stream="backend"
        onSelect={jest.fn()}
        highlightText="bot"
      />,
    )

    const mark = document.querySelector('[data-track-id="log-row-highlight"]')
    expect(mark).toBeInTheDocument()
    expect(mark).toHaveTextContent('bot')
    // The full msg is still present in the DOM overall (nothing dropped).
    expect(screen.getByText(/Inserted/)).toBeInTheDocument()
    expect(screen.getByText(/generation/)).toBeInTheDocument()
  })

  it('case-insensitive matching against msg preserves the ORIGINAL casing in what is rendered', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      msg: 'Careful: WARNING issued',
    })
    render(
      <LogRow
        line={line}
        stream="backend"
        onSelect={jest.fn()}
        highlightText="warning"
      />,
    )

    const mark = document.querySelector('[data-track-id="log-row-highlight"]')
    expect(mark).toHaveTextContent('WARNING') // original casing, not "warning"
  })

  it('a malformed (parsed === null) row’s raw text is searched/highlighted the same way msg is for a normal row', () => {
    const line = makeLine(null, { raw: 'not valid json here', byteOffset: 5 })
    render(
      <LogRow
        line={line}
        stream="backend"
        onSelect={jest.fn()}
        highlightText="valid"
      />,
    )

    const mark = document.querySelector('[data-track-id="log-row-highlight"]')
    expect(mark).toBeInTheDocument()
    expect(mark).toHaveTextContent('valid')
    expect(screen.getByText(/not/)).toBeInTheDocument()
    expect(screen.getByText(/json here/)).toBeInTheDocument()
  })

  it('multiple occurrences of the search term within msg are all highlighted, not just the first', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      msg: 'retry retry retry failed',
    })
    render(
      <LogRow
        line={line}
        stream="backend"
        onSelect={jest.fn()}
        highlightText="retry"
      />,
    )

    const marks = document.querySelectorAll(
      '[data-track-id="log-row-highlight"]',
    )
    expect(marks).toHaveLength(3)
    for (const mark of marks) {
      expect(mark).toHaveTextContent('retry')
    }
  })

  it('a highlightText that never occurs in this row’s msg renders plainly, no crash, no stray markup', () => {
    const line = makeLine({
      level: 30,
      time: 1783247968175,
      process: 'main',
      msg: 'Inserted bot generation',
    })
    render(
      <LogRow
        line={line}
        stream="backend"
        onSelect={jest.fn()}
        highlightText="zzz-not-present"
      />,
    )

    expect(screen.getByText('Inserted bot generation')).toBeInTheDocument()
    expect(
      document.querySelector('[data-track-id="log-row-highlight"]'),
    ).not.toBeInTheDocument()
  })
})
