import '@testing-library/jest-dom'

import { fireEvent, render, screen } from '@testing-library/react'

import { LogLine, LogLineRow, LogViewer } from '../../log-viewer'

const LINES: LogLine[] = [
  { id: 1, ts: '12:00:01', level: 'INFO', source: 'api', message: 'up' },
  { id: 2, level: 'WARN', message: 'slow' },
  { id: 3, level: 'ERROR', message: 'boom' },
  { id: 4, message: 'raw stderr', stderr: true },
  { id: 5, level: 'DEBUG', message: 'trace' },
]

describe('LogViewer', () => {
  it('colours levels', () => {
    render(<LogViewer lines={LINES} />)

    expect(screen.getByText('INFO')).toHaveClass('text-accent-hi')
    expect(screen.getByText('WARN')).toHaveClass('text-warn')
    expect(screen.getByText('ERROR')).toHaveClass('text-bad')
    expect(screen.getByText('DEBUG')).toHaveClass('text-ink-4')
  })

  it('shows timestamp, source and message in their roles', () => {
    render(<LogViewer lines={LINES} />)

    expect(screen.getByText('12:00:01')).toHaveClass('text-ink-3')
    expect(screen.getByText('api')).toHaveClass('text-ink')
    expect(screen.getByText('up')).toHaveClass('flex-1')
  })

  it('tints stderr lines', () => {
    render(<LogViewer lines={LINES} />)

    const err = screen.getByText('raw stderr').parentElement
    expect(err).toHaveClass('bg-bad-ghost', 'border-bad')
    expect(err).toHaveAttribute('data-stream', 'stderr')
    expect(screen.getByText('slow').parentElement).not.toHaveClass(
      'bg-bad-ghost',
    )
  })

  it('is a sunk, polite live log well', () => {
    render(<LogViewer height={200} lines={LINES} />)

    const log = screen.getByRole('log', { name: 'Logs' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log).toHaveClass('bg-bg-sunk', 'overflow-auto')
    expect(log).toHaveStyle({ height: '200px' })
  })

  it('animates fresh lines in', () => {
    render(
      <LogViewer
        lines={[
          { id: 1, message: 'old' },
          { id: 2, message: 'new', fresh: true },
        ]}
      />,
    )

    expect(screen.getByText('new').parentElement).toHaveClass('animate-rise')
    expect(screen.getByText('old').parentElement).not.toHaveClass(
      'animate-rise',
    )
  })

  it('never animates under virtualize', () => {
    render(
      <LogViewer lines={[{ id: 2, message: 'new', fresh: true }]} virtualize />,
    )

    expect(screen.getByText('new').parentElement).not.toHaveClass(
      'animate-rise',
    )
  })

  it('never animates through LogLineRow when virtualized', () => {
    render(
      <LogLineRow line={{ id: 1, message: 'm', fresh: true }} virtualized />,
    )

    expect(screen.getByText('m').parentElement).not.toHaveClass('animate-rise')
  })

  it('renders rows through renderLine', () => {
    render(
      <LogViewer
        lines={LINES.slice(0, 2)}
        renderLine={(l, i) => <p key={l.id}>{`${i}:${l.message}`}</p>}
        virtualize
      />,
    )

    expect(screen.getByText('0:up')).toBeInTheDocument()
    expect(screen.getByText('1:slow')).toBeInTheDocument()
  })
})

describe('LogViewer follow', () => {
  let scrollHeight = 1000
  const clientHeight = 200

  beforeEach(() => {
    scrollHeight = 1000
    jest
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(() => scrollHeight)
    jest
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(() => clientHeight)
  })

  function scrollTo(el: HTMLElement, top: number) {
    el.scrollTop = top
    fireEvent.scroll(el)
  }

  it('jumps to the bottom and sticks as lines arrive', () => {
    const { rerender } = render(<LogViewer follow lines={LINES} />)
    const log = screen.getByRole('log')
    expect(log.scrollTop).toBe(1000)

    scrollHeight = 1400
    rerender(
      <LogViewer follow lines={[...LINES, { id: 6, message: 'more' }]} />,
    )

    expect(log.scrollTop).toBe(1400)
  })

  it('does not scroll when follow is off', () => {
    render(<LogViewer lines={LINES} />)

    expect(screen.getByRole('log').scrollTop).toBe(0)
  })

  it('asks to turn follow off when the reader scrolls up', () => {
    const onFollowChange = jest.fn()
    render(<LogViewer follow lines={LINES} onFollowChange={onFollowChange} />)

    scrollTo(screen.getByRole('log'), 100)

    expect(onFollowChange).toHaveBeenCalledWith(false)
  })

  it('stays quiet while the reader is within the slack of the bottom', () => {
    const onFollowChange = jest.fn()
    render(<LogViewer follow lines={LINES} onFollowChange={onFollowChange} />)

    scrollTo(screen.getByRole('log'), 790)

    expect(onFollowChange).not.toHaveBeenCalled()
  })

  it('keeps the reader in place while scrolled up, even if follow stays on', () => {
    const { rerender } = render(<LogViewer follow lines={LINES} />)
    const log = screen.getByRole('log')

    scrollTo(log, 100)
    scrollHeight = 1400
    rerender(
      <LogViewer follow lines={[...LINES, { id: 6, message: 'more' }]} />,
    )

    expect(log.scrollTop).toBe(100)
  })

  it('resumes pinning once the reader is back at the bottom', () => {
    const { rerender } = render(<LogViewer follow lines={LINES} />)
    const log = screen.getByRole('log')

    scrollTo(log, 100)
    scrollTo(log, 800)
    scrollHeight = 1400
    rerender(
      <LogViewer follow lines={[...LINES, { id: 6, message: 'more' }]} />,
    )

    expect(log.scrollTop).toBe(1400)
  })

  it('re-pins when follow is switched back on', () => {
    const { rerender } = render(<LogViewer lines={LINES} />)
    const log = screen.getByRole('log')
    scrollTo(log, 100)

    rerender(<LogViewer follow lines={LINES} />)

    expect(log.scrollTop).toBe(1000)
  })
})
