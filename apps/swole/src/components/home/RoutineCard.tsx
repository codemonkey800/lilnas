'use client'

import { cns } from '@lilnas/utils/cns'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

import { archiveRoutine } from 'src/actions/routines'
import { startSession } from 'src/actions/sessions'
import type { ExerciseWithId } from 'src/db/mappers'
import { type DayCode } from 'src/db/schema'
import type { RoutineRow } from 'src/db/types'
import { useToast } from 'src/hooks/use-toast'
import {
  formatDayCodes,
  formatNextUpLine,
  mapArchiveRoutineError,
  mapStartSessionError,
} from 'src/lib/format'

export type RoutineCardProps = {
  routine: RoutineRow
  exerciseCount: number
  // Already converted from `ExerciseRow` to the FSM-side `Exercise` (via
  // `toExercise`) by the caller, so the formatter sees a discriminated union
  // without null-guards.
  firstExercise: ExerciseWithId | null
  todayCode: DayCode | null
}

export function RoutineCard({
  routine,
  exerciseCount,
  firstExercise,
  todayCode,
}: RoutineCardProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isStartingSession, startSessionTransition] = useTransition()
  const [isArchiving, startArchiveTransition] = useTransition()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [menuExiting, setMenuExiting] = useState(false)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => () => clearTimeout(exitTimerRef.current), [])

  const closeMenu = useCallback(() => {
    setMenuAnchor(null)
    // Keep the elevation lock for 300ms so the MUI exit animation (~200ms)
    // finishes before we hand control back to CSS :hover. Without this, the
    // backdrop briefly blocks :hover during the animation, causing a snap.
    setMenuExiting(true)
    clearTimeout(exitTimerRef.current)
    exitTimerRef.current = setTimeout(() => setMenuExiting(false), 300)
  }, [])

  const handleStartSession = useCallback(() => {
    startSessionTransition(async () => {
      const result = await startSession({ routineId: routine.id })
      if (!result.ok) {
        const { message, severity } = mapStartSessionError(result)
        showToast(message, severity)
        return
      }
      router.push(`/session/${result.row.id}`)
    })
  }, [routine.id, router, showToast])

  const openArchiveDialog = useCallback(() => {
    closeMenu()
    setArchiveDialogOpen(true)
  }, [closeMenu])

  const closeArchiveDialog = useCallback(() => {
    setArchiveDialogOpen(false)
  }, [])

  const handleConfirmArchive = useCallback(() => {
    startArchiveTransition(async () => {
      const result = await archiveRoutine({ id: routine.id })
      if (!result.ok) {
        const { message, severity } = mapArchiveRoutineError(result)
        showToast(message, severity)
        return
      }
      setArchiveDialogOpen(false)
    })
  }, [routine.id, showToast])

  const dayTokens = formatDayCodes(routine.days, todayCode)
  const menuOpen = menuAnchor !== null
  // True while the menu is open OR while its exit animation is running.
  // Keeps the card elevated through the full MUI close lifecycle so CSS :hover
  // can re-apply cleanly once the backdrop is gone.
  const isCardActive = menuOpen || menuExiting
  const hasToday = dayTokens.some(tok => tok.isToday)

  return (
    <div
      className={cns(
        'group relative flex flex-col gap-4 rounded-xl border bg-neutral-900/80 p-5 shadow-md transition-all',
        isCardActive
          ? '-translate-y-0.5 bg-neutral-900 shadow-lg'
          : 'hover:-translate-y-0.5 hover:bg-neutral-900 hover:shadow-lg',
        hasToday
          ? 'border-orange-500/40 ring-1 ring-orange-500/20'
          : isCardActive
            ? 'border-neutral-700'
            : 'border-neutral-800 hover:border-neutral-700',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          {hasToday && (
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-400">
              Today
            </span>
          )}
          <Typography
            component="h2"
            variant="h6"
            className="!font-bold !leading-tight"
          >
            {routine.name}
          </Typography>
        </div>
        <IconButton
          size="small"
          aria-label={`${routine.name} actions`}
          onClick={e => setMenuAnchor(e.currentTarget)}
          className="!text-neutral-400 hover:!bg-neutral-800 hover:!text-white"
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </div>

      {dayTokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dayTokens.map(tok => (
            <span
              key={tok.code}
              className={cns(
                'rounded-md px-2 py-0.5 text-xs font-medium',
                tok.isToday
                  ? 'bg-orange-700 text-white'
                  : 'bg-neutral-800 text-neutral-300',
              )}
            >
              {tok.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1 text-sm text-neutral-400">
        <div className="flex items-center gap-1.5">
          <FitnessCenterIcon className="!text-base !text-neutral-500" />
          <span>
            {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
          </span>
        </div>
        {firstExercise && (
          <div className="truncate text-neutral-300">
            <span className="text-neutral-500">Next up · </span>
            {formatNextUpLine(firstExercise)}
          </div>
        )}
      </div>

      <Button
        variant="contained"
        fullWidth
        disabled={isStartingSession}
        onClick={handleStartSession}
        startIcon={<PlayArrowIcon />}
        className="!mt-1 !font-semibold"
      >
        Start session
      </Button>

      <Menu anchorEl={menuAnchor} open={menuOpen} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu()
            router.push(`/routines/${routine.id}`)
          }}
        >
          Edit
        </MenuItem>
        <MenuItem onClick={openArchiveDialog}>Archive…</MenuItem>
      </Menu>

      <Dialog open={archiveDialogOpen} onClose={closeArchiveDialog}>
        <DialogTitle>Archive {routine.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Archived routines disappear from home but their history remains. You
            can restore later from the routine page.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeArchiveDialog} disabled={isArchiving}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmArchive}
            color="warning"
            variant="contained"
            disabled={isArchiving}
          >
            Archive
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
