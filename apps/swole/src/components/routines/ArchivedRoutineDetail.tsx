import Typography from '@mui/material/Typography'
import Link from 'next/link'

import { ExerciseTypeBadge } from 'src/components/stats/ExerciseTypeBadge'
import { toExercise } from 'src/db/mappers'
import type { ExerciseRow, RoutineRow } from 'src/db/types'
import {
  formatDayCodes,
  formatExerciseConfig,
  formatRelativeDay,
} from 'src/lib/format'

type Props = {
  routine: RoutineRow & { archivedAt: Date }
  exercises: ExerciseRow[]
  now: Date
  hasCompletedSession: boolean
}

export function ArchivedRoutineDetail({
  routine,
  exercises,
  now,
  hasCompletedSession,
}: Props) {
  const dayTokens = formatDayCodes(routine.days, null)
  const archivedLabel = formatRelativeDay(routine.archivedAt, now)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Typography component="h1" variant="h5" className="!font-bold">
            {routine.name}
          </Typography>
          <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-400">
            Archived
          </span>
        </div>
        <Typography variant="body2" color="text.secondary">
          archived {archivedLabel}
        </Typography>
      </div>

      {/* Day pills */}
      {dayTokens.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dayTokens.map(tok => (
            <span
              key={tok.code}
              className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1 text-sm text-neutral-300"
            >
              {tok.label}
            </span>
          ))}
        </div>
      )}

      {/* Exercise list */}
      {exercises.length > 0 && (
        <div className="flex flex-col gap-2">
          <Typography
            variant="body2"
            color="text.secondary"
            className="!font-medium"
          >
            Exercises
          </Typography>
          <ul className="flex flex-col divide-y divide-neutral-800 rounded-xl border border-neutral-800">
            {exercises.map(row => {
              const ex = toExercise(row)
              return (
                <li key={row.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-100">
                      {row.name}
                    </span>
                    <ExerciseTypeBadge type={row.type} />
                  </div>
                  <span className="text-sm text-neutral-500">
                    {formatExerciseConfig(ex)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* View stats link — only when routine has history */}
      {hasCompletedSession && (
        <Link
          href={`/stats?routine=${routine.id}`}
          className="text-sm text-blue-400 hover:underline"
        >
          View stats →
        </Link>
      )}
    </div>
  )
}
