'use client'

import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'

import type { Exercise, SetLog } from 'src/core/session-machine'
import { formatPreviousSetPeek } from 'src/lib/format'

export type ReviewCardProps = {
  exercise: Exercise
  loggedSets: SetLog[]
  onBack: () => void
}

export function ReviewCard({ exercise, loggedSets, onBack }: ReviewCardProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/80 p-5 shadow-md">
      <div className="flex items-center gap-2">
        <Button
          startIcon={<ArrowBackIcon />}
          size="small"
          onClick={onBack}
          className="!text-neutral-400 hover:!text-white"
        >
          Back to current set
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <Typography component="h2" variant="h6" className="!font-bold">
          {exercise.name}
        </Typography>
        <Typography component="p" variant="caption" color="text.secondary">
          {loggedSets.length} of {exercise.sets} sets logged
        </Typography>
      </div>

      {loggedSets.length > 0 && <Divider className="!border-neutral-800" />}

      <div className="flex flex-col gap-2">
        {loggedSets.map((log, i) => {
          const peekStr = formatPreviousSetPeek(
            {
              kind: 'log',
              weight: log.weight,
              reps: log.reps,
              actualReps: log.actualReps,
              duration: log.duration,
              actualDuration: log.actualDuration,
              action: log.action,
            },
            exercise,
          )
          return (
            <div key={i} className="flex items-center justify-between gap-2">
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
              >
                Set {i + 1}
              </Typography>
              <Typography
                component="span"
                variant="body2"
                className="!text-neutral-300"
              >
                {peekStr}
              </Typography>
            </div>
          )
        })}

        {loggedSets.length === 0 && (
          <Typography component="p" variant="body2" color="text.secondary">
            No sets logged yet.
          </Typography>
        )}
      </div>
    </div>
  )
}
