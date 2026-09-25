import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { Card, Note } from 'src/components/ui/card'
import { iconSymbolId } from 'src/components/ui/icon'

function requireUse(root: HTMLElement): SVGUseElement {
  const use = root.querySelector<SVGUseElement>('svg use')

  if (!use) {
    throw new Error('expected the note to render an icon')
  }

  return use
}

describe('Card', () => {
  it('is raised by default — surface, not the well', () => {
    render(<Card data-testid="card">body</Card>)
    const card = screen.getByTestId('card')

    expect(card).toHaveClass('bg-surface')
    expect(card).not.toHaveClass('bg-bg-sunk')
  })

  it('inverts into a well when sunk', () => {
    render(
      <Card data-testid="card" sunk>
        body
      </Card>,
    )
    const card = screen.getByTestId('card')

    expect(card).toHaveClass('bg-bg-sunk')
    expect(card).not.toHaveClass('bg-surface')
  })

  it('keeps its border and radius in both states', () => {
    const { rerender } = render(<Card data-testid="card">body</Card>)
    expect(screen.getByTestId('card')).toHaveClass(
      'rounded-lg',
      'border',
      'border-line',
    )

    rerender(
      <Card data-testid="card" sunk>
        body
      </Card>,
    )
    expect(screen.getByTestId('card')).toHaveClass(
      'rounded-lg',
      'border',
      'border-line',
    )
  })

  it('lets a call site replace the default padding', () => {
    render(
      <Card className="px-1.5 pt-1 pb-1.5" data-testid="card">
        body
      </Card>,
    )
    const card = screen.getByTestId('card')

    expect(card).toHaveClass('px-1.5', 'pt-1', 'pb-1.5')
  })

  it('spreads the rest of its props onto the root element', () => {
    render(
      <Card aria-label="Recent activity" data-testid="card" id="activity">
        body
      </Card>,
    )
    const card = screen.getByTestId('card')

    expect(card.tagName).toBe('DIV')
    expect(card).toHaveAttribute('id', 'activity')
    expect(card).toHaveAccessibleName('Recent activity')
  })

  it('does not leak the sunk flag into the DOM', () => {
    render(
      <Card data-testid="card" sunk>
        body
      </Card>,
    )

    expect(screen.getByTestId('card')).not.toHaveAttribute('sunk')
  })
})

describe('Note', () => {
  it('defaults its icon to alert', () => {
    const { container } = render(<Note>Heads up.</Note>)

    expect(requireUse(container)).toHaveAttribute(
      'href',
      `#${iconSymbolId('alert')}`,
    )
  })

  it('uses the icon it is given', () => {
    const { container } = render(<Note icon="download">Heads up.</Note>)

    expect(requireUse(container)).toHaveAttribute(
      'href',
      `#${iconSymbolId('download')}`,
    )
  })

  it('renders the icon as a direct child svg so [&>svg]: overrides reach it', () => {
    render(<Note data-testid="note">Heads up.</Note>)
    const note = screen.getByTestId('note')

    expect(note.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect(note.firstElementChild).toHaveClass('text-ink-3', 'shrink-0')
  })

  it('wraps its children so the icon stays top-aligned beside them', () => {
    render(
      <Note data-testid="note">
        <p>Multi-line prose.</p>
      </Note>,
    )
    const note = screen.getByTestId('note')

    expect(note).toHaveClass('flex', 'gap-2.5', 'text-sm', 'text-ink-2')
    expect(note.lastElementChild?.tagName.toLowerCase()).toBe('div')
    expect(screen.getByText('Multi-line prose.')).toBeInTheDocument()
  })

  it('lets a call site override the tone with important utilities', () => {
    render(
      <Note
        className="border-bad/35! bg-bad-ghost! [&>svg]:text-bad!"
        data-testid="note"
      >
        Something broke.
      </Note>,
    )
    const note = screen.getByTestId('note')

    expect(note).toHaveClass(
      'border-bad/35!',
      'bg-bad-ghost!',
      '[&>svg]:text-bad!',
    )
  })

  it('keeps both its size and its colour through cns', () => {
    // A theme size token next to a text colour in one `cns` call — the shape
    // that used to annihilate one of the two. `text-sm` was always safe (a
    // built-in name); the custom tokens are safe now too, via the
    // `extendTailwindMerge` config in `packages/utils/src/cns.ts`. Pinned on
    // the rendered DOM, which is the only place the collision ever showed.
    render(<Note data-testid="note">Heads up.</Note>)
    const classes = (
      screen.getByTestId('note').getAttribute('class') ?? ''
    ).split(/\s+/)

    expect(classes).toContain('text-sm')
    expect(classes).toContain('text-ink-2')
  })

  it('does not leak the icon prop into the DOM', () => {
    render(
      <Note data-testid="note" icon="shield">
        Heads up.
      </Note>,
    )

    expect(screen.getByTestId('note')).not.toHaveAttribute('icon')
  })
})
