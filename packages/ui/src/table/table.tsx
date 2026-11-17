import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithRef, JSX } from 'react'

export type TableAlign = 'left' | 'right'

/** Numeric columns right-align and set their figures in tabular-nums. */
const ALIGN: Record<TableAlign, string> = {
  left: 'text-left',
  right: 'text-right tabular-nums',
}

function Root({
  className,
  ...props
}: ComponentPropsWithRef<'table'>): JSX.Element {
  return (
    <table {...props} className={cns('w-full border-collapse', className)} />
  )
}

function Head(props: ComponentPropsWithRef<'thead'>): JSX.Element {
  return <thead {...props} />
}

/** The last row has no border, so a table sits flush in its `Panel`. */
function Body({
  className,
  ...props
}: ComponentPropsWithRef<'tbody'>): JSX.Element {
  return (
    <tbody
      {...props}
      className={cns('[&>tr:last-child>td]:border-b-0', className)}
    />
  )
}

export type TableRowProps = ComponentPropsWithRef<'tr'> & {
  /** Tints the row with the accent. */
  selected?: boolean
}

/** Only body rows react to the pointer; a header row is not a target. */
function Row({
  selected = false,
  className,
  ...props
}: TableRowProps): JSX.Element {
  return (
    <tr
      {...props}
      className={cns(
        'transition-colors duration-[120ms] ease-standard',
        selected
          ? 'bg-accent-ghost in-[tbody]:hover:bg-accent-ghost'
          : 'in-[tbody]:hover:bg-surface-2',
        className,
      )}
      data-selected={selected ? '' : undefined}
    />
  )
}

export type ThProps = Omit<ComponentPropsWithRef<'th'>, 'align'> & {
  align?: TableAlign
}

function Th({ align = 'left', className, ...props }: ThProps): JSX.Element {
  return (
    <th
      {...props}
      className={cns(
        'border-b border-line-loud px-3 pb-2.5 text-label font-medium uppercase text-ink-3',
        ALIGN[align],
        className,
      )}
    />
  )
}

export type TdProps = Omit<ComponentPropsWithRef<'td'>, 'align'> & {
  align?: TableAlign
  /** Identifiers (IDs, paths, hostnames) are set in Geist Mono. */
  mono?: boolean
}

function Td({
  align = 'left',
  mono = false,
  className,
  ...props
}: TdProps): JSX.Element {
  return (
    <td
      {...props}
      className={cns(
        'border-b border-line-soft px-3 py-2.5 align-middle text-[13.5px]',
        ALIGN[align],
        mono && 'font-mono',
        className,
      )}
    />
  )
}

/**
 * Table parts that carry the design's cell rules, so a row is plain markup:
 *
 * ```tsx
 * <Table.Root>
 *   <Table.Head>
 *     <Table.Row><Table.Th>Name</Table.Th><Table.Th align="right">Size</Table.Th></Table.Row>
 *   </Table.Head>
 *   <Table.Body>
 *     <Table.Row><Table.Td>a</Table.Td><Table.Td align="right">1</Table.Td></Table.Row>
 *   </Table.Body>
 * </Table.Root>
 * ```
 *
 * Below `md` use `DataList`, which renders this table and a card list from one
 * column definition.
 */
export const Table = { Root, Head, Body, Row, Th, Td }
