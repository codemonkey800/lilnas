import { cns } from '@lilnas/utils/cns'
import Button from '@mui/material/Button'

import type { ExerciseRow, ProgressionRow } from 'src/db/types'
import { formatRelativeDay, formatWeight } from 'src/lib/format'
import type { StatsScope } from 'src/lib/stats'
import { classifyTrend, TREND_GLYPH, TREND_LABEL } from 'src/lib/stats'

import { ExerciseTypeBadge } from './ExerciseTypeBadge'

type Props = {
  exercise: ExerciseRow
  lastPerformedAt: Date | null
  progressions: ProgressionRow[]
  scope: StatsScope
  now: Date
}

export function ExerciseStatRow({
  exercise,
  lastPerformedAt,
  progressions,
  scope,
  now,
}: Props) {
  const isWeighted = exercise.type === 'weighted'
  const isArchivedScope = scope.kind === 'archived'

  // Trend arrow: shown for weighted exercises in active/all scope only.
  const trend =
    isWeighted && !isArchivedScope && progressions.length > 0
      ? classifyTrend(progressions, now)
      : null

  const currentWeight =
    isWeighted && exercise.startingWeight !== null
      ? formatWeight(exercise.startingWeight)
      : null

  const recency = lastPerformedAt
    ? formatRelativeDay(lastPerformedAt, now)
    : '—'

  return (
    <li>
      <Button
        href={`/stats/${exercise.id}`}
        fullWidth
        className={cns(
          '!flex !items-center !justify-between !rounded-none !px-4 !py-3',
          '!text-left !text-sm !text-neutral-200 !transition-colors',
          'hover:!bg-neutral-800/50 hover:!text-orange-400',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">{exercise.name}</span>
          <ExerciseTypeBadge type={exercise.type} />
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
          {currentWeight && (
            <span className="flex items-center gap-0.5">
              <span>{currentWeight}</span>
              {trend && (
                <>
                  <span
                    aria-hidden="true"
                    className={cns(
                      'ml-0.5',
                      trend === 'up' ? 'text-orange-500' : 'text-neutral-400',
                    )}
                  >
                    {TREND_GLYPH[trend]}
                  </span>
                  <span className="sr-only">{TREND_LABEL[trend]}</span>
                </>
              )}
            </span>
          )}
          <span>{recency}</span>
          <span aria-hidden="true" className="text-neutral-700">
            ›
          </span>
        </span>
      </Button>
    </li>
  )
}
