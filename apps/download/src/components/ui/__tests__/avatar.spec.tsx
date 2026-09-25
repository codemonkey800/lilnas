import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import {
  Avatar,
  type AvatarProps,
  CastPerson,
  MASKED_INITIALS,
} from 'src/components/ui/avatar'
import { UNKNOWN_VALUE } from 'src/lib/format'

function requireRoot(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild

  if (!(element instanceof HTMLElement)) {
    throw new Error('expected a rendered root element')
  }

  return element
}

describe('Avatar', () => {
  describe('tag choice', () => {
    it('renders a <span> when there is no href', () => {
      const { container } = render(<Avatar initials="JA" />)
      const root = requireRoot(container)

      expect(root.tagName).toBe('SPAN')
      expect(root).not.toHaveAttribute('href')
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('renders an <a> when a call site opts into linking', () => {
      render(<Avatar href="/profile" initials="JA" />)
      const link = screen.getByRole('link', { name: 'JA' })

      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href', '/profile')
    })

    it('only carries the hover treatment when it is a link', () => {
      const hover = [
        'transition-[border-color,background-color]',
        'duration-200',
        'ease-uv',
        'hover:border-uv-dim',
        'hover:bg-surface-2',
      ]

      const { container: linked } = render(
        <Avatar href="/profile" initials="JA" />,
      )
      expect(requireRoot(linked)).toHaveClass(...hover)

      const { container: inert } = render(<Avatar initials="JA" />)
      expect(requireRoot(inert)).not.toHaveClass(...hover)
    })
  })

  describe('hidden', () => {
    it('renders the dashed outline and no initials', () => {
      const { container } = render(<Avatar hidden />)
      const root = requireRoot(container)

      expect(root).toHaveClass('border-dashed', 'text-ink-4')
      expect(root).toHaveTextContent(new RegExp(`^${MASKED_INITIALS}$`))
      expect(root.textContent).toBe(MASKED_INITIALS)
    })

    it('masks with the mockup glyph, not the empty-text em dash', () => {
      expect(MASKED_INITIALS).toBe('–')
      expect(MASKED_INITIALS).not.toBe(UNKNOWN_VALUE)
    })

    it('never sets the native hidden attribute', () => {
      const { container } = render(<Avatar hidden />)
      const root = requireRoot(container)

      expect(root).not.toHaveAttribute('hidden')
      expect(root).toBeVisible()
    })

    it('is not dashed when the identity is known', () => {
      const { container } = render(<Avatar initials="JA" />)

      expect(requireRoot(container)).not.toHaveClass('border-dashed')
    })
  })

  describe('hidden + href is impossible', () => {
    it('rejects href alongside hidden at the type level', () => {
      // @ts-expect-error - a masked identity has no profile to link to.
      const invalid = <Avatar hidden href="/profile" />

      expect(invalid).toBeTruthy()
    })

    it('rejects initials alongside hidden at the type level', () => {
      // @ts-expect-error - a masked identity must not leak initials.
      const invalid = <Avatar hidden initials="JA" />

      expect(invalid).toBeTruthy()
    })

    it('still refuses to render an anchor if the types are bypassed', () => {
      const smuggled = {
        hidden: true,
        href: '/profile',
      } as unknown as AvatarProps

      const { container } = render(<Avatar {...smuggled} />)
      const root = requireRoot(container)

      expect(root.tagName).toBe('SPAN')
      expect(root).not.toHaveAttribute('href')
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('size', () => {
    it('defaults to the 24px triple', () => {
      const { container } = render(<Avatar initials="JA" />)

      expect(requireRoot(container)).toHaveClass('h-6', 'w-6', 'text-[10.5px]')
    })

    it.each([
      ['xs', ['h-[18px]', 'w-[18px]', 'text-[8.5px]']],
      ['md', ['h-[30px]', 'w-[30px]', 'text-[12px]']],
    ] as const)(
      'gives %s its own height, width and font size',
      (size, expected) => {
        const { container } = render(<Avatar initials="JA" size={size} />)

        expect(requireRoot(container)).toHaveClass(...expected)
      },
    )

    it('lets a call site override the size through className', () => {
      const { container } = render(
        <Avatar className="h-[52px] w-[52px] text-[18px]" initials="JA" />,
      )
      const root = requireRoot(container)

      expect(root).toHaveClass('h-[52px]', 'w-[52px]', 'text-[18px]')
      expect(root).not.toHaveClass('h-6', 'w-6', 'text-[10.5px]')
    })
  })

  describe('ring', () => {
    it('is a two-layer box shadow rather than a border', () => {
      const { container } = render(<Avatar initials="JA" ring />)

      expect(requireRoot(container)).toHaveClass(
        'shadow-[0_0_0_2px_var(--color-bg-sunk),0_0_0_4px_var(--color-uv)]',
      )
    })

    it('is absent by default', () => {
      const { container } = render(<Avatar initials="JA" />)

      expect(requireRoot(container).className).not.toContain('shadow-')
    })
  })

  it('spreads remaining props onto the root element', () => {
    const { container } = render(
      <Avatar
        data-testid="requester"
        initials="JA"
        ring
        title="Jeremy · you"
      />,
    )
    const root = requireRoot(container)

    expect(root).toHaveAttribute('data-testid', 'requester')
    expect(root).toHaveAttribute('title', 'Jeremy · you')
  })
})

describe('CastPerson', () => {
  it('pairs a medium avatar with the credited name', () => {
    const { container } = render(<CastPerson initials="ML" name="Mara Lin" />)
    const root = requireRoot(container)

    expect(root.tagName).toBe('DIV')
    expect(root).toHaveClass('flex', 'shrink-0', 'items-center', 'gap-2')
    expect(root).toHaveTextContent('Mara Lin')

    const avatar = root.firstElementChild

    expect(avatar).toHaveClass('h-[30px]', 'w-[30px]', 'text-[12px]')
    expect(avatar).toHaveTextContent('ML')
  })

  it('renders the name at the theme text-sm scale', () => {
    render(<CastPerson initials="ML" name="Mara Lin" />)

    expect(screen.getByText('Mara Lin')).toHaveClass('text-sm')
  })

  it('spreads remaining props onto the root element', () => {
    const { container } = render(
      <CastPerson
        className="w-40"
        data-testid="cast"
        initials="ML"
        name="Mara Lin"
      />,
    )
    const root = requireRoot(container)

    expect(root).toHaveClass('w-40')
    expect(root).toHaveAttribute('data-testid', 'cast')
  })
})
