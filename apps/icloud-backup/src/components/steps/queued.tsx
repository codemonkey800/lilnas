import { Icon } from '@lilnas/ui'
import type { JSX } from 'react'

import { StateHead } from 'src/components/steps/state-head'

/** Waiting for one of the two download slots. */
export function Queued(): JSX.Element {
  return (
    <section data-step="queued">
      <StateHead
        badge={{ tone: 'warn', label: 'Queued' }}
        lede="Two backups run at a time. Yours starts as soon as one finishes."
        title="Your backup is in line"
      />
      <p className="mt-6 flex items-center gap-2 text-sm text-ink-3">
        <Icon name="clock" size={14} />
        You can close this tab. Your place in line is kept.
      </p>
    </section>
  )
}
