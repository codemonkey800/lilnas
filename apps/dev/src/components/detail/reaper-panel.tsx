import { Badge, Card, Meter } from '@lilnas/ui'
import type { JSX, ReactNode } from 'react'

import { CardHead } from 'src/components/detail/card-head'
import {
  idlePercent,
  summarizeReaper,
} from 'src/components/detail/reaper-summary'
import { formatClock } from 'src/components/detail/time'
import {
  formatAgo,
  formatDuration,
  formatUntil,
  UNKNOWN_VALUE,
} from 'src/lib/format'
import type { StackView } from 'src/stacks/stacks.types'

function Row({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line-soft py-2 first:border-t-0 first:pt-0">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  )
}

const Aside = ({ children }: { children: ReactNode }) => (
  <span className="text-ink-3"> {children}</span>
)

/** When the idle reaper will take the stack, and the numbers behind that. */
export function ReaperPanel({
  stack,
  now,
}: {
  stack: StackView
  now: number
}): JSX.Element {
  const reaper = summarizeReaper(stack)
  const maxIdle = reaper.maxIdleHours
    ? formatDuration(reaper.maxIdleHours * 3_600_000)
    : UNKNOWN_VALUE
  const idle = idlePercent(reaper.lastActiveAt, reaper.maxIdleHours, now)
  const lastActive = formatAgo(reaper.lastActiveAt, now)

  return (
    <Card aria-label="Idle reaper" role="region">
      <CardHead
        caption={
          reaper.enabled
            ? `stops after ${maxIdle} without a visit`
            : 'never stops this stack'
        }
        title="Idle reaper"
      >
        <Badge>{reaper.enabled ? 'On' : 'Off'}</Badge>
      </CardHead>
      <dl>
        <Row label="Last visit">{lastActive}</Row>
        <Row label="Active users">
          {reaper.activeUsers ?? UNKNOWN_VALUE}
          {reaper.activeUsers !== undefined && reaper.maxIdleHours ? (
            <Aside>in {reaper.maxIdleHours}h</Aside>
          ) : null}
        </Row>
        <Row label="Max idle">
          {maxIdle}
          {reaper.maxIdleSource ? <Aside>{reaper.maxIdleSource}</Aside> : null}
        </Row>
        <Row label="Reaps at">
          {reaper.reapsAt ? (
            <>
              {formatClock(reaper.reapsAt)}
              <Aside>in {formatUntil(reaper.reapsAt, now)}</Aside>
            </>
          ) : reaper.activeUsers ? (
            <span className="text-ink-3">not while users are active</span>
          ) : (
            UNKNOWN_VALUE
          )}
        </Row>
      </dl>
      {idle !== undefined ? (
        <Meter
          className="mt-1"
          detail={`${lastActive.replace(' ago', '')} of ${maxIdle}`}
          label="Idle"
          max={100}
          value={idle}
        />
      ) : null}
      <p className="mt-3 text-sm text-ink-3">
        <span className="font-medium text-ink-2">Basis.</span> {reaper.basis}
      </p>
    </Card>
  )
}
