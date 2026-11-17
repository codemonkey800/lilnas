import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { iconBody } from 'src/__tests__/helpers/icon'
import { DeleteButton } from 'src/components/ui/delete-button'

describe('DeleteButton', () => {
  it('is the filled red confirm, with a trailing trash', () => {
    const { container } = render(<DeleteButton />)

    const button = screen.getByRole('button', { name: 'Delete' })

    expect(button).toHaveClass('bg-bad', 'text-bg-sunk')
    expect(button).not.toHaveClass('bg-accent', 'bg-bad-ghost')
    expect(container.querySelector('svg')?.innerHTML).toBe(iconBody('trash'))
  })

  it('steps its fill on hover and press instead of lifting', () => {
    render(<DeleteButton />)

    const button = screen.getByRole('button', { name: 'Delete' })

    expect(button).toHaveClass('hover:bg-bad/85', 'active:bg-bad/75')
    expect(button).not.toHaveClass('hover:bg-accent-hi')
  })

  it('takes the small size', () => {
    render(<DeleteButton />)

    expect(screen.getByRole('button')).toHaveClass('h-(--control-h-sm)')
  })

  it('stretches for the stacked mobile layout', () => {
    render(<DeleteButton full />)

    expect(screen.getByRole('button')).toHaveClass('w-full')
  })

  it('takes a replacement label and fires onClick', async () => {
    const user = userEvent.setup()
    const onClick = jest.fn()

    render(<DeleteButton onClick={onClick}>Delete series</DeleteButton>)

    await user.click(screen.getByRole('button', { name: 'Delete series' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('swallows a click while aria-disabled', async () => {
    const user = userEvent.setup()
    const onClick = jest.fn()

    render(<DeleteButton aria-disabled onClick={onClick} />)

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('merges a caller class over the fill', () => {
    render(<DeleteButton className="bg-transparent" />)

    expect(screen.getByRole('button')).toHaveClass('bg-transparent')
    expect(screen.getByRole('button')).not.toHaveClass('bg-bad')
  })
})
