import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'

import type { ReminderView } from 'src/api/api.types'
import { useCancelReminder } from 'src/queries/useReminders'

interface CancelDialogProps {
  reminder: ReminderView | null
  onClose: () => void
}

export function CancelDialog({ reminder, onClose }: CancelDialogProps) {
  const cancel = useCancelReminder()

  const close = () => {
    cancel.reset()
    onClose()
  }

  const confirm = () => {
    if (!reminder) return
    cancel.mutate(reminder.id, { onSuccess: close })
  }

  return (
    <Dialog open={!!reminder} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>Cancel this reminder?</DialogTitle>
      <DialogContent>
        <DialogContentText color="text.primary">
          {reminder?.what}
        </DialogContentText>
        <Typography variant="caption" color="text.secondary">
          {reminder?.scheduleDescription}
        </Typography>
        {cancel.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {cancel.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={close}>
          Keep
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={cancel.isPending}
          onClick={confirm}
          startIcon={
            cancel.isPending ? <CircularProgress size={14} /> : undefined
          }
        >
          Cancel reminder
        </Button>
      </DialogActions>
    </Dialog>
  )
}
