import { cns } from '@lilnas/utils/cns'
import type { ReactNode } from 'react'

const TONES = {
  warn: { fill: 'bg-warn-ghost', lead: 'text-warn' },
  bad: { fill: 'bg-bad-ghost', lead: 'text-bad' },
} as const

/**
 * A `Note` look-alike for inside a `ConfirmDialog` body. That body renders in
 * a `<p>`, which can't hold `Note`'s `<div>`, so this is spans end to end.
 */
export function DialogNote({
  tone,
  lead,
  children,
}: {
  tone: keyof typeof TONES
  lead: ReactNode
  children?: ReactNode
}) {
  const { fill, lead: leadColor } = TONES[tone]

  return (
    <span
      className={cns(
        'mt-3 block rounded-lg px-3 py-2.5 text-sm text-ink-2',
        fill,
      )}
      role={tone === 'bad' ? 'alert' : 'status'}
    >
      <strong className={cns('font-semibold', leadColor)}>{lead}</strong>
      {children ? <> {children}</> : null}
    </span>
  )
}
