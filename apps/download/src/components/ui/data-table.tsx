import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * Every cell rule lives here, on the `<table>`, expressed with descendant
 * variants rather than repeated on each `<th>`/`<td>`. That is what keeps a
 * row readable as markup — a body row is `<tr><td>…</td></tr>` and nothing
 * else — and it is why this string is as long as it is. Do not distribute it
 * back onto the cells.
 *
 * Headers are mono uppercase: a field name is the machine talking.
 *
 * One deliberate difference from `ui.pug`, which writes `[&_th]:text-label`:
 * `cns` is `twMerge(clsx(...))`, and tailwind-merge does not know this theme's
 * custom `--text-*` tokens. It classifies the unrecognised `text-label` as a
 * *colour* utility, so `[&_th]:text-label` and `[&_th]:text-ink-4` land in the
 * same conflict group and the size is silently dropped — headers would render
 * at the inherited 15px body size. Naming the token as an arbitrary length
 * makes tailwind-merge classify it as a font size, which is what it is. The
 * generated CSS is unchanged: `--text-label` declares no line-height, and its
 * `--font-weight: 500` / `--letter-spacing: 0.11em` modifiers are already
 * spelled out below as `[&_th]:font-medium` and `[&_th]:tracking-[0.11em]`.
 */
const DATA_TABLE_CLASSES = cns(
  'w-full border-collapse',
  '[&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:py-3 [&_td]:align-middle [&_td]:text-sm',
  '[&_tbody_tr]:transition-colors [&_tbody_tr]:duration-[120ms] [&_tbody_tr]:ease-uv',
  '[&_tbody_tr:hover]:bg-surface-2 [&_tbody_tr:last-child_td]:border-b-0',
  '[&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left',
  '[&_th]:font-mono [&_th]:text-[length:var(--text-label)] [&_th]:font-medium',
  '[&_th]:tracking-[0.11em] [&_th]:uppercase [&_th]:text-ink-4',
)

export type DataTableProps = ComponentPropsWithoutRef<'table'>

/**
 * A data table. Compose it with plain table markup — the component renders the
 * `<table>` and nothing more, and the caller supplies `<thead>`/`<tbody>`:
 *
 * ```tsx
 * <Card className="px-1.5 pt-1 pb-1.5">
 *   <DataTable>
 *     <thead>
 *       <tr>
 *         <th className="w-[38%]">item</th>
 *         <th className="text-right!">started</th>
 *       </tr>
 *     </thead>
 *     <tbody>
 *       {jobs.map(job => (
 *         <tr key={job.id}>
 *           <td>{job.title}</td>
 *           <td className="text-right!">{formatRelative(job.createdAt, now)}</td>
 *         </tr>
 *       ))}
 *     </tbody>
 *   </DataTable>
 * </Card>
 * ```
 *
 * Per-cell overrides go on the cell and need `!` to beat the table's descendant
 * variants, which is what `text-right!` is doing above. On narrow viewports the
 * mockups wrap the table in an `overflow-x-auto` `Card` and give the table a
 * `min-w-[480px]` rather than reflowing it.
 */
export function DataTable({
  className,
  ...props
}: DataTableProps): JSX.Element {
  return <table {...props} className={cns(DATA_TABLE_CLASSES, className)} />
}
