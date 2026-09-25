import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Tab, Tabs } from 'src/components/ui/tabs'

const SEASONS = ['Season 1', 'Season 2', 'Season 3']

function ControlledTabs({
  initial = 'Season 1',
  activationMode,
  onChange,
}: {
  initial?: string
  activationMode?: 'automatic' | 'manual'
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState(initial)

  return (
    <Tabs
      activationMode={activationMode}
      aria-label="Seasons"
      value={value}
      onValueChange={next => {
        setValue(next)
        onChange?.(next)
      }}
    >
      {SEASONS.map(season => (
        <Tab key={season} value={season}>
          {season}
        </Tab>
      ))}
    </Tabs>
  )
}

function tabs(): HTMLElement[] {
  return screen.getAllByRole('tab')
}

describe('Tabs', () => {
  it('gives the strip role="tablist", which the ui.pug mixin omits', () => {
    render(<ControlledTabs />)

    const tablist = screen.getByRole('tablist')

    expect(tablist).toHaveAccessibleName('Seasons')
    expect(tablist).toHaveClass('border-b', 'border-line')
  })

  it('marks exactly one tab aria-selected', () => {
    render(<ControlledTabs initial="Season 2" />)

    expect(tabs().map(tab => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('keeps only the selected tab in the tab order', () => {
    render(<ControlledTabs initial="Season 2" />)

    expect(tabs().map(tab => tab.tabIndex)).toEqual([-1, 0, -1])
  })

  it('selects on click', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<ControlledTabs onChange={onChange} />)

    await user.click(screen.getByRole('tab', { name: 'Season 3' }))

    expect(onChange).toHaveBeenCalledWith('Season 3')
    expect(screen.getByRole('tab', { name: 'Season 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('moves focus and selection rightwards with ArrowRight', async () => {
    const user = userEvent.setup()

    render(<ControlledTabs />)

    screen.getByRole('tab', { name: 'Season 1' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('wraps around at both ends', async () => {
    const user = userEvent.setup()

    render(<ControlledTabs />)

    screen.getByRole('tab', { name: 'Season 1' }).focus()
    await user.keyboard('{ArrowLeft}')

    expect(screen.getByRole('tab', { name: 'Season 3' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveFocus()
  })

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup()

    render(<ControlledTabs initial="Season 2" />)

    screen.getByRole('tab', { name: 'Season 2' }).focus()
    await user.keyboard('{End}')

    expect(screen.getByRole('tab', { name: 'Season 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.keyboard('{Home}')

    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('skips disabled tabs', async () => {
    const user = userEvent.setup()

    render(
      <Tabs aria-label="Seasons" value="a" onValueChange={jest.fn()}>
        <Tab value="a">A</Tab>
        <Tab disabled value="b">
          B
        </Tab>
        <Tab value="c">C</Tab>
      </Tabs>,
    )

    screen.getByRole('tab', { name: 'A' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'C' })).toHaveFocus()
  })

  it('leaves other keys to the browser', async () => {
    const user = userEvent.setup()

    render(<ControlledTabs />)

    const first = screen.getByRole('tab', { name: 'Season 1' })

    first.focus()
    await user.keyboard('{ArrowDown}')

    expect(first).toHaveFocus()
  })

  it('swaps the layout for stretch and scroll', () => {
    const { rerender } = render(
      <Tabs value="a" onValueChange={jest.fn()}>
        <Tab value="a">A</Tab>
      </Tabs>,
    )

    expect(screen.getByRole('tablist')).toHaveClass('flex', 'gap-[22px]')

    rerender(
      <Tabs scroll stretch value="a" onValueChange={jest.fn()}>
        <Tab value="a">A</Tab>
      </Tabs>,
    )

    expect(screen.getByRole('tablist')).toHaveClass(
      'grid',
      'grid-cols-3',
      'overflow-x-auto',
    )
  })

  it('draws the accent underline only on the selected tab', () => {
    render(<ControlledTabs initial="Season 2" />)

    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveClass(
      'text-ink',
      'after:bg-uv',
    )
    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveClass(
      'text-ink-3',
    )
  })

  it('refuses to render a Tab outside a Tabs', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Tab value="a">A</Tab>)).toThrow(
      '<Tab> must be rendered inside a <Tabs>',
    )

    error.mockRestore()
  })
})

describe('Tabs activationMode="manual"', () => {
  it('moves focus without selecting on ArrowRight', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<ControlledTabs activationMode="manual" onChange={onChange} />)

    screen.getByRole('tab', { name: 'Season 1' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Season 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('activates the focused tab on Enter', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<ControlledTabs activationMode="manual" onChange={onChange} />)

    screen.getByRole('tab', { name: 'Season 1' }).focus()
    await user.keyboard('{ArrowRight}{Enter}')

    expect(onChange).toHaveBeenCalledWith('Season 2')
    expect(screen.getByRole('tab', { name: 'Season 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('activates the focused tab on Space', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<ControlledTabs activationMode="manual" onChange={onChange} />)

    screen.getByRole('tab', { name: 'Season 1' }).focus()
    await user.keyboard('{ArrowRight}{ }')

    expect(onChange).toHaveBeenCalledWith('Season 2')
  })
})
