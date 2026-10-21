import type { JSX, ReactNode } from 'react'

import { Panel, PanelHead } from 'src/components/detail/panel'
import {
  idlePercent,
  summarizeReaper,
} from 'src/components/detail/reaper-summary'
import { formatClock } from 'src/components/detail/time'
import { Chip } from 'src/components/ui/chip'
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
    <div className="flex items-baseline justify-between gap-4 py-2 [&+&]:border-t [&+&]:border-line-soft">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right font-mono text-mono text-ink tabular-nums">
        {children}
      </dd>
    </div>
  )
}

const Aside = ({ children }: { children: ReactNode }) => (
  <span className="text-ink-4"> {children}</span>
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
    <Panel aria-label="Idle reaper">
      <PanelHead
        caption={
          reaper.enabled
            ? `stops after ${maxIdle} without a visit`
            : 'never stops this stack'
        }
        title="Idle reaper"
      >
        <Chip
          icon={reaper.enabled ? 'clock' : undefined}
          label={reaper.enabled ? 'on' : 'off'}
          tone="mute"
        />
      </PanelHead>
      <div className="px-5 pt-1 pb-4">
        <dl>
          <Row label="Last active">{lastActive}</Row>
          <Row label="Active users">
            {reaper.activeUsers ?? UNKNOWN_VALUE}
            {reaper.activeUsers !== undefined && reaper.maxIdleHours ? (
              <Aside>in {reaper.maxIdleHours}h</Aside>
            ) : null}
          </Row>
          <Row label="Max idle">
            {maxIdle}
            {reaper.maxIdleSource ? (
              <Aside>{reaper.maxIdleSource}</Aside>
            ) : null}
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
          <>
            <div
              aria-label={`Idle for ${lastActive.replace(' ago', '')} of ${maxIdle}`}
              className="mt-2 h-[5px] overflow-hidden rounded-full bg-surface-3"
              role="img"
            >
              <i
                className="block h-full rounded-full bg-uv transition-[width] duration-[380ms] ease-uv"
                style={{ width: `${idle}%` }}
              />
            </div>
            <p className="mt-1.5 flex justify-between font-mono text-mono-sm text-ink-4">
              <span>idle {lastActive.replace(' ago', '')}</span>
              <span>{maxIdle}</span>
            </p>
          </>
        ) : null}
        <p className="mt-3.5 text-sm text-ink-3">
          <span className="font-[560] text-ink-2">Basis.</span> {reaper.basis}
        </p>
      </div>
    </Panel>
  )
}
