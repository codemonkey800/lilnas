import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Tabs } from 'src/tabs'

function Strip({
  activationMode,
  onValueChange,
}: {
  activationMode?: 'automatic' | 'manual'
  onValueChange?: (value: string) => void
}) {
  return (
    <Tabs.Root defaultValue="queue" onValueChange={onValueChange}>
      <Tabs.List activationMode={activationMode} aria-label="Sections">
        <Tabs.Tab value="queue">Queue</Tabs.Tab>
        <Tabs.Tab count={12} value="history">
          History
        </Tabs.Tab>
        <Tabs.Tab value="failed">Failed</Tabs.Tab>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Panel value="queue">Queue panel</Tabs.Panel>
      <Tabs.Panel value="history">History panel</Tabs.Panel>
      <Tabs.Panel value="failed">Failed panel</Tabs.Panel>
    </Tabs.Root>
  )
}

describe('Tabs', () => {
  it('shows the selected tab and its panel', () => {
    render(<Strip />)

    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Queue' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Queue panel')
  })

  it('activates on click', async () => {
    const onValueChange = jest.fn()
    const user = userEvent.setup()
    render(<Strip onValueChange={onValueChange} />)

    await user.click(screen.getByRole('tab', { name: /History/ }))

    expect(onValueChange).toHaveBeenCalledWith('history', expect.anything())
    expect(screen.getByRole('tab', { name: /History/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('History panel')
  })

  it('activates with the arrow keys by default, wrapping and jumping', async () => {
    const user = userEvent.setup()
    render(<Strip />)

    await user.tab()
    expect(screen.getByRole('tab', { name: 'Queue' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /History/ })).toHaveFocus()
    expect(screen.getByRole('tab', { name: /History/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Failed' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Queue' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Failed' })).toHaveFocus()
  })

  it('only moves focus under activationMode="manual" until Enter', async () => {
    const onValueChange = jest.fn()
    const user = userEvent.setup()
    render(<Strip activationMode="manual" onValueChange={onValueChange} />)

    await user.tab()
    await user.keyboard('{ArrowRight}')

    const history = screen.getByRole('tab', { name: /History/ })
    expect(history).toHaveFocus()
    expect(history).toHaveAttribute('aria-selected', 'false')
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Queue panel')

    await user.keyboard('{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('history', expect.anything())
    expect(history).toHaveAttribute('aria-selected', 'true')
  })

  it('renders the count as a mute pill', () => {
    render(<Strip />)

    const pill = screen.getByText('12')
    expect(pill).toHaveClass('rounded-full', 'bg-surface-2', 'font-mono')
    expect(screen.getByRole('tab', { name: /History/ })).toContainElement(pill)
    expect(screen.getByRole('tab', { name: 'Queue' })).not.toHaveTextContent(
      /\d/,
    )
  })

  it('stretch and scroll shape the list', () => {
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List scroll stretch aria-label="Seasons">
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>,
    )

    expect(screen.getByRole('tablist')).toHaveClass(
      'grid',
      'grid-flow-col',
      'overflow-x-auto',
    )
  })
})
