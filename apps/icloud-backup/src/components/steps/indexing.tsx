import { Card } from '@lilnas/ui'
import type { JSX } from 'react'

import { StateHead } from 'src/components/steps/state-head'
import type { StepProps } from 'src/components/steps/types'
import { useNow } from 'src/lib/use-now'

/** 95 seconds -> "1:35". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function AttemptBar({
  attempt,
  max,
}: {
  attempt: number
  max: number
}): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((attempt / max) * 100)) : 0

  return (
    <div
      aria-label="Attempts so far"
      aria-valuemax={max}
      aria-valuemin={0}
      aria-valuenow={Math.min(attempt, max)}
      className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
    >
      <span
        className="block h-full rounded-full bg-warn transition-[width] duration-[380ms] ease-standard"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** Apple is still building the library; the server retries on a timer. */
export function Indexing({ view }: StepProps): JSX.Element {
  const job = view.job
  const retryAt = job?.retryAt ? Date.parse(job.retryAt) : NaN
  const hasRetry = !Number.isNaN(retryAt)
  const now = useNow(1000, hasRetry)

  const remaining = retryAt - now
  const lede = !hasRetry
    ? 'Trying again soon.'
    : remaining > 0
      ? `Trying again in ${formatCountdown(remaining)}.`
      : 'Trying again now.'

  return (
    <section data-step="indexing">
      <StateHead
        badge={{ tone: 'warn', label: 'Waiting for Apple' }}
        lede={<span aria-live="off">{lede}</span>}
        title="Apple is still preparing your library"
      />
      {job ? (
        <Card className="mt-6">
          <AttemptBar attempt={job.attempt} max={job.maxAttempts} />
          <p className="mt-2 text-cap text-ink-3">
            Attempt {job.attempt} of {job.maxAttempts}
          </p>
        </Card>
      ) : null}
      <p className="mt-4 text-sm text-ink-3">
        Big libraries can take a while. You can close this tab.
      </p>
    </section>
  )
}
