import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Field, Input } from 'src/components/ui/input'

function classes(element: Element): string[] {
  return Array.from(element.classList)
}

/** Every font-size utility on the element — there must only ever be one. */
function fontSizeClasses(element: Element): string[] {
  return classes(element).filter(
    name => name.startsWith('text-[') || name === 'text-mono',
  )
}

/** Every padding-left utility — likewise exactly one. */
function paddingLeftClasses(element: Element): string[] {
  return classes(element).filter(name => name.startsWith('pl-'))
}

describe('Input', () => {
  it('defaults to a text field', () => {
    render(<Input />)

    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'text')
  })

  it('lets a caller pick another type', () => {
    render(<Input placeholder="From" type="date" />)

    expect(screen.getByPlaceholderText('From')).toHaveAttribute('type', 'date')
  })

  it('carries exactly one font-size utility, proportional by default', () => {
    render(<Input />)

    expect(fontSizeClasses(screen.getByRole('textbox'))).toEqual([
      'text-[14px]',
    ])
  })

  it('swaps the whole type treatment for the machine face when mono', () => {
    render(<Input mono />)

    const input = screen.getByRole('textbox')

    expect(fontSizeClasses(input)).toEqual(['text-mono'])
    expect(input).toHaveClass('font-mono')
  })

  it('carries exactly one padding-left utility, widened by a leading icon', () => {
    const { rerender } = render(<Input />)

    expect(paddingLeftClasses(screen.getByRole('textbox'))).toEqual(['pl-3'])

    rerender(<Input icon="search" />)

    expect(paddingLeftClasses(screen.getByRole('textbox'))).toEqual([
      'pl-[34px]',
    ])
  })

  it('renders a decorative leading icon only when asked', () => {
    const { container, rerender } = render(<Input />)

    expect(container.querySelector('svg')).toBeNull()

    rerender(<Input icon="search" />)

    const icon = container.querySelector('svg')

    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('use')).toHaveAttribute('href', '#i-search')
  })

  it('applies className to the input and wrapperClassName to the wrapper', () => {
    const { container } = render(
      <Input className="w-[76px]!" icon="search" wrapperClassName="flex-1" />,
    )

    expect(screen.getByRole('textbox')).toHaveClass('w-[76px]!')
    expect(container.firstChild).toHaveClass('flex-1')
  })

  it('spreads the rest of its props onto the input', () => {
    render(<Input aria-invalid="true" name="year" />)

    const input = screen.getByRole('textbox')

    expect(input).toHaveAttribute('name', 'year')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Field', () => {
  it('associates its label with the input it wraps', () => {
    render(
      <Field label="Release year">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Release year')

    expect(input).toBe(screen.getByRole('textbox'))
    expect(input.id).toBeTruthy()
  })

  it('focuses the input when the label is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Field label="Release year">
        <Input />
      </Field>,
    )

    await user.click(screen.getByText('Release year'))

    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('lets the input keep an explicit id', () => {
    render(
      <Field htmlFor="year" label="Release year">
        <Input id="year" />
      </Field>,
    )

    expect(screen.getByLabelText('Release year')).toHaveAttribute('id', 'year')
  })

  it('gives each field a distinct id', () => {
    render(
      <>
        <Field label="From">
          <Input />
        </Field>
        <Field label="To">
          <Input />
        </Field>
      </>,
    )

    expect(screen.getByLabelText('From').id).not.toBe(
      screen.getByLabelText('To').id,
    )
  })

  it('spreads the rest of its props onto the wrapper', () => {
    const { container } = render(
      <Field className="col-span-2" data-testid="field" label="Genre">
        <Input />
      </Field>,
    )

    expect(container.firstChild).toHaveAttribute('data-testid', 'field')
    expect(container.firstChild).toHaveClass('col-span-2')
  })
})
