import { Card, StatusDot, type StatusDotTone } from '@lilnas/ui'
import type { JSX } from 'react'

import { StateHead } from 'src/components/steps/state-head'

const STEPS: { tone: StatusDotTone; pulse?: boolean; label: string }[] = [
  { tone: 'ok', label: 'Photos and videos downloaded' },
  { tone: 'accent', pulse: true, label: 'Creating your Immich account' },
  { tone: 'idle', label: 'Creating your library' },
]

/** The download is over; the server is creating the Immich account and library. */
export function Finishing(): JSX.Element {
  return (
    <section data-step="finishing">
      <StateHead
        badge={{ tone: 'accent', label: 'Finishing', live: true }}
        lede="Creating your Immich account and library. This takes a moment."
        title="Setting up your photos"
      />
      <Card className="mt-6">
        <ul className="flex flex-col gap-3">
          {STEPS.map(step => (
            <li key={step.label} className="flex items-center gap-2.5 text-sm">
              <StatusDot pulse={step.pulse} tone={step.tone} />
              <span
                className={step.tone === 'idle' ? 'text-ink-3' : 'text-ink'}
              >
                {step.label}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}
