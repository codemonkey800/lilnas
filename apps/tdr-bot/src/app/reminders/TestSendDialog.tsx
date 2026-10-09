import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { ReminderView } from 'src/api/api.types'
import { useReminderRuns, useTestReminder } from 'src/queries/useReminders'

import { atTimeOfDay, formatWhen, testDateBounds, toDateInput } from './format'

interface TestSendDialogProps {
  reminder: ReminderView | null
  onClose: () => void
}

/** DMs the reminder's creator the message it would send at a chosen run. */
export function TestSendDialog({ reminder, onClose }: TestSendDialogProps) {
  const runs = useReminderRuns(reminder?.id ?? null)
  const test = useTestReminder()
  const [picked, setPicked] = useState<string | null>(null)

  // Test sends keep the reminder's time of day; only the date is chosen.
  const first = runs.data?.runs[0]
  const timeOfDay = first ? new Date(first) : null
  const bounds = timeOfDay
    ? testDateBounds(timeOfDay, reminder?.endsAt ?? null, new Date())
    : null
  const exhausted = !!bounds && !!bounds.max && bounds.min > bounds.max

  const date =
    picked ??
    (timeOfDay && bounds
      ? [toDateInput(timeOfDay), bounds.min].reduce((a, b) => (a > b ? a : b))
      : '')
  const valid =
    !!bounds &&
    !!date &&
    date >= bounds.min &&
    (!bounds.max || date <= bounds.max)
  const at =
    valid && timeOfDay ? atTimeOfDay(date, timeOfDay).toISOString() : ''

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
          type="date"
          fullWidth
          label="Send as if it were"
          value={date}
          disabled={!runs.data || exhausted || test.isPending}
          error={!!runs.error || exhausted || (!!date && !valid)}
          helperText={
            runs.error?.message ??
            (exhausted
              ? 'This reminder has no future dates left to test.'
              : bounds?.max
                ? `Future dates up to when it ends (${bounds.max}).`
                : undefined)
          }
          onChange={e => {
            setPicked(e.target.value)
            test.reset()
          }}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { min: bounds?.min, max: bounds?.max ?? undefined },
          }}
          sx={{ mt: 2.5 }}
        />

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
