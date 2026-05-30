'use client'

import Typography from '@mui/material/Typography'

import { ActionButtonGrid } from 'src/components/session/ActionButtonGrid'
import type { Action, Exercise, NextTarget } from 'src/core/session-machine'
import { formatPreviousSetPeek, formatRunnerTarget } from 'src/lib/format'
import type { ButtonSlotConfig, PreviousSetPeek } from 'src/lib/runner'

export type CurrentSetCardProps = {
  exercise: Exercise
  target: NextTarget
  peek: PreviousSetPeek
  buttons: ButtonSlotConfig[]
  isPending: boolean
  onAction: (action: Action) => void
  onOpenFailed: () => void
}

export function CurrentSetCard({
  exercise,
  target,
  peek,
  buttons,
  isPending,
  onAction,
  onOpenFailed,
}: CurrentSetCardProps) {
  // R5: single-set cardio omits the "of N" set line.
  const isCardioSingle = exercise.type === 'cardio'
  const peekStr = formatPreviousSetPeek(peek, exercise)

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-neutral-800 bg-neutral-900/80 p-5 shadow-md">
      <div className="flex flex-col gap-1">
        <Typography
          component="h2"
          variant="h6"
          className="!font-bold !leading-tight"
        >
          {exercise.name}
        </Typography>

        {!isCardioSingle && (
          <Typography component="p" variant="body2" color="text.secondary">
            Set {target.setIdx + 1} of {exercise.sets}
          </Typography>
        )}

        <Typography
          component="p"
          variant="h5"
          className="!mt-1 !font-bold !text-orange-400"
        >
          {formatRunnerTarget(exercise, target)}
        </Typography>

        {peekStr && (
          <Typography
            component="p"
            variant="caption"
            color="text.secondary"
            className="!mt-0.5"
          >
            last · {peekStr}
          </Typography>
        )}
      </div>

      <ActionButtonGrid
        buttons={buttons}
        isPending={isPending}
        onAction={onAction}
        onOpenFailed={onOpenFailed}
      />
    </div>
  )
}
