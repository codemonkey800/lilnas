import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Icon } from 'src/icons'
import { Field, Input, Search, Textarea, useFieldId } from 'src/input'

describe('Field', () => {
  it('labels the control and wires the hint through aria-describedby', () => {
    render(
      <Field hint="Paste any link." label="Video URL">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Video URL')
    const hint = screen.getByText('Paste any link.')

    expect(input).toHaveAttribute('aria-describedby', hint.id)
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(hint).toHaveClass('text-ink-3')
  })

  it('replaces the hint with the error and flags the control', () => {
    render(
      <Field error="Not a URL." hint="Paste any link." label="Video URL">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Video URL')
    const error = screen.getByText('Not a URL.')

    expect(screen.queryByText('Paste any link.')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', error.id)
    expect(error).toHaveClass('text-bad')
    expect(error).not.toHaveAttribute('role')
    expect(input).toHaveClass('border-bad')
  })

  it('keeps a describedby the control already carries', () => {
    render(
      <Field hint="Hint" label="Name">
        <Input aria-describedby="extra" />
      </Field>,
    )

    const input = screen.getByLabelText('Name')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual([
      'extra',
      screen.getByText('Hint').id,
    ])
  })

  it('honours htmlFor and an id already on the control', () => {
    render(
      <>
        <Field htmlFor="explicit" label="One">
          <Input />
        </Field>
        <Field label="Two">
          <Input id="own" />
        </Field>
      </>,
    )

    expect(screen.getByLabelText('One')).toHaveAttribute('id', 'explicit')
    expect(screen.getByLabelText('Two')).toHaveAttribute('id', 'own')
  })

  it('useFieldId prefers the explicit id', () => {
    function Probe({ id }: { id?: string }) {
      return <span data-testid="probe">{useFieldId(id)}</span>
    }

    const { rerender } = render(<Probe id="mine" />)
    expect(screen.getByTestId('probe')).toHaveTextContent('mine')

    rerender(<Probe />)
    expect(screen.getByTestId('probe').textContent).not.toBe('')
  })
})

describe('Input', () => {
  it('defaults to a proportional text field on the sunk well', () => {
    render(<Input aria-label="Name" />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveClass('bg-bg-sunk', 'border-line-control')
    expect(input).not.toHaveClass('font-mono')
  })

  it('mono switches to the machine face', () => {
    render(<Input mono aria-label="Path" />)
    expect(screen.getByRole('textbox')).toHaveClass('font-mono', 'text-mono')
  })

  it('invalid draws the error border and sets aria-invalid', () => {
    render(<Input invalid aria-label="Path" />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveClass('border-bad')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('renders the icon through Icon in a wrapper and pads the input', () => {
    const { container } = render(
      <Input
        aria-label="Find"
        className="on-input"
        icon="search"
        wrapperClassName="on-wrapper"
      />,
    )

    const input = screen.getByRole('textbox')
    const wrapper = container.querySelector('.on-wrapper')
    const slot = wrapper?.querySelector('span')
    const expected = render(<Icon name="search" />).container.innerHTML

    expect(wrapper).toContainElement(input)
    expect(input).toHaveClass('on-input', 'pl-9')
    expect(slot).toHaveClass('pointer-events-none', 'text-ink-4')
    expect(slot?.innerHTML).toBe(expected)
    expect(slot?.querySelector('svg')).toHaveAttribute('width', '16')
    expect(slot?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('adds neither wrapper nor padding without an icon', () => {
    const { container } = render(<Input aria-label="Name" />)

    expect(container.firstElementChild).toBe(screen.getByRole('textbox'))
    expect(screen.getByRole('textbox')).not.toHaveClass('pl-9')
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('Textarea', () => {
  it('has a 70px floor and no resize handle', () => {
    render(<Textarea aria-label="Notes" />)
    expect(screen.getByRole('textbox')).toHaveClass(
      'min-h-[70px]',
      'resize-none',
    )
  })

  it('mono and invalid mirror Input', () => {
    render(<Textarea invalid mono aria-label="Notes" />)

    const area = screen.getByRole('textbox')
    expect(area).toHaveClass('font-mono', 'border-bad')
    expect(area).toHaveAttribute('aria-invalid', 'true')
  })

  it('autoResize grows to its content as you type', () => {
    render(<Textarea autoResize aria-label="Notes" />)

    const area = screen.getByRole('textbox')
    expect(area).toHaveClass('overflow-hidden')

    Object.defineProperty(area, 'scrollHeight', {
      configurable: true,
      value: 140,
    })
    fireEvent.input(area, { target: { value: 'a\nb\nc' } })

    expect(area.style.height).toBe('140px')
  })

  it('forwards its ref', () => {
    let node: HTMLTextAreaElement | null = null
    render(
      <Textarea
        aria-label="Notes"
        ref={el => {
          node = el
        }}
      />,
    )
    expect(node).toBe(screen.getByRole('textbox'))
  })
})

describe('Search', () => {
  function Harness({ onSubmit }: { onSubmit: (v: string) => void }) {
    const [value, setValue] = useState('')
    return (
      <Search
        placeholder="Find a movie"
        value={value}
        onSubmit={onSubmit}
        onValueChange={setValue}
      />
    )
  }

  it('submits the value on Enter', async () => {
    const onSubmit = jest.fn()
    const user = userEvent.setup()
    render(<Harness onSubmit={onSubmit} />)

    await user.type(screen.getByRole('searchbox'), 'dune{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('dune')
  })

  it('submits the value from the button', async () => {
    const onSubmit = jest.fn()
    const user = userEvent.setup()
    render(<Harness onSubmit={onSubmit} />)

    await user.type(screen.getByRole('searchbox'), 'alien')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(onSubmit).toHaveBeenCalledWith('alien')
  })

  it('renders the package accent Button with a search Icon', () => {
    const { container } = render(
      <Search
        buttonLabel="Find"
        value=""
        onSubmit={jest.fn()}
        onValueChange={jest.fn()}
      />,
    )
    const glyph = render(<Icon name="search" />).container.innerHTML

    const button = screen.getByRole('button', { name: 'Find' })
    expect(button).toHaveClass(
      'bg-accent',
      'rounded-md',
      'border',
      'transition-press',
    )
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toHaveAttribute('aria-label', 'Find')
    expect(button.querySelector('svg')?.outerHTML).toBe(glyph)

    // The field's leading glyph is the same Icon.
    const slot = container.querySelector('input')?.previousElementSibling
    expect(slot?.innerHTML).toBe(glyph)
  })

  it('shows the label from sm up and collapses to a square icon below', () => {
    render(
      <Search
        buttonLabel="Find"
        value=""
        onSubmit={jest.fn()}
        onValueChange={jest.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: 'Find' })
    expect(screen.getByText('Find')).toHaveClass('hidden', 'sm:inline')
    expect(button).toHaveClass('max-sm:w-(--control-h)', 'max-sm:px-0')
  })

  it('disables the button and shows its pending state while pending', () => {
    render(
      <Search
        pending
        value=""
        onSubmit={jest.fn()}
        onValueChange={jest.fn()}
      />,
    )

    const button = screen.getByRole('button', { name: 'Search' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('svg')).toBeNull()
    expect(button.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('does not submit from the button while pending', async () => {
    const onSubmit = jest.fn()
    const user = userEvent.setup()
    render(
      <Search
        pending
        value="x"
        onSubmit={onSubmit}
        onValueChange={jest.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
