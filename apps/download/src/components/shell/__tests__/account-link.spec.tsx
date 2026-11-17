import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AccountLink } from 'src/components/shell/account-link'
import { PROFILE_HREF } from 'src/lib/profile-filters'

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: 'Your account' })
}

describe('AccountLink', () => {
  it('is a menu trigger wearing the viewer’s avatar', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)

    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('derives the initials from the viewer email', () => {
    render(<AccountLink email="jeremy.asuncion@lilnas.io" />)

    expect(trigger()).toHaveTextContent('JA')
  })

  it('names the account in the tooltip without leaking it into the label', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)

    expect(trigger()).toHaveAttribute('title', 'jeremy@lilnas.io · you')
    expect(trigger()).toHaveAccessibleName('Your account')
  })

  it('carries the accent fill that marks the avatar as the viewer', () => {
    render(<AccountLink email="jeremy@lilnas.io" />)

    expect(trigger().firstElementChild?.getAttribute('class')).toContain(
      'bg-accent',
    )
  })

  it('opens onto the email and the one way to the profile', async () => {
    const user = userEvent.setup()
    render(<AccountLink email="jeremy@lilnas.io" />)

    await user.click(trigger())

    expect(await screen.findByRole('menu')).toHaveTextContent(
      'jeremy@lilnas.io',
    )
    expect(
      screen.getByRole('menuitem', { name: 'Your profile' }),
    ).toHaveAttribute('href', PROFILE_HREF)
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
  })

  it('merges a className onto the trigger', () => {
    render(<AccountLink className="max-md:hidden" email="jeremy@lilnas.io" />)

    expect(trigger()).toHaveClass('max-md:hidden')
  })
})
