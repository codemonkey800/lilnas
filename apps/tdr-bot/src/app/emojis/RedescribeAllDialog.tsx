import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'

import { useRedescribeAllEmojis } from 'src/queries/useEmojis'

interface RedescribeAllDialogProps {
  open: boolean
  total: number
  manual: number
  onClose: () => void
  onStarted: () => void
}

/** Confirms replacing every description with a fresh AI one. */
export function RedescribeAllDialog({
  open,
  total,
  manual,
  onClose,
  onStarted,
}: RedescribeAllDialogProps) {
  const redescribeAll = useRedescribeAllEmojis()

  const close = () => {
    redescribeAll.reset()
    onClose()
  }

  const confirm = () => {
    redescribeAll.mutate(undefined, {
      onSuccess: () => {
        onStarted()
        close()
      },
    })
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>Re-describe all {total} emojis?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ color: 'text.primary' }}>
          Every emoji gets a new AI description, written in batches so similar
          emojis stay distinct. This runs in the background.
        </DialogContentText>
        {manual > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {manual} hand-written description{manual === 1 ? '' : 's'} will be
            replaced. The old text isn’t kept.
          </Alert>
        )}
        {redescribeAll.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {redescribeAll.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={close}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={redescribeAll.isPending}
          onClick={confirm}
          startIcon={
            redescribeAll.isPending ? <CircularProgress size={14} /> : undefined
          }
        >
          Re-describe all
        </Button>
      </DialogActions>
    </Dialog>
  )
}
