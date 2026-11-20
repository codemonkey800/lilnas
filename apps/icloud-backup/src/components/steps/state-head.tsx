import { Badge, type BadgeTone } from '@lilnas/ui'
import type { JSX, ReactNode } from 'react'

export interface StateBadge {
  tone: BadgeTone
  label: string
  /** The pulsing dot: only a backup that is running wears it. */
  live?: boolean
}

/** A status badge, then the one headline and the line under it. */
export function StateHead({
  badge,
  title,
  lede,
}: {
  badge: StateBadge
  title: ReactNode
  lede?: ReactNode
}): JSX.Element {
  return (
    <header>
      <div className="mb-4">
        <Badge live={badge.live} tone={badge.tone}>
          {badge.label}
        </Badge>
      </div>
      <h1 className="text-h1">{title}</h1>
      {lede ? <p className="mt-2 text-body text-ink-2">{lede}</p> : null}
    </header>
  )
}
