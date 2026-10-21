'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { useLayoutEffect, useRef } from 'react'

import { Panel, PanelHead } from 'src/components/detail/panel'
import { formatClock, formatTook } from 'src/components/detail/time'
import { useOperationStream } from 'src/components/logs/use-operation-stream'
import { Chip } from 'src/components/ui/chip'
import { Spinner } from 'src/components/ui/feedback'
import type { Operation } from 'src/lib/api'

/** A little slack so a sub-pixel gap still counts as "at the bottom". */
const BOTTOM_SLACK_PX = 24

/** What a finished operation says about itself on the right of the head. */
function ExitChip({ operation }: { operation: Operation }): JSX.Element {
  const failed = operation.status === 'failed'
  const label =
    operation.exitCode === undefined
      ? operation.status
      : `exit ${operation.exitCode}`
  return (
    <Chip
      icon={failed ? 'x' : 'check'}
      label={label}
      tone={failed ? 'bad' : 'ok'}
    />
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
  const scroller = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [lines, done])

  const failed = finished?.status === 'failed'
  const took =
    finished?.finishedAt && finished.startedAt
      ? formatTook(
          Date.parse(finished.finishedAt) - Date.parse(finished.startedAt),
        )
      : null

  return (
    <Panel aria-label="Operation log">
      <PanelHead
        caption={[
          operation.action,
          formatClock(operation.startedAt),
          operation.actor ?? 'dashboard',
        ].join(' · ')}
        title="Operation log"
      >
        {finished ? (
          <ExitChip operation={finished} />
        ) : (
          <Chip tone="uv">
            <Spinner className="h-[10px] w-[10px] border-[1.5px]" />
            running
          </Chip>
        )}
      </PanelHead>
      <div
        aria-live="polite"
        className="max-h-[320px] overflow-y-auto bg-bg-sunk px-5 py-4 font-mono text-[12px] leading-[1.7]"
        onScroll={event => {
          const el = event.currentTarget
          stuck.current =
            el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX
        }}
        ref={scroller}
        role="log"
      >
        <p className="break-all text-ink-3">$ {operation.command.join(' ')}</p>
        {lines.map((line, i) => (
          <p className="break-all text-ink-2" key={i}>
            {line.text}
          </p>
        ))}
        {finished ? (
          <p
            className={cns(
              'mt-1.5 border-t border-line-soft pt-1.5',
              failed ? 'text-bad' : 'text-ok',
            )}
          >
            exit {finished.exitCode ?? finished.status}
            {took ? ` · ${took}` : ''}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-ink-4">
            <span className="inline-block h-[14px] w-[7px] bg-uv align-middle" />
          </p>
        )}
      </div>
    </Panel>
  )
}
