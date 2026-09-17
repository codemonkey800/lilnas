import { render, screen } from '@testing-library/react'

import { AccountLink } from 'src/components/shell/account-link'
import { PROFILE_HREF } from 'src/lib/profile-filters'

describe('AccountLink', () => {
  it('is an <a>, not a <button> — it navigates', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)
    const link = screen.getByRole('link', { name: 'Your account' })

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', PROFILE_HREF)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('derives the initials from the viewer email', () => {
    render(<AccountLink email="jeremy.asuncion@lilnas.io" />)

    expect(
      screen.getByRole('link', { name: 'Your account' }),
    ).toHaveTextContent('JA')
  })

  it('names the account in the tooltip without leaking it into the label', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)
    const link = screen.getByRole('link', { name: 'Your account' })

    expect(link).toHaveAttribute('title', 'jeremy@lilnas.io · you')
  })

  it('carries the uv ring that marks the avatar as the viewer', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)
    const avatar = screen.getByRole('link', {
      name: 'Your account',
    }).firstElementChild

    expect(avatar?.getAttribute('class')).toContain(
      'shadow-[0_0_0_2px_var(--color-bg-sunk),0_0_0_4px_var(--color-uv)]',
    )
  })

  it('renders one avatar, not a nested link inside a link', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)

    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(
      screen.getByRole('link', { name: 'Your account' }).firstElementChild
        ?.tagName,
    ).toBe('SPAN')
  })

  it('is a 32px plate on mobile and a 30px plateless mark on desktop', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)
    const classes =
      screen
        .getByRole('link', { name: 'Your account' })
        .getAttribute('class') ?? ''

    expect(classes).toContain('h-8')
    expect(classes).toContain('w-8')
    expect(classes).toContain('rounded-md')
    expect(classes).toContain('hover:bg-surface-2')
    expect(classes).toContain('sm:h-[30px]')
    expect(classes).toContain('sm:w-[30px]')
    expect(classes).toContain('sm:rounded-full')
    expect(classes).toContain('sm:hover:bg-transparent')
  })

  it('keeps both avatar sizes, so the mark grows with the plate', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)
    const classes =
      screen
        .getByRole('link', { name: 'Your account' })
        .firstElementChild?.getAttribute('class') ?? ''

    expect(classes).toContain('h-6')
    expect(classes).toContain('text-[10.5px]')
    expect(classes).toContain('sm:h-[30px]')
    expect(classes).toContain('sm:text-[11.5px]')
  })

  it('spreads remaining props and lets a call site override href', () => {
    render(
      <AccountLink
        className="ml-2"
        data-testid="account"
        email="jeremy@lilnas.io"
        href="/profile/me"
      />,
    )
    const link = screen.getByTestId('account')

    expect(link).toHaveAttribute('href', '/profile/me')
    expect(link).toHaveClass('ml-2')
  })
})
