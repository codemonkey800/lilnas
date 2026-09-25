import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { iconSymbolId } from 'src/components/ui/icon'
import { Tile } from 'src/components/ui/tile'

describe('Tile', () => {
  it('is one link carrying the icon, the heading and the count', () => {
    render(
      <Tile
        data-testid="tile"
        href="/movies"
        icon="film"
        meta="318 in the library"
        title="Browse movies"
      />,
    )
    const tile = screen.getByTestId('tile')

    expect(tile.tagName).toBe('A')
    expect(tile).toHaveAttribute('href', '/movies')
    expect(tile).toHaveTextContent('Browse movies')
    expect(tile).toHaveTextContent('318 in the library')
    expect(tile.querySelector('svg use')).toHaveAttribute(
      'href',
      `#${iconSymbolId('film')}`,
    )
  })

  it('is a column by default and a row when asked', () => {
    const { rerender } = render(
      <Tile
        data-testid="tile"
        icon="tv"
        meta="54 in the library"
        title="Browse shows"
      />,
    )
    expect(screen.getByTestId('tile')).toHaveClass('flex-col')
    expect(screen.getByTestId('tile')).not.toHaveClass('flex-row')

    rerender(
      <Tile
        data-testid="tile"
        icon="tv"
        meta="54 in the library"
        row
        title="Browse shows"
      />,
    )
    expect(screen.getByTestId('tile')).toHaveClass('flex-row', 'items-center')
    expect(screen.getByTestId('tile')).not.toHaveClass('flex-col')
  })

  it('lets the text half fill the row only in the row layout', () => {
    const { rerender } = render(
      <Tile
        data-testid="tile"
        icon="play"
        meta="203 in the library"
        title="Video library"
      />,
    )
    const text = () => screen.getByText('Video library').parentElement

    expect(text).not.toBeNull()
    expect(text()).not.toHaveClass('flex-1')

    rerender(
      <Tile
        data-testid="tile"
        icon="play"
        meta="203 in the library"
        row
        title="Video library"
      />,
    )
    expect(text()).toHaveClass('flex-1')
  })

  it('reacts to a hover of the whole tile, not of the icon plate', () => {
    render(
      <Tile
        data-testid="tile"
        icon="film"
        meta="318 in the library"
        title="Browse movies"
      />,
    )
    const tile = screen.getByTestId('tile')
    const plate = tile.firstElementChild

    expect(tile).toHaveClass(
      'group',
      'hover:-translate-y-[2px]',
      'hover:border-uv',
      'hover:bg-surface-uv',
    )
    expect(plate).toHaveClass(
      'group-hover:bg-uv-ghost',
      'group-hover:text-uv-hi',
      'bg-surface-3',
      'text-ink-2',
    )
    expect(plate?.querySelector('svg')).toHaveClass('h-[15px]', 'w-[15px]')
  })

  it('has no live dot by default', () => {
    render(
      <Tile
        data-testid="tile"
        icon="film"
        meta="318 in the library"
        title="Browse movies"
      />,
    )

    expect(screen.getByTestId('tile').querySelector('.dot-live')).toBeNull()
  })

  it('hangs a live dot in front of the count when live', () => {
    render(
      <Tile
        data-testid="tile"
        icon="download"
        live
        meta="2 running now"
        title="Downloads activity"
      />,
    )
    const metaRow = screen.getByText('2 running now').parentElement

    expect(metaRow?.firstElementChild).toHaveClass('dot-live')
    expect(metaRow).toHaveClass('font-mono', 'text-ink-3')
  })

  it('keeps both the mono size token and the ink colour on the count', () => {
    render(
      <Tile
        data-testid="tile"
        icon="film"
        meta="318 in the library"
        title="Browse movies"
      />,
    )
    const classes = (
      screen
        .getByText('318 in the library')
        .parentElement?.getAttribute('class') ?? ''
    ).split(/\s+/)

    expect(classes).toContain('text-mono-sm')
    expect(classes).toContain('text-ink-3')
  })

  it('renders the heading at the h3 token', () => {
    render(
      <Tile
        data-testid="tile"
        icon="film"
        meta="318 in the library"
        title="Browse movies"
      />,
    )

    expect(screen.getByText('Browse movies')).toHaveClass('block', 'text-h3')
  })

  it('spreads the rest of its props and merges a caller className', () => {
    render(
      <Tile
        aria-label="Browse movies"
        className="min-w-[220px] flex-1"
        data-testid="tile"
        icon="film"
        id="quick-movies"
        meta="318 in the library"
        title="Browse movies"
      />,
    )
    const tile = screen.getByTestId('tile')

    expect(tile).toHaveAttribute('id', 'quick-movies')
    expect(tile).toHaveClass('min-w-[220px]', 'flex-1', 'group')
  })

  it('does not leak its own props into the DOM', () => {
    render(
      <Tile
        data-testid="tile"
        icon="download"
        live
        meta="2 running now"
        row
        title="Downloads activity"
      />,
    )
    const tile = screen.getByTestId('tile')

    // `title` is shadowed on purpose — the heading is already visible text, so
    // it must not also become a native tooltip.
    expect(tile).not.toHaveAttribute('title')
    expect(tile).not.toHaveAttribute('icon')
    expect(tile).not.toHaveAttribute('meta')
    expect(tile).not.toHaveAttribute('live')
    expect(tile).not.toHaveAttribute('row')
  })

  it('renders children after the text half, as the mixin block does', () => {
    render(
      <Tile
        data-testid="tile"
        icon="film"
        meta="318 in the library"
        title="Browse movies"
      >
        <span data-testid="extra">extra</span>
      </Tile>,
    )

    expect(screen.getByTestId('tile').lastElementChild).toBe(
      screen.getByTestId('extra'),
    )
  })
})
