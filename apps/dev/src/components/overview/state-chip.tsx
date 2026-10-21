import type { JSX } from 'react'

import { Chip } from 'src/components/ui/chip'
import { Spinner } from 'src/components/ui/feedback'
import { Dot } from 'src/components/ui/status'
import type { DisplayState } from 'src/lib/stack-display'

/** The state chip on a card (`dev.pug`'s `+stateChip`). `healthy` breathes. */
export function StateChip({
  state,
  className,
}: {
  state: DisplayState
  className?: string
}): JSX.Element {
  switch (state) {
    case 'healthy':
      return (
        <Chip className={className} tone="ok">
          <Dot tone="live" />
          running
        </Chip>
      )
    case 'unhealthy':
      return (
        <Chip className={className} icon="alert" label="unhealthy" tone="bad" />
      )
    case 'exited':
      return <Chip className={className} label="exited" tone="bad" />
    case 'absent':
      return <Chip className={className} label="absent" tone="mute" />
    case 'busy':
      return (
        <Chip className={className} tone="uv">
          <Spinner className="h-[10px] w-[10px] border-[1.5px]" />
          busy
        </Chip>
      )
    case 'env-missing':
      return (
        <Chip
          className={className}
          icon="file"
          label="env missing"
          tone="warn"
        />
      )
  }
}
