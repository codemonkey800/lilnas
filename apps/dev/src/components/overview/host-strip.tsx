import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { Dot } from 'src/components/ui/status'
import { formatAgo, formatBytes, UNKNOWN_VALUE } from 'src/lib/format'
import type { Overview } from 'src/stacks/stacks.types'

function HostStat({
  value,
  label,
  className,
}: {
  value: string | number
  label: string
  className?: string
}): JSX.Element {
  return (
    <div className={cns('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="font-mono text-[22px] leading-[1.15] font-semibold tracking-[-0.02em] tabular-nums">
        {value}
      </span>
      <span className="font-mono text-label tracking-[0.11em] text-ink-4 uppercase">
        {label}
      </span>
    </div>
  )
}

/** What the reaper's windows are across the services it watches. */
export function reaperSummary(stacks: Overview['stacks']): string {
  const hours = new Set<number>()
  for (const stack of stacks) {
    for (const svc of stack.services) {
      if (svc.idleReap.enabled) hours.add(svc.idleReap.maxIdleHours)
    }
  }

  if (hours.size === 0) return UNKNOWN_VALUE
  const sorted = [...hours].sort((a, b) => a - b)
  const [min, max] = [sorted[0], sorted[sorted.length - 1]]
  return min === max ? `${min}h idle` : `${min}–${max}h idle`
}

/** The strip under the app bar: what's on the host, at a glance. */
export function HostStrip({
  overview,
  now,
}: {
  overview: Overview
  now: number
}): JSX.Element {
  const { host, stacks } = overview

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border border-line bg-surface p-4 sm:flex sm:items-center sm:gap-8 sm:px-6 sm:py-4">
      <HostStat label="stacks" value={stacks.length} />
      <HostStat label="running containers" value={host.containers} />
      <HostStat label="dev memory" value={formatBytes(host.memoryBytes)} />
      <HostStat
        className="sm:border-l sm:border-line-soft sm:pl-8"
        label="reaper"
        value={reaperSummary(stacks)}
      />
      <span className="ml-auto hidden items-center gap-2 font-mono text-mono-sm text-ink-3 sm:flex">
        <Dot tone="live" />
        updated {formatAgo(host.generatedAt, now)}
      </span>
    </div>
  )
}
