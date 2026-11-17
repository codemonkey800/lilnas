import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Tooltip } from 'src/tooltip'

function Example() {
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger>Pause</Tooltip.Trigger>
        <Tooltip.Popup>Pause all downloads</Tooltip.Popup>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

describe('Tooltip', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('opens on hover only after the 400ms delay', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    render(<Example />)

    await user.hover(screen.getByRole('button', { name: 'Pause' }))
    act(() => jest.advanceTimersByTime(399))
    expect(screen.queryByText('Pause all downloads')).not.toBeInTheDocument()

    act(() => jest.advanceTimersByTime(1))
    const popup = await screen.findByText('Pause all downloads')
    expect(popup).toHaveClass('bg-surface-2', 'border-line-loud', 'shadow-lift')
  })

  it('opens when the trigger takes keyboard focus', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    render(<Example />)

    await user.tab()
    act(() => jest.advanceTimersByTime(400))

    expect(await screen.findByText('Pause all downloads')).toBeInTheDocument()
  })

  it('closes when the pointer leaves', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    render(<Example />)

    await user.hover(screen.getByRole('button', { name: 'Pause' }))
    act(() => jest.advanceTimersByTime(400))
    await screen.findByText('Pause all downloads')

    await user.unhover(screen.getByRole('button', { name: 'Pause' }))
    act(() => jest.runOnlyPendingTimers())
    expect(screen.queryByText('Pause all downloads')).not.toBeInTheDocument()
  })

  it('opens the next neighbour with no delay', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    render(
      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger>One</Tooltip.Trigger>
          <Tooltip.Popup>First tip</Tooltip.Popup>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>Two</Tooltip.Trigger>
          <Tooltip.Popup>Second tip</Tooltip.Popup>
        </Tooltip.Root>
      </Tooltip.Provider>,
    )

    await user.hover(screen.getByRole('button', { name: 'One' }))
    act(() => jest.advanceTimersByTime(400))
    await screen.findByText('First tip')

    await user.hover(screen.getByRole('button', { name: 'Two' }))
    act(() => jest.advanceTimersByTime(10))
    expect(await screen.findByText('Second tip')).toBeInTheDocument()
  })
})
