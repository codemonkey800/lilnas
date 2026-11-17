import { fireEvent, render, screen } from '@testing-library/react'

import { Note } from 'src/note'

describe('Note', () => {
  it.each(['accent', 'ok', 'warn'] as const)(
    'is a status for the %s tone',
    tone => {
      render(<Note lead="Heads up." tone={tone} />)

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    },
  )

  it('is an alert for the bad tone', () => {
    render(<Note lead="Auth failed." tone="bad" />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('defaults to accent and tints fill and lead by tone', () => {
    const { rerender } = render(
      <Note lead="Heads up.">Indexers are slow.</Note>,
    )

    expect(screen.getByRole('status')).toHaveClass('bg-accent-ghost')
    expect(screen.getByText('Heads up.').tagName).toBe('STRONG')
    expect(screen.getByText('Heads up.')).toHaveClass('text-accent')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Heads up. Indexers are slow.',
    )

    rerender(
      <Note lead="Disk almost full." tone="warn">
        912 GB used.
      </Note>,
    )
    expect(screen.getByRole('status')).toHaveClass('bg-warn-ghost')
    expect(screen.getByText('Disk almost full.')).toHaveClass('text-warn')
  })

  it('renders an icon when given', () => {
    render(<Note icon={<svg data-testid="icon" />} lead="Done." tone="ok" />)

    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('has no dismiss button without onDismiss', () => {
    render(<Note lead="Heads up." />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders a labelled × button that calls onDismiss', () => {
    const onDismiss = jest.fn()
    render(<Note lead="Heads up." onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
