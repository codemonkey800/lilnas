'use client'

import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  onConfirm?: (() => void) | (() => Promise<void>)
  onClose: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          bgcolor: 'var(--color-carbon-800)',
          backgroundImage: 'none',
          borderColor: 'var(--color-carbon-500)',
          border: 1,
        },
      }}
    >
      <DialogTitle sx={{ fontFamily: 'var(--font-mono)', fontSize: '1rem' }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: 'var(--color-carbon-300)' }}>
          {description}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="secondary" size="small">
          Cancel
        </Button>
        <Button
          onClick={() => void onConfirm?.()}
          color="error"
          variant="contained"
          size="small"
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  )
}
