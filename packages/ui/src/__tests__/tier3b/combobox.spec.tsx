import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { ComboboxItem, ComboboxProps } from '../../combobox'
import { Combobox } from '../../combobox'

const ITEMS: ComboboxItem<string>[] = [
  { value: 'squat', label: 'Squat', group: 'legs' },
  { value: 'bench', label: 'Bench press', group: 'chest' },
  { value: 'lunge', label: 'Lunge', group: 'legs', disabled: true },
  { value: 'deadlift', label: 'Deadlift', group: 'legs', hint: 'barbell' },
  { value: 'jose', label: 'José', group: 'back' },
  { value: 'free', label: 'Plank' },
]

const GROUPS = [
  { key: 'chest', label: 'Chest', dot: 'rgb(1, 2, 3)' },
  { key: 'legs', label: 'Legs' },
]

function Example(
  props: Partial<ComboboxProps<string>> & {
    onChange?: (v: string | null) => void
  },
) {
  const { onChange, ...rest } = props
  const [value, setValue] = useState<string | null>(rest.value ?? null)
  return (
    <Combobox
      groups={GROUPS}
      items={ITEMS}
      label="Exercise"
      placeholder="Pick one"
      {...rest}
      value={value}
      onValueChange={v => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

function input() {
  return screen.getByRole('combobox', { name: 'Exercise' })
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(input())
  return screen.findByRole('listbox')
}

function optionNames() {
  return screen.getAllByRole('option').map(o => o.textContent)
}

describe('Combobox', () => {
  it('styles the field like Input and shows the placeholder', () => {
    render(<Example />)

    expect(input()).toHaveAttribute('placeholder', 'Pick one')
    expect(input()).toHaveClass(
      'h-(--control-h)',
      'rounded-md',
      'border-line-control',
      'bg-bg-sunk',
    )
  })

  it('opens a panel styled like Select with all items', async () => {
    const user = userEvent.setup()
    render(<Example />)
    const listbox = await open(user)

    expect(listbox.closest('[class*="shadow-lift"]')).toHaveClass(
      'bg-surface',
      'border-line-loud',
      'rounded-lg',
      'p-1.5',
    )
    expect(screen.getAllByRole('option')).toHaveLength(ITEMS.length)
    expect(screen.getByRole('option', { name: 'Squat' })).toHaveClass(
      'h-8',
      'px-2.5',
      'text-[13.5px]',
    )
  })

  it('shows the Search… row for touch inside the panel', async () => {
    const user = userEvent.setup()
    render(<Example />)
    await open(user)

    const row = screen.getByText('Search…').parentElement
    expect(row).toHaveClass('hidden', 'pointer-coarse:flex')
    expect(row).toHaveAttribute('aria-hidden', 'true')
  })

  describe('filtering', () => {
    it('filters as you type, ignoring case', async () => {
      const user = userEvent.setup()
      render(<Example />)
      await open(user)
      await user.type(input(), 'PRESS')

      expect(optionNames()).toEqual(['Bench press'])
    })

    it('ignores diacritics in both directions', async () => {
      const user = userEvent.setup()
      render(<Example />)
      await open(user)
      await user.type(input(), 'jose')
      expect(optionNames()).toEqual(['José'])

      await user.clear(input())
      await user.type(input(), 'JOSÉ')
      expect(optionNames()).toEqual(['José'])
    })

    it('lists everything again when the panel reopens on a chosen value', async () => {
      const user = userEvent.setup()
      render(<Example value="squat" />)
      expect(input()).toHaveValue('Squat')
      await open(user)

      expect(screen.getAllByRole('option')).toHaveLength(ITEMS.length)
    })
  })

  describe('grouping', () => {
    it('puts ungrouped rows first, then groups in the declared order, then the rest', async () => {
      const user = userEvent.setup()
      render(<Example />)
      await open(user)

      expect(optionNames()).toEqual(
        ['Plank', 'Bench press', 'Squat', 'Lunge', 'Deadlifthint', 'José'].map(
          n => (n === 'Deadlifthint' ? 'Deadliftbarbell' : n),
        ),
      )
    })

    it('labels each group and draws the coloured dot', async () => {
      const user = userEvent.setup()
      render(<Example />)
      await open(user)

      const chest = screen.getByText('Chest')
      expect(chest.querySelector('span')).toHaveStyle({
        backgroundColor: 'rgb(1, 2, 3)',
      })
      expect(screen.getByText('Legs').querySelector('span')).toBeNull()
      // A group missing from `groups` is labelled with its key.
      expect(screen.getByText('back')).toBeInTheDocument()
    })

    it('drops a group heading once no row in it matches', async () => {
      const user = userEvent.setup()
      render(<Example />)
      await open(user)
      await user.type(input(), 'bench')

      expect(screen.getByText('Chest')).toBeInTheDocument()
      expect(screen.queryByText('Legs')).not.toBeInTheDocument()
    })
  })

  describe('rows', () => {
    it('shows icon, hint and a check on the picked row', async () => {
      const user = userEvent.setup()
      render(
        <Example
          items={[
            {
              value: 'a',
              label: 'Ada',
              hint: '@ada',
              icon: <i data-testid="avatar" />,
            },
          ]}
          value="a"
        />,
      )
      await open(user)

      const row = screen.getByRole('option', { name: /Ada/ })
      expect(row).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('avatar')).toBeInTheDocument()
      expect(screen.getByText('@ada')).toHaveClass('text-mono-sm', 'text-ink-3')
      expect(row.querySelector('svg')?.parentElement).toHaveClass(
        'text-accent-hi',
      )
    })

    it('hands the item to renderItem', async () => {
      const user = userEvent.setup()
      render(
        <Example
          renderItem={item => <b data-testid="custom">{item.label}!</b>}
        />,
      )
      await open(user)

      expect(screen.getAllByTestId('custom')).toHaveLength(ITEMS.length)
      expect(screen.getByText('Squat!')).toBeInTheDocument()
    })
  })

  describe('selection', () => {
    it('selects with a click and fills the field with the label', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example onChange={onChange} />)
      await open(user)
      await user.click(screen.getByRole('option', { name: 'Bench press' }))

      expect(onChange).toHaveBeenCalledWith('bench')
      expect(input()).toHaveValue('Bench press')
      await waitFor(() =>
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
      )
    })

    it('selects the first match with Enter after typing', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example onChange={onChange} />)
      await open(user)
      await user.type(input(), 'dead')
      await waitFor(() =>
        expect(screen.getByRole('option')).toHaveAttribute('data-highlighted'),
      )
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('deadlift')
      expect(input()).toHaveValue('Deadlift')
    })

    it('walks the list with the arrow keys and skips a disabled row', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example onChange={onChange} />)
      await open(user)
      input().focus()

      // Plank, Bench press, Squat, then Lunge (disabled) is skipped.
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Squat' })).toHaveAttribute(
          'data-highlighted',
        ),
      )
      await user.keyboard('{ArrowDown}')
      await waitFor(() =>
        expect(
          screen.getByRole('option', { name: /Deadlift/ }),
        ).toHaveAttribute('data-highlighted'),
      )
      expect(screen.getByRole('option', { name: 'Lunge' })).not.toHaveAttribute(
        'data-highlighted',
      )
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledWith('deadlift')
    })

    it('does not pick a disabled row with the pointer', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example onChange={onChange} />)
      await open(user)
      await user.click(screen.getByRole('option', { name: 'Lunge' }))

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Escape', () => {
    it('drops the typed text and restores the previous value', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example value="squat" onChange={onChange} />)
      await open(user)
      await user.type(input(), 'zzz')
      expect(input()).toHaveValue('Squatzzz')

      await user.keyboard('{Escape}')

      expect(input()).toHaveValue('Squat')
      expect(onChange).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
      )
    })

    it('restores the previous custom value too', async () => {
      const user = userEvent.setup()
      render(<Example allowCustom value="zed" />)
      await open(user)
      await user.type(input(), 'x')
      await user.keyboard('{Escape}')

      expect(input()).toHaveValue('zed')
    })

    it('keeps the chosen value when pressed with the panel closed', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example value="squat" onChange={onChange} />)
      await open(user)
      await user.keyboard('{Escape}')
      await waitFor(() =>
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
      )

      await user.keyboard('{Escape}')

      expect(input()).toHaveValue('Squat')
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('empty', () => {
    it('shows the default empty text when nothing matches', async () => {
      const user = userEvent.setup()
      render(<Example />)
      await open(user)
      await user.type(input(), 'qqq')

      expect(screen.getByText('No matches')).toBeInTheDocument()
      expect(screen.queryAllByRole('option')).toHaveLength(0)
    })

    it('takes custom empty text', async () => {
      const user = userEvent.setup()
      render(<Example emptyText="Nobody here" items={[]} />)
      await open(user)

      expect(await screen.findByText('Nobody here')).toBeInTheDocument()
    })
  })

  describe('allowCustom', () => {
    it('keeps typed text that matches nothing when Enter is pressed', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example allowCustom onChange={onChange} />)
      await open(user)
      await user.type(input(), 'Zercher squat')
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('Zercher squat')
      expect(input()).toHaveValue('Zercher squat')
      await waitFor(() =>
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
      )
    })

    it('prefers a highlighted row over the typed text', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example allowCustom onChange={onChange} />)
      await open(user)
      await user.type(input(), 'dead')
      await user.keyboard('{ArrowDown}')
      await waitFor(() =>
        expect(screen.getByRole('option')).toHaveAttribute('data-highlighted'),
      )
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledWith('deadlift')
    })

    it('resolves typed text equal to a label to that item', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Example allowCustom onChange={onChange} />)
      await open(user)
      await user.type(input(), 'squat')
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledWith('squat')
    })

    it('commits the typed text when the field loses focus', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(
        <>
          <Example allowCustom onChange={onChange} />
          <button type="button">elsewhere</button>
        </>,
      )
      await open(user)
      await user.type(input(), 'Sissy squat')
      await user.click(screen.getByText('elsewhere'))

      expect(onChange).toHaveBeenCalledWith('Sissy squat')
    })

    it('still submits the typed value from an empty list', async () => {
      const user = userEvent.setup()
      const onSubmit = jest.fn((e: { preventDefault: () => void }) =>
        e.preventDefault(),
      )
      render(
        <form
          data-testid="form"
          onSubmit={e => {
            onSubmit(e)
            submitted = new FormData(e.currentTarget).get('exercise')
          }}
        >
          <Example allowCustom items={[]} name="exercise" />
        </form>,
      )
      let submitted: FormDataEntryValue | null = null
      await user.click(input())
      await user.type(input(), 'Turkish get-up')
      fireEvent.submit(screen.getByTestId('form'))

      expect(submitted).toBe('Turkish get-up')
    })

    it('does not keep unmatched text without allowCustom', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(
        <>
          <Example value="squat" onChange={onChange} />
          <button type="button">elsewhere</button>
        </>,
      )
      await open(user)
      await user.clear(input())
      await user.type(input(), 'nope')
      await user.click(screen.getByText('elsewhere'))

      expect(onChange).not.toHaveBeenCalledWith('nope')
      expect(input()).toHaveValue('Squat')
    })
  })

  describe('form value', () => {
    it('submits the chosen value under name', async () => {
      const user = userEvent.setup()
      render(
        <form data-testid="form">
          <Example name="exercise" />
        </form>,
      )
      await open(user)
      await user.click(screen.getByRole('option', { name: 'Squat' }))

      const data = new FormData(screen.getByTestId('form') as HTMLFormElement)
      expect(data.get('exercise')).toBe('squat')
    })
  })

  describe('Field wiring', () => {
    it('forwards id, aria-describedby and invalid to the input', () => {
      render(<Example aria-describedby="hint" id="ex" invalid />)

      expect(input()).toHaveAttribute('id', 'ex')
      expect(input()).toHaveAttribute('aria-describedby', 'hint')
      expect(input()).toHaveAttribute('aria-invalid', 'true')
      expect(input()).toHaveClass('border-bad')
    })

    it('ignores input when disabled', async () => {
      const user = userEvent.setup()
      render(<Example disabled />)

      expect(input()).toBeDisabled()
      await user.click(input())
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })
})
