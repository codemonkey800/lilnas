import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'

import type { ButtonSize, ButtonVariant } from '../../button'
import { Button, buttonClassName } from '../../button'

describe('Button', () => {
  it('defaults to an outline, md, type="button" button', () => {
    render(<Button>Save</Button>)

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('bg-surface-2', 'border-line', 'h-(--control-h)')
  })

  it.each<[ButtonVariant, string[]]>([
    ['accent', ['bg-accent', 'text-accent-ink', 'hover:bg-accent-hi']],
    ['outline', ['bg-surface-2', 'text-ink', 'border-line']],
    ['ghost', ['text-accent-hi', 'hover:bg-accent-ghost']],
    ['bad', ['text-bad', 'border-bad', 'hover:bg-bad-ghost']],
  ])('applies the %s variant', (variant, classes) => {
    render(<Button variant={variant}>Go</Button>)

    expect(screen.getByRole('button')).toHaveClass(...classes)
  })

  it.each<[ButtonSize, string[]]>([
    ['sm', ['h-(--control-h-sm)', 'px-[11px]', 'text-sm']],
    ['md', ['h-(--control-h)', 'px-3.5', 'text-body']],
    ['lg', ['h-11', 'px-5', 'text-[15px]']],
  ])('applies the %s size', (size, classes) => {
    render(<Button size={size}>Go</Button>)

    expect(screen.getByRole('button')).toHaveClass(...classes)
  })

  it('stretches with full', () => {
    render(<Button full>Go</Button>)

    expect(screen.getByRole('button')).toHaveClass('w-full')
  })

  it('merges className last and forwards ref and props', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button className="bg-bad" data-testid="b" ref={ref} variant="accent">
        Go
      </Button>,
    )

    const button = screen.getByTestId('b')
    expect(ref.current).toBe(button)
    expect(button).toHaveClass('bg-bad')
    expect(button).not.toHaveClass('bg-accent')
  })

  it('exposes buttonClassName for non-button elements', () => {
    expect(buttonClassName({ variant: 'accent', size: 'lg' })).toContain(
      'bg-accent',
    )
    expect(buttonClassName({ iconOnly: true })).toContain('w-(--control-h)')
  })

  describe('disabled', () => {
    it('is a real disabled button that ignores clicks', async () => {
      const onClick = jest.fn()
      render(
        <Button disabled onClick={onClick}>
          Go
        </Button>,
      )

      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(button).toHaveClass('disabled:opacity-40')
      await userEvent.click(button)
      expect(onClick).not.toHaveBeenCalled()
    })

    it('treats aria-disabled as inert but focusable', async () => {
      const onClick = jest.fn()
      render(
        <Button aria-disabled onClick={onClick}>
          Go
        </Button>,
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(button)
      expect(onClick).not.toHaveBeenCalled()
      button.focus()
      expect(button).toHaveFocus()
    })
  })

  describe('loading', () => {
    it('is aria-busy and aria-disabled and ignores clicks', async () => {
      const onClick = jest.fn()
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      )

      const button = screen.getByRole('button', { name: 'Save' })
      expect(button).toHaveAttribute('aria-busy', 'true')
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).not.toBeDisabled()
      await userEvent.click(button)
      expect(onClick).not.toHaveBeenCalled()
    })

    it('does not submit a form while loading', async () => {
      const onSubmit = jest.fn(e => e.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <Button loading type="submit">
            Save
          </Button>
        </form>,
      )

      await userEvent.click(screen.getByRole('button'))
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('swaps the leading icon for the ring without adding one', () => {
      const { container, rerender } = render(
        <Button icon="download">Get</Button>,
      )
      expect(container.querySelectorAll('svg')).toHaveLength(1)
      expect(container.querySelector('.animate-spin')).toBeNull()

      rerender(
        <Button icon="download" loading>
          Get
        </Button>,
      )
      expect(container.querySelectorAll('svg')).toHaveLength(0)
      expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
      expect(screen.getByText('Get')).toBeVisible()
    })

    it('overlays the ring and keeps the label in the layout without an icon', () => {
      const { container } = render(<Button loading>Save</Button>)

      expect(container.querySelectorAll('.animate-spin')).toHaveLength(1)
      expect(screen.getByText('Save')).toHaveClass('invisible')
    })

    it('fires onClick normally when idle', async () => {
      const onClick = jest.fn()
      render(<Button onClick={onClick}>Go</Button>)

      await userEvent.click(screen.getByRole('button'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('render', () => {
    it('swaps the element and leaves type off it', () => {
      render(
        <Button render={<a href="/queue" />} variant="accent">
          Queue
        </Button>,
      )

      const link = screen.getByRole('link', { name: 'Queue' })
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href', '/queue')
      expect(link).not.toHaveAttribute('type')
      expect(link).toHaveClass('bg-accent')
      expect(screen.queryByRole('button')).toBeNull()
    })
  })

  describe('icons', () => {
    it('renders a leading and a trailing icon', () => {
      const { container } = render(
        <Button icon="search" iconEnd="arrow">
          Find
        </Button>,
      )

      expect(container.querySelectorAll('svg')).toHaveLength(2)
    })

    it('is square when icon-only and labelled', () => {
      render(<Button aria-label="Delete" icon="trash" size="sm" />)

      expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
        'w-(--control-h-sm)',
        'h-(--control-h-sm)',
      )
    })

    it('throws in dev when icon-only has no aria-label', () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined)

      expect(() => render(<Button icon="trash" />)).toThrow(/aria-label/)
    })
  })
})
