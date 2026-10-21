import type { JSX } from 'react'

import { Button } from 'src/components/ui/button'
import { Callout } from 'src/components/ui/callout'
import { Card } from 'src/components/ui/card'
import { Skeleton } from 'src/components/ui/feedback'
import { PEPE_SYMBOL_ID } from 'src/components/ui/icon'

/** Nothing discovered: no lilnas app and no `~/dev` project. */
export function EmptyState({
  onRefresh,
}: {
  onRefresh: () => void
}): JSX.Element {
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <svg aria-hidden="true" className="h-14 w-14">
        <use href={`#${PEPE_SYMBOL_ID}`} />
      </svg>
      <p className="text-h3">No dev stacks yet</p>
      <p className="max-w-[40ch] text-sm text-ink-3">
        Any folder in ~/dev with a docker-compose file, and any lilnas app with
        a deploy.dev.yml, shows up here, ready to bring up.
      </p>
      <Button icon="refresh" onClick={onRefresh} size="sm" variant="outline">
        Refresh
      </Button>
    </Card>
  )
}

/** The API didn't answer. `stale` says whether there is a list on screen. */
export function ErrorPanel({
  message,
  retryInSeconds,
  stale,
  onRetry,
}: {
  message: string
  retryInSeconds: number
  stale: boolean
  onRetry: () => void
}): JSX.Element {
  return (
    <Card className="flex flex-col gap-3">
      <Callout icon="alert" tone="bad">
        <p className="font-medium text-ink">Couldn’t load the stack list.</p>
        <p className="mt-0.5 text-ink-3">
          The dashboard’s API didn’t answer
          {stale ? ', so the stacks below may be stale' : ''}. Retrying in{' '}
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
export function LoadingState(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading stacks" role="status">
      <Skeleton className="mb-8 h-[78px] rounded-lg" />
      <div className="columns-1 gap-x-4 md:columns-2 xl:columns-3">
        {[0, 1, 2].map(i => (
          <Skeleton className="mb-4 h-[220px] rounded-lg" key={i} />
        ))}
      </div>
    </div>
  )
}
