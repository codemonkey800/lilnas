import '@testing-library/jest-dom'

import { cns } from '@lilnas/utils/cns'
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

  it('leaves the header cells unstyled, so the table classes are load-bearing', () => {
    const header = renderTable().querySelector('th')

    expect(header).not.toBeNull()
    expect(header?.getAttribute('class')).toBeNull()
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

/**
 * Pins for the `cns`/tailwind-merge hazard `data-table.tsx` works around.
 *
 * These read the rendered `class` attribute — what actually reaches the DOM
 * *after* `cns` has run — rather than the string handed to `cns`, because the
 * drop happens inside `cns` and is invisible from the call site.
 *
 * Compiled through this app's own `@tailwindcss/postcss` pipeline, the theme
 * token `[&_th]:text-label` emits three declarations, not one:
 *
 *   font-size:      var(--text-label)                                        -> 10.5px
 *   letter-spacing: var(--tw-tracking,    var(--text-label--letter-spacing)) -> 0.11em
 *   font-weight:    var(--tw-font-weight, var(--text-label--font-weight))    -> 500
 *
 * and no line-height, because `--text-label` declares no `--line-height`
 * companion (unlike `--text-sm` or `--text-cap`, which do).
 *
 * `[&_th]:text-[length:var(--text-label)]` emits only the font-size. The
 * other two therefore have to come from the neighbouring utilities —
 * `[&_th]:font-medium` (`--font-weight-medium` is 500) and
 * `[&_th]:tracking-[0.11em]` — which `ui.pug` already carried beside the
 * token, and which additionally *set* `--tw-font-weight`/`--tw-tracking`, so
 * they would have won the fallback chain either way.
 *
 * That makes those two neighbours load-bearing rather than redundant. These
 * tests exist so a future "simplification" that drops either one, or that
 * restores the bare token, fails loudly instead of silently shrinking every
 * table header to the inherited 15px body size.
 */
describe('DataTable header typography', () => {
  function tableClasses(): string[] {
    return (renderTable().getAttribute('class') ?? '').split(/\s+/)
  }

  it('survives cns with both the header size and the header colour', () => {
    const classes = tableClasses()

    expect(classes).toContain('[&_th]:text-[length:var(--text-label)]')
    expect(classes).toContain('[&_th]:text-ink-4')
  })

  it('supplies the weight and tracking the bare token would have carried', () => {
    const classes = tableClasses()

    // --text-label--font-weight: 500, and --font-weight-medium is also 500.
    expect(classes).toContain('[&_th]:font-medium')
    // --text-label--letter-spacing: 0.11em.
    expect(classes).toContain('[&_th]:tracking-[0.11em]')
  })

  it('does not ship the bare token that cns cannot carry', () => {
    expect(tableClasses()).not.toContain('[&_th]:text-label')
  })

  it('documents the drop the substitution exists to avoid', () => {
    // tailwind-merge does not know this theme's custom --text-* tokens, so it
    // reads `text-label` as a colour and discards it against `text-ink-4`.
    expect(cns('[&_th]:text-label [&_th]:text-ink-4')).toBe('[&_th]:text-ink-4')

    // The arbitrary-length spelling is classified as the font size it is, so
    // both survive.
    expect(
      cns('[&_th]:text-[length:var(--text-label)] [&_th]:text-ink-4'),
    ).toBe('[&_th]:text-[length:var(--text-label)] [&_th]:text-ink-4')
  })
})
