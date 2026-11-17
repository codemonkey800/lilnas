import { Card, StatusDot } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { formatAgo, formatBytes, UNKNOWN_VALUE } from 'src/lib/format'
import type { Overview } from 'src/stacks/stacks.types'

/** One figure on the strip. Numbers are Geist, tabular — not mono. */
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
    <div className={cns('flex min-w-0 flex-col', className)}>
      <span className="text-h1 tabular-nums">{value}</span>
      <span className="text-label text-ink-3 uppercase">{label}</span>
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
    <Card>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-1 sm:flex sm:items-center sm:gap-8 sm:px-3 sm:py-1">
        <HostStat label="stacks" value={stacks.length} />
        <HostStat label="running containers" value={host.containers} />
        <HostStat label="dev memory" value={formatBytes(host.memoryBytes)} />
        <HostStat
          className="sm:border-l sm:border-line-soft sm:pl-8"
          label="reaper"
          value={reaperSummary(stacks)}
        />
        <span className="col-span-2 flex items-center gap-2 border-t border-line-soft pt-3 text-cap text-ink-3 sm:ml-auto sm:border-t-0 sm:pt-0">
          <StatusDot pulse tone="ok" />
          updated {formatAgo(host.generatedAt, now)}
        </span>
      </div>
    </Card>
  )
}
