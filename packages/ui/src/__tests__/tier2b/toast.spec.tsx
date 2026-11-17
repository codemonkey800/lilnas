import { act, fireEvent, render, screen } from '@testing-library/react'

import type { ShowToastOptions } from 'src/toast'
import { ToastProvider, useToast } from 'src/toast'

function Fire({ opts }: { opts: ShowToastOptions }) {
  const { show } = useToast()

  return (
    <button onClick={() => show(opts)} type="button">
      fire
    </button>
  )
}

function setup(opts: ShowToastOptions) {
  render(
    <ToastProvider>
      <Fire opts={opts} />
    </ToastProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'fire' }))
}

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('shows a title and a truncated detail in a polite status region', () => {
    setup({ title: 'Routine saved', detail: 'Pushed to 3 devices' })

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Routine saved')).toHaveClass('truncate')
    expect(screen.getByText('Pushed to 3 devices')).toHaveClass(
      'truncate',
      'text-ink-3',
    )
  })

  it('tints the inset edge bar by tone', () => {
    setup({ title: 'Heads up', tone: 'warn' })

    expect(
      screen.getByText('Heads up').closest('[class*="before:bg-"]'),
    ).toHaveClass('before:bg-warn', 'before:rounded-full')
  })

  it('auto-dismisses after 2200ms', () => {
    setup({ title: 'Routine saved' })

    act(() => jest.advanceTimersByTime(2199))
    expect(screen.getByText('Routine saved')).toBeInTheDocument()

    act(() => jest.advanceTimersByTime(1))
    act(() => jest.runOnlyPendingTimers())
    expect(screen.queryByText('Routine saved')).not.toBeInTheDocument()
  })

  it('keeps a bad toast until it is dismissed', () => {
    setup({ title: 'Download failed', tone: 'bad' })

    act(() => jest.advanceTimersByTime(60_000))
    expect(screen.getByText('Download failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    act(() => jest.runOnlyPendingTimers())
    expect(screen.queryByText('Download failed')).not.toBeInTheDocument()
  })

  it('dismisses with the × button before the timeout', () => {
    setup({ title: 'Routine saved' })

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    act(() => jest.runOnlyPendingTimers())
    expect(screen.queryByText('Routine saved')).not.toBeInTheDocument()
  })

  it('honours an explicit timeout', () => {
    setup({ title: 'Quick', timeout: 500 })

    act(() => jest.advanceTimersByTime(500))
    act(() => jest.runOnlyPendingTimers())
    expect(screen.queryByText('Quick')).not.toBeInTheDocument()
  })
})
