import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResponseInput } from 'src/components/response-input'

describe('ResponseInput', () => {
  it('renders a textarea with the given value', () => {
    render(<ResponseInput value="Hello" onValueChange={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('Hello')
  })

  it('calls onValueChange when the user types', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<ResponseInput value="" onValueChange={handleChange} />)
    await user.type(screen.getByRole('textbox'), 'a')

    expect(handleChange).toHaveBeenCalledWith('a')
  })

  it('displays the character counter', () => {
    render(
      <ResponseInput value="Hello" onValueChange={vi.fn()} maxLength={100} />,
    )
    expect(screen.getByText('5 / 100')).toBeInTheDocument()
  })

  it('displays default max length of 5000', () => {
    render(<ResponseInput value="" onValueChange={vi.fn()} />)
    expect(screen.getByText('0 / 5000')).toBeInTheDocument()
  })

  it('shows counter in error styling when at max length', () => {
    const value = 'a'.repeat(100)
    render(
      <ResponseInput value={value} onValueChange={vi.fn()} maxLength={100} />,
    )

    const counter = screen.getByText('100 / 100')
    expect(counter.className).toContain('text-error')
    expect(counter.className).not.toContain('text-text-muted')
  })

  it('shows counter in muted styling when under limit', () => {
    render(
      <ResponseInput value="Hello" onValueChange={vi.fn()} maxLength={100} />,
    )

    const counter = screen.getByText('5 / 100')
    expect(counter.className).toContain('text-text-muted')
    expect(counter.className).not.toContain('text-error')
  })

  it('forwards ref to the textarea element', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<ResponseInput ref={ref} value="" onValueChange={vi.fn()} />)
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
  })

  describe('auto-save', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('calls onAutoSave after 1s debounce', () => {
      const handleAutoSave = vi.fn()

      render(
        <ResponseInput
          value=""
          onValueChange={vi.fn()}
          onAutoSave={handleAutoSave}
        />,
      )

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'a' },
      })
      expect(handleAutoSave).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1000)
      expect(handleAutoSave).toHaveBeenCalledOnce()
      expect(handleAutoSave).toHaveBeenCalledWith('a')
    })

    it('resets the debounce timer when typing continues', () => {
      const handleAutoSave = vi.fn()

      render(
        <ResponseInput
          value=""
          onValueChange={vi.fn()}
          onAutoSave={handleAutoSave}
        />,
      )

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'a' },
      })
      vi.advanceTimersByTime(500)
      expect(handleAutoSave).not.toHaveBeenCalled()

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'ab' },
      })
      vi.advanceTimersByTime(500)
      expect(handleAutoSave).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)
      expect(handleAutoSave).toHaveBeenCalledOnce()
      expect(handleAutoSave).toHaveBeenCalledWith('ab')
    })

    it('does not call onAutoSave when not provided', () => {
      render(<ResponseInput value="" onValueChange={vi.fn()} />)

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'a' },
      })
      vi.advanceTimersByTime(1000)

      // No error thrown, no auto-save called
    })
  })

  it('respects disabled prop', () => {
    render(<ResponseInput value="" onValueChange={vi.fn()} disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('passes through placeholder', () => {
    render(
      <ResponseInput
        value=""
        onValueChange={vi.fn()}
        placeholder="Type your answer..."
      />,
    )
    expect(
      screen.getByPlaceholderText('Type your answer...'),
    ).toBeInTheDocument()
  })
})
