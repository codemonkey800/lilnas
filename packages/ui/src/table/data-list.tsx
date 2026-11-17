'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  HTMLAttributes,
  JSX,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from 'react'

import { Table } from './table'

export type Column<T> = {
  key: string
  header: string
  render(row: T): ReactNode
  /** Right-aligns in the table (with tabular-nums); cards keep it left. */
  align?: 'left' | 'right'
  mono?: boolean
  /** The card's title. Defaults to the first column shown on cards. */
  primary?: boolean
  /** Left out of the card list. */
  hideOnCard?: boolean
}

export type CardBreakpoint = 'sm' | 'md' | 'lg' | 'xl'

// Tailwind reads class names statically, so each breakpoint spells both out.
const BREAKPOINTS: Record<CardBreakpoint, { table: string; cards: string }> = {
  sm: { table: 'hidden sm:block', cards: 'sm:hidden' },
  md: { table: 'hidden md:block', cards: 'md:hidden' },
  lg: { table: 'hidden lg:block', cards: 'lg:hidden' },
  xl: { table: 'hidden xl:block', cards: 'xl:hidden' },
}

export type RowExtras = HTMLAttributes<HTMLElement> & {
  [data: `data-${string}`]: string | undefined
}

export type DataListProps<T> = {
  rows: readonly T[]
  columns: readonly Column<T>[]
  rowKey: (row: T) => string
  /** Makes rows keyboard-activatable buttons. */
  onRowClick?: (row: T) => void
  selectedKey?: string
  /** Shown once, in place of both layouts, when there are no rows. */
  empty?: ReactNode
  /** The table's caption (visually hidden) and the card list's label. */
  caption?: string
  /** Width from which the table replaces the card list. */
  cardBreakpoint?: CardBreakpoint
  /**
   * Extra attributes for the row: the table `<tr>` and the card `<li>`.
   * `className` is merged after DataList's own and `style` shallowly; the
   * `onRowClick` handlers, `tabIndex`, `key` and `data-selected` always win.
   */
  rowProps?: (row: T, index: number) => RowExtras
}

const CONTROLS = 'a, button, input, select, textarea, label, [role="button"]'

/** A click on a control inside the row belongs to that control. */
function onControl(event: MouseEvent): boolean {
  return (
    event.target instanceof Element && event.target.closest(CONTROLS) !== null
  )
}

function activateOnKey(event: KeyboardEvent, activate: () => void) {
  // A control inside the row keeps its own Enter/Space.
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    activate()
  }
}

/**
 * One column definition, two renderings: a `Table` from the breakpoint up and
 * a card list below it. Both are in the DOM and CSS picks one, as `auth` does,
 * so the data can't drift between them.
 */
export function DataList<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  empty,
  caption,
  cardBreakpoint = 'md',
  rowProps,
}: DataListProps<T>): JSX.Element {
  if (rows.length === 0) return <>{empty}</>

  const bp = BREAKPOINTS[cardBreakpoint]
  const cardColumns = columns.filter(c => !c.hideOnCard)
  const primary = cardColumns.find(c => c.primary) ?? cardColumns[0]
  const details = cardColumns.filter(c => c !== primary)

  function interaction(row: T) {
    if (!onRowClick) return {}
    return {
      tabIndex: 0,
      onClick: (e: MouseEvent) => {
        if (!onControl(e)) onRowClick(row)
      },
      onKeyDown: (e: KeyboardEvent) => activateOnKey(e, () => onRowClick(row)),
    }
  }

  const clickable = onRowClick ? 'cursor-pointer' : undefined

  return (
    <>
      <div className={cns('overflow-x-auto', bp.table)}>
        <Table.Root>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <Table.Head>
            <Table.Row>
              {columns.map(col => (
                <Table.Th align={col.align} key={col.key} scope="col">
                  {col.header}
                </Table.Th>
              ))}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {rows.map((row, index) => {
              const key = rowKey(row)
              const { className, style, ...extra } =
                rowProps?.(row, index) ?? {}
              return (
                <Table.Row
                  {...extra}
                  {...interaction(row)}
                  className={cns(clickable, className)}
                  key={key}
                  selected={key === selectedKey}
                  style={style}
                >
                  {columns.map(col => (
                    <Table.Td align={col.align} key={col.key} mono={col.mono}>
                      {col.render(row)}
                    </Table.Td>
                  ))}
                </Table.Row>
              )
            })}
          </Table.Body>
        </Table.Root>
      </div>

      <ul aria-label={caption} className={cns('flex flex-col', bp.cards)}>
        {rows.map((row, index) => {
          const key = rowKey(row)
          const selected = key === selectedKey
          const { className, style, ...extra } = rowProps?.(row, index) ?? {}
          return (
            <li
              {...extra}
              {...interaction(row)}
              className={cns(
                'flex flex-col gap-2.5 px-4 py-3.5 transition-colors duration-[120ms] ease-standard [&+&]:border-t [&+&]:border-line-soft',
                selected ? 'bg-accent-ghost' : 'hover:bg-surface-2',
                clickable,
                className,
              )}
              data-selected={selected ? '' : undefined}
              key={key}
              style={style}
            >
              {primary ? (
                <div
                  className={cns(
                    'min-w-0 text-[13.5px] font-medium break-words text-ink',
                    primary.mono && 'font-mono',
                  )}
                >
                  {primary.render(row)}
                </div>
              ) : null}
              {details.length > 0 ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                  {details.map(col => (
                    <div
                      className="flex min-w-0 flex-col gap-0.5"
                      key={col.key}
                    >
                      <dt className="text-ink-4">{col.header}</dt>
                      <dd
                        className={cns(
                          'min-w-0 text-left text-ink-2',
                          col.mono && 'font-mono',
                        )}
                      >
                        {col.render(row)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}
