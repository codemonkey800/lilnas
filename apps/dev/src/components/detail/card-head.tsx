import type { JSX, ReactNode } from 'react'

/**
 * A detail card's heading row: title and caption on the left, whatever the
 * block holds (a badge, a status) on the right.
 */
export function CardHead({
  title,
  caption,
  children,
}: {
  title: string
  caption?: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-h3">{title}</h2>
        {caption ? <p className="text-cap text-ink-3">{caption}</p> : null}
      </div>
      {children}
    </div>
  )
}
