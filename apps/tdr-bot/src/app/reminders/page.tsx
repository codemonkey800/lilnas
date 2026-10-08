'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import type { ReminderView } from 'src/api/api.types'
import type { ReminderStatus } from 'src/db/schema'
import { useReminders } from 'src/queries/useReminders'

import { CancelDialog } from './CancelDialog'
import { ReminderDialog } from './ReminderDialog'
import { ReminderTable } from './ReminderTable'

type StatusFilter = ReminderStatus | 'all'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'missed', label: 'Missed' },
  { value: 'all', label: 'All' },
]

function matches(reminder: ReminderView, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) return true

  return [reminder.what, reminder.userName, reminder.targetUserName].some(
    field => field?.toLowerCase().includes(needle),
  )
}

export default function RemindersPage() {
  const [status, setStatus] = useState<StatusFilter>('active')
  const [text, setText] = useState('')
  const [dialog, setDialog] = useState<{
    open: boolean
    reminder: ReminderView | null
  }>({ open: false, reminder: null })
  const [cancelling, setCancelling] = useState<ReminderView | null>(null)

  const all = useReminders({ status: 'all' })
  const list = useReminders({ status })

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      active: 0,
      completed: 0,
      cancelled: 0,
      missed: 0,
      all: 0,
    }
    for (const r of all.data ?? []) {
      result[r.status] += 1
      result.all += 1
    }

    return result
  }, [all.data])

  const visible = useMemo(
    () => (list.data ?? []).filter(r => matches(r, text)),
    [list.data, text],
  )
  const now = new Date()
  const label = FILTERS.find(f => f.value === status)?.label.toLowerCase()

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Typography variant="h4" component="h1" fontWeight={600}>
        Reminders
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 3, mt: 0.5 }}
      >
        Every reminder the bot holds.
      </Typography>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1.5,
          mb: 2,
        }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={status}
          aria-label="Status filter"
          onChange={(_, value: StatusFilter | null) =>
            value && setStatus(value)
          }
        >
          {FILTERS.map(f => (
            <ToggleButton key={f.value} value={f.value}>
              {f.label}
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{ ml: 0.75 }}
              >
                {counts[f.value]}
              </Typography>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="Who or what…"
          value={text}
          onChange={e => setText(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Filter reminders' } }}
          sx={{ width: 224 }}
        />
        <Button
          variant="contained"
          sx={{ ml: 'auto' }}
          onClick={() => setDialog({ open: true, reminder: null })}
        >
          + New reminder
        </Button>
      </Box>

      {list.isLoading && (
        <Stack spacing={1} aria-label="Loading reminders">
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} variant="rounded" height={40} />
          ))}
        </Stack>
      )}
      {list.error && (
        <Alert severity="error">
          Couldn’t load reminders: {list.error.message}
        </Alert>
      )}
      {list.data && visible.length === 0 && (
        <Box
          sx={{
            py: 8,
            textAlign: 'center',
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography fontSize={32}>⏰</Typography>
          <Typography variant="body2" fontWeight={500} sx={{ mt: 1 }}>
            {text.trim()
              ? 'No matching reminders'
              : `No ${status === 'all' ? '' : `${label} `}reminders`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Create one, or ask tdr-bot in Discord.
          </Typography>
        </Box>
      )}
      {visible.length > 0 && (
        <ReminderTable
          reminders={visible}
          now={now}
          onEdit={reminder => setDialog({ open: true, reminder })}
          onCancel={setCancelling}
        />
      )}

      <ReminderDialog
        open={dialog.open}
        reminder={dialog.reminder}
        onClose={() => setDialog(d => ({ ...d, open: false }))}
      />
      <CancelDialog reminder={cancelling} onClose={() => setCancelling(null)} />
    </Box>
  )
}
