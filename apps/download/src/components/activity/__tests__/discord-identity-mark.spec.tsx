import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  DISCORD_UNLINKED_NOTE,
  DiscordIdentityMark,
} from 'src/components/activity/discord-identity-mark'

/**
 * A real snowflake: 18 digits, past `Number.MAX_SAFE_INTEGER`. Asserted in
 * full everywhere below — this is the value an admin pastes into `apps/auth`
 * to link the account, so a truncated or rounded one is worse than none.
 */
const SNOWFLAKE = '273145016936267776'
const USERNAME = 'sam.pham'

function renderMark(): void {
  render(
    <>
      <button type="button">outside</button>
      <DiscordIdentityMark
        discordUserId={SNOWFLAKE}
        discordUsername={USERNAME}
      />
    </>,
  )
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /Discord account details/ })
}

describe('DiscordIdentityMark', () => {
  it('is a real button, not a decorative span', () => {
    const { container } = render(
      <DiscordIdentityMark
        discordUserId={SNOWFLAKE}
        discordUsername={USERNAME}
      />,
    )

    const glyph = container.querySelector('svg')

    // A bare <span>/<svg> would be unreachable by keyboard and invisible to a
    // screen reader, which is the whole reason this is a control.
    expect(glyph?.closest('button')).toBe(trigger())
    expect(trigger()).toHaveAttribute('type', 'button')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
  })

  it('names the trigger after the handle it reveals', () => {
    renderMark()

    expect(trigger()).toHaveAccessibleName(
      `Discord account details for ${USERNAME}`,
    )
  })

  it('renders no panel and no snowflake at all while closed', () => {
    renderMark()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(SNOWFLAKE)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(SNOWFLAKE)
  })

  it('opens on a click and closes on a second one', async () => {
    const user = userEvent.setup()

    renderMark()

    await user.click(trigger())

    expect(screen.getByRole('dialog')).toHaveFocus()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')

    await user.click(trigger())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('discloses both the handle and the full snowflake once open', async () => {
    const user = userEvent.setup()

    renderMark()

    await user.click(trigger())

    const panel = screen.getByRole('dialog', {
      name: `Discord account details for ${USERNAME}`,
    })
    const id = screen.getByText(SNOWFLAKE)

    // The id without the handle is unreadable; the handle without the id is
    // unactionable. Both, or the mark is pointless.
    expect(panel).toHaveTextContent(`@${USERNAME}`)
    expect(id).toHaveTextContent(SNOWFLAKE)
    expect(id).toHaveClass('font-mono', 'select-all')
    expect(panel).toHaveTextContent(DISCORD_UNLINKED_NOTE)
  })

  it('labels both fields rather than leaving two bare strings', async () => {
    const user = userEvent.setup()

    renderMark()

    await user.click(trigger())

    expect(screen.getByText('handle')).toBeInTheDocument()
    expect(screen.getByText('discord id')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()

    renderMark()

    await user.click(trigger())
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('closes on a press outside, leaving focus where it went', async () => {
    const user = userEvent.setup()

    renderMark()

    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'outside' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'outside' })).toHaveFocus()
  })

  it('stays open while the pointer works inside it', async () => {
    const user = userEvent.setup()

    renderMark()

    await user.click(trigger())
    await user.click(screen.getByText(SNOWFLAKE))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('takes no hover to open — click is the only way in', async () => {
    const user = userEvent.setup()

    renderMark()

    await user.hover(trigger())

    // Hovering is not a mechanism a finger has. It must not be load-bearing,
    // and no `title` may stand in for the panel either.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger()).not.toHaveAttribute('title')
  })

  it('lets a caller re-anchor the panel on a narrow surface', async () => {
    const user = userEvent.setup()

    render(
      <DiscordIdentityMark
        className="text-ink-3"
        discordUserId={SNOWFLAKE}
        discordUsername={USERNAME}
        panelClassName="left-auto right-0 translate-x-0"
      />,
    )

    expect(trigger()).toHaveClass('text-ink-3')

    await user.click(trigger())

    const panel = screen.getByRole('dialog')

    expect(panel).toHaveClass('right-0', 'translate-x-0')
    expect(panel).not.toHaveClass('left-1/2')
  })
})
