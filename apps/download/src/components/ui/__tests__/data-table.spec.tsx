import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { DataTable } from 'src/components/ui/data-table'

function renderTable() {
  render(
    <DataTable data-testid="table">
      <thead>
        <tr>
          <th>item</th>
          <th className="text-right!">started</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Arrival</td>
          <td>2m ago</td>
        </tr>
        <tr>
          <td>Dune</td>
          <td>9m ago</td>
        </tr>
      </tbody>
    </DataTable>,
  )

  return screen.getByTestId('table')
}

describe('DataTable', () => {
  it('renders a table element', () => {
    expect(renderTable().tagName).toBe('TABLE')
  })

  it('styles cells from the table with descendant variants, not on each cell', () => {
    const table = renderTable()

    // The rules that make a cell a cell are declared once, here.
    expect(table).toHaveClass(
      '[&_td]:border-b',
      '[&_td]:border-line-soft',
      '[&_td]:px-3',
      '[&_td]:py-3',
      '[&_td]:align-middle',
      '[&_td]:text-sm',
      '[&_th]:border-b',
      '[&_th]:border-line',
      '[&_th]:px-3',
      '[&_th]:py-2.5',
      '[&_th]:text-left',
      '[&_th]:font-mono',
      '[&_th]:font-medium',
      '[&_th]:tracking-[0.11em]',
      '[&_th]:uppercase',
      '[&_th]:text-ink-4',
    )

    // ...and correspondingly nowhere else. A row stays readable as markup.
    for (const cell of Array.from(table.querySelectorAll('td'))) {
      expect(cell.className).toBe('')
    }
  })

  it('keeps the header size token, which tailwind-merge would otherwise drop', () => {
    // `text-label` is not a font size tailwind-merge recognises, so it would
    // classify it as a colour and discard it against `[&_th]:text-ink-4`.
    expect(renderTable()).toHaveClass('[&_th]:text-[length:var(--text-label)]')
  })

  it('carries the row hover and last-row rules', () => {
    expect(renderTable()).toHaveClass(
      '[&_tbody_tr]:transition-colors',
      '[&_tbody_tr]:duration-[120ms]',
      '[&_tbody_tr]:ease-uv',
      '[&_tbody_tr:hover]:bg-surface-2',
      '[&_tbody_tr:last-child_td]:border-b-0',
      'w-full',
      'border-collapse',
    )
  })

  it('leaves per-cell overrides on the cell that declares them', () => {
    renderTable()

    expect(screen.getByText('started')).toHaveClass('text-right!')
  })

  it('renders the rows it is given', () => {
    const table = renderTable()

    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.getByText('Arrival')).toBeInTheDocument()
    expect(screen.getByText('Dune')).toBeInTheDocument()
  })

  it('merges a caller className onto the table', () => {
    render(
      <DataTable className="min-w-[480px]" data-testid="table">
        <tbody>
          <tr>
            <td>only</td>
          </tr>
        </tbody>
      </DataTable>,
    )

    expect(screen.getByTestId('table')).toHaveClass('min-w-[480px]', 'w-full')
  })
})
