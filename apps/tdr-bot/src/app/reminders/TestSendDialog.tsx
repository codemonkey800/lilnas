import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { ReminderView } from 'src/api/api.types'
import { useReminderRuns, useTestReminder } from 'src/queries/useReminders'

import { formatWhen } from './format'

interface TestSendDialogProps {
  reminder: ReminderView | null
  onClose: () => void
}

/** "Fri, Oct 9, 2026, 9:00 AM" — runs can be months out, so keep the year. */
function formatRun(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** DMs the reminder's creator the message it would send at a chosen run. */
export function TestSendDialog({ reminder, onClose }: TestSendDialogProps) {
  const runs = useReminderRuns(reminder?.id ?? null)
  const test = useTestReminder()
  const [picked, setPicked] = useState<string | null>(null)

  const at = picked ?? runs.data?.runs[0] ?? ''

  const close = () => {
    test.reset()
    setPicked(null)
    onClose()
  }

  const send = () => {
    if (!reminder || !at) return
    test.mutate({ id: reminder.id, at })
  }

  return (
    <Dialog open={!!reminder} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>Send a test</DialogTitle>
      <DialogContent>
        <DialogContentText color="text.primary">
          {reminder?.what}
        </DialogContentText>
        <Typography variant="caption" color="text.secondary">
          DMs @{reminder?.userName} the message this reminder would send at the
          chosen time. Its schedule isn’t touched.
        </Typography>

        <TextField
          select
          fullWidth
          label="Send as if it were"
          value={at}
          disabled={!runs.data || test.isPending}
          error={!!runs.error}
          helperText={runs.error?.message}
          onChange={e => {
            setPicked(e.target.value)
            test.reset()
          }}
          sx={{ mt: 2.5 }}
        >
          {(runs.data?.runs ?? []).map((run, i) => (
            <MenuItem key={run} value={run}>
              {formatRun(run)}
              {i === 0 && reminder?.nextRunAt === run && (
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1 }}
                >
                  next
                </Typography>
              )}
            </MenuItem>
          ))}
        </TextField>

        {test.isSuccess && (
          <Alert severity="success" sx={{ mt: 2 }}>
            Sent to @{reminder?.userName}’s DMs as of {formatWhen(at)}.
          </Alert>
        )}
        {test.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {test.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={close}>
          Close
        </Button>
        <Button
          variant="contained"
          disabled={!at || test.isPending}
          onClick={send}
          startIcon={
            test.isPending ? <CircularProgress size={14} /> : undefined
          }
        >
          {test.isSuccess ? 'Send again' : 'Send test'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
