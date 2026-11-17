import { Icon, StatusDot } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { formatAgo, formatBytes, formatSince } from 'src/lib/format'
import {
  reapNote,
  serviceName,
  serviceTone,
  serviceVerdict,
} from 'src/lib/stack-display'
import type { ServiceView } from 'src/stacks/stacks.types'

/** One container on a card: dot, name, verdict; then its numbers. */
export function ServiceRow({
  service,
  now,
}: {
  service: ServiceView
  now: number
}): JSX.Element {
  const { container, stats } = service
  const tone = serviceTone(service)
  const reap = reapNote(service.reap, now)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} />
        <span className="min-w-0 flex-1 truncate font-mono text-mono text-ink">
          {serviceName(service)}
        </span>
        <span
          className={cns(
            'shrink-0 font-mono text-mono-sm',
            tone === 'bad' ? 'text-bad' : 'text-ink-3',
          )}
        >
          {serviceVerdict(service)}
        </span>
      </div>

      {container?.state === 'running' ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-0.5 pl-4 text-cap text-ink-3 tabular-nums">
          <span>up {formatSince(container.startedAt, now)}</span>
          {stats ? (
            <>
              <span>cpu {stats.cpuPercent.toFixed(1)}%</span>
              <span>mem {formatBytes(stats.memoryBytes)}</span>
            </>
          ) : null}
          <span
            className={cns(
              'ml-auto inline-flex items-center gap-1.5',
              reap.warn && 'text-warn',
            )}
            title={reap.title}
          >
            <Icon name="clock" size={12} />
            {reap.text}
          </span>
        </div>
      ) : container?.state === 'exited' && container.finishedAt ? (
        <div className="pl-4 text-cap text-ink-3">
          stopped {formatAgo(container.finishedAt, now)}
        </div>
      ) : null}
    </div>
  )
}
