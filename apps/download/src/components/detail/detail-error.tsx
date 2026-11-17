'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

export type DetailErrorProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'title'
> & {
  /** The server log's correlation id, when Next hands one over. */
  digest?: string
  /** Why, and that nothing was lost - the Note's body. */
  detail: ReactNode
  /** What broke, in one sentence - the Note's lead. */
  lead: string
  /** Re-runs the segment, which re-fetches. */
  onReset: () => void
  /** The page's heading: `This movie couldn’t be loaded`. */
  title: string
}

/**
 * A detail route's error boundary body - `boundaryError` in `download.pug`:
 * the page heading, a `bad` note saying what broke and that trying again is
 * safe, then the one Try again button with the digest beside it in mono.
 *
 * ⚠️ `error.message` is never rendered. A production build replaces it with a
 * generic string and a development one puts a stack trace's first line there.
 * The `digest` is the one thing that correlates this screen with the server
 * log that explains it, so it is the one thing shown.
 */
export function DetailError({
  className,
  detail,
  digest,
  lead,
  onReset,
  title,
  ...props
}: DetailErrorProps): JSX.Element {
  return (
    <div {...props} className={className}>
      <h1 className={cns('mb-4 text-h2')}>{title}</h1>
      <Note icon={<Icon name="alert" />} lead={lead} tone="bad">
        {detail}
      </Note>
      <div className={cns('mt-3 flex items-center gap-3')}>
        <Button icon="refresh" size="sm" variant="outline" onClick={onReset}>
          Try again
        </Button>
        {digest === undefined ? null : (
          <span className={cns('font-mono text-mono-sm text-ink-3')}>
            {`digest ${digest}`}
          </span>
        )}
      </div>
    </div>
  )
}
