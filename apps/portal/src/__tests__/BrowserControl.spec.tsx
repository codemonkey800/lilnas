import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  fetchBrowserStatus,
  powerOffBrowser,
  powerOnBrowser,
} from 'src/app/browser/actions'
import { BrowserControl } from 'src/components/BrowserControl'
import type { BrowserStatus } from 'src/utils/browser'

jest.mock('src/app/browser/actions', () => ({
  fetchBrowserStatus: jest.fn(),
  powerOnBrowser: jest.fn(),
  powerOffBrowser: jest.fn(),
}))

const mockOn = jest.mocked(powerOnBrowser)
const mockOff = jest.mocked(powerOffBrowser)

function renderControl(initialStatus: BrowserStatus) {
  return render(
    <BrowserControl
      browserUrl="https://browser.lilnas.io"
      idleTimeoutMinutes={30}
      initialStatus={initialStatus}
      maxUptimeHours={4}
    />,
  )
}

const dot = () => screen.getByTestId('browser-status-dot')

describe('BrowserControl', () => {
  it('renders Not installed with a bad dot, the command and no action', () => {
    renderControl({ state: 'missing' })

    expect(screen.getByRole('heading', { name: 'Not installed' })).toBeVisible()
    expect(dot()).toHaveClass('bg-bad')
    expect(screen.getByText('docker compose up -d browser')).toHaveClass(
      'font-mono',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders Stopped with an idle dot and an accent Turn on', () => {
    renderControl({ state: 'stopped' })

    expect(screen.getByRole('heading', { name: 'Stopped' })).toBeVisible()
    expect(dot()).toHaveClass('bg-ink-4')
    expect(screen.getByRole('button', { name: 'Turn on' })).toHaveClass(
      'bg-accent',
    )
    expect(screen.queryByText('Open browser')).not.toBeInTheDocument()
  })

  it('renders Starting with a warn dot, progress copy and Turn off', () => {
    renderControl({ state: 'starting' })

    expect(screen.getByRole('heading', { name: 'Starting…' })).toBeVisible()
    expect(dot()).toHaveClass('bg-warn')
    expect(screen.getByText(/Waiting for the browser/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeVisible()
  })

  it('renders Running with a pulsing ok dot, Open browser and a countdown', () => {
    renderControl({ state: 'running', autoStopAt: Date.now() + 12 * 60_000 })

    expect(screen.getByRole('heading', { name: 'Running' })).toBeVisible()
    expect(dot()).toHaveClass('bg-ok')
    expect(dot()).toHaveAttribute('data-pulse')
    expect(screen.getByText(/stops in 12 min/)).toBeVisible()

    const open = screen.getByRole('link', { name: 'Open browser' })
    expect(open).toHaveAttribute('href', 'https://browser.lilnas.io')
    expect(open).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeVisible()
  })

  it('shows the idle and uptime limits in mono', () => {
    renderControl({ state: 'stopped' })

    expect(screen.getByText('30 min')).toHaveClass('font-mono')
    expect(screen.getByText('4 h')).toHaveClass('font-mono')
  })

  it('disables the button and swaps its label while an action is working', async () => {
    let resolve: (status: BrowserStatus) => void = () => undefined
    mockOn.mockReturnValue(new Promise(r => (resolve = r)))
    const user = userEvent.setup()
    renderControl({ state: 'stopped' })

    await user.click(screen.getByRole('button', { name: 'Turn on' }))

    const working = screen.getByRole('button', { name: 'Turning on' })
    expect(working).toHaveAttribute('aria-busy', 'true')
    expect(working).toHaveAttribute('aria-disabled', 'true')

    // A second press while in flight does nothing.
    await user.click(working)
    expect(mockOn).toHaveBeenCalledTimes(1)

    await act(async () => resolve({ state: 'starting' }))

    expect(screen.getByRole('heading', { name: 'Starting…' })).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Turn off' }),
    ).not.toHaveAttribute('aria-busy')
  })

  it('turns the browser off from running', async () => {
    mockOff.mockResolvedValue({ state: 'stopped' })
    const user = userEvent.setup()
    renderControl({ state: 'running' })

    await user.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(mockOff).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole('heading', { name: 'Stopped' }),
    ).toBeVisible()
  })

  it('shows a bad note when an action fails and keeps the status', async () => {
    mockOn.mockRejectedValue(new Error('ENOENT /var/run/docker.sock'))
    const user = userEvent.setup()
    renderControl({ state: 'stopped' })

    await user.click(screen.getByRole('button', { name: 'Turn on' }))

    const note = await screen.findByRole('alert')
    expect(note).toHaveTextContent("Couldn't turn it on.")
    expect(note).toHaveClass('bg-bad-ghost')
    expect(screen.getByText('ENOENT /var/run/docker.sock')).toHaveClass(
      'font-mono',
    )
    expect(screen.getByRole('heading', { name: 'Stopped' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Turn on' })).not.toHaveAttribute(
      'aria-busy',
    )
  })

  it('polls the status every 5 seconds', async () => {
    jest.useFakeTimers()
    try {
      jest.mocked(fetchBrowserStatus).mockResolvedValue({ state: 'running' })
      renderControl({ state: 'stopped' })

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000)
      })

      expect(fetchBrowserStatus).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('heading', { name: 'Running' })).toBeVisible()
    } finally {
      jest.useRealTimers()
    }
  })
})
