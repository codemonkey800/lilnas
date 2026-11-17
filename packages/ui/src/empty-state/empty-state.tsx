import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react'
import { Children } from 'react'

import { PepeFull } from '../marks'

export type EmptyStateProps = Omit<
  ComponentPropsWithRef<'div'>,
  'title' | 'children'
> & {
  title: string
  body?: string
  /** Exactly one thing to press; an empty state is never a dead end. */
  action?: ReactNode
}

/** The only place the mascot appears in normal UI. */
export function EmptyState({
  title,
  body,
  action,
  className,
  ...props
}: EmptyStateProps): JSX.Element {
  if (process.env.NODE_ENV !== 'production' && Children.count(action) > 1) {
    throw new Error('EmptyState takes exactly one action.')
  }

  return (
    <div {...props} className={cns('px-6 py-10 text-center', className)}>
      <PepeFull className="mx-auto opacity-55" size={46} />
      <h3 className="mt-3 text-h3">{title}</h3>
      {body ? (
        <p className="mx-auto mt-1 max-w-[34ch] text-sm text-ink-3">{body}</p>
      ) : null}
      {action ? (
        <div className="mt-4 flex justify-center" data-slot="action">
          {action}
        </div>
      ) : null}
    </div>
  )
}
