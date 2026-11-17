'use client'

import {
  Badge,
  Card,
  type LogLine,
  LogViewer as LogPane,
  Progress,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { useMemo } from 'react'

import { CardHead } from 'src/components/detail/card-head'
import { formatClock, formatTook } from 'src/components/detail/time'
import { useOperationStream } from 'src/components/logs/use-operation-stream'
import type { Operation } from 'src/lib/api'

/** What a finished operation says about itself on the right of the head. */
function ExitBadge({ operation }: { operation: Operation }): JSX.Element {
  const label =
    operation.exitCode === undefined
      ? operation.status
      : `Exit ${operation.exitCode}`
  return (
    <Badge tone={operation.status === 'failed' ? 'bad' : 'ok'}>{label}</Badge>
  )
}

/**
 * The output of a compose operation. `operation` is the snapshot the page
 * saw (running, or just accepted); the stream replays its lines, follows it
 * live, and ends with the final operation, which gives the exit line.
 * The log sticks to the bottom until the reader scrolls up.
 */
export function OperationLog({
  operation,
}: {
  operation: Operation
}): JSX.Element {
  const { lines, done } = useOperationStream(operation.id)
  const finished = done ?? (operation.status === 'running' ? null : operation)

  const rows = useMemo<LogLine[]>(
    () =>
      lines.map((line, i) => ({
        id: i,
        message: line.text,
        stderr: line.stream === 'stderr',
      })),
    [lines],
  )

  const failed = finished?.status === 'failed'
  const took =
    finished?.finishedAt && finished.startedAt
      ? formatTook(
          Date.parse(finished.finishedAt) - Date.parse(finished.startedAt),
        )
      : null

  return (
    <Card aria-label="Operation log" role="region">
      <CardHead
        caption={[
          operation.action,
          formatClock(operation.startedAt),
          operation.actor ?? 'dashboard',
        ].join(' · ')}
        title="Operation log"
      >
        {finished ? (
          <ExitBadge operation={finished} />
        ) : (
          <Badge live tone="accent">
            Running
          </Badge>
        )}
      </CardHead>
      <p className="mb-2 font-mono text-mono-sm break-all text-ink-3">
        $ {operation.command.join(' ')}
      </p>
      {/* `follow` stays on: the well only sticks while the reader is at the
          bottom, so scrolling up to read doesn't get yanked back. */}
      <LogPane
        aria-label="Operation output"
        className="max-h-80"
        follow
        height="auto"
        lines={rows}
      />
      {finished ? (
        <p
          className={cns(
            'mt-3 font-mono text-mono-sm',
            failed ? 'text-bad' : 'text-ok',
          )}
        >
          exit {finished.exitCode ?? finished.status}
          {took ? ` · ${took}` : ''}
        </p>
      ) : (
        <Progress
          className="mt-3"
          indeterminate
          label="Operation running"
          tone="accent"
        />
      )}
    </Card>
  )
}
