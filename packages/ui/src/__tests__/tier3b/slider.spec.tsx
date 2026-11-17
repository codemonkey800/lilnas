import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { SliderProps } from '../../slider'
import { Slider } from '../../slider'

function Example(
  props: Partial<SliderProps> & { onChange?: (v: number) => void },
) {
  const { onChange, ...rest } = props
  const [value, setValue] = useState(rest.value ?? 1)
  return (
    <Slider
      label="Temperature"
      max={2}
      min={0}
      step={0.1}
      {...rest}
      value={value}
      onValueChange={v => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

const thumb = () => screen.getByRole('slider', { name: 'Temperature' })

describe('Slider', () => {
  it('labels the thumb and shows the value right-aligned in tabular-nums', () => {
    render(<Example value={0.7} />)

    expect(thumb()).toHaveAttribute('aria-valuenow', '0.7')
    expect(thumb()).toHaveAttribute('min', '0')
    expect(thumb()).toHaveAttribute('max', '2')

    const output = screen.getByText('0.7')
    expect(output).toHaveClass('tabular-nums')
    expect(output.parentElement).toHaveClass('justify-between')
    expect(screen.getByText('Temperature')).toBeInTheDocument()
  })

  it('draws the track, fill and thumb from the spec', () => {
    const { container } = render(<Example />)

    expect(container.querySelector('[class*="h-1.5"]')).toHaveClass(
      'rounded-full',
      'bg-surface-2',
    )
    expect(container.querySelector('[class*="bg-accent"]')).toHaveClass(
      'rounded-full',
    )
    expect(container.querySelector('[class*="size-[18px]"]')).toHaveClass(
      'bg-ink',
      'border-[3px]',
      'border-accent',
    )
  })

  describe('keyboard', () => {
    it('steps with the arrow keys', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example value={1} onChange={onChange} />)
      thumb().focus()

      await user.keyboard('{ArrowRight}')
      expect(onChange).toHaveBeenLastCalledWith(1.1)
      await user.keyboard('{ArrowUp}')
      expect(onChange).toHaveBeenLastCalledWith(1.2)
      await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowDown}')
      expect(onChange).toHaveBeenLastCalledWith(0.9)
      expect(thumb()).toHaveAttribute('aria-valuenow', '0.9')
    })

    it('jumps to the ends with Home and End', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example onChange={onChange} />)
      thumb().focus()

      await user.keyboard('{End}')
      expect(onChange).toHaveBeenLastCalledWith(2)
      await user.keyboard('{Home}')
      expect(onChange).toHaveBeenLastCalledWith(0)
    })

    it('does not move past either end', async () => {
      const user = userEvent.setup()
      render(<Example value={2} />)
      thumb().focus()

      await user.keyboard('{ArrowRight}{ArrowUp}')
      expect(thumb()).toHaveAttribute('aria-valuenow', '2')
    })

    it('does nothing when disabled', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example disabled onChange={onChange} />)

      await user.keyboard('{Tab}{ArrowRight}')
      expect(onChange).not.toHaveBeenCalled()
      expect(thumb()).toBeDisabled()
    })
  })

  describe('clamping and rounding', () => {
    it('clamps an out-of-range value into min and max', () => {
      const { rerender } = render(
        <Slider
          label="Temperature"
          max={2}
          min={0}
          step={0.1}
          value={9}
          onValueChange={() => undefined}
        />,
      )
      expect(thumb()).toHaveAttribute('aria-valuenow', '2')
      expect(screen.getByText('2')).toBeInTheDocument()

      rerender(
        <Slider
          label="Temperature"
          max={2}
          min={0}
          step={0.1}
          value={-4}
          onValueChange={() => undefined}
        />,
      )
      expect(thumb()).toHaveAttribute('aria-valuenow', '0')
    })

    it('rounds to the step without float noise', () => {
      render(<Example value={0.30000000000000004} />)
      expect(thumb()).toHaveAttribute('aria-valuenow', '0.3')
      expect(screen.getByText('0.3')).toBeInTheDocument()
    })

    it('rounds to the step counted from min', () => {
      render(<Example max={100} min={5} step={10} value={19} />)
      expect(thumb()).toHaveAttribute('aria-valuenow', '15')
    })
  })

  describe('format', () => {
    it('drives the displayed value and aria-valuetext', async () => {
      const user = userEvent.setup()
      render(<Example format={v => `${v.toFixed(1)}°`} value={0.5} />)

      expect(screen.getByText('0.5°')).toHaveClass('tabular-nums')
      expect(thumb()).toHaveAttribute('aria-valuetext', '0.5°')

      thumb().focus()
      await user.keyboard('{ArrowRight}')
      expect(screen.getByText('0.6°')).toBeInTheDocument()
      expect(thumb()).toHaveAttribute('aria-valuetext', '0.6°')
    })

    it('formats the clamped value, not the raw one', () => {
      render(<Example format={v => `${v} units`} value={50} />)
      expect(screen.getByText('2 units')).toBeInTheDocument()
    })
  })
})
