import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

import type { ReminderView } from 'src/api/api.types'

import {
  ACTION_LABELS,
  formatWhen,
  relativeTime,
  scheduleLines,
  whoLabel,
} from './format'
import { ReminderCard, type ReminderRowProps } from './ReminderCard'
import { StatusChip } from './StatusChip'

const HEADERS = [
  'Status',
  'What',
  'Who',
  'Schedule',
  'Next run',
  'Last run',
  '',
]

function ReminderRow({
  reminder,
  now,
  onEdit,
  onCancel,
  onTest,
}: ReminderRowProps) {
  const [description, ...rest] = scheduleLines(reminder)

  return (
    <TableRow sx={{ verticalAlign: 'top' }}>
      <TableCell>
        <StatusChip status={reminder.status} />
      </TableCell>
      <TableCell sx={{ maxWidth: 256 }}>
        <Typography variant="body2">{reminder.what}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <Chip
            size="small"
            variant="outlined"
            label={ACTION_LABELS[reminder.actionType]}
          />
          <Typography variant="caption" color="text.secondary">
            {reminder.channelName ? `#${reminder.channelName}` : 'default'}
          </Typography>
        </Box>
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>{whoLabel(reminder)}</TableCell>
      <TableCell sx={{ minWidth: 160 }}>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {description}
        </Typography>
        {rest.map(line => (
          <Typography
            key={line}
            variant="caption"
            color="text.secondary"
            fontFamily={
              line === reminder.cronExpression ? 'monospace' : undefined
            }
            sx={{ display: 'block', whiteSpace: 'nowrap' }}
          >
            {line}
          </Typography>
        ))}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        {reminder.nextRunAt
          ? `${relativeTime(reminder.nextRunAt, now)} · ${formatWhen(reminder.nextRunAt)}`
          : '—'}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {formatWhen(reminder.lastRunAt)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block' }}
        >
          {reminder.runCount} runs
        </Typography>
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Button size="small" onClick={() => onTest(reminder)}>
          Test
        </Button>
        <Button size="small" onClick={() => onEdit(reminder)}>
          Edit
        </Button>
        {reminder.status === 'active' && (
          <Button size="small" color="error" onClick={() => onCancel(reminder)}>
            Cancel
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

interface ReminderTableProps {
  reminders: ReminderView[]
  now: Date
  onEdit: (reminder: ReminderView) => void
  onCancel: (reminder: ReminderView) => void
  onTest: (reminder: ReminderView) => void
}

/** A table from the `md` breakpoint up, stacked cards below it. */
export function ReminderTable({
  reminders,
  now,
  onEdit,
  onCancel,
  onTest,
}: ReminderTableProps) {
  return (
    <>
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ display: { xs: 'none', md: 'block' } }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              {HEADERS.map((h, i) => (
                <TableCell key={i} sx={{ whiteSpace: 'nowrap' }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {reminders.map(reminder => (
              <ReminderRow
                key={reminder.id}
                reminder={reminder}
                now={now}
                onEdit={onEdit}
                onCancel={onCancel}
                onTest={onTest}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
        {reminders.map(reminder => (
          <ReminderCard
            key={reminder.id}
            reminder={reminder}
            now={now}
            onEdit={onEdit}
            onCancel={onCancel}
            onTest={onTest}
          />
        ))}
      </Stack>
    </>
  )
}
