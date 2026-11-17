import { EmptyState as UiEmptyState } from '@lilnas/ui'
import type { JSX, ReactNode } from 'react'

/** `message` is the title; add a `body` line and at most one `action`. */
export function EmptyState({
  message,
  body,
  action,
}: {
  message: string
  body?: string
  action?: ReactNode
}): JSX.Element {
  return (
    <UiEmptyState
      action={action}
      body={body}
      className="rounded-lg border border-dashed border-line"
      title={message}
    />
  )
}
