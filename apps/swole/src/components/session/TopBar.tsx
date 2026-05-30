'use client'

import { cns } from '@lilnas/utils/cns'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import UndoIcon from '@mui/icons-material/Undo'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'

import type { ProgressData } from 'src/lib/runner'

export type TopBarProps = {
  routineName: string
  progress: ProgressData
  canUndo: boolean
  onUndo: () => void
  onOpenDrawer: () => void
  onExit: () => void
}

export function TopBar({
  routineName,
  progress,
  canUndo,
  onUndo,
  onOpenDrawer,
  onExit,
}: TopBarProps) {
  const { activeExerciseIdx, exerciseCount, loggedSets, totalSets } = progress
  const pct = totalSets > 0 ? (loggedSets / totalSets) * 100 : 0

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <IconButton
          size="small"
          aria-label="Leave session"
          onClick={onExit}
          className="!text-neutral-400 hover:!bg-neutral-800 hover:!text-white"
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>

        <div className="min-w-0 flex-1 px-1">
          <Typography
            component="p"
            variant="body2"
            className="!truncate !font-semibold !leading-tight"
          >
            {routineName}
          </Typography>
          <Typography
            component="p"
            variant="caption"
            color="text.secondary"
            className="!leading-tight"
          >
            Exercise {activeExerciseIdx + 1}/{exerciseCount}
          </Typography>
        </div>

        <IconButton
          size="small"
          aria-label="Undo last set"
          disabled={!canUndo}
          onClick={onUndo}
          className={cns(
            'hover:!bg-neutral-800',
            canUndo
              ? '!text-neutral-300 hover:!text-white'
              : '!text-neutral-600',
          )}
        >
          <UndoIcon fontSize="small" />
        </IconButton>

        <IconButton
          size="small"
          aria-label="Browse exercises"
          onClick={onOpenDrawer}
          className="!text-neutral-400 hover:!bg-neutral-800 hover:!text-white"
        >
          <FitnessCenterIcon fontSize="small" />
        </IconButton>
      </div>

      {/* Thin progress bar */}
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full bg-orange-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={loggedSets}
          aria-valuemax={totalSets}
          aria-label={`${loggedSets} of ${totalSets} sets completed`}
        />
      </div>
    </div>
  )
}
