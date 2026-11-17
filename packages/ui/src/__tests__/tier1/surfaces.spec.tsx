import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import { createRef } from 'react'

import { Badge } from '../../badge'
import { Card, Panel, PanelHead, Tile } from '../../card'
import { EmptyState } from '../../empty-state'
import { Icon, ICON_NAMES } from '../../icons'
import { StatusDot } from '../../status-dot'

describe('Icon', () => {
  it.each(ICON_NAMES)('renders %s', name => {
    const { container } = render(<Icon name={name} />)

    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('stroke', 'currentColor')
    expect(svg?.childElementCount).toBeGreaterThan(0)
  })

  it('has no duplicates and merges the three source sets', () => {
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
    expect(ICON_NAMES).toEqual(
      expect.arrayContaining([
        'google',
        'key',
        'sort',
        'terminal',
        'grid-fill',
      ]),
    )
  })

  it('sizes, labels and merges className', () => {
    render(
      <Icon aria-label="Done" className="text-ok" name="check" size={24} />,
    )

    const svg = screen.getByRole('img', { name: 'Done' })
    expect(svg).not.toHaveAttribute('aria-hidden')
    expect(svg).toHaveAttribute('width', '24')
    expect(svg).toHaveClass('text-ok')
  })

  it('scales the 20-grid stroke to match the 16 grid', () => {
    const { container } = render(
      <>
        <Icon name="check" />
        <Icon name="home" />
      </>,
    )

    const [a, b] = Array.from(container.querySelectorAll('svg'))
    expect(a).toHaveAttribute('stroke-width', '1.6')
    expect(b).toHaveAttribute('stroke-width', '2')
  })
})

describe('StatusDot', () => {
  it.each(['ok', 'accent'] as const)('pulses for %s', tone => {
    const { container } = render(<StatusDot pulse tone={tone} />)

    expect(container.firstElementChild).toHaveAttribute('data-pulse')
    expect(container.querySelector('.animate-breathe')).not.toBeNull()
  })

  it.each(['warn', 'bad', 'idle'] as const)('ignores pulse for %s', tone => {
    const { container } = render(<StatusDot pulse tone={tone} />)

    expect(container.firstElementChild).not.toHaveAttribute('data-pulse')
    expect(container.querySelector('.animate-breathe')).toBeNull()
  })

  it('does not pulse unless asked', () => {
    const { container } = render(<StatusDot tone="ok" />)

    expect(container.querySelector('.animate-breathe')).toBeNull()
  })

  it('maps tones to fills and is decorative', () => {
    const { container } = render(
      <>
        <StatusDot tone="warn" />
        <StatusDot />
      </>,
    )

    const [warn, idle] = Array.from(container.children)
    expect(warn).toHaveClass('bg-warn', 'size-2', 'rounded-full')
    expect(warn).toHaveAttribute('aria-hidden', 'true')
    expect(idle).toHaveClass('bg-ink-4')
  })
})

describe('Badge', () => {
  it.each([
    ['mute', ['bg-surface-2', 'text-ink-3']],
    ['accent', ['bg-accent-ghost', 'text-accent-hi']],
    ['ok', ['bg-ok-ghost', 'text-ok']],
    ['warn', ['bg-warn-ghost', 'text-warn']],
    ['bad', ['bg-bad-ghost', 'text-bad']],
  ] as const)('applies the %s tone', (tone, classes) => {
    render(<Badge tone={tone}>Label</Badge>)

    expect(screen.getByText('Label')).toHaveClass(
      'h-6',
      'rounded-full',
      'px-2.5',
      'text-xs',
      'font-medium',
      ...classes,
    )
  })

  it('defaults to mute and shows a static leading dot', () => {
    render(<Badge>Idle</Badge>)

    const badge = screen.getByText('Idle')
    expect(badge).toHaveClass('bg-surface-2')
    expect(badge.querySelector('.bg-current')).toHaveClass('size-1.5')
    expect(badge.querySelector('[data-pulse]')).toBeNull()
  })

  it('live swaps in a pulsing StatusDot for accent and ok', () => {
    const { rerender } = render(
      <Badge live tone="accent">
        Downloading
      </Badge>,
    )
    expect(
      screen.getByText('Downloading').querySelector('[data-pulse]'),
    ).not.toBeNull()
    expect(
      screen.getByText('Downloading').querySelector('.bg-current'),
    ).toBeNull()

    rerender(
      <Badge live tone="ok">
        Connected
      </Badge>,
    )
    expect(
      screen.getByText('Connected').querySelector('[data-pulse]'),
    ).not.toBeNull()
  })

  it('live does not pulse problems', () => {
    render(
      <Badge live tone="bad">
        Failed
      </Badge>,
    )

    expect(screen.getByText('Failed').querySelector('[data-pulse]')).toBeNull()
  })

  it('is never a button', () => {
    render(<Badge tone="accent">Queued</Badge>)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Queued').tagName).toBe('SPAN')
  })
})

describe('Card and Panel', () => {
  it('Card is a raised surface with no shadow', () => {
    render(<Card data-testid="c" />)

    const card = screen.getByTestId('c')
    expect(card).toHaveClass('bg-surface', 'border-line', 'rounded-lg', 'p-4')
    expect(card.className).not.toMatch(/shadow/)
  })

  it('Card sunk is a well; className wins; ref forwards', () => {
    const ref = createRef<HTMLDivElement>()
    render(<Card className="p-8" data-testid="c" ref={ref} variant="sunk" />)

    const card = screen.getByTestId('c')
    expect(ref.current).toBe(card)
    expect(card).toHaveClass('bg-bg-sunk', 'p-8')
    expect(card).not.toHaveClass('bg-surface', 'p-4')
  })

  it('Panel with a head', () => {
    render(
      <Panel data-testid="p">
        <PanelHead caption="/var/log" title="Logs">
          <span>chip</span>
        </PanelHead>
      </Panel>,
    )

    expect(screen.getByTestId('p')).toHaveClass('overflow-hidden', 'rounded-lg')
    expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
    expect(screen.getByText('/var/log')).toHaveClass('font-mono')
    expect(screen.getByText('chip')).toBeInTheDocument()
  })
})

describe('Tile', () => {
  it('renders as an anchor with an href', () => {
    render(
      <Tile
        href="https://download.lilnas.io"
        icon="download"
        meta="download.lilnas.io"
        status="3 active"
        statusTone="accent"
        title="Download"
      />,
    )

    const tile = screen.getByRole('link', { name: /Download/ })
    expect(tile.tagName).toBe('A')
    expect(tile).toHaveAttribute('href', 'https://download.lilnas.io')
    expect(tile).toHaveClass('hover:bg-surface-2', 'hover:border-line-loud')
    expect(tile.className).not.toMatch(/shadow/)
    expect(screen.getByText('download.lilnas.io')).toHaveClass('font-mono')
    expect(screen.getByText('3 active')).toBeInTheDocument()
    expect(tile.querySelector('.bg-accent')).not.toBeNull()
  })

  it('renders through render', () => {
    render(
      <Tile
        icon="film"
        render={<a data-testid="custom" href="/x" />}
        title="Media"
      />,
    )

    const tile = screen.getByTestId('custom')
    expect(tile.tagName).toBe('A')
    expect(tile).toHaveTextContent('Media')
    expect(tile).toHaveClass('bg-surface')
  })

  it('is a plain div without href or render, and omits the status', () => {
    const { container } = render(<Tile icon="film" title="Media" />)

    expect(container.firstElementChild?.tagName).toBe('DIV')
    expect(container.querySelector('.size-2')).toBeNull()
  })
})

describe('EmptyState', () => {
  it('shows the mascot, copy and exactly one action', () => {
    const { container } = render(
      <EmptyState
        action={<button type="button">Add a show</button>}
        body="Nothing here yet."
        title="No downloads"
      />,
    )

    expect(
      screen.getByRole('heading', { name: 'No downloads' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing here yet.')).toHaveClass('max-w-[34ch]')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(container.querySelectorAll('[data-slot="action"]')).toHaveLength(1)
    const mark = container.querySelector('svg')
    expect(mark).toHaveAttribute('height', '46')
    expect(mark).toHaveClass('opacity-55')
  })

  it('renders no action wrapper when none is given', () => {
    const { container } = render(<EmptyState title="Empty" />)

    expect(container.querySelector('[data-slot="action"]')).toBeNull()
  })

  it('refuses a second action in dev', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() =>
      render(
        <EmptyState
          action={[
            <button key="a" type="button">
              A
            </button>,
            <button key="b" type="button">
              B
            </button>,
          ]}
          title="Empty"
        />,
      ),
    ).toThrow(/exactly one action/)
  })
})
