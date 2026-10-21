import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

/** The detail page's bordered section (`stack-detail.pug`'s `+panel`). */
export function Panel({
  className,
  ...props
}: ComponentPropsWithoutRef<'section'>): JSX.Element {
  return (
    <section
      {...props}
      className={cns(
        'overflow-hidden rounded-lg border border-line bg-surface',
        className,
      )}
    />
  )
}

/** A panel's title, a mono caption under it and room for a chip on the right. */
export function PanelHead({
  title,
  caption,
  children,
}: {
  title: string
  caption?: string
  children?: ReactNode
}): JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-line-soft px-5 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-h3">{title}</h2>
        {caption ? (
          <p className="font-mono text-mono-sm break-words text-ink-4">
            {caption}
          </p>
        ) : null}
      </div>
      {children}
    </header>
  )
}
