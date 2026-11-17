import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import {
  CastPerson,
  MASKED_INITIALS,
  PersonAvatar,
  type PersonAvatarProps,
} from 'src/components/ui/person-avatar'
import { UNKNOWN_VALUE } from 'src/lib/format'

describe('PersonAvatar', () => {
  describe('tag choice', () => {
    it('renders no link when there is no href', () => {
      render(<PersonAvatar initials="JA" />)

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'JA' })).toBeInTheDocument()
    })

    it('wraps the avatar in an <a> when a call site opts into linking', () => {
      render(<PersonAvatar href="/profile" initials="JA" />)
      const link = screen.getByRole('link', { name: 'JA' })

      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href', '/profile')
    })

    it('keeps the initials as the accessible name, and the title a tooltip', () => {
      render(
        <PersonAvatar href="/profile" initials="JA" title="jeremy@lilnas.io" />,
      )

      expect(screen.getByRole('link', { name: 'JA' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'JA' })).toHaveAttribute(
        'title',
        'jeremy@lilnas.io',
      )
    })
  })

  describe('hidden', () => {
    it('renders the dashed outline and no initials', () => {
      render(<PersonAvatar hidden />)
      const mask = screen.getByRole('img')

      expect(mask).toHaveClass('border-dashed', 'text-ink-4')
      expect(mask.textContent).toBe(MASKED_INITIALS)
    })

    it('masks with the mockup glyph, not the empty-text em dash', () => {
      expect(MASKED_INITIALS).toBe('–')
      expect(MASKED_INITIALS).not.toBe(UNKNOWN_VALUE)
    })

    it('never sets the native hidden attribute', () => {
      render(<PersonAvatar hidden />)

      expect(screen.getByRole('img')).not.toHaveAttribute('hidden')
      expect(screen.getByRole('img')).toBeVisible()
    })

    it('is not dashed when the identity is known', () => {
      render(<PersonAvatar initials="JA" />)

      expect(screen.getByRole('img')).not.toHaveClass('border-dashed')
    })

    it('rejects href and initials alongside hidden at the type level', () => {
      // @ts-expect-error - a masked identity has no profile to link to.
      const withHref = <PersonAvatar hidden href="/profile" />
      // @ts-expect-error - a masked identity must not leak initials.
      const withInitials = <PersonAvatar hidden initials="JA" />

      expect(withHref).toBeTruthy()
      expect(withInitials).toBeTruthy()
    })

    it('still refuses to render a link if the types are bypassed', () => {
      const smuggled = {
        hidden: true,
        href: '/profile',
      } as unknown as PersonAvatarProps

      render(<PersonAvatar {...smuggled} />)

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('size', () => {
    it('defaults to the package 24px', () => {
      render(<PersonAvatar initials="JA" />)

      expect(screen.getByRole('img')).toHaveClass('size-6')
    })

    it.each([
      ['xs', ['size-[18px]', 'text-[8.5px]']],
      ['md', ['size-[30px]', 'text-cap']],
    ] as const)('gives %s its own size and type', (size, expected) => {
      render(<PersonAvatar initials="JA" size={size} />)

      expect(screen.getByRole('img')).toHaveClass(...expected)
    })

    it('lets a call site override the size through className', () => {
      render(<PersonAvatar className="size-[52px] text-[18px]" initials="JA" />)

      expect(screen.getByRole('img')).toHaveClass('size-[52px]', 'text-[18px]')
      expect(screen.getByRole('img')).not.toHaveClass('size-6')
    })
  })

  it('fills with the accent for the viewer', () => {
    render(<PersonAvatar initials="JA" ring />)

    expect(screen.getByRole('img')).toHaveClass('bg-accent')
  })

  it('spreads remaining props onto the avatar', () => {
    render(
      <PersonAvatar
        data-testid="requester"
        initials="JA"
        title="Jeremy · you"
      />,
    )

    expect(screen.getByTestId('requester')).toHaveAttribute(
      'title',
      'Jeremy · you',
    )
  })
})

describe('CastPerson', () => {
  it('pairs a medium avatar with the credited name', () => {
    const { container } = render(<CastPerson initials="ML" name="Mara Lin" />)
    const root = container.firstElementChild

    expect(root).toHaveClass('flex', 'shrink-0', 'items-center', 'gap-2')
    expect(root).toHaveTextContent('Mara Lin')
    expect(screen.getByRole('img', { name: 'ML' })).toHaveClass('size-[30px]')
    expect(container.querySelector('img')).toBeNull()
  })

  it('draws a headshot over the initials, which stay underneath', () => {
    const { container } = render(
      <CastPerson
        imageUrl="https://image.tmdb.org/t/p/w185/ml.jpg"
        initials="ML"
        name="Mara Lin"
      />,
    )
    const img = container.querySelector('img')

    expect(img).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/ml.jpg')
    // Decorative: the name beside it is the accessible label.
    expect(img).toHaveAttribute('alt', '')
    expect(container).toHaveTextContent('ML')
  })

  it('puts the role on a second line under the name', () => {
    render(<CastPerson initials="ML" name="Mara Lin" role="Captain Ives" />)

    expect(screen.getByText('Mara Lin')).toHaveClass('text-sm')
    expect(screen.getByText('Captain Ives')).toHaveClass(
      'text-cap',
      'text-ink-3',
    )
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

    expect(container.firstElementChild).toHaveClass('w-40')
    expect(screen.getByTestId('cast')).toBeInTheDocument()
  })
})
