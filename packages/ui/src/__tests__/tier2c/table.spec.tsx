import '@testing-library/jest-dom'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Badge } from '../../badge'
import { Column, DataList, Table } from '../../table'

describe('Table', () => {
  it('styles th as a label and td at 13.5px', () => {
    render(
      <Table.Root>
        <Table.Head>
          <Table.Row>
            <Table.Th>Name</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Td>alpha</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table.Root>,
    )

    expect(screen.getByText('Name')).toHaveClass(
      'text-label',
      'uppercase',
      'text-ink-3',
      'text-left',
      'border-line-loud',
    )
    expect(screen.getByText('alpha')).toHaveClass(
      'text-[13.5px]',
      'border-line-soft',
    )
  })

  it('right-aligns numeric th/td with tabular-nums, and left is the default', () => {
    render(
      <Table.Root>
        <Table.Head>
          <Table.Row>
            <Table.Th align="right">Size</Table.Th>
            <Table.Th>Label</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row>
            <Table.Td align="right">12</Table.Td>
            <Table.Td>x</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table.Root>,
    )

    expect(screen.getByText('Size')).toHaveClass('text-right', 'tabular-nums')
    expect(screen.getByText('12')).toHaveClass('text-right', 'tabular-nums')
    expect(screen.getByText('Label')).not.toHaveClass('text-right')
    expect(screen.getByText('x')).not.toHaveClass('tabular-nums')
  })

  it('sets mono cells in the mono face', () => {
    render(
      <Table.Root>
        <Table.Body>
          <Table.Row>
            <Table.Td mono>/var/log</Table.Td>
            <Table.Td>plain</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table.Root>,
    )

    expect(screen.getByText('/var/log')).toHaveClass('font-mono')
    expect(screen.getByText('plain')).not.toHaveClass('font-mono')
  })

  it('hovers body rows only and tints selected ones', () => {
    render(
      <Table.Root>
        <Table.Head>
          <Table.Row data-testid="head">
            <Table.Th>h</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row data-testid="plain">
            <Table.Td>a</Table.Td>
          </Table.Row>
          <Table.Row data-testid="picked" selected>
            <Table.Td>b</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table.Root>,
    )

    expect(screen.getByTestId('plain')).toHaveClass(
      'in-[tbody]:hover:bg-surface-2',
    )
    expect(screen.getByTestId('plain')).not.toHaveAttribute('data-selected')
    expect(screen.getByTestId('picked')).toHaveClass('bg-accent-ghost')
    expect(screen.getByTestId('picked')).toHaveAttribute('data-selected')
    // Scoped to tbody, so the header row never lights up.
    expect(screen.getByTestId('head').className).not.toMatch(
      /(^|\s)hover:bg-surface-2/,
    )
  })

  it('drops the border under the last body row', () => {
    const { container } = render(
      <Table.Root>
        <Table.Body />
      </Table.Root>,
    )

    expect(container.querySelector('tbody')).toHaveClass(
      '[&>tr:last-child>td]:border-b-0',
    )
  })
})

type Job = { id: string; name: string; state: string; size: number }

const JOBS: Job[] = [
  { id: 'j1', name: 'alpha', state: 'running', size: 12 },
  { id: 'j2', name: 'beta', state: 'failed', size: 7 },
]

const COLUMNS: Column<Job>[] = [
  { key: 'name', header: 'Name', render: j => j.name, primary: true },
  {
    key: 'state',
    header: 'State',
    render: j => (
      <Badge tone={j.state === 'failed' ? 'bad' : 'ok'}>{j.state}</Badge>
    ),
  },
  { key: 'id', header: 'ID', render: j => j.id, mono: true, hideOnCard: true },
  { key: 'size', header: 'Size', render: j => j.size, align: 'right' },
]

function renderList(props: Partial<Parameters<typeof DataList<Job>>[0]> = {}) {
  return render(
    <DataList
      caption="Jobs"
      columns={COLUMNS}
      rowKey={j => j.id}
      rows={JOBS}
      {...props}
    />,
  )
}

describe('DataList', () => {
  it('renders both layouts from one column set', () => {
    const { container } = renderList()

    const table = within(container.querySelector('table')!)
    const cards = within(screen.getByRole('list', { hidden: true }))

    expect(table.getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'Name',
      'State',
      'ID',
      'Size',
    ])
    expect(table.getAllByRole('row')).toHaveLength(3)
    expect(cards.getAllByRole('listitem', { hidden: true })).toHaveLength(2)
    for (const job of JOBS) {
      expect(table.getByText(job.name)).toBeInTheDocument()
      expect(cards.getByText(job.name)).toBeInTheDocument()
    }
    expect(table.getAllByText('running')).toHaveLength(1)
    expect(cards.getAllByText('running')).toHaveLength(1)
  })

  it('switches layout at the breakpoint with hidden/md:block', () => {
    const { container } = renderList()

    expect(container.querySelector('table')?.parentElement).toHaveClass(
      'hidden',
      'md:block',
    )
    expect(container.querySelector('ul')).toHaveClass('md:hidden')
  })

  it('honours cardBreakpoint', () => {
    const { container } = renderList({ cardBreakpoint: 'lg' })

    expect(container.querySelector('table')?.parentElement).toHaveClass(
      'hidden',
      'lg:block',
    )
    expect(container.querySelector('ul')).toHaveClass('lg:hidden')
  })

  it('uses the primary column as the card title and others as dt/dd', () => {
    const { container } = renderList()
    const card = container.querySelectorAll('li')[0]!

    expect(card.firstElementChild).toHaveTextContent('alpha')
    const terms = Array.from(card.querySelectorAll('dt')).map(
      t => t.textContent,
    )
    expect(terms).toEqual(['State', 'Size'])
    expect(card.querySelector('dd')).toHaveTextContent('running')
  })

  it('omits hideOnCard columns from cards only', () => {
    const { container } = renderList()
    const cards = container.querySelector('ul')!

    expect(within(cards).queryByText('ID')).not.toBeInTheDocument()
    expect(within(cards).queryByText('j1')).not.toBeInTheDocument()
    expect(
      within(container.querySelector('table')!).getByText('ID'),
    ).toBeVisible()
    expect(
      within(container.querySelector('table')!).getByText('j1'),
    ).toBeVisible()
  })

  it('falls back to the first card column as the title', () => {
    const columns = COLUMNS.map(c => ({ ...c, primary: undefined }))
    const { container } = renderList({ columns })

    expect(container.querySelector('li')?.firstElementChild).toHaveTextContent(
      'alpha',
    )
  })

  it('right-aligns numeric columns in the table but not in cards', () => {
    const { container } = renderList()
    const table = container.querySelector('table')!
    const cards = container.querySelector('ul')!

    expect(within(table).getByText('Size')).toHaveClass('text-right')
    expect(within(table).getByText('12')).toHaveClass(
      'text-right',
      'tabular-nums',
    )
    expect(within(cards).getByText('12')).not.toHaveClass('text-right')
    expect(within(cards).getByText('12')).toHaveClass('text-left')
  })

  it('renders empty once, not per layout', () => {
    const { container } = renderList({
      rows: [],
      empty: <p>Nothing here</p>,
    })

    expect(screen.getAllByText('Nothing here')).toHaveLength(1)
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('ul')).toBeNull()
  })

  it('renders nothing for zero rows without an empty node', () => {
    const { container } = renderList({ rows: [] })

    expect(container).toBeEmptyDOMElement()
  })

  it('marks the selected row in both layouts', () => {
    const { container } = renderList({ selectedKey: 'j2' })
    const row = within(container.querySelector('tbody')!)
      .getByText('beta')
      .closest('tr')!
    const card = container.querySelectorAll('li')[1]!

    expect(row).toHaveClass('bg-accent-ghost')
    expect(card).toHaveClass('bg-accent-ghost')
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(2)
    expect(container.querySelector('tbody tr')).not.toHaveClass(
      'bg-accent-ghost',
    )
  })

  it('activates rows by click, Enter and Space', async () => {
    const user = userEvent.setup()
    const onRowClick = jest.fn()
    const { container } = renderList({ onRowClick })
    const row = container.querySelector('tbody tr') as HTMLElement

    expect(row).toHaveAttribute('tabindex', '0')
    expect(row).toHaveClass('cursor-pointer')

    await user.click(row)
    row.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    await user.keyboard('a')

    expect(onRowClick).toHaveBeenCalledTimes(3)
    expect(onRowClick).toHaveBeenCalledWith(JOBS[0])
  })

  it('activates cards from the keyboard too', async () => {
    const user = userEvent.setup()
    const onRowClick = jest.fn()
    const { container } = renderList({ onRowClick })
    const card = container.querySelectorAll('li')[1]!

    card.focus()
    await user.keyboard('{Enter}')

    expect(onRowClick).toHaveBeenCalledWith(JOBS[1])
  })

  it('leaves a control inside a row its own Enter', async () => {
    const user = userEvent.setup()
    const onRowClick = jest.fn()
    const onInner = jest.fn()
    render(
      <DataList
        columns={[
          {
            key: 'go',
            header: 'Go',
            render: () => <button onClick={onInner}>inner</button>,
          },
        ]}
        onRowClick={onRowClick}
        rowKey={j => j.id}
        rows={[JOBS[0]!]}
      />,
    )

    screen.getAllByRole('button', { name: 'inner', hidden: true })[0]!.focus()
    await user.keyboard('{Enter}')

    expect(onInner).toHaveBeenCalled()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('is not focusable without onRowClick', () => {
    const { container } = renderList()

    expect(container.querySelector('tbody tr')).not.toHaveAttribute('tabindex')
    expect(container.querySelector('li')).not.toHaveAttribute('tabindex')
  })

  it('captions the table and labels the card list', () => {
    const { container } = renderList()

    expect(container.querySelector('caption')).toHaveTextContent('Jobs')
    expect(container.querySelector('ul')).toHaveAttribute('aria-label', 'Jobs')
  })
})
