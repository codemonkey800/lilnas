'use client'

import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { deleteSession } from 'src/actions/sessions'
import type { ProgressionRow } from 'src/db/types'
import { useToast } from 'src/hooks/use-toast'
import { mapDeleteSessionError } from 'src/lib/format'
import { canDeleteSession } from 'src/lib/session-detail'

export type SessionDetailActionsProps = {
  sessionId: number
  progressions: ProgressionRow[]
}

export function SessionDetailActions({
  sessionId,
  progressions,
}: SessionDetailActionsProps) {
  const { showToast } = useToast()
  const router = useRouter()
  const [deletePending, startDelete] = useTransition()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const canDelete = canDeleteSession(progressions)

  const handleConfirmDelete = () => {
    startDelete(async () => {
      setDeleteDialogOpen(false)
      const result = await deleteSession({ sessionId })
      if (!result.ok) {
        const { message, severity } = mapDeleteSessionError(result)
        showToast(message, severity)
        return
      }
      router.push('/')
    })
  }

  return (
    <>
      <div className="flex flex-col gap-1 pt-2">
        {canDelete ? (
          <Button
            variant="outlined"
            color="error"
            fullWidth
            onClick={() => setDeleteDialogOpen(true)}
            disabled={deletePending}
            aria-label="Delete this session"
          >
            Delete session
          </Button>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-400">
            <InfoOutlinedIcon className="!text-base !shrink-0" />
            <span>
              This session recorded a progression and can&apos;t be deleted.
            </span>
          </div>
        )}
      </div>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        PaperProps={{ className: '!bg-neutral-900 !text-neutral-100' }}
      >
        <DialogTitle>Delete session?</DialogTitle>
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
