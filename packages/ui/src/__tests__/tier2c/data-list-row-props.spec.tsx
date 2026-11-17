import '@testing-library/jest-dom'

import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Column, DataList } from '../../table'

type Job = { id: string; name: string }

const JOBS: Job[] = [
  { id: 'j1', name: 'alpha' },
  { id: 'j2', name: 'beta' },
]

const COLUMNS: Column<Job>[] = [
  { key: 'name', header: 'Name', render: j => j.name },
]

function renderList(props: Partial<Parameters<typeof DataList<Job>>[0]> = {}) {
  const { container } = render(
    <DataList
      caption="Jobs"
      columns={COLUMNS}
      rowKey={j => j.id}
      rows={JOBS}
      {...props}
    />,
  )
  const trs = Array.from(container.querySelectorAll<HTMLElement>('tbody tr'))
  const lis = Array.from(container.querySelectorAll<HTMLElement>('li'))
  return { trs, lis }
}

describe('DataList rowProps', () => {
  it('puts data attributes and classes on both the <tr> and the <li>', () => {
    const { trs, lis } = renderList({
      rowProps: row => ({
        className: 'opacity-60',
        'data-departing': row.id === 'j2' ? 'true' : undefined,
      }),
    })

    expect(trs[0]).toHaveClass('opacity-60')
    expect(lis[0]).toHaveClass('opacity-60')
    expect(trs[0]).not.toHaveAttribute('data-departing')
    expect(trs[1]).toHaveAttribute('data-departing', 'true')
    expect(lis[1]).toHaveAttribute('data-departing', 'true')
  })

  it("keeps DataList's own classes beside the row's", () => {
    const { trs, lis } = renderList({
      rowProps: () => ({ className: 'extra' }),
    })

    expect(trs[0]).toHaveClass('extra', 'transition-colors')
    expect(lis[0]).toHaveClass('extra', 'flex', 'flex-col')
  })

  it('merges style on both layouts', () => {
    const { trs, lis } = renderList({
      rowProps: (_, index) => ({
        style: { animationDelay: `${index * 40}ms` },
      }),
    })

    expect(trs[1]).toHaveStyle({ animationDelay: '40ms' })
    expect(lis[1]).toHaveStyle({ animationDelay: '40ms' })
  })

  it('passes the row and its index', () => {
    const rowProps = jest.fn(() => ({}))
    renderList({ rowProps })

    // Once per row for the table and once for the cards.
    expect(rowProps).toHaveBeenCalledWith(JOBS[0], 0)
    expect(rowProps).toHaveBeenCalledWith(JOBS[1], 1)
    expect(rowProps).toHaveBeenCalledTimes(4)
  })

  it('renders as before without rowProps', () => {
    const plain = renderList()
    const empty = renderList({ rowProps: () => ({}) })

    expect(empty.trs.map(r => r.outerHTML)).toEqual(
      plain.trs.map(r => r.outerHTML),
    )
    expect(empty.lis.map(r => r.outerHTML)).toEqual(
      plain.lis.map(r => r.outerHTML),
    )
  })

  it('leaves onRowClick, tabIndex and data-selected to DataList', async () => {
    const user = userEvent.setup()
    const onRowClick = jest.fn()
    const onRogue = jest.fn()
    const { trs, lis } = renderList({
      onRowClick,
      selectedKey: 'j1',
      rowProps: () => ({
        onClick: onRogue,
        tabIndex: -1,
        'data-selected': 'nope',
      }),
    })

    await user.click(trs[0]!)
    await user.click(lis[1]!)

    expect(onRogue).not.toHaveBeenCalled()
    expect(onRowClick).toHaveBeenCalledWith(JOBS[0])
    expect(onRowClick).toHaveBeenCalledWith(JOBS[1])
    expect(trs[0]).toHaveAttribute('tabindex', '0')
    expect(lis[0]).toHaveAttribute('tabindex', '0')
    expect(trs[0]).toHaveAttribute('data-selected', '')
    expect(lis[0]).toHaveAttribute('data-selected', '')
    expect(trs[1]).not.toHaveAttribute('data-selected')
    expect(lis[1]).not.toHaveAttribute('data-selected')
  })
})
