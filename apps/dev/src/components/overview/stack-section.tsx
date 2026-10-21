import type { JSX } from 'react'

import { StackCard } from 'src/components/overview/stack-card'
import { Card } from 'src/components/ui/card'
import type { StackView } from 'src/stacks/stacks.types'

/**
 * One group of cards under a heading. Cards differ a lot in height (one
 * container vs four plus a callout), so CSS columns pack them masonry-style
 * instead of a grid that stretches the short ones.
 */
export function StackSection({
  title,
  caption,
  empty,
  stacks,
  now,
  onChanged,
}: {
  title: string
  caption: string
  /** What to say when the group has no stacks. */
  empty: string
  stacks: StackView[]
  now: number
  onChanged: () => void
}): JSX.Element {
  return (
    <section aria-label={title} className="mb-9 last:mb-0">
      <div className="mb-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 className="text-h2">{title}</h2>
        <span className="font-mono text-mono-sm text-ink-4 tabular-nums">
          {stacks.length}
        </span>
        <span className="font-mono text-mono-sm text-ink-4">{caption}</span>
      </div>

      {stacks.length === 0 ? (
        <Card className="text-sm text-ink-3">{empty}</Card>
      ) : (
        <div className="columns-1 gap-x-4 md:columns-2 xl:columns-3">
          {stacks.map(stack => (
            <div className="mb-4 break-inside-avoid" key={stack.id}>
              <StackCard now={now} onChanged={onChanged} stack={stack} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
