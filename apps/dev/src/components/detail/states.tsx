import { Button, Card, EmptyState, Icon, Note, Skeleton } from '@lilnas/ui'
import Link from 'next/link'
import type { JSX } from 'react'

/** The API says there is no stack with this id (404). */
export function NotFound({ id }: { id: string }): JSX.Element {
  return (
    <Card className="mx-auto max-w-[560px]">
      <EmptyState
        action={
          <Button render={<Link href="/" />} size="sm" variant="accent">
            Back to all stacks
          </Button>
        }
        body={`Nothing on this host is called ${id}. Its compose file may have moved or been removed.`}
        title="No such stack"
      />
    </Card>
  )
}

/** The API didn't answer. `stale` says whether there is a page on screen. */
export function DetailError({
  message,
  stale,
  retryInSeconds,
  onRetry,
}: {
  message: string
  stale: boolean
  retryInSeconds: number
  onRetry: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <Note
        icon={<Icon name="alert" />}
        lead="Couldn’t load this stack."
        tone="bad"
      >
        The dashboard’s API didn’t answer
        {stale ? ', so what’s below may be stale' : ''}. Retrying in{' '}
        {retryInSeconds}s.
        <span className="mt-1 block font-mono text-mono-sm break-words text-ink-3">
          {message}
        </span>
      </Note>
      <div>
        <Button icon="refresh" onClick={onRetry} size="sm">
          Retry now
        </Button>
      </div>
    </div>
  )
}

/** Placeholder while the first answer is on its way. Shapes match what's coming. */
export function DetailSkeleton(): JSX.Element {
  const lines = (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )

  return (
    <div
      aria-busy="true"
      aria-label="Loading stack"
      className="flex flex-col gap-5"
      role="status"
    >
      <p className="text-sm text-ink-3">Reading this stack from Docker…</p>
      <Card className="flex flex-col gap-3">
        <Skeleton className="h-6 w-1/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </Card>
      <Card>{lines}</Card>
      <div className="grid gap-5 md:grid-cols-2">
        <Card>{lines}</Card>
        <Card>{lines}</Card>
      </div>
    </div>
  )
}
