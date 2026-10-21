import type { JSX } from 'react'

import { Button } from 'src/components/ui/button'
import { buttonRecipeClassName } from 'src/components/ui/button-recipe'
import { Callout } from 'src/components/ui/callout'
import { Card } from 'src/components/ui/card'
import { Skeleton } from 'src/components/ui/feedback'
import { PEPE_SYMBOL_ID } from 'src/components/ui/icon'

/** The API says there is no stack with this id (404). */
export function NotFound({ id }: { id: string }): JSX.Element {
  return (
    <Card className="mx-auto flex max-w-[560px] flex-col items-center gap-3 py-10 text-center">
      <svg aria-hidden="true" className="h-14 w-14">
        <use href={`#${PEPE_SYMBOL_ID}`} />
      </svg>
      <h1 className="text-h3">No such stack</h1>
      <p className="max-w-[44ch] text-sm text-ink-3">
        Nothing on this host is called{' '}
        <code className="font-mono text-mono-sm break-all text-ink-2">
          {id}
        </code>
        . Its compose file may have moved or been removed.
      </p>
      <a
        className={buttonRecipeClassName({ variant: 'outline', size: 'sm' })}
        href="/"
      >
        Back to all stacks
      </a>
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
    <Card className="flex flex-col gap-3">
      <Callout icon="alert" tone="bad">
        <p className="font-medium text-ink">Couldn’t load this stack.</p>
        <p className="mt-0.5 text-ink-3">
          The dashboard’s API didn’t answer
          {stale ? ', so what’s below may be stale' : ''}. Retrying in{' '}
          {retryInSeconds}s.
        </p>
        <p className="mt-1.5 font-mono text-mono-sm break-words text-ink-4">
          {message}
        </p>
      </Callout>
      <div className="flex gap-2">
        <Button icon="refresh" onClick={onRetry} size="sm" variant="outline">
          Retry now
        </Button>
      </div>
    </Card>
  )
}

/** Placeholder while the first answer is on its way. */
export function DetailSkeleton(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Loading stack"
      className="flex flex-col gap-5"
      role="status"
    >
      <Skeleton className="h-[120px] rounded-lg" />
      <Skeleton className="h-[220px] rounded-lg" />
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="h-[180px] rounded-lg" />
        <Skeleton className="h-[180px] rounded-lg" />
      </div>
    </div>
  )
}
