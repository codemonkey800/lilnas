import '@testing-library/jest-dom'

import { DownloadJobStatus } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import type { ChipTone } from 'src/components/ui/chip'
import { Chip } from 'src/components/ui/chip'
import { statusTone } from 'src/lib/format'

function renderChip(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  const chip = container.firstElementChild

  if (!(chip instanceof HTMLElement)) {
    throw new Error('expected the chip to be the only root element')
  }

  return chip
}

function borderColorClasses(element: Element): string[] {
  return Array.from(element.classList).filter(
    name =>
      name.startsWith('border-uv') ||
      name.startsWith('border-ok') ||
      name.startsWith('border-warn') ||
      name.startsWith('border-bad') ||
      name === 'border-line' ||
      name === 'border-transparent',
  )
}

describe('Chip', () => {
  it('renders an inert <span> by default', () => {
    const chip = renderChip(<Chip label="queued" />)

    expect(chip.tagName.toLowerCase()).toBe('span')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(chip).not.toHaveAttribute('aria-pressed')
  })

  it('renders a real <button> when interactive', () => {
    const chip = renderChip(<Chip interactive label="movies" />)

    expect(chip.tagName.toLowerCase()).toBe('button')
    expect(chip).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: 'movies' })).toBe(chip)
  })

  it('mirrors active onto aria-pressed', () => {
    expect(renderChip(<Chip interactive label="movies" />)).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('reports aria-pressed="true" for an active interactive chip', () => {
    expect(
      renderChip(<Chip active interactive label="movies" />),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('fires onClick when interactive', async () => {
    const onClick = jest.fn()
    const user = userEvent.setup()

    render(<Chip interactive label="movies" onClick={onClick} />)

    await user.click(screen.getByRole('button', { name: 'movies' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('only adds the pointer affordance when interactive', () => {
    expect(renderChip(<Chip label="queued" tone="mute" />)).not.toHaveClass(
      'cursor-pointer',
    )
    expect(renderChip(<Chip interactive label="movies" />)).toHaveClass(
      'cursor-pointer',
    )
  })

  describe('tones', () => {
    const cases: Array<[ChipTone, string, string, string]> = [
      ['uv', 'bg-uv-ghost', 'text-uv-hi', 'border-uv/30'],
      ['ok', 'bg-ok-ghost', 'text-ok', 'border-ok/30'],
      ['warn', 'bg-warn-ghost', 'text-warn', 'border-warn/30'],
      ['bad', 'bg-bad-ghost', 'text-bad', 'border-bad/32'],
      ['mute', 'bg-surface-2', 'text-ink-3', 'border-line'],
    ]

    it.each(cases)(
      '%s owns its own fill, ink and border colour',
      (tone, fill, ink, border) => {
        const chip = renderChip(<Chip label="x" tone={tone} />)

        expect(chip).toHaveClass(fill, ink, border)
        expect(borderColorClasses(chip)).toEqual([border])
      },
    )

    /**
     * Sibling regression to `Button`'s: `cns` is `twMerge(clsx(...))`, which
     * left unconfigured classifies this theme's custom `--text-*` tokens as
     * text *colours* and silently drops one of the pair when a size token
     * meets an ink colour. `Chip` states its type as the arbitrary
     * `text-[11px]`, so it was never exposed even before
     * `packages/utils/src/cns.ts` fixed the classification. Asserted off the
     * rendered `class` attribute, since that is the only place the collision
     * would show.
     */
    it.each<ChipTone>(['uv', 'ok', 'warn', 'bad', 'mute'])(
      'keeps its size and mono face after the %s tint is applied',
      tone => {
        const chip = renderChip(<Chip label="x" tone={tone} />)

        expect(chip).toHaveClass('text-[11px]', 'font-mono')
      },
    )

    it('renders an untinted chip with no tone', () => {
      const chip = renderChip(<Chip label="x" />)

      expect(borderColorClasses(chip)).toEqual(['border-transparent'])
      expect(chip).not.toHaveClass('bg-uv-ghost')
    })

    it('accepts every tone statusTone can produce', () => {
      for (const status of Object.values(DownloadJobStatus)) {
        const tone: ChipTone = statusTone(status)

        expect(renderChip(<Chip label={status} tone={tone} />)).toHaveClass(
          'inline-flex',
        )
      }
    })
  })

  describe('active', () => {
    it('overrides a status tone entirely', () => {
      const chip = renderChip(<Chip active label="failed" tone="bad" />)

      expect(chip).toHaveClass('bg-uv-ghost', 'text-uv-hi', 'border-uv/35')
      expect(chip).not.toHaveClass('bg-bad-ghost')
      expect(chip).not.toHaveClass('text-bad')
      expect(borderColorClasses(chip)).toEqual(['border-uv/35'])
    })

    it('uses the stronger hover cue when active and interactive', () => {
      const chip = renderChip(<Chip active interactive label="movies" />)

      expect(chip).toHaveClass('hover:border-uv/55')
      expect(chip).not.toHaveClass('hover:border-uv-dim')
    })

    it('uses the idle hover cue when inactive and interactive', () => {
      const chip = renderChip(<Chip interactive label="movies" />)

      expect(chip).toHaveClass('hover:border-uv-dim', 'hover:bg-surface-2')
      expect(chip).not.toHaveClass('hover:border-uv/55')
    })
  })

  describe('content', () => {
    it('renders an icon before the label', () => {
      const chip = renderChip(<Chip icon="film" label="movie" />)

      expect(chip.firstElementChild?.tagName.toLowerCase()).toBe('svg')
      expect(chip.querySelector('use')).toHaveAttribute('href', '#i-film')
      expect(chip).toHaveTextContent('movie')
    })

    it('sizes the icon to the chip', () => {
      const chip = renderChip(<Chip icon="film" label="movie" />)

      expect(chip.querySelector('svg')).toHaveClass('h-[11px]', 'w-[11px]')
    })

    it('renders children after the label', () => {
      expect(
        renderChip(
          <Chip label="99">
            <span>%</span>
          </Chip>,
        ),
      ).toHaveTextContent('99%')
    })
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    const chip = renderChip(
      <Chip className="ml-auto" data-testid="badge" label="queued" />,
    )

    expect(chip).toHaveClass('ml-auto', 'inline-flex')
    expect(chip).toHaveAttribute('data-testid', 'badge')
  })
})
