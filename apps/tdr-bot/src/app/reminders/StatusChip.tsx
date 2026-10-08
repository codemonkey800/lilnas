import Chip from '@mui/material/Chip'

import type { ReminderView } from 'src/api/api.types'

import { type StatusTone, statusTone } from './format'

const TONE_COLOR = {
  ok: 'success',
  muted: 'default',
  warn: 'warning',
  bad: 'error',
} as const satisfies Record<StatusTone, string>

export function StatusChip({ status }: { status: ReminderView['status'] }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={TONE_COLOR[statusTone(status)]}
      label={status[0].toUpperCase() + status.slice(1)}
    />
  )
}
