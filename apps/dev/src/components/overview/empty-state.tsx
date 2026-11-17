import {
  Button,
  Card,
  EmptyState as EmptyStateView,
  Icon,
  Note,
  Skeleton,
} from '@lilnas/ui'
import type { JSX } from 'react'

/** Nothing discovered: no lilnas app and no `~/dev` project. */
export function EmptyState({
  onRefresh,
}: {
  onRefresh: () => void
}): JSX.Element {
  return (
    <Card>
      <EmptyStateView
        action={
          <Button icon="refresh" onClick={onRefresh} size="sm" variant="accent">
            Refresh
          </Button>
        }
        body="Add a compose file under ~/dev, or a deploy.dev.yml to an app, and it’ll show up here, ready to bring up."
        title="No dev stacks yet"
      />
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
    <div className="flex flex-col gap-3">
      <Note
        icon={<Icon name="alert" />}
        lead="Couldn’t load the stack list."
        tone="bad"
      >
        The dashboard’s API didn’t answer
        {stale ? ', so the stacks below may be stale' : ''}. Retrying in{' '}
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
export function LoadingState(): JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Loading stacks"
      className="flex flex-col gap-4"
      role="status"
    >
      <p className="text-sm text-ink-3">Reading stacks from Docker…</p>
      <Card>
        <div className="flex gap-8 p-1">
          {['w-14', 'w-14', 'w-16'].map((w, i) => (
            <div className="flex flex-col gap-2" key={i}>
              <Skeleton className={`${w} h-6`} />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </Card>
      <div className="columns-1 gap-x-4 md:columns-2 xl:columns-3">
        {[0, 1, 2].map(i => (
          <Card className="mb-4 flex break-inside-avoid flex-col gap-3" key={i}>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-6 w-16 rounded-full!" />
            </div>
            <Skeleton className="h-3 w-2/3" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <div className="flex gap-1.5 border-t border-line-soft pt-3">
              {[0, 1, 2].map(j => (
                <Skeleton
                  className="h-(--control-h-sm) w-16 rounded-md!"
                  key={j}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
