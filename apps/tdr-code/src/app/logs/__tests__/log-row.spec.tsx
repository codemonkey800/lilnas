import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LogRow, ROW_PX } from 'src/app/logs/log-row'
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
