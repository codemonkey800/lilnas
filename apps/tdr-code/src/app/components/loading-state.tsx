import { Skeleton } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

const ROWS = ['w-full', 'w-11/12', 'w-full', 'w-4/5']

/** Says what is being fetched; the skeleton rows match a table's. */
export function LoadingState({
  message = 'Loading…',
  className,
}: {
  message?: string
  /** Overrides the card chrome, e.g. to sit flush inside a panel. */
  className?: string
}): JSX.Element {
  return (
    <div
      aria-busy="true"
      className={cns(
        'flex flex-col gap-3 rounded-lg border border-line bg-surface p-4',
        className,
      )}
      role="status"
    >
      <p className="text-sm text-ink-3">{message}</p>
      {ROWS.map((width, i) => (
        <Skeleton className={`h-3.5 ${width}`} key={i} />
      ))}
    </div>
  )
}
