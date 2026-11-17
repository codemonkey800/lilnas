import { cns } from '@lilnas/utils/cns'
import type { ReactNode } from 'react'

// A section's heading: the title, the count pill, and whatever sits at the
// right edge (a toolbar, a bulk action).
export function SectionHead({
  title,
  count,
  children,
  className,
}: {
  title: string
  count?: number
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cns(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-h2">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full bg-surface-2 px-1.5 font-mono text-[11px] text-ink">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}
