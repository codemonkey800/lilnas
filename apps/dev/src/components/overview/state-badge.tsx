import { Badge, type BadgeTone } from '@lilnas/ui'
import type { JSX } from 'react'

import type { DisplayState } from 'src/lib/stack-display'

const LOOKS: Record<
  DisplayState,
  { tone: BadgeTone; label: string; live?: boolean }
> = {
  healthy: { tone: 'ok', label: 'Running', live: true },
  unhealthy: { tone: 'warn', label: 'Unhealthy' },
  exited: { tone: 'bad', label: 'Exited' },
  absent: { tone: 'mute', label: 'Absent' },
  busy: { tone: 'accent', label: 'Busy', live: true },
  'env-missing': { tone: 'warn', label: 'Env missing' },
}

/** The state badge on a card and on the detail header. */
export function StateBadge({
  state,
  className,
}: {
  state: DisplayState
  className?: string
}): JSX.Element {
  const { tone, label, live } = LOOKS[state]
  return (
    <Badge className={className} live={live} tone={tone}>
      {label}
    </Badge>
  )
}
