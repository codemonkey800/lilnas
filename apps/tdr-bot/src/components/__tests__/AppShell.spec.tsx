import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AppShell } from 'src/components/AppShell'

const mockPathname = jest.fn<string, []>()

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

const LABELS = ['Settings', 'Transcript', 'Reminders', 'Emojis', 'Playground']

describe('AppShell', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/settings')
  })

  it('renders the doorplate and the page content in main', () => {
    render(
      <AppShell>
        <p>page body</p>
      </AppShell>,
    )

    expect(
      screen.getByRole('link', { name: 'tdr.lilnas.io' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('page body')
  })

  it('lists every section as a link in the primary navigation', () => {
    render(<AppShell>{null}</AppShell>)

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    const links = within(nav).getAllByRole('link')

    expect(links.map(link => link.textContent)).toEqual(LABELS)
    expect(
      within(nav).getByRole('link', { name: 'Reminders' }),
    ).toHaveAttribute('href', '/reminders')
  })

  it('marks the link for the current path, including nested paths', () => {
    mockPathname.mockReturnValue('/transcript/abc')
    render(<AppShell>{null}</AppShell>)

    const nav = screen.getByRole('navigation', { name: 'Primary' })

    expect(
      within(nav).getByRole('link', { name: 'Transcript' }),
    ).toHaveAttribute('aria-current', 'page')
    for (const label of LABELS.filter(l => l !== 'Transcript')) {
      expect(
        within(nav).getByRole('link', { name: label }),
      ).not.toHaveAttribute('aria-current')
    }
  })

  it('opens a sheet of the same links from the phone trigger', async () => {
    mockPathname.mockReturnValue('/emojis')
    const user = userEvent.setup()
    render(<AppShell>{null}</AppShell>)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))

    const sheet = await screen.findByRole('dialog')
    const links = within(sheet).getAllByRole('link')

    expect(links.map(link => link.textContent)).toEqual(LABELS)
    expect(within(sheet).getByRole('link', { name: 'Emojis' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(sheet).getByRole('link', { name: 'Settings' }),
    ).not.toHaveAttribute('aria-current')
  })

  it('closes the sheet after a link is chosen', async () => {
    const user = userEvent.setup()
    render(<AppShell>{null}</AppShell>)

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('link', { name: 'Playground' }))

    await screen.findByRole('button', { name: 'Open navigation' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
