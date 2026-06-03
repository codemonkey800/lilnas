'use client'

import { cns } from '@lilnas/utils/cns'
import UnarchiveIcon from '@mui/icons-material/Unarchive'
import Button from '@mui/material/Button'
import Link from 'next/link'
import { useTransition } from 'react'

import { unarchiveRoutine } from 'src/actions/routines'
import type { ArchivedRoutineSummary } from 'src/db/routines'
import { useToast } from 'src/hooks/use-toast'
import { formatRelativeDay, mapUnarchiveRoutineError } from 'src/lib/format'

type Props = {
  summary: ArchivedRoutineSummary
  now: Date
}

export function ArchivedRoutineRow({ summary, now }: Props) {
  const { routine, exerciseCount, lastTrained } = summary
  const { showToast } = useToast()
  const [isPending, startTransition] = useTransition()

  const label = lastTrained
    ? formatRelativeDay(lastTrained, now)
    : 'Never trained'
  const exerciseLabel =
    exerciseCount === 1 ? '1 exercise' : `${exerciseCount} exercises`

  const handleRestore = (e: React.MouseEvent) => {
    e.stopPropagation()
    startTransition(async () => {
      const result = await unarchiveRoutine({ id: routine.id })
      if (!result.ok) {
        const { message, severity } = mapUnarchiveRoutineError(result)
        showToast(message, severity)
        return
      }
      showToast(`Restored ${routine.name}`, 'success')
    })
  }

  return (
    <div
      className={cns(
        'flex min-h-[56px] items-center gap-2 px-4 py-3',
        isPending && 'opacity-50',
      )}
    >
      <Link
        href={`/routines/${routine.id}`}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium text-neutral-100">
            {routine.name}
          </span>
          <span className="text-sm text-neutral-500">
            {exerciseLabel} · {label}
          </span>
        </div>
        <span aria-hidden="true" className="shrink-0 text-neutral-700">
          ›
        </span>
      </Link>

      <Button
        variant="text"
        size="small"
        startIcon={<UnarchiveIcon fontSize="small" />}
        aria-label={`Restore ${routine.name}`}
        onClick={handleRestore}
        disabled={isPending}
        className="!shrink-0 !text-xs !text-neutral-400 hover:!text-neutral-200"
      >
        Restore
      </Button>
    </div>
  )
}
