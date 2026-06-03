'use client'

import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { deleteRoutine, unarchiveRoutine } from 'src/actions/routines'
import type { RoutineRow } from 'src/db/types'
import { useToast } from 'src/hooks/use-toast'
import { mapDeleteRoutineError, mapUnarchiveRoutineError } from 'src/lib/format'

type Props = {
  routine: RoutineRow
  hasCompletedSession: boolean
}

export function ArchivedRoutineDetailActions({
  routine,
  hasCompletedSession,
}: Props) {
  const { showToast } = useToast()
  const router = useRouter()
  const [restorePending, startRestore] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const isPending = restorePending || deletePending

  const handleRestore = () => {
    startRestore(async () => {
      const result = await unarchiveRoutine({ id: routine.id })
      if (!result.ok) {
        const { message, severity } = mapUnarchiveRoutineError(result)
        showToast(message, severity)
        return
      }
      showToast(`Restored ${routine.name}`, 'success')
      router.push('/')
    })
  }

  const handleConfirmDelete = () => {
    startDelete(async () => {
      setDeleteDialogOpen(false)
      const result = await deleteRoutine({ id: routine.id })
      if (!result.ok) {
        const { message, severity } = mapDeleteRoutineError(result)
        showToast(message, severity)
        return
      }
      showToast(`Deleted ${routine.name}`, 'success')
      router.push('/routines/archived')
    })
  }

  return (
    <>
      <div className="flex flex-col gap-3 pt-2">
        <Button
          variant="contained"
          fullWidth
          onClick={handleRestore}
          disabled={isPending}
          aria-label={`Restore ${routine.name}`}
        >
          Restore routine
        </Button>

        <div className="flex flex-col gap-1">
          <Button
            variant="outlined"
            color="error"
            fullWidth
            onClick={() => setDeleteDialogOpen(true)}
            disabled={isPending || hasCompletedSession}
            aria-label={`Delete ${routine.name}`}
          >
            Delete permanently
          </Button>
          {hasCompletedSession && (
            <Typography
              variant="caption"
              color="text.secondary"
              className="text-center"
            >
              Logged history can&apos;t be deleted
            </Typography>
          )}
        </div>
      </div>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        PaperProps={{ className: '!bg-neutral-900 !text-neutral-100' }}
      >
        <DialogTitle>Delete {routine.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText className="!text-neutral-300">
            This can&apos;t be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteDialogOpen(false)}
            className="!text-neutral-300"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            color="error"
            disabled={deletePending}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
