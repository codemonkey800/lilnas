import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { InlineConfirm } from 'src/app/components/inline-confirm'

describe('InlineConfirm', () => {
  it('shows the prompt only while confirming', async () => {
    const user = userEvent.setup()
    render(
      <InlineConfirm
        label="Tear down"
        onConfirm={jest.fn()}
        prompt="Kill active session?"
      />,
    )

    expect(screen.queryByText('Kill active session?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tear down' }))
    expect(screen.getByText('Kill active session?')).toBeInTheDocument()
  })

  it('starts as the single destructive button, with no confirm step showing', () => {
    render(
      <InlineConfirm
        label="Tear down"
        confirmLabel="Tear down"
        onConfirm={jest.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Tear down' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument()
  })

  it('swaps in place for Confirm and Cancel when pressed, without confirming yet', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(
      <InlineConfirm
        label="Restart bot"
        confirmLabel="Yes, restart"
        onConfirm={onConfirm}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Restart bot' }))

    expect(
      screen.queryByRole('button', { name: 'Restart bot' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Yes, restart' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onConfirm exactly once when Confirm is pressed', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(<InlineConfirm label="Tear down" onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Tear down' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('restores the original button on Cancel and never calls onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(<InlineConfirm label="Tear down" onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Tear down' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(
      screen.getByRole('button', { name: 'Tear down' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Confirm' }),
    ).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows Confirm busy and Cancel disabled while pending, and ignores a second Confirm', async () => {
    const user = userEvent.setup()
    const onConfirm = jest.fn()
    render(<InlineConfirm label="Tear down" onConfirm={onConfirm} pending />)

    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await user.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('forwards data-track-id to the first step and suffixes it on the confirm step', async () => {
    const user = userEvent.setup()
    render(
      <InlineConfirm
        data-track-id="session-teardown"
        label="Tear down"
        onConfirm={jest.fn()}
      />,
    )

    const first = screen.getByRole('button', { name: 'Tear down' })
    expect(first).toHaveAttribute('data-track-id', 'session-teardown')

    await user.click(first)
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveAttribute(
      'data-track-id',
      'session-teardown-confirm',
    )
  })
})
