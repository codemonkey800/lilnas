import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Reason, ReasonGroup } from 'src/components/ui/reason'

const REASONS = [
  'Wrong audio or subtitles',
  'Video won’t play',
  'Not this movie',
] as const

/** The reason picker, controlled the way a page controls it. */
function Picker({
  disabled,
  initial,
  onChange,
}: {
  disabled?: string
  initial?: string
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState(initial ?? '')

  return (
    <ReasonGroup
      aria-label="What’s wrong with this file?"
      value={value}
      onValueChange={next => {
        setValue(next)
        onChange?.(next)
      }}
    >
      {REASONS.map(reason => (
        <Reason
          disabled={reason === disabled}
          key={reason}
          label={reason}
          value={reason}
        />
      ))}
    </ReasonGroup>
  )
}

function radios(): HTMLElement[] {
  return screen.getAllByRole('radio')
}

describe('ReasonGroup', () => {
  it('is a named radiogroup', () => {
    render(<Picker />)

    expect(screen.getByRole('radiogroup')).toHaveAccessibleName(
      'What’s wrong with this file?',
    )
    expect(radios()).toHaveLength(3)
  })

  it('marks exactly the chosen row checked', () => {
    render(<Picker initial={REASONS[1]} />)

    expect(radios().map(radio => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('names each radio from its label', () => {
    render(<Picker />)

    for (const reason of REASONS) {
      expect(screen.getByRole('radio', { name: reason })).toBeInTheDocument()
    }
  })

  it('chooses on click, and reports the value once', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<Picker onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: REASONS[2] }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(REASONS[2])
    expect(screen.getByRole('radio', { name: REASONS[2] })).toBeChecked()
  })

  it('chooses by clicking the label text too', async () => {
    const user = userEvent.setup()

    render(<Picker />)

    await user.click(screen.getByText(REASONS[1]))

    expect(screen.getByRole('radio', { name: REASONS[1] })).toBeChecked()
  })

  it('moves the focus and the choice with the arrow keys, wrapping at the end', async () => {
    const user = userEvent.setup()

    render(<Picker initial={REASONS[1]} />)

    radios()[1]?.focus()
    await user.keyboard('{ArrowDown}')
    expect(radios()[2]).toHaveFocus()
    expect(radios()[2]).toBeChecked()

    await user.keyboard('{ArrowDown}')
    expect(radios()[0]).toHaveFocus()
    expect(radios()[0]).toBeChecked()
  })

  it('keeps one tab stop, on the chosen row', () => {
    render(<Picker initial={REASONS[2]} />)

    expect(radios().map(radio => radio.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '0',
    ])
  })

  it('skips a disabled row', async () => {
    const user = userEvent.setup()

    render(<Picker disabled={REASONS[1]} initial={REASONS[0]} />)

    radios()[0]?.focus()
    await user.keyboard('{ArrowDown}')

    expect(radios()[2]).toHaveFocus()
    expect(screen.getByRole('radio', { name: REASONS[1] })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('lays a row out as a bordered-free line, so a dialog can draw its own', () => {
    render(<Picker />)

    const row = radios()[0]?.closest('label')

    expect(row?.getAttribute('class')).toContain('items-start')
    expect(row?.getAttribute('class')).not.toContain('border')
  })
})
