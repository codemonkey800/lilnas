import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Checkbox, Radio, RadioGroup, Segmented, Switch } from 'src/choice'

describe('Checkbox', () => {
  it('toggles with Space and reports onCheckedChange', async () => {
    const onCheckedChange = jest.fn()
    const user = userEvent.setup()
    render(<Checkbox label="Remember me" onCheckedChange={onCheckedChange} />)

    const box = screen.getByRole('checkbox', { name: 'Remember me' })
    expect(box).toHaveAttribute('aria-checked', 'false')

    await user.tab()
    expect(box).toHaveFocus()
    await user.keyboard(' ')

    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())
    expect(box).toHaveAttribute('aria-checked', 'true')
    expect(box).toHaveAttribute('data-checked')

    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenLastCalledWith(false, expect.anything())
  })

  it('treats the label as part of the tap target', async () => {
    const onCheckedChange = jest.fn()
    const user = userEvent.setup()
    render(<Checkbox label="Remember me" onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByText('Remember me'))

    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('does not toggle when disabled', async () => {
    const onCheckedChange = jest.fn()
    const user = userEvent.setup()
    render(
      <Checkbox disabled label="Locked" onCheckedChange={onCheckedChange} />,
    )

    await user.click(screen.getByText('Locked'))

    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).toHaveAttribute('data-disabled')
  })
})

describe('Switch', () => {
  it('toggles with Space and reports onCheckedChange', async () => {
    const onCheckedChange = jest.fn()
    const user = userEvent.setup()
    render(<Switch label="Auto-start" onCheckedChange={onCheckedChange} />)

    const toggle = screen.getByRole('switch', { name: 'Auto-start' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await user.tab()
    await user.keyboard(' ')

    expect(onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything())
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toHaveAttribute('data-checked')
  })

  it('toggles when its label is clicked', async () => {
    const onCheckedChange = jest.fn()
    const user = userEvent.setup()
    render(<Switch label="Auto-start" onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByText('Auto-start'))

    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })
})

describe('RadioGroup', () => {
  function Harness({ onValueChange }: { onValueChange: (v: string) => void }) {
    return (
      <RadioGroup
        aria-label="Quality"
        defaultValue="hd"
        onValueChange={onValueChange}
      >
        <Radio label="SD" value="sd" />
        <Radio label="HD" value="hd" />
        <Radio label="4K" value="uhd" />
      </RadioGroup>
    )
  }

  it('moves and selects with the arrow keys', async () => {
    const onValueChange = jest.fn()
    const user = userEvent.setup()
    render(<Harness onValueChange={onValueChange} />)

    expect(screen.getByRole('radio', { name: 'HD' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.tab()
    expect(screen.getByRole('radio', { name: 'HD' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(onValueChange).toHaveBeenLastCalledWith('uhd', expect.anything())
    expect(screen.getByRole('radio', { name: '4K' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(onValueChange).toHaveBeenLastCalledWith('sd', expect.anything())
    expect(screen.getByRole('radio', { name: 'SD' })).toHaveFocus()
  })

  it('selects by clicking the label', async () => {
    const onValueChange = jest.fn()
    const user = userEvent.setup()
    render(<Harness onValueChange={onValueChange} />)

    await user.click(screen.getByText('SD'))

    expect(onValueChange).toHaveBeenCalledWith('sd', expect.anything())
  })
})

describe('Segmented', () => {
  const OPTIONS = [
    { value: '50', label: '50' },
    { value: '200', label: '200' },
    { value: '1000', label: '1000' },
  ]

  function Harness({ onValueChange }: { onValueChange?: (v: string) => void }) {
    const [value, setValue] = useState('200')
    return (
      <Segmented
        label="Tail lines"
        options={OPTIONS}
        value={value}
        onValueChange={next => {
          setValue(next)
          onValueChange?.(next)
        }}
      />
    )
  }

  it('is a labelled radiogroup with the current value checked', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: 'Tail lines' })).toBeVisible()
    expect(screen.getByRole('radio', { name: '200' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: '50' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('moves and selects with the arrow keys', async () => {
    const onValueChange = jest.fn()
    const user = userEvent.setup()
    render(<Harness onValueChange={onValueChange} />)

    await user.tab()
    expect(screen.getByRole('radio', { name: '200' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(onValueChange).toHaveBeenLastCalledWith('1000')
    expect(screen.getByRole('radio', { name: '1000' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(onValueChange).toHaveBeenLastCalledWith('50')
    expect(screen.getByRole('radio', { name: '50' })).toHaveFocus()
  })

  it('selects on click and keeps a 44px touch target', async () => {
    const onValueChange = jest.fn()
    const user = userEvent.setup()
    render(<Harness onValueChange={onValueChange} />)

    const segment = screen.getByRole('radio', { name: '50' })
    expect(segment).toHaveClass('pointer-coarse:min-h-11')

    await user.click(segment)
    expect(onValueChange).toHaveBeenCalledWith('50')
  })
})
