import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'

import type { ReminderView } from 'src/api/api.types'

import {
  ACTION_LABELS,
  formatWhen,
  relativeTime,
  scheduleLines,
  whoLabel,
} from './format'
import { StatusChip } from './StatusChip'

export interface ReminderRowProps {
  reminder: ReminderView
  now: Date
  onEdit: (reminder: ReminderView) => void
  onCancel: (reminder: ReminderView) => void
}

export function ReminderCard({
  reminder,
  now,
  onEdit,
  onCancel,
}: ReminderRowProps) {
  const [description, ...rest] = scheduleLines(reminder)

  return (
    <Card variant="outlined">
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box
          sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}
        >
          <Typography variant="body2" fontWeight={500}>
            {reminder.what}
          </Typography>
          <StatusChip status={reminder.status} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {whoLabel(reminder)}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>
          {description}
        </Typography>
        {rest.map(line => (
          <Typography
            key={line}
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block' }}
          >
            {line}
          </Typography>
        ))}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.5 }}
        >
          Next:{' '}
          {reminder.nextRunAt
            ? `${relativeTime(reminder.nextRunAt, now)} · ${formatWhen(reminder.nextRunAt)}`
            : '—'}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mt: 1.5,
          }}
        >
          <Chip
            size="small"
            variant="outlined"
            label={ACTION_LABELS[reminder.actionType]}
          />
          <Box>
            <Button size="small" onClick={() => onEdit(reminder)}>
              Edit
            </Button>
            {reminder.status === 'active' && (
              <Button
                size="small"
                color="error"
                onClick={() => onCancel(reminder)}
              >
                Cancel
              </Button>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  )
}
