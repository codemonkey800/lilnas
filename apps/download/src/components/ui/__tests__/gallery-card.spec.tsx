import '@testing-library/jest-dom'

import { Button } from '@lilnas/ui'
import { render, screen } from '@testing-library/react'

import {
  GalleryCard,
  GalleryCardAttrib,
  GalleryCardLink,
  GalleryCardRow,
  GalleryCardTitle,
} from 'src/components/ui/gallery-card'
import { PersonAvatar } from 'src/components/ui/person-avatar'
import { Poster } from 'src/components/ui/poster'

describe('GalleryCard', () => {
  it('is a div that stacks its rows and steps its surface on hover', () => {
    render(<GalleryCard data-testid="card">body</GalleryCard>)
    const card = screen.getByTestId('card')

    expect(card.tagName).toBe('DIV')
    expect(card).toHaveClass(
      'flex',
      'flex-col',
      'gap-2',
      'rounded-lg',
      'border',
      'border-line',
      'bg-surface',
      'p-2.5',
    )
    // Hover steps the surface; it does not lift.
    expect(card).toHaveClass('hover:border-line-loud', 'hover:bg-surface-2')
    expect(card.className).not.toContain('translate')
  })

  it('lets a call site pin its width', () => {
    render(<GalleryCard className="w-[158px]" data-testid="card" />)

    expect(screen.getByTestId('card')).toHaveClass('w-[158px]', 'flex-col')
  })

  it('spreads the rest of its props onto the root element', () => {
    render(<GalleryCard aria-label="Scary Movie" data-testid="card" id="m1" />)
    const card = screen.getByTestId('card')

    expect(card).toHaveAttribute('id', 'm1')
    expect(card).toHaveAccessibleName('Scary Movie')
  })
})

describe('GalleryCardLink', () => {
  it('is an anchor carrying no appearance of its own', () => {
    render(
      <GalleryCardLink data-testid="link" href="/movies/m1">
        body
      </GalleryCardLink>,
    )
    const link = screen.getByTestId('link')

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/movies/m1')
    expect(link).toHaveClass('flex', 'flex-col', 'gap-2')
    expect(link).not.toHaveClass('border')
  })
})

describe('GalleryCardTitle', () => {
  it('clamps to two lines and keeps both its size and its line height', () => {
    render(
      <GalleryCardTitle data-testid="title">
        Jackass: Best and Last
      </GalleryCardTitle>,
    )
    const title = screen.getByTestId('title')

    expect(title.tagName).toBe('P')
    expect(title).toHaveTextContent('Jackass: Best and Last')

    const classes = (title.getAttribute('class') ?? '').split(/\s+/)
    expect(classes).toContain('line-clamp-2')
    expect(classes).toContain('font-semibold')
    // `leading-[1.35]` is written after `text-sm` precisely so tailwind-merge
    // keeps both — a font size later in the list would eat the line height.
    expect(classes).toContain('text-sm')
    expect(classes).toContain('leading-[1.35]')
  })

  it('lets a call site override the size, as the mobile search grid does', () => {
    render(
      <GalleryCardTitle className="text-[12.5px]!" data-testid="title">
        Warrior
      </GalleryCardTitle>,
    )

    expect(screen.getByTestId('title')).toHaveClass('text-[12.5px]!')
  })
})

describe('GalleryCardRow', () => {
  it('spreads its children apart on one line', () => {
    render(<GalleryCardRow data-testid="row">body</GalleryCardRow>)
    const row = screen.getByTestId('row')

    expect(row.tagName).toBe('DIV')
    expect(row).toHaveClass(
      'flex',
      'items-center',
      'justify-between',
      'gap-1.5',
    )
  })

  it('accepts the mt-auto the mockups use to bottom-align attribution', () => {
    render(<GalleryCardRow className="mt-auto" data-testid="row" />)

    expect(screen.getByTestId('row')).toHaveClass('mt-auto', 'justify-between')
  })
})

describe('GalleryCardAttrib', () => {
  it('is a non-wrapping run that yields width to its neighbour', () => {
    render(
      <GalleryCardAttrib data-testid="attrib">JA · 12m ago</GalleryCardAttrib>,
    )
    const attrib = screen.getByTestId('attrib')

    expect(attrib.tagName).toBe('SPAN')
    expect(attrib).toHaveClass(
      'flex',
      'min-w-0',
      'items-center',
      'gap-[5px]',
      'whitespace-nowrap',
    )
  })
})

describe('the assembled card', () => {
  it('links only the top half, leaving the bottom row interactive', () => {
    render(
      <GalleryCard data-testid="card">
        <GalleryCardLink data-testid="link" href="/movies/m1">
          <Poster seed="m1" shape="tall" />
          <GalleryCardTitle>Scary Movie</GalleryCardTitle>
        </GalleryCardLink>
        <GalleryCardRow className="mt-auto">
          <GalleryCardAttrib>
            <PersonAvatar initials="JA" size="xs" />
            <span className="font-mono text-mono-sm text-ink-3">12m ago</span>
          </GalleryCardAttrib>
          <Button variant="ghost">Watch</Button>
        </GalleryCardRow>
      </GalleryCard>,
    )

    const card = screen.getByTestId('card')
    const link = screen.getByTestId('link')
    const watch = screen.getByRole('button', { name: 'Watch' })

    // The card itself is never the anchor — a single wrapping <a> would nest
    // the Watch button inside a link.
    expect(card.tagName).toBe('DIV')
    expect(card.closest('a')).toBeNull()

    expect(link).toContainElement(screen.getByText('Scary Movie'))
    expect(link).not.toContainElement(watch)
    expect(watch.closest('a')).toBeNull()

    // And exactly one anchor in the whole card, the top half.
    expect(card.querySelectorAll('a')).toHaveLength(1)
  })
})
