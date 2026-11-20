import { Card, Note, Progress } from '@lilnas/ui'
import type { JSX } from 'react'

import { StateHead } from 'src/components/steps/state-head'
import { SyncNow } from 'src/components/steps/sync-now'
import type { StepProps } from 'src/components/steps/types'
import { formatCount } from 'src/lib/format'
import { progressPercent } from 'src/lib/progress'

/** The server ran low on space; nothing for the person to do but wait. */
export function Paused({ view, actions }: StepProps): JSX.Element {
  const job = view.job
  const pct = job ? progressPercent(job) : null
  const saved = job ? job.downloadedItems + job.skippedItems : 0

  return (
    <section data-step="paused">
      <StateHead
        badge={{ tone: 'warn', label: 'Paused' }}
        lede="Your backup is paused so nothing gets cut off. It picks up by itself once there is room."
        title="The server is low on space"
      />
      <Note className="mt-5" lead="What to do:" tone="warn">
        nothing here. Tell Jeremy the server is full and he&apos;ll make room.
      </Note>
      {job ? (
        <Card className="mt-4">
          <Progress
            indeterminate={pct === null}
            label="Backup progress"
            max={100}
            value={pct ?? 0}
          />
          <p className="mt-2 text-cap text-ink-3">
            {job.totalItems === null
              ? `${formatCount(saved)} photos and videos saved so far`
              : `${formatCount(saved)} of ${formatCount(job.totalItems)} photos and videos saved so far`}
          </p>
        </Card>
      ) : null}
      <SyncNow
        actions={actions}
        className="mt-5"
        lowDiskSpace={view.lowDiskSpace}
      />
    </section>
  )
}
