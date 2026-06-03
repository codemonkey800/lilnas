import type { DayCode } from 'src/db/schema'
import type { StatsScope } from 'src/lib/stats'
import { selectNeedsAttention } from 'src/lib/stats'

export type NeedsAttentionItem = {
  id: number
  name: string
  days: readonly DayCode[]
  lastPerformedAt: Date | null
}

type Props = {
  items: NeedsAttentionItem[]
  scope: StatsScope
  /** Total completed sessions in scope — cold-start gate. */
  completedSessionCount: number
  now: Date
}

const MAX_NOT_STARTED_SHOWN = 3

export function NeedsAttention({
  items,
  scope,
  completedSessionCount,
  now,
}: Props) {
  // Hidden entirely under archived scope (Decision 12)
  if (scope.kind === 'archived') return null

  // Hidden on cold-start: ≤1 completed session (Decision 11 / F4)
  if (completedSessionCount <= 1) return null

  const { overdue, notStarted } = selectNeedsAttention(items, now)

  // Self-hides when nothing qualifies (R22)
  if (overdue.length === 0 && notStarted.length === 0) return null

  const shownNotStarted = notStarted.slice(0, MAX_NOT_STARTED_SHOWN)
  const extraNotStarted = notStarted.length - shownNotStarted.length

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Needs attention
        </h2>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>

      <ul className="flex flex-col gap-1">
        {overdue.map(item => {
          const daysSince =
            item.lastPerformedAt !== null
              ? Math.floor(
                  (now.getTime() - item.lastPerformedAt.getTime()) /
                    (24 * 60 * 60 * 1000),
                )
              : null
          const trainsDays = item.days.length

          return (
            <li
              key={item.id}
              className="flex items-baseline gap-2 text-sm text-neutral-200"
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-neutral-500">
                {daysSince !== null && `${daysSince}d`}
                {trainsDays > 0 && ` · trains ${trainsDays}×/wk`}
              </span>
            </li>
          )
        })}

        {notStarted.length > 0 && (
          <li className="flex flex-wrap items-baseline gap-1.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Not started yet
            </span>
            <span className="text-neutral-400">
              {shownNotStarted.map(e => e.name).join(', ')}
              {extraNotStarted > 0 && (
                <span className="ml-1 text-neutral-500">
                  +{extraNotStarted} more
                </span>
              )}
            </span>
          </li>
        )}
      </ul>
    </section>
  )
}
