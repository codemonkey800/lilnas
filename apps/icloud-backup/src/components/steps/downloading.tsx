import {
  Button,
  Card,
  ConfirmDialog,
  Note,
  Progress,
  StatusDot,
} from '@lilnas/ui'
import { type JSX, useState } from 'react'

import { MiddleTruncate } from 'src/components/steps/middle-truncate'
import { StateHead } from 'src/components/steps/state-head'
import { PHONE_FULL } from 'src/components/steps/styles'
import type { StepProps } from 'src/components/steps/types'
import { useAction } from 'src/components/steps/use-action'
import { formatBytes, formatCount } from 'src/lib/format'
import { progressPercent } from 'src/lib/progress'

/** The live screen: count, bar, size so far, current file and Stop. */
export function Downloading({ view, actions }: StepProps): JSX.Element | null {
  const [confirming, setConfirming] = useState(false)
  const stop = useAction()

  const job = view.job
  if (!job) return null

  const pct = progressPercent(job)
  const title =
    job.totalItems === null
      ? 'Counting…'
      : `${formatCount(job.downloadedItems)} of ${formatCount(job.totalItems)} photos and videos`

  const onStop = async (): Promise<void> => {
    const stopped = await stop.run(actions.cancel)
    if (!stopped) setConfirming(false)
  }

  return (
    <section data-step="downloading">
      <StateHead
        badge={{ tone: 'accent', label: 'Downloading', live: true }}
        lede={
          job.skippedItems > 0
            ? `${formatCount(job.skippedItems)} already on the server.`
            : undefined
        }
        title={title}
      />

      <Card className="mt-5">
        <div className="flex items-center gap-3">
          <Progress
            className="flex-1"
            indeterminate={pct === null}
            label="Backup progress"
            max={100}
            value={pct ?? 0}
          />
          {pct !== null ? (
            <span className="w-9 shrink-0 text-right text-cap text-ink-3 tabular-nums">
              {pct}%
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex flex-col gap-x-6 gap-y-1 sm:flex-row sm:items-baseline sm:justify-between">
          <p>
            <span className="text-h3 tabular-nums">
              {formatBytes(job.downloadedBytes)}
            </span>
            <span className="ml-1.5 text-sm text-ink-3">so far</span>
          </p>
          {job.currentFile ? (
            <MiddleTruncate
              className="block min-w-0 font-mono text-mono-sm text-ink-2"
              text={job.currentFile}
            />
          ) : null}
        </div>
      </Card>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2.5 text-sm text-ink-3">
          <StatusDot pulse tone="accent" />
          You can close this tab. Your backup keeps going.
        </p>
        <Button
          className={PHONE_FULL}
          icon="stop"
          onClick={() => setConfirming(true)}
        >
          Stop
        </Button>
      </div>

      {stop.error ? (
        <Note className="mt-4" lead="Couldn't stop the backup." tone="bad">
          {stop.error}
        </Note>
      ) : null}

      <ConfirmDialog
        body="Photos already saved stay on the server. You can start again later."
        cancelLabel="Keep going"
        confirmLabel="Stop backup"
        open={confirming}
        pending={stop.pending}
        title="Stop this backup?"
        tone="accent"
        onConfirm={() => void onStop()}
        onOpenChange={setConfirming}
      />
    </section>
  )
}
